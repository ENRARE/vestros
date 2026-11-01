/**
 * Compatibility adapter for historical vesting activity.
 *
 * Local confirmed receipts are loaded first. The optional Bun + SQLite
 * Activity API can enrich them, but this hook never creates a browser RPC
 * client or calls eth_getLogs.
 */
import { useMemo } from 'react'
import { scheduleRefKey } from './vestingEventIndex'
import { useVestingActivity, type ActivityFilters, type EventLog, type ScheduleRef, type ActivitySource } from './useVestingActivity'

export type { ActivityCoverage, EventLog, ScheduleRef } from './useVestingActivity'

export interface VestingEventIndex {
  logs: EventLog[]
  byScheduleId: Map<string, EventLog[]>
  byBeneficiary: Map<string, ScheduleRef[]>
  totalClaims: Map<string, bigint>
  totalCreated: bigint
  totalRevoked: bigint
  loading: boolean
  syncing: boolean
  error: string | null
  coverage: 'complete' | 'partial' | 'unavailable'
  historySource: ActivitySource
  hasMore: boolean
  updatedAt: number | null
  indexedBlock: bigint
  headBlock: bigint
  progressPct: number
  refresh: () => void
}

export function useVestingEvents(filters?: ActivityFilters): VestingEventIndex {
  const activity = useVestingActivity(filters)
  const derived = useMemo(() => {
    const byScheduleId = new Map<string, EventLog[]>()
    const byBeneficiary = new Map<string, ScheduleRef[]>()
    const totalClaims = new Map<string, bigint>()
    let totalCreated = 0n
    let totalRevoked = 0n

    for (const log of activity.records) {
      const key = scheduleRefKey(log.vaultAddress, log.scheduleId)
      const scheduleLogs = byScheduleId.get(key) ?? []
      scheduleLogs.push(log)
      byScheduleId.set(key, scheduleLogs)

      if (log.type === 'created') {
        totalCreated += log.amount
        const beneficiary = log.beneficiary.toLowerCase()
        const refs = byBeneficiary.get(beneficiary) ?? []
        if (!refs.some(ref => ref.vaultAddress.toLowerCase() === log.vaultAddress.toLowerCase() && ref.scheduleId === log.scheduleId)) {
          refs.push({ vaultAddress: log.vaultAddress, scheduleId: log.scheduleId })
        }
        byBeneficiary.set(beneficiary, refs)
      } else if (log.type === 'claimed') {
        totalClaims.set(key, (totalClaims.get(key) ?? 0n) + log.amount)
      } else if (log.type === 'revoked') {
        totalRevoked += log.amount
      }
    }
    return { byScheduleId, byBeneficiary, totalClaims, totalCreated, totalRevoked }
  }, [activity.records])

  return {
    logs: activity.records,
    ...derived,
    loading: activity.status === 'loading',
    syncing: false,
    error: activity.error,
    coverage: activity.coverage,
    historySource: activity.historySource,
    hasMore: activity.hasMore,
    updatedAt: activity.updatedAt,
    indexedBlock: 0n,
    headBlock: 0n,
    progressPct: 0,
    refresh: activity.refresh,
  }
}
