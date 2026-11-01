import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBulkCsv } from './bulkVestingUtils.ts'

void test('keeps legacy four-column CSV durations in days', () => {
  const [row] = parseBulkCsv(
    'beneficiary,amount,cliffDays,vestingDays\n0x0000000000000000000000000000000000000001,1000,90,365',
    () => 'legacy-row',
  )

  assert.deepEqual(row, {
    id: 'legacy-row',
    beneficiary: '0x0000000000000000000000000000000000000001',
    amount: '1000',
    cliffValue: '90',
    cliffUnit: 'days',
    vestingValue: '365',
    vestingUnit: 'days',
  })
})

void test('parses mixed units from the unit-aware CSV format', () => {
  const [row] = parseBulkCsv(
    'beneficiary,amount,cliffValue,cliffUnit,vestingValue,vestingUnit\n0x0000000000000000000000000000000000000001,1,1,minutes,10,hours',
    () => 'mixed-row',
  )

  assert.equal(row.cliffValue, '1')
  assert.equal(row.cliffUnit, 'minutes')
  assert.equal(row.vestingValue, '10')
  assert.equal(row.vestingUnit, 'hours')
  assert.equal(row.error, undefined)
})

void test('marks an unknown CSV duration unit instead of reinterpreting it', () => {
  const [row] = parseBulkCsv(
    'beneficiary,amount,cliffValue,cliffUnit,vestingValue,vestingUnit\n0x0000000000000000000000000000000000000001,1,1,weeks,10,days',
    () => 'invalid-row',
  )

  assert.equal(row.cliffUnit, 'days')
  assert.equal(row.error, 'Cliff unit must be minutes, hours, or days.')
})
