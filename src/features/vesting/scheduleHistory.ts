import type { Address } from 'viem'
import type { EventLog, ScheduleRef } from '@/hooks/useVestingEvents'

export type ScheduleHistoryEvent = EventLog

export function selectScheduleHistory(logs: readonly EventLog[], ref: ScheduleRef): ScheduleHistoryEvent[] {
  return logs
    .filter(log => log.vaultAddress.toLowerCase() === ref.vaultAddress.toLowerCase() && log.scheduleId === ref.scheduleId)
    .sort((left, right) => right.blockNumber === left.blockNumber
      ? right.logIndex - left.logIndex
      : right.blockNumber > left.blockNumber ? 1 : -1)
}

export function scheduleHistoryKey(vaultAddress: Address, scheduleId: bigint): string {
  return `${vaultAddress.toLowerCase()}:${scheduleId.toString()}`
}

