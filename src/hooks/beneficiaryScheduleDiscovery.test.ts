import test from 'node:test'
import assert from 'node:assert/strict'
import { collectScheduleRefs, mergeScheduleRefs, normalizeVestingSchedule, scheduleRefKey } from './beneficiaryScheduleDiscovery.ts'

const vaultA = '0x837c0438f8aBF0cD2DCB06636e2781dB82d32074' as const
const vaultB = '0x31f4c741a4d3B901B1f0C870e4cf34eEb76aa29c' as const
const legacy = '0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693' as const

void test('keeps identical schedule ids distinct across originating vaults', () => {
  const refs = collectScheduleRefs([
    { vaultAddress: vaultA, scheduleIds: [0n] },
    { vaultAddress: vaultB, scheduleIds: [0n] },
    { vaultAddress: legacy, scheduleIds: [0n] },
  ])

  assert.equal(refs.length, 3)
  assert.deepEqual(refs.map(scheduleRefKey), [
    `${vaultA.toLowerCase()}:0`,
    `${vaultB.toLowerCase()}:0`,
    `${legacy.toLowerCase()}:0`,
  ])
})

void test('deduplicates repeated direct reads without filtering incoming schedules', () => {
  const refs = collectScheduleRefs([
    { vaultAddress: vaultA, scheduleIds: [0n, 0n, 2n] },
    { vaultAddress: vaultA.toLowerCase() as typeof vaultA, scheduleIds: [2n, 3n] },
  ])

  assert.deepEqual(refs.map(scheduleRefKey), [
    `${vaultA.toLowerCase()}:0`,
    `${vaultA.toLowerCase()}:2`,
    `${vaultA.toLowerCase()}:3`,
  ])
})

void test('normalizes ABI bigint timestamps for the existing vesting math', () => {
  const schedule = normalizeVestingSchedule({
    beneficiary: vaultB,
    revoked: false,
    startTime: 1_793_389_583n,
    cliffTime: 1_793_389_643n,
    endTime: 1_793_390_183n,
    revokeTime: 0n,
    totalAmount: 1_000_000n,
    claimedAmount: 0n,
  })

  assert.deepEqual(schedule, {
    beneficiary: vaultB,
    revoked: false,
    startTime: 1_793_389_583,
    cliffTime: 1_793_389_643,
    endTime: 1_793_390_183,
    revokeTime: 0,
    totalAmount: 1_000_000n,
    claimedAmount: 0n,
  })
})

void test('keeps direct beneficiary discovery usable when historical indexing has no refs', () => {
  const refs = mergeScheduleRefs(
    [{ vaultAddress: vaultA, scheduleId: 0n }],
    [],
  )

  assert.deepEqual(refs.map(scheduleRefKey), [`${vaultA.toLowerCase()}:0`])
})
