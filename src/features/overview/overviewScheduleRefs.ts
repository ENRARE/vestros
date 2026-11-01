import { selectMyVestingScheduleLogs, type MyVestingScheduleLog } from '../vesting/myVestingSchedule.ts'

export interface OverviewScheduleRef {
  vaultAddress: string
  scheduleId: bigint
}

export function selectOverviewScheduleRefs<T extends MyVestingScheduleLog>(
  logs: readonly T[],
  wallet: string,
  managedVault?: string,
): OverviewScheduleRef[] {
  return selectMyVestingScheduleLogs(logs, wallet, managedVault)
    .map(log => ({ vaultAddress: log.vaultAddress, scheduleId: log.scheduleId }))
}
