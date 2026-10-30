/**
 * useVestingEvents — complete event indexer for the deployed USDCVesting contract.
 *
 * Features:
 *  - Resolves the true deployment block from the deploy tx receipt (avoids
 *    scanning from genesis or from an arbitrary lookback window).
 *  - Paginates getLogs in BATCH_SIZE-block increments to stay within RPC limits.
 *  - Incremental sync: persists the last-indexed block in sessionStorage so
 *    navigating between tabs only fetches new blocks, not the full history.
 *  - Deduplication by (txHash, type, logIndex) — safe against re-fetches.
 *  - Reorg detection: if the current head is lower than the cached lastBlock,
 *    the cache is discarded and a full re-index begins.
 *  - Derived indexes (byScheduleId, byBeneficiary, totalClaims) are memoized
 *    and only rebuilt when rawLogs changes.
 *  - Exposes rich progress state (indexedBlock, headBlock, pct) so callers can
 *    show a banner instead of misleading totals during backfill.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPublicClient, http, parseAbiItem } from 'viem'
import { arcTestnet } from 'viem/chains'
import { CONTRACT_ADDRESS } from '@/contractConfig'
import { requireChain } from '@/onchain-facts'

const chain = requireChain(arcTestnet.id)
const rpcUrl = chain.rpcUrls[0]

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(rpcUrl),
})

// ─── ABI items ────────────────────────────────────────────────────────────────
const SCHEDULE_CREATED_ABI = parseAbiItem(
  'event ScheduleCreated(uint256 indexed scheduleId, address indexed beneficiary, uint128 totalAmount, uint48 startTime, uint48 cliffTime, uint48 endTime)',
)
const CLAIMED_ABI = parseAbiItem(
  'event Claimed(uint256 indexed scheduleId, address indexed beneficiary, uint128 amount)',
)
const REVOKED_ABI = parseAbiItem(
  'event ScheduleRevoked(uint256 indexed scheduleId, address indexed beneficiary, uint128 unvestedReturned)',
)

// ─── Constants ────────────────────────────────────────────────────────────────
/** Block range per getLogs call. Stay well under typical RPC caps. */
const BATCH_SIZE = 2_000n

/** Deploy tx hash — used to resolve the exact deployment block. */
const DEPLOY_TX_HASH = '0x35bcde1c1d3fed9008db8267f0754dbc36f735f5e637c39b07a9c75e1e96741f' as `0x${string}`

/** sessionStorage keys */
const SS_LOGS_KEY = 'vestros:eventLogs:v2'
const SS_LAST_BLOCK_KEY = 'vestros:lastBlock:v2'
const SS_DEPLOY_BLOCK_KEY = 'vestros:deployBlock:v2'

// ─── Types ────────────────────────────────────────────────────────────────────
export interface EventLog {
  scheduleId: bigint
  type: 'created' | 'claimed' | 'revoked'
  beneficiary: string
  amount: bigint
  blockNumber: bigint
  txHash: string
  logIndex: number
}

export interface VestingEventIndex {
  logs: EventLog[]
  byScheduleId: Map<string, EventLog[]>
  byBeneficiary: Map<string, bigint[]>
  totalClaims: Map<string, bigint>
  totalCreated: bigint
  totalRevoked: bigint
  loading: boolean
  syncing: boolean        // true during incremental top-up after initial load
  error: string | null
  indexedBlock: bigint    // last block fully indexed
  headBlock: bigint       // chain tip at start of last run
  progressPct: number     // 0-100
  refresh: () => void
}

// ─── SessionStorage helpers ───────────────────────────────────────────────────
function ssGet<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch { return null }
}

function ssSet(key: string, value: unknown): void {
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* quota exceeded — ignore */ }
}

function ssClear(): void {
  try {
    sessionStorage.removeItem(SS_LOGS_KEY)
    sessionStorage.removeItem(SS_LAST_BLOCK_KEY)
  } catch { /* ignore */ }
}

/** Serialize EventLog for JSON (bigint → string) */
type SerializedLog = Omit<EventLog, 'scheduleId' | 'amount' | 'blockNumber'> & {
  scheduleId: string; amount: string; blockNumber: string
}

function serializeLogs(logs: EventLog[]): SerializedLog[] {
  return logs.map(l => ({
    ...l,
    scheduleId: l.scheduleId.toString(),
    amount: l.amount.toString(),
    blockNumber: l.blockNumber.toString(),
  }))
}

function deserializeLogs(raw: SerializedLog[]): EventLog[] {
  return raw.map(l => ({
    ...l,
    scheduleId: BigInt(l.scheduleId),
    amount: BigInt(l.amount),
    blockNumber: BigInt(l.blockNumber),
  }))
}

// ─── Core fetch ───────────────────────────────────────────────────────────────
async function fetchBatch(fromBlock: bigint, toBlock: bigint): Promise<EventLog[]> {
  const [created, claimed, revoked] = await Promise.all([
    publicClient.getLogs({ address: CONTRACT_ADDRESS, event: SCHEDULE_CREATED_ABI, fromBlock, toBlock }),
    publicClient.getLogs({ address: CONTRACT_ADDRESS, event: CLAIMED_ABI, fromBlock, toBlock }),
    publicClient.getLogs({ address: CONTRACT_ADDRESS, event: REVOKED_ABI, fromBlock, toBlock }),
  ])

  const result: EventLog[] = []

  for (const e of created) {
    const a = e.args as { scheduleId: bigint; beneficiary: string; totalAmount: bigint }
    result.push({ scheduleId: a.scheduleId, type: 'created', beneficiary: a.beneficiary.toLowerCase(), amount: a.totalAmount, blockNumber: e.blockNumber ?? 0n, txHash: e.transactionHash ?? '', logIndex: e.logIndex ?? 0 })
  }
  for (const e of claimed) {
    const a = e.args as { scheduleId: bigint; beneficiary: string; amount: bigint }
    result.push({ scheduleId: a.scheduleId, type: 'claimed', beneficiary: a.beneficiary.toLowerCase(), amount: a.amount, blockNumber: e.blockNumber ?? 0n, txHash: e.transactionHash ?? '', logIndex: e.logIndex ?? 0 })
  }
  for (const e of revoked) {
    const a = e.args as { scheduleId: bigint; beneficiary: string; unvestedReturned: bigint }
    result.push({ scheduleId: a.scheduleId, type: 'revoked', beneficiary: a.beneficiary.toLowerCase(), amount: a.unvestedReturned, blockNumber: e.blockNumber ?? 0n, txHash: e.transactionHash ?? '', logIndex: e.logIndex ?? 0 })
  }

  return result
}

async function fetchRange(
  fromBlock: bigint,
  toBlock: bigint,
  onBatchDone?: (indexedBlock: bigint) => void,
): Promise<EventLog[]> {
  const all: EventLog[] = []
  let current = fromBlock
  while (current <= toBlock) {
    const batchEnd = current + BATCH_SIZE - 1n <= toBlock ? current + BATCH_SIZE - 1n : toBlock
    const batch = await fetchBatch(current, batchEnd)
    all.push(...batch)
    onBatchDone?.(batchEnd)
    current = batchEnd + 1n
  }
  return all
}

function dedup(logs: EventLog[]): EventLog[] {
  const seen = new Set<string>()
  return logs.filter(l => {
    const key = `${l.txHash}-${l.type}-${l.logIndex}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sortLogs(logs: EventLog[]): EventLog[] {
  return [...logs].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1
    return a.logIndex - b.logIndex
  })
}

async function resolveDeployBlock(): Promise<bigint> {
  // Try cache first
  const cached = ssGet<string>(SS_DEPLOY_BLOCK_KEY)
  if (cached) return BigInt(cached)

  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: DEPLOY_TX_HASH })
    if (receipt?.blockNumber) {
      ssSet(SS_DEPLOY_BLOCK_KEY, receipt.blockNumber.toString())
      return receipt.blockNumber
    }
  } catch {
    // tx not found (chain reset?) — fall through to genesis
  }
  return 0n
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useVestingEvents(): VestingEventIndex {
  const [rawLogs, setRawLogs] = useState<EventLog[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [indexedBlock, setIndexedBlock] = useState<bigint>(0n)
  const [headBlock, setHeadBlock] = useState<bigint>(0n)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => {
    ssClear()
    setNonce(n => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function run() {
      setError(null)

      try {
        const head = await publicClient.getBlockNumber()
        if (cancelled) return
        setHeadBlock(head)

        // Load cached logs + last indexed block
        const cachedSerialized = ssGet<SerializedLog[]>(SS_LOGS_KEY)
        const cachedLastBlockStr = ssGet<string>(SS_LAST_BLOCK_KEY)
        const cachedLastBlock = cachedLastBlockStr ? BigInt(cachedLastBlockStr) : null

        // Reorg detection: if cached lastBlock > current head, cache is stale
        if (cachedLastBlock !== null && cachedLastBlock > head) {
          ssClear()
        }

        const cachedLogs = cachedSerialized ? deserializeLogs(cachedSerialized) : null
        const resumeFrom: bigint | null = cachedLastBlock !== null && cachedLastBlock <= head ? cachedLastBlock + 1n : null

        // If we have a valid cache, load it immediately then top-up in background
        if (cachedLogs && resumeFrom !== null) {
          setRawLogs(cachedLogs)
          setIndexedBlock(cachedLastBlock!)
          setLoading(false)
          setSyncing(true)

          // Incremental top-up: only fetch new blocks since last index
          if (resumeFrom <= head) {
            const newLogs = await fetchRange(resumeFrom, head, (b) => {
              if (!cancelled) setIndexedBlock(b)
            })
            if (cancelled) return

            const combined = sortLogs(dedup([...cachedLogs, ...newLogs]))
            setRawLogs(combined)
            setIndexedBlock(head)
            ssSet(SS_LOGS_KEY, serializeLogs(combined))
            ssSet(SS_LAST_BLOCK_KEY, head.toString())
          } else {
            setIndexedBlock(head)
          }
          setSyncing(false)
          return
        }

        // Full index from deployment block
        setLoading(true)
        const deployBlock = await resolveDeployBlock()
        if (cancelled) return

        const allLogs = await fetchRange(deployBlock, head, (b) => {
          if (!cancelled) setIndexedBlock(b)
        })
        if (cancelled) return

        const sorted = sortLogs(dedup(allLogs))
        setRawLogs(sorted)
        setIndexedBlock(head)
        ssSet(SS_LOGS_KEY, serializeLogs(sorted))
        ssSet(SS_LAST_BLOCK_KEY, head.toString())
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message ?? 'Failed to load events')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setSyncing(false)
        }
      }
    }

    void run()
    return () => { cancelled = true }
  }, [nonce])

  const progressPct = headBlock > 0n
    ? Math.min(100, Math.round(Number((indexedBlock * 100n) / headBlock)))
    : 0

  // Memoized derived indexes
  const derived = useMemo(() => {
    const byScheduleId = new Map<string, EventLog[]>()
    const byBeneficiary = new Map<string, bigint[]>()
    const totalClaims = new Map<string, bigint>()
    let totalCreated = 0n
    let totalRevoked = 0n

    for (const log of rawLogs) {
      const sid = log.scheduleId.toString()
      if (!byScheduleId.has(sid)) byScheduleId.set(sid, [])
      byScheduleId.get(sid)!.push(log)

      if (log.type === 'created') {
        totalCreated += log.amount
        const addr = log.beneficiary
        if (!byBeneficiary.has(addr)) byBeneficiary.set(addr, [])
        const existing = byBeneficiary.get(addr)!
        if (!existing.includes(log.scheduleId)) existing.push(log.scheduleId)
      }

      if (log.type === 'claimed') {
        const prev = totalClaims.get(sid) ?? 0n
        totalClaims.set(sid, prev + log.amount)
      }

      if (log.type === 'revoked') {
        totalRevoked += log.amount
      }
    }

    return { byScheduleId, byBeneficiary, totalClaims, totalCreated, totalRevoked }
  }, [rawLogs])

  return {
    logs: rawLogs,
    ...derived,
    loading,
    syncing,
    error,
    indexedBlock,
    headBlock,
    progressPct,
    refresh,
  }
}
