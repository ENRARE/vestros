export interface TimelineScheduleRef {
  vaultAddress: string
  scheduleId: bigint
}

export function selectTimelineSchedules(
  byBeneficiary: ReadonlyMap<string, readonly TimelineScheduleRef[]>,
  beneficiary: string,
): TimelineScheduleRef[] {
  return [...(byBeneficiary.get(beneficiary.trim().toLowerCase()) ?? [])]
}
