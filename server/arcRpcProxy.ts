const ARC_TESTNET_PATH = '/api/rpc/arc-testnet'
const ARC_TESTNET_CHAIN_ID = 5042002n
const MAX_BODY_BYTES = 1_000_000
const REQUEST_TIMEOUT_MS = 10_000

const ALLOWED_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_getBalance',
  'eth_getBlockByHash',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_feeHistory',
  'net_version',
])

export interface ArcRpcProxyEnv {
  ARC_TESTNET_RPC_SECONDARY?: string
  /** Legacy frontend variable accepted for typing only; never used for auth. */
  VITE_ARC_TESTNET_RPC_SECONDARY?: string
}

export interface ArcRpcProxyOptions {
  env?: ArcRpcProxyEnv
  fetchImpl?: typeof fetch
}

export function resolveArcTestnetRpc(env: ArcRpcProxyEnv): string | undefined {
  const value = env.ARC_TESTNET_RPC_SECONDARY?.trim()
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function chainIdMatches(body: unknown): boolean {
  if (!isRecord(body) || typeof body.result !== 'string') return false
  try { return BigInt(body.result) === ARC_TESTNET_CHAIN_ID } catch { return false }
}

export async function handleArcRpc(
  request: Request,
  url: URL,
  options: ArcRpcProxyOptions = {},
): Promise<Response | null> {
  if (url.pathname !== ARC_TESTNET_PATH) return null
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const upstream = resolveArcTestnetRpc(options.env ?? process.env)
  if (!upstream) return json({ error: 'Arc Testnet secondary RPC is not configured' }, 503)

  const rawRequest = await request.text()
  if (new TextEncoder().encode(rawRequest).byteLength > MAX_BODY_BYTES) {
    return json({ error: 'RPC request is too large' }, 413)
  }

  let payload: unknown
  try { payload = JSON.parse(rawRequest) } catch { return json({ error: 'Invalid JSON-RPC request' }, 400) }
  if (!isRecord(payload) || typeof payload.method !== 'string' || !ALLOWED_METHODS.has(payload.method)) {
    return json({ error: 'Unsupported RPC method' }, 400)
  }
  if (payload.params !== undefined && !Array.isArray(payload.params)) {
    return json({ error: 'RPC params must be an array' }, 400)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const fetchImpl = options.fetchImpl ?? fetch
    const response = await fetchImpl(upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rawRequest,
      signal: controller.signal,
    })
    const rawResponse = await response.text()
    if (payload.method === 'eth_chainId' && response.ok) {
      let responseBody: unknown
      try { responseBody = JSON.parse(rawResponse) } catch { responseBody = undefined }
      if (!chainIdMatches(responseBody)) return json({ error: 'Configured secondary is not Arc Testnet' }, 502)
    }
    return new Response(rawResponse, {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
    })
  } catch {
    return json({ error: 'Arc Testnet secondary RPC unavailable' }, 502)
  } finally {
    clearTimeout(timeout)
  }
}
