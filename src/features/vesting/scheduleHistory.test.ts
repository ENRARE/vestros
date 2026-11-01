import test from 'node:test'
import assert from 'node:assert/strict'
import { selectScheduleHistory } from './scheduleHistory.ts'

const originalVault = '0x837c0438f8aBF0cD2DCB06636e2781dB82d32074' as const
const otherVault = '0x31f4c741a4d3B901B1f0C870e4cf34eEb76aa29c' as const
const beneficiary = '0x73B6CCd4951E3F74910A4EfaE6fC9510A3a3DE58'

void test('selects newest events for one composite vault and schedule identity', () => {
  const history = selectScheduleHistory([
    { vaultAddress: originalVault, scheduleId: 0n, type: 'created', beneficiary, amount: 1_000_000n, blockNumber: 10n, txHash: '0xcreate', logIndex: 0 },
    { vaultAddress: originalVault, scheduleId: 0n, type: 'claimed', beneficiary, amount: 1_000_000n, blockNumber: 20n, txHash: '0xclaim', logIndex: 1 },
    { vaultAddress: otherVault, scheduleId: 0n, type: 'claimed', beneficiary, amount: 1_000_000n, blockNumber: 30n, txHash: '0xother', logIndex: 0 },
  ], { vaultAddress: originalVault, scheduleId: 0n })

  assert.deepEqual(history.map(event => event.txHash), ['0xclaim', '0xcreate'])
})

void test('does not invent a funding event from schedule creation', () => {
  const history = selectScheduleHistory([
    { vaultAddress: originalVault, scheduleId: 0n, type: 'created', beneficiary, amount: 1_000_000n, blockNumber: 10n, txHash: '0xcreate', logIndex: 0 },
  ], { vaultAddress: originalVault, scheduleId: 0n })

  assert.deepEqual(history.map(event => event.type), ['created'])
})

