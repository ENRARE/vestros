import assert from 'node:assert/strict'
import test from 'node:test'
import { selectOverviewScheduleRefs } from './overviewScheduleRefs.ts'

void test('overview includes incoming schedules when beneficiary owns another vault', () => {
  const wallet = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const ownVault = '0x1111111111111111111111111111111111111111'
  const fundedVault = '0x2222222222222222222222222222222222222222'

  assert.deepEqual(
    selectOverviewScheduleRefs([
      { vaultAddress: ownVault, scheduleId: 8n, beneficiary: '0xcccccccccccccccccccccccccccccccccccccc', type: 'created' as const },
      { vaultAddress: fundedVault, scheduleId: 0n, beneficiary: wallet, type: 'created' as const },
    ], wallet, ownVault),
    [
      { vaultAddress: ownVault, scheduleId: 8n },
      { vaultAddress: fundedVault, scheduleId: 0n },
    ],
  )
})
