import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import { test } from 'bun:test'
import { ensureVestingIndexSchema, insertVestingEvents, saveIndexerSource } from './vestingStorage'
import { handleVestingActivity } from './routes/vestingActivity'

function databaseWithRecords() {
  const database = new Database(':memory:')
  ensureVestingIndexSchema(database)
  saveIndexerSource(database, {
    chainId: 5042002,
    sourceAddress: '0x837c0438f8abf0cd2dcb06636e2781db82d32074',
    sourceKind: 'vault',
    startBlock: '69890587',
    nextBlock: '70157167',
    headBlock: '70157166',
    status: 'complete',
    error: null,
  })
  insertVestingEvents(database, [
    {
      chainId: 5042002,
      vaultAddress: '0x837c0438f8abf0cd2dcb06636e2781db82d32074',
      vaultOwner: '0x0b83a98a46310c47ac6c87c67904b98d6febd392',
      scheduleId: '0', type: 'created', beneficiary: '0x73b6ccd4951e3f74910a4efae6fc9510a3a3de58',
      amount: '1000000', blockNumber: '69890587', blockTimestamp: 1793389583,
      txHash: '0x3897b1503e36ea5e89dfcf2e3d48a23169d1c382ca72388b864cb007eaffd13e', logIndex: 0, status: 'confirmed',
    },
    {
      chainId: 5042002,
      vaultAddress: '0x837c0438f8abf0cd2dcb06636e2781db82d32074',
      vaultOwner: '0x0b83a98a46310c47ac6c87c67904b98d6febd392',
      scheduleId: '0', type: 'claimed', beneficiary: '0x73b6ccd4951e3f74910a4efae6fc9510a3a3de58',
      amount: '1000000', blockNumber: '70157166', blockTimestamp: 1793390183,
      txHash: '0x845d05aca669655015af0970cc27003d86c447ccbf67607a4cf949f6f06995bb', logIndex: 1, status: 'confirmed',
    },
  ])
  return database
}

void test('returns paginated activity with complete coverage and filters', async () => {
  const database = databaseWithRecords()
  const response = handleVestingActivity(
    new Request('http://localhost/api/vesting/activity?page=1&limit=1&organization=0x0b83a98a46310c47ac6c87c67904b98d6febd392&vault=0x837c0438f8abf0cd2dcb06636e2781db82d32074&scheduleId=0'),
    new URL('http://localhost/api/vesting/activity?page=1&limit=1&organization=0x0b83a98a46310c47ac6c87c67904b98d6febd392&vault=0x837c0438f8abf0cd2dcb06636e2781db82d32074&scheduleId=0'),
    { database },
  )
  assert.equal(response.status, 200)
  const body = await response.json() as { records: Array<{ type: string; txHash: string }>; hasMore: boolean; coverage: string }
  assert.equal(body.coverage, 'complete')
  assert.equal(body.records[0]?.type, 'claimed')
  assert.equal(body.records[0]?.txHash, '0x845d05aca669655015af0970cc27003d86c447ccbf67607a4cf949f6f06995bb')
  assert.equal(body.hasMore, true)
})

void test('does not call empty history complete when coverage is partial', async () => {
  const database = new Database(':memory:')
  ensureVestingIndexSchema(database)
  saveIndexerSource(database, {
    chainId: 5042002,
    sourceAddress: '0x31f4c741a4d3b901b1f0c870e4cf34eeb76aa29c',
    sourceKind: 'vault',
    startBlock: '70157167', nextBlock: '70157167', headBlock: '70157166', status: 'partial', error: 'start block required',
  })
  const response = handleVestingActivity(new Request('http://localhost/api/vesting/activity'), new URL('http://localhost/api/vesting/activity'), { database })
  const body = await response.json() as { records: unknown[]; coverage: string }
  assert.equal(body.records.length, 0)
  assert.equal(body.coverage, 'partial')
})

void test('rejects an unbounded page size', () => {
  const database = databaseWithRecords()
  const response = handleVestingActivity(new Request('http://localhost/api/vesting/activity?limit=1000'), new URL('http://localhost/api/vesting/activity?limit=1000'), { database })
  assert.equal(response.status, 400)
})
