import test from 'node:test'
import assert from 'node:assert/strict'
import { selectScheduleHistory } from './scheduleHistory.ts'

const vault = '0x837c0438f8aBF0cD2DCB06636e2781dB82d32074' as const
const beneficiary = '0x73B6CCd4951E3F74910A4EfaE6fC9510A3a3DE58'

void test('keeps verified fixture transactions attached to the originating schedule', () => {
  const history = selectScheduleHistory([
    {
      chainId: 5042002,
      vaultAddress: vault,
      scheduleId: 0n,
      type: 'created',
      beneficiary,
      amount: 1_000_000n,
      blockNumber: 69_890_587n,
      timestamp: 1_793_389_583n,
      txHash: '0x3897b1503e36ea5e89dfcf2e3d48a23169d1c382ca72388b864cb007eaffd13e',
      logIndex: 0,
      status: 'confirmed',
    },
    {
      chainId: 5042002,
      vaultAddress: vault,
      scheduleId: 0n,
      type: 'claimed',
      beneficiary,
      amount: 1_000_000n,
      blockNumber: 69_890_700n,
      timestamp: 1_793_390_000n,
      txHash: '0x845d05aca669655015af0970cc27003d86c447ccbf67607a4cf949f6f06995bb',
      logIndex: 0,
      status: 'confirmed',
    },
  ], { vaultAddress: vault, scheduleId: 0n })

  assert.deepEqual(history.map(record => record.txHash), [
    '0x845d05aca669655015af0970cc27003d86c447ccbf67607a4cf949f6f06995bb',
    '0x3897b1503e36ea5e89dfcf2e3d48a23169d1c382ca72388b864cb007eaffd13e',
  ])
  assert.deepEqual(history.map(record => record.type), ['claimed', 'created'])
})

