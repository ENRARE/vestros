import { useMemo } from 'react'
import { selectScheduleHistory } from '@/features/vesting/scheduleHistory'
import { useVestingEvents, type EventLog, type ScheduleRef } from './useVestingEvents'

export type HistoryRecordStatus = 'confirmed' | 'failed' | 'unavailable'

export interface ScheduleHistoryRecord extends Omit<EventLog, 'status'> {
  status: HistoryRecordStatus
}

export interface ScheduleTransactionHistoryState {
  records: ScheduleHistoryRecord[]
  status: 'idle' | 'loading' | 'ready' | 'empty' | 'degraded'
  error: string | null
  retry: () => void
}

export function useScheduleTransactionHistory({
  vaultAddress,
  scheduleId,
  enabled,
}: ScheduleRef & { enabled: boolean }): ScheduleTransactionHistoryState {
  const activity = useVestingEvents({ vaultAddress, scheduleId })
  const selected = useMemo(
    () => selectScheduleHistory(activity.logs, { vaultAddress, scheduleId }),
    [activity.logs, scheduleId, vaultAddress],
  )
  const records = useMemo<ScheduleHistoryRecord[]>(
    () => selected.map(log => ({ ...log, status: 'confirmed' as const })),
    [selected],
  )
  const status: ScheduleTransactionHistoryState['status'] = !enabled
    ? 'idle'
      : activity.loading
      ? 'loading'
      : records.length === 0
        ? activity.coverage === 'complete' ? 'empty' : 'degraded'
        : activity.coverage === 'complete' ? 'ready' : 'degraded'
  const error = activity.error ?? (activity.coverage === 'partial' && records.length > 0 ? 'Some older activity may still be unavailable.' : null)

  return { records, status, error, retry: activity.refresh }
}

export function scheduleHistoryRecordKey(record: ScheduleHistoryRecord): string {
  return `${record.chainId}:${record.vaultAddress.toLowerCase()}:${record.scheduleId}:${record.txHash}:${record.logIndex}`
}
