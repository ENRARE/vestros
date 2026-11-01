export const MAX_UINT48 = (1n << 48n) - 1n
export const SCHEDULE_START_HEADROOM_SECONDS = 300
export const MAX_DISPLAYABLE_TIMESTAMP_SECONDS = 8_640_000_000_000n

export const DURATION_UNITS = [
  { value: 'minutes', label: 'Minutes', seconds: 60n },
  { value: 'hours', label: 'Hours', seconds: 3_600n },
  { value: 'days', label: 'Days', seconds: 86_400n },
] as const

export type DurationUnit = (typeof DURATION_UNITS)[number]['value']

function unitSeconds(unit: DurationUnit): bigint {
  const option = DURATION_UNITS.find(item => item.value === unit)
  if (!option) throw new Error('Unknown duration unit.')
  return option.seconds
}

export function durationToSeconds(value: string, unit: DurationUnit): bigint {
  if (!/^\d+$/.test(value.trim())) throw new Error('Duration must be a whole number.')
  const seconds = BigInt(value.trim()) * unitSeconds(unit)
  if (seconds > MAX_UINT48) throw new Error('Duration must fit within uint48 seconds.')
  return seconds
}

export function validateDuration(value: string, unit: DurationUnit, label: string, allowZero: boolean): string | undefined {
  if (!value.trim()) return `${label} is required.`
  if (!/^\d+$/.test(value.trim())) return `${label} must be a whole number.`

  try {
    const seconds = durationToSeconds(value, unit)
    if (!allowZero && seconds === 0n) return `${label} must be greater than 0.`
  } catch (error) {
    return error instanceof Error ? `${label} ${error.message.charAt(0).toLowerCase()}${error.message.slice(1)}` : `${label} is invalid.`
  }

  return undefined
}

export function validateDurationPair(
  cliffValue: string,
  cliffUnit: DurationUnit,
  vestingValue: string,
  vestingUnit: DurationUnit,
): string | undefined {
  const cliffError = validateDuration(cliffValue, cliffUnit, 'Cliff', true)
  if (cliffError) return cliffError
  const vestingError = validateDuration(vestingValue, vestingUnit, 'Vesting', false)
  if (vestingError) return vestingError

  if (durationToSeconds(cliffValue, cliffUnit) > durationToSeconds(vestingValue, vestingUnit)) {
    return 'Cliff duration cannot exceed vesting duration.'
  }

  return undefined
}

export function validateScheduleTimes(
  startTime: bigint,
  cliffDuration: bigint,
  vestingDuration: bigint,
): string | undefined {
  if (startTime > MAX_UINT48) return 'Start time must fit within uint48.'
  if (startTime + cliffDuration > MAX_UINT48) return 'Cliff unlock time exceeds uint48 range.'
  if (startTime + vestingDuration > MAX_UINT48) return 'Vesting completion exceeds uint48 range.'
  return undefined
}

export function isDisplayableTimestamp(timestamp: bigint): boolean {
  return timestamp <= MAX_DISPLAYABLE_TIMESTAMP_SECONDS
}

export function scheduleStartFromChainTime(chainTimestamp: number): number {
  return Math.floor(chainTimestamp) + SCHEDULE_START_HEADROOM_SECONDS
}
