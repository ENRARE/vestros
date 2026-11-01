import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildActivityUrl, coverageToStatus, mergeActivityRecords, toEventLog } from './useVestingActivity.ts'

void test('builds a bounded same-origin activity query with composite filters', () => {
  const url = buildActivityUrl({
    wallet: '0x73B6CCd4951E3F74910A4EfaE6fC9510A3a3DE58',
    organization: '0x0B83a98a46310C47Ac6c87C67904b98D6febd392',
    vaultAddress: '0x837c0438f8aBF0cD2DCB06636e2781dB82d32074',
    scheduleId: 0n,
    limit: 100,
  })
  assert.equal(url, '/api/vesting/activity?limit=100&wallet=0x73b6ccd4951e3f74910a4efae6fc9510a3a3de58&organization=0x0b83a98a46310c47ac6c87c67904b98d6febd392&vault=0x837c0438f8abf0cd2dcb06636e2781db82d32074&scheduleId=0')
})

void test('maps persisted decimal records back to bigint event records', () => {
  const event = toEventLog({
    chainId: 5042002,
    vaultAddress: '0x837c0438f8abf0cd2dcb06636e2781db82d32074',
    vaultOwner: '0x0b83a98a46310c47ac6c87c67904b98d6febd392',
    scheduleId: '0', type: 'claimed', beneficiary: '0x73b6ccd4951e3f74910a4efae6fc9510a3a3de58',
    amount: '1000000', blockNumber: '70157166', blockTimestamp: 1793390183,
    txHash: '0xclaim', logIndex: 1, status: 'confirmed',
  })
  assert.equal(event.scheduleId, 0n)
  assert.equal(event.amount, 1000000n)
  assert.equal(event.blockNumber, 70157166n)
  assert.equal(event.timestamp, 1793390183n)
  assert.equal(event.from, '0x73b6ccd4951e3f74910a4efae6fc9510a3a3de58')
})

void test('does not treat partial or unavailable history as an empty complete state', () => {
  assert.deepEqual(coverageToStatus('complete', 0), 'empty')
  assert.deepEqual(coverageToStatus('partial', 0), 'degraded')
  assert.deepEqual(coverageToStatus('unavailable', 0), 'degraded')
  assert.deepEqual(coverageToStatus('partial', 1), 'ready')
  assert.deepEqual(coverageToStatus('unavailable', 1, 'local'), 'degraded')
})

void test('merges local receipt records with backend records by composite transaction identity', () => {
  const base = {
    chainId: 5042002,
    vaultAddress: '0x837c0438f8abf0cd2dcb06636e2781db82d32074' as const,
    scheduleId: 0n,
    type: 'created' as const,
    beneficiary: '0x73b6ccd4951e3f74910a4efae6fc9510a3a3de58',
    amount: 1000000n,
    blockNumber: 10n,
    txHash: '0xcreate',
    logIndex: 0,
  }
  const duplicate = { ...base, amount: 9n }
  const claim = { ...base, type: 'claimed' as const, blockNumber: 20n, txHash: '0xclaim', logIndex: 1 }
  assert.deepEqual(mergeActivityRecords([base, claim], [duplicate]).map(record => record.txHash), ['0xclaim', '0xcreate'])
})
