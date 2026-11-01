import { useAccount } from 'wagmi'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { isAddress, type Address } from 'viem'
import { readLocalVestingRecords, type LocalVestingRecord } from '../features/vesting/transactionJournal.ts'

export type ActivityCoverage = 'complete' | 'partial' | 'unavailable'
export type ActivityStatus = 'loading' | 'ready' | 'empty' | 'degraded'
export type ActivitySource = 'backend' | 'local' | 'mixed' | 'none'

export interface EventLog {
  chainId?: number
  wallet?: Address
  vaultAddress: Address
  vaultOwner?: Address
  scheduleId: bigint
  type: 'created' | 'claimed' | 'revoked'
  beneficiary: string
  amount: bigint
  blockNumber: bigint
  blockHash?: string
  timestamp?: bigint
  txHash: string
  logIndex: number
  from?: Address
  status?: 'confirmed'
}

export interface ScheduleRef {
  vaultAddress: Address
  scheduleId: bigint
}

export interface ActivityFilters {
  wallet?: string
  organization?: string
  vaultAddress?: string
  beneficiary?: string
  scheduleId?: bigint
  type?: EventLog['type']
  limit?: number
}

interface ActivityApiRecord {
  chainId: number
  wallet?: string
  vaultAddress: string
  vaultOwner?: string
  scheduleId: string
  type: EventLog['type']
  beneficiary: string
  amount: string
  blockNumber: string
  blockHash?: string
  blockTimestamp?: number
  txHash: string
  logIndex: number
  status: 'confirmed'
}

interface ActivityApiResponse {
  records: ActivityApiRecord[]
  coverage: ActivityCoverage
  hasMore: boolean
  updatedAt: number | null
}

interface ActivityResponseState {
  records: EventLog[]
  coverage: ActivityCoverage
  hasMore: boolean
  updatedAt: number | null
  source: ActivitySource
  requestKey: string
}

export interface VestingActivityState {
  records: EventLog[]
  coverage: ActivityCoverage
  status: ActivityStatus
  hasMore: boolean
  updatedAt: number | null
  historySource: ActivitySource
  error: string | null
  refresh: () => void
}

export function buildActivityUrl(filters: ActivityFilters = {}): string {
  const params = new URLSearchParams()
  params.set('limit', String(Math.min(100, Math.max(1, filters.limit ?? 100))))
  if (filters.wallet) params.set('wallet', filters.wallet.toLowerCase())
  if (filters.organization) params.set('organization', filters.organization.toLowerCase())
  if (filters.vaultAddress) params.set('vault', filters.vaultAddress.toLowerCase())
  if (filters.beneficiary) params.set('beneficiary', filters.beneficiary.toLowerCase())
  if (filters.scheduleId !== undefined) params.set('scheduleId', filters.scheduleId.toString())
  if (filters.type) params.set('type', filters.type)
  return `/api/vesting/activity?${params.toString()}`
}

export function toEventLog(record: ActivityApiRecord): EventLog {
  return {
    chainId: record.chainId,
    wallet: record.wallet as Address | undefined,
    vaultAddress: record.vaultAddress as Address,
    vaultOwner: record.vaultOwner as Address | undefined,
    scheduleId: BigInt(record.scheduleId),
    type: record.type,
    beneficiary: record.beneficiary,
    amount: BigInt(record.amount),
    blockNumber: BigInt(record.blockNumber),
    blockHash: record.blockHash,
    timestamp: record.blockTimestamp === undefined ? undefined : BigInt(record.blockTimestamp),
    txHash: record.txHash,
    logIndex: record.logIndex,
    from: (record.type === 'claimed' ? record.beneficiary : record.vaultOwner) as Address | undefined,
    status: record.status,
  }
}

export function localRecordToEventLog(record: LocalVestingRecord): EventLog {
  return {
    chainId: record.chainId,
    wallet: record.wallet,
    vaultAddress: record.vaultAddress,
    scheduleId: record.scheduleId,
    type: record.type,
    beneficiary: record.beneficiary,
    amount: record.amount,
    blockNumber: record.blockNumber,
    blockHash: record.blockHash,
    timestamp: record.timestamp,
    txHash: record.txHash,
    logIndex: record.logIndex,
    from: record.from,
    status: record.status,
  }
}

function activityRecordKey(record: Pick<EventLog, 'chainId' | 'vaultAddress' | 'txHash' | 'logIndex'>): string {
  return `${record.chainId ?? 'unknown'}:${record.vaultAddress.toLowerCase()}:${record.txHash.toLowerCase()}:${record.logIndex}`
}

export function mergeActivityRecords(local: readonly EventLog[], remote: readonly EventLog[]): EventLog[] {
  const unique = new Map<string, EventLog>()
  for (const record of [...local, ...remote]) unique.set(activityRecordKey(record), record)
  return [...unique.values()].sort((left, right) => right.blockNumber === left.blockNumber
    ? right.logIndex - left.logIndex
    : right.blockNumber > left.blockNumber ? 1 : -1)
}

export function coverageToStatus(coverage: ActivityCoverage, recordCount: number, source: ActivitySource = 'backend'): Exclude<ActivityStatus, 'loading'> {
  if (recordCount > 0) return source === 'local' ? 'degraded' : 'ready'
  return coverage === 'complete' ? 'empty' : 'degraded'
}

export function useVestingActivity(filters: ActivityFilters = {}): VestingActivityState {
  const { address, chainId } = useAccount()
  const [response, setResponse] = useState<ActivityResponseState>({ records: [], coverage: 'unavailable', hasMore: false, updatedAt: null, source: 'none', requestKey: '' })
  const [status, setStatus] = useState<ActivityStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const wallet = filters.wallet ?? address
  const requestFilters = useMemo(() => ({
    wallet,
    organization: filters.organization,
    vaultAddress: filters.vaultAddress,
    beneficiary: filters.beneficiary,
    scheduleId: filters.scheduleId,
    type: filters.type,
    limit: filters.limit,
  }), [filters.beneficiary, filters.limit, filters.organization, filters.scheduleId, filters.type, filters.vaultAddress, wallet])
  const requestUrl = useMemo(() => buildActivityUrl(requestFilters), [requestFilters])
  const chainMismatch = chainId !== undefined && chainId !== 5042002 && chainId !== 5042
  const requestKey = `${nonce}:${chainId ?? 'unknown'}:${requestUrl}`

  useEffect(() => {
    const controller = new AbortController()
    if (chainMismatch) {
      return () => controller.abort()
    }
    const localWallet = typeof wallet === 'string' && isAddress(wallet) ? wallet : undefined
    const localRecords = chainId !== undefined && localWallet
      ? readLocalVestingRecords(chainId, localWallet, {
        vaultAddress: requestFilters.vaultAddress && isAddress(requestFilters.vaultAddress) ? requestFilters.vaultAddress : undefined,
        beneficiary: requestFilters.beneficiary && isAddress(requestFilters.beneficiary) ? requestFilters.beneficiary : undefined,
        scheduleId: requestFilters.scheduleId,
        type: requestFilters.type,
      }).filter(record => !requestFilters.organization || record.wallet.toLowerCase() === requestFilters.organization.toLowerCase())
      : []
    const localEventRecords = localRecords.map(localRecordToEventLog)
    if (localEventRecords.length > 0) {
      // Local storage is an external source; publish its snapshot immediately.
      // eslint-disable-next-line react/set-state-in-effect
      setResponse({ records: localEventRecords, coverage: 'unavailable', hasMore: false, updatedAt: null, source: 'local', requestKey })
      setStatus('degraded')
      setError('Showing transactions confirmed in this browser. Older activity may be unavailable.')
    } else {
      setResponse({ records: [], coverage: 'unavailable', hasMore: false, updatedAt: null, source: 'none', requestKey })
      setStatus('loading')
      setError(null)
    }

    // The optional Bun Activity API currently indexes Arc Testnet only. Do not
    // query it for Mainnet or an undetermined wallet network, and never allow
    // records from one network to populate another network's Core UI.
    if (chainId !== 5042002) {
      const source: ActivitySource = localEventRecords.length > 0 ? 'local' : 'none'
      setResponse({ records: localEventRecords, coverage: 'unavailable', hasMore: false, updatedAt: null, source, requestKey })
      setStatus(coverageToStatus('unavailable', localEventRecords.length, source))
      setError(localEventRecords.length > 0
        ? 'Showing locally confirmed transactions. Older activity may be unavailable.'
        : chainId === 5042 ? 'Historical activity is unavailable on Arc Mainnet. Direct vesting data remains available.' : null)
      return () => controller.abort()
    }

    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 2500)
    void fetch(requestUrl, { signal: controller.signal, headers: { accept: 'application/json' } })
      .then(async result => {
        if (!result.ok) throw new Error('Vesting activity is temporarily unavailable.')
        return await result.json() as ActivityApiResponse
      })
      .then(next => {
        if (controller.signal.aborted) return
        const remoteRecords = next.records.map(toEventLog).filter(record => record.chainId === chainId)
        const mergedRecords = mergeActivityRecords(localEventRecords, remoteRecords)
        const source: ActivitySource = localEventRecords.length > 0 ? 'mixed' : 'backend'
        setResponse({ records: mergedRecords, coverage: next.coverage, hasMore: next.hasMore, updatedAt: next.updatedAt, source, requestKey })
        setStatus(coverageToStatus(next.coverage, mergedRecords.length, source))
        setError(next.coverage === 'complete'
          ? null
          : next.coverage === 'partial'
            ? 'Some activity history is unavailable. Direct vesting data remains available.'
            : localEventRecords.length > 0
              ? 'Showing locally confirmed transactions. Older activity may be unavailable.'
              : 'Activity history is temporarily unavailable. Direct vesting data remains available.')
      })
      .catch(() => {
        if (controller.signal.aborted && !timedOut) return
        setResponse({ records: localEventRecords, coverage: 'unavailable', hasMore: false, updatedAt: null, source: localEventRecords.length > 0 ? 'local' : 'none', requestKey })
        setStatus('degraded')
        setError(localEventRecords.length > 0
          ? 'Showing locally confirmed transactions. Older activity may be unavailable.'
          : 'Activity history is temporarily unavailable. Direct vesting data remains available.')
      })
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [chainId, chainMismatch, requestFilters.beneficiary, requestFilters.organization, requestFilters.scheduleId, requestFilters.type, requestFilters.vaultAddress, requestKey, requestUrl, wallet])

  const refresh = useCallback(() => setNonce(value => value + 1), [])
  const hasCurrentResponse = response.requestKey === requestKey
  const records = useMemo(() => (chainMismatch || !hasCurrentResponse ? [] : response.records), [chainMismatch, hasCurrentResponse, response.records])
  return {
    records,
    coverage: chainMismatch || !hasCurrentResponse ? 'unavailable' : response.coverage,
    status: chainMismatch ? 'degraded' : hasCurrentResponse ? status : 'loading',
    hasMore: chainMismatch || !hasCurrentResponse ? false : response.hasMore,
    updatedAt: chainMismatch || !hasCurrentResponse ? null : response.updatedAt,
    historySource: chainMismatch || !hasCurrentResponse ? 'none' : response.source,
    error: chainMismatch ? 'Switch to a supported Arc network to load vesting activity.' : hasCurrentResponse ? error : null,
    refresh,
  }
}
