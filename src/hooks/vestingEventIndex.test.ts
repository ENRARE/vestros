import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deduplicateVestingLogs,
  filterVestingLogsForWallet,
  isCachedIndexStale,
  scheduleRefKey,
  supportedVaultsFromLogs,
  type IndexedVestingLog,
} from './vestingEventIndex.ts'

const base = (vaultAddress: string, txHash: string, logIndex: number, scheduleId = 0n): IndexedVestingLog => ({
  vaultAddress,
  scheduleId,
  type: 'created',
  beneficiary: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  amount: 10n,
  blockNumber: 10n,
  txHash,
  logIndex,
})

void test('deduplication includes the originating vault', () => {
  const logs = [
    base('0x1111111111111111111111111111111111111111', '0xtx', 0),
    base('0x1111111111111111111111111111111111111111', '0xtx', 0),
    base('0x2222222222222222222222222222222222222222', '0xtx', 0),
  ]
  assert.equal(deduplicateVestingLogs(logs).length, 2)
})

void test('discovered vaults preserve duplicate schedule ids as separate references', () => {
  const logs = [
    base('0x1111111111111111111111111111111111111111', '0xa', 0),
    base('0x2222222222222222222222222222222222222222', '0xb', 0),
  ]
  const refs = supportedVaultsFromLogs('0x9999999999999999999999999999999999999999', logs)
  assert.deepEqual(refs, [
    '0x1111111111111111111111111111111111111111',
    '0x2222222222222222222222222222222222222222',
    '0x9999999999999999999999999999999999999999',
  ])
  assert.notEqual(scheduleRefKey(refs[0], 0n), scheduleRefKey(refs[1], 0n))
})

void test('cache invalidation and wallet filtering are explicit', () => {
  assert.equal(isCachedIndexStale(12n, 10n), true)
  assert.equal(isCachedIndexStale(10n, 12n), false)
  const logs = [
    base('0x1111111111111111111111111111111111111111', '0xa', 0),
    { ...base('0x2222222222222222222222222222222222222222', '0xb', 0), beneficiary: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  ]
  assert.equal(filterVestingLogsForWallet(logs, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb').length, 1)
  assert.equal(filterVestingLogsForWallet(logs, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '0x1111111111111111111111111111111111111111', true).length, 1)
})
