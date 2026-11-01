import assert from 'node:assert/strict'
import test from 'node:test'
import { selectMyVestingScheduleLogs } from './myVestingSchedule.ts'

const owner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const beneficiary = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const ownVault = '0x1111111111111111111111111111111111111111'
const receivedVault = '0x2222222222222222222222222222222222222222'

void test('owner-beneficiary sees received schedules outside their own vault', () => {
  const logs = [
    { vaultAddress: ownVault, scheduleId: 7n, beneficiary: owner, type: 'created' as const },
    { vaultAddress: receivedVault, scheduleId: 0n, beneficiary, type: 'created' as const },
  ]

  assert.deepEqual(
    selectMyVestingScheduleLogs(logs, beneficiary, receivedVault),
    [logs[1]],
  )
})
