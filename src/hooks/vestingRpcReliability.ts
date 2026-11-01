export type RpcErrorKind = 'rate_limited' | 'network_unavailable' | 'contract_read' | 'unknown'

const MIN_LOG_CHUNK = 1n
const MAX_RETRY_DELAY_MS = 4_000

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.toLowerCase()
  if (typeof error === 'string') return error.toLowerCase()
  try { return JSON.stringify(error).toLowerCase() } catch { return '' }
}

function retryAfterValue(error: unknown): string | number | undefined {
  const candidate = error as {
    response?: { headers?: Headers | Record<string, string> }
    details?: string
    cause?: unknown
  } | undefined
  const headers = candidate?.response?.headers
  if (headers instanceof Headers) return headers.get('retry-after') ?? undefined
  if (headers && typeof headers === 'object') {
    return headers['retry-after'] ?? headers['Retry-After']
  }
  const match = `${candidate?.details ?? ''}`.match(/retry-after\s*[:=]\s*([\d.]+)/i)
  return match?.[1]
}

export function classifyRpcError(error: unknown): RpcErrorKind {
  const text = errorText(error)
  if (/\b429\b|rate.?limit|too many requests|request exceeds defined limit|(?:eth_getlogs|log).*(?:block )?range|range (?:too large|exceeded)|free tier.*(?:eth_getlogs|range)/.test(text)) return 'rate_limited'
  if (/network|fetch failed|timeout|timed out|econn|socket|503|502|504/.test(text)) return 'network_unavailable'
  if (/revert|execution reverted|contract|decode|abi/.test(text)) return 'contract_read'
  return 'unknown'
}

export function retryDelayMs(error: unknown, attempt: number, random = Math.random): number {
  const retryAfter = retryAfterValue(error)
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_DELAY_MS, Math.round(seconds * 1_000))
  }

  const base = Math.min(MAX_RETRY_DELAY_MS, 500 * (2 ** Math.max(0, attempt)))
  return Math.min(MAX_RETRY_DELAY_MS, Math.round(base * (1 + Math.max(0, Math.min(1, random())) * 0.25)))
}

export function nextLogChunkSize(current: bigint, error: unknown): bigint {
  if (classifyRpcError(error) !== 'rate_limited') return current
  const reduced = current / 2n
  return reduced < MIN_LOG_CHUNK ? MIN_LOG_CHUNK : reduced
}

interface PendingRequest {
  run: () => Promise<void>
}

export interface RpcRequestQueue {
  enqueue<T>(key: string, task: () => Promise<T>): Promise<T>
}

export function createRpcRequestQueue(concurrency = 1): RpcRequestQueue {
  const pending: PendingRequest[] = []
  const inFlight = new Map<string, Promise<unknown>>()
  let active = 0

  const drain = () => {
    while (active < Math.max(1, concurrency) && pending.length > 0) {
      const item = pending.shift()!
      active += 1
      void item.run().finally(() => {
        active -= 1
        drain()
      })
    }
  }

  return {
    enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key) as Promise<T> | undefined
      if (existing) return existing

      const promise = new Promise<T>((resolve, reject) => {
        pending.push({
          run: async () => {
            try { resolve(await task()) } catch (error) { reject(error instanceof Error ? error : new Error(String(error))) }
          },
        })
        drain()
      })
      inFlight.set(key, promise)
      void promise.then(() => inFlight.delete(key), () => inFlight.delete(key))
      return promise
    },
  }
}
