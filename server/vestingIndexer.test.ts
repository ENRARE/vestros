import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import { test } from 'bun:test'
import {
  ensureVestingIndexSchema,
  insertVestingEvents,
  queryVestingEvents,
  readIndexerSources,
  readVestingVaults,
  saveIndexerSource,
  saveVestingVault,
  type VestingHistoryRecord,
} from './vestingStorage'
import { deduplicateHistoryRecords, replaceReorgWindow } from './vestingIndexer'

function makeDatabase() {
  const database = new Database(':memory:')
  ensureVestingIndexSchema(database)
  return database
}

function record(overrides: Partial<VestingHistoryRecord> = {}): VestingHistoryRecord {
  return {
    chainId: 5042002,
    vaultAddress: '0x837c0438f8abf0cd2dcb06636e2781db82d32074',
    vaultOwner: '0x0b83a98a46310c47ac6c87c67904b98d6febd392',
    scheduleId: '0',
    type: 'created',
    beneficiary: '0x73b6ccd4951e3f74910a4efae6fc9510a3a3de58',
    amount: '1000000',
    blockNumber: '69890587',
    blockHash: '0xblock-a',
    blockTimestamp: 1793389583,
    txHash: '0x3897b1503e36ea5e89dfcf2e3d48a23169d1c382ca72388b864cb007eaffd13e',
    logIndex: 0,
    status: 'confirmed',
    ...overrides,
  }
}

void test('persists checkpoints and is idempotent for composite event identity', () => {
  const database = makeDatabase()
  saveIndexerSource(database, {
    chainId: 5042002,
    sourceAddress: '0x837c0438f8abf0cd2dcb06636e2781db82d32074',
    sourceKind: 'vault',
    startBlock: '69890587',
    nextBlock: '69890588',
    headBlock: '69890587',
    status: 'complete',
    error: null,
  })
  insertVestingEvents(database, [record(), record({ amount: '999', txHash: '0xother', logIndex: 0 })])
  insertVestingEvents(database, [record()])

  const sources = readIndexerSources(database)
  const rows = queryVestingEvents(database, { chainId: 5042002, vaultAddress: record().vaultAddress })

  assert.equal(sources[0]?.nextBlock, '69890588')
  assert.equal(rows.records.length, 2)
})

void test('keeps identical schedule IDs distinct across vaults', () => {
  const database = makeDatabase()
  insertVestingEvents(database, [
    record(),
    record({ vaultAddress: '0x31f4c741a4d3b901b1f0c870e4cf34eeb76aa29c', txHash: '0xother-vault' }),
  ])

  assert.equal(queryVestingEvents(database, { chainId: 5042002, scheduleId: '0' }).records.length, 2)
  assert.equal(queryVestingEvents(database, { chainId: 5042002, vaultAddress: record().vaultAddress, scheduleId: '0' }).records.length, 1)
})

void test('replaces events inside a reorg overlap without touching later blocks', () => {
  const database = makeDatabase()
  insertVestingEvents(database, [
    record(),
    record({ blockNumber: '69890588', blockHash: '0xold', txHash: '0xold-event' }),
  ])
  replaceReorgWindow(database, 5042002, '0x837c0438f8abf0cd2dcb06636e2781db82d32074', '69890588', [
    record({ blockNumber: '69890588', blockHash: '0xnew', txHash: '0xnew-event' }),
  ])

  const rows = queryVestingEvents(database, { chainId: 5042002 }).records
  assert.deepEqual(rows.map(row => row.txHash), ['0xnew-event', '0x3897b1503e36ea5e89dfcf2e3d48a23169d1c382ca72388b864cb007eaffd13e'])
})

void test('deduplicates by chain, vault, transaction, and log index', () => {
  const first = record()
  const duplicate = record({ type: 'claimed', amount: '1' })
  const distinct = record({ logIndex: 1, type: 'claimed', amount: '1' })

  assert.deepEqual(deduplicateHistoryRecords([first, duplicate, distinct]).map(row => row.logIndex), [0, 1])
})

void test('stores discovered vault ownership separately from schedule events', () => {
  const database = makeDatabase()
  saveVestingVault(database, {
    chainId: 5042002,
    vaultAddress: record().vaultAddress,
    ownerAddress: record().vaultOwner!,
    createdBlock: '69890000',
    createdTxHash: '0xvault-created',
  })
  assert.equal(queryVestingEvents(database, { chainId: 5042002 }).coverage, 'unavailable')
})

void test('replaces a discovered placeholder with verified factory creation metadata', () => {
  const database = makeDatabase()
  const vault = '0x31f4c741a4d3b901b1f0c870e4cf34eeb76aa29c'
  const owner = '0x73b6ccd4951e3f74910a4efae6fc9510a3a3de58'
  const creationTx = '0xa175e5b12603ace62d5e5d8601634dd9caab8584220b471edb40412fe30d2c4e'

  saveVestingVault(database, { chainId: 5042002, vaultAddress: vault, ownerAddress: owner, createdBlock: '70182739' })
  saveVestingVault(database, { chainId: 5042002, vaultAddress: vault, ownerAddress: owner, createdBlock: '69891738', createdTxHash: creationTx })

  assert.deepEqual(readVestingVaults(database, 5042002), [{
    chainId: 5042002,
    vaultAddress: vault,
    ownerAddress: owner,
    createdBlock: '69891738',
    createdTxHash: creationTx,
  }])
})
