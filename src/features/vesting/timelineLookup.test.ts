import assert from 'node:assert/strict'
import test from 'node:test'
import { selectTimelineSchedules } from './timelineLookup.ts'

void test('selects every vault-qualified schedule for a beneficiary', () => {
  const refs = selectTimelineSchedules(
    new Map([
      ['0xbeneficiary', [
        { vaultAddress: '0x1111111111111111111111111111111111111111', scheduleId: 0n },
        { vaultAddress: '0x2222222222222222222222222222222222222222', scheduleId: 0n },
      ]],
    ]),
    '0xBeNeFiCiArY',
  )

  assert.deepEqual(refs, [
    { vaultAddress: '0x1111111111111111111111111111111111111111', scheduleId: 0n },
    { vaultAddress: '0x2222222222222222222222222222222222222222', scheduleId: 0n },
  ])
})

void test('returns an empty list for an unknown beneficiary', () => {
  assert.deepEqual(selectTimelineSchedules(new Map(), '0xunknown'), [])
})
