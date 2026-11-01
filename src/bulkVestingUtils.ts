import type { BulkEntry } from './types.ts'
import { DURATION_UNITS, type DurationUnit } from './vestingDuration.ts'

function uid(): string {
  return Math.random().toString(36).slice(2, 9)
}

export function parseDurationUnit(value: string | undefined): DurationUnit | undefined {
  return DURATION_UNITS.some(unit => unit.value === value) ? value as DurationUnit : undefined
}

export function parseBulkCsv(text: string, idFactory: () => string = uid): BulkEntry[] {
  const lines = text.split(/\r?\n/).filter(line => line.trim())
  const rows: BulkEntry[] = []

  for (const line of lines) {
    const parts = line.split(',').map(part => part.trim())
    if (parts.length < 2 || parts[0]?.toLowerCase() === 'beneficiary') continue

    const [beneficiary, amount, cliffValue = '30', cliffUnitOrLegacyVesting = '365', vestingValue, vestingUnit] = parts
    const isUnitAware = vestingValue !== undefined || vestingUnit !== undefined

    if (!isUnitAware) {
      rows.push({
        id: idFactory(), beneficiary: beneficiary ?? '', amount: amount ?? '',
        cliffValue, cliffUnit: 'days', vestingValue: cliffUnitOrLegacyVesting, vestingUnit: 'days',
      })
      continue
    }

    const cliffUnit = parseDurationUnit(cliffUnitOrLegacyVesting)
    const parsedVestingUnit = parseDurationUnit(vestingUnit)
    const invalidCliffUnit = cliffUnit === undefined
    const invalidVestingUnit = parsedVestingUnit === undefined

    rows.push({
      id: idFactory(), beneficiary: beneficiary ?? '', amount: amount ?? '',
      cliffValue, cliffUnit: cliffUnit ?? 'days', vestingValue: vestingValue ?? '', vestingUnit: parsedVestingUnit ?? 'days',
      error: invalidCliffUnit
        ? 'Cliff unit must be minutes, hours, or days.'
        : invalidVestingUnit ? 'Vesting unit must be minutes, hours, or days.' : undefined,
    })
  }

  return rows
}
