import test from 'node:test'
import assert from 'node:assert/strict'
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
} from 'viem'
import {
  decodeConfirmedVestingReceipt,
  journalRecordKey,
  mergeJournalRecords,
  type LocalVestingRecord,
  type ReceiptLike,
} from './transactionJournal.ts'

const vault = '0x837c0438f8aBF0cD2DCB06636e2781dB82d32074' as const
const owner = '0x0B83a98a46310C47Ac6c87C67904b98D6febd392' as const
const beneficiary = '0x73B6CCd4951E3F74910A4EfaE6fC9510A3a3DE58' as const
const createdAbi = parseAbiItem('event ScheduleCreated(uint256 indexed scheduleId,address indexed beneficiary,uint128 totalAmount,uint48 startTime,uint48 cliffTime,uint48 endTime)')
const claimedAbi = parseAbiItem('event Claimed(uint256 indexed scheduleId,address indexed beneficiary,uint128 amount)')

function logFor(abi: typeof createdAbi | typeof claimedAbi, eventName: 'ScheduleCreated' | 'Claimed', args: Record<string, unknown>, dataTypes: readonly { type: string }[]): ReceiptLike['logs'][number] {
  const topics = encodeEventTopics({ abi: [abi], eventName, args })
    .filter((topic): topic is `0x${string}` => topic !== null)
  const values = Object.entries(args).filter(([key]) => !['scheduleId', 'beneficiary'].includes(key)).map(([, value]) => value)
  return {
    address: vault,
    data: encodeAbiParameters(dataTypes as never, values as never),
    topics,
    logIndex: 4,
  }
}

function receipt(overrides: Partial<ReceiptLike> = {}): ReceiptLike {
  return {
    status: 'success',
    to: vault,
    transactionHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    blockNumber: 70157166n,
    blockHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    logs: [],
    ...overrides,
  }
}

void test('decodes only confirmed lifecycle events from the originating vault', () => {
  const record = decodeConfirmedVestingReceipt({
    chainId: 5042002,
    wallet: owner,
    vaultAddress: vault,
    blockTimestamp: 1_793_390_000n,
  }, receipt({ logs: [logFor(createdAbi, 'ScheduleCreated', {
    scheduleId: 0n,
    beneficiary,
    totalAmount: 1_000_000n,
    startTime: 1_793_389_583n,
    cliffTime: 1_793_389_643n,
    endTime: 1_793_390_183n,
  }, [{ type: 'uint128' }, { type: 'uint48' }, { type: 'uint48' }, { type: 'uint48' }])] }))

  assert.equal(record.length, 1)
  assert.deepEqual(record[0], {
    chainId: 5042002,
    wallet: owner,
    vaultAddress: vault,
    scheduleId: 0n,
    type: 'created',
    beneficiary,
    amount: 1_000_000n,
    blockNumber: 70_157_166n,
    blockHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    timestamp: 1_793_390_000n,
    txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    logIndex: 4,
    from: owner,
    status: 'confirmed',
  })
})

void test('rejects failed receipts, wrong vault logs, and unrelated token transfers', () => {
  const wrongVault = { ...logFor(claimedAbi, 'Claimed', { scheduleId: 0n, beneficiary, amount: 1_000_000n }, [{ type: 'uint128' }]), address: owner }
  assert.deepEqual(decodeConfirmedVestingReceipt({ chainId: 5042002, wallet: beneficiary, vaultAddress: vault }, receipt({ status: 'reverted', logs: [wrongVault] })), [])
  assert.deepEqual(decodeConfirmedVestingReceipt({ chainId: 5042002, wallet: beneficiary, vaultAddress: vault }, receipt({ logs: [wrongVault] })), [])
  assert.deepEqual(decodeConfirmedVestingReceipt({ chainId: 5042002, wallet: beneficiary, vaultAddress: vault }, receipt({ logs: [{ address: vault, data: '0x', topics: [], logIndex: 0 }] })), [])
})

void test('merges and sorts records by composite transaction identity', () => {
  const base: LocalVestingRecord = {
    chainId: 5042002,
    wallet: owner,
    vaultAddress: vault,
    scheduleId: 0n,
    type: 'created' as const,
    beneficiary,
    amount: 1_000_000n,
    blockNumber: 10n,
    blockHash: '0x1',
    txHash: '0x2',
    logIndex: 0,
    from: owner,
    status: 'confirmed' as const,
  }
  const duplicate = { ...base, amount: 9n }
  const newer: LocalVestingRecord = { ...base, type: 'claimed', blockNumber: 20n, txHash: '0x3', logIndex: 1 }
  assert.equal(journalRecordKey(base), '5042002:0x837c0438f8abf0cd2dcb06636e2781db82d32074:0x2:0')
  assert.deepEqual(mergeJournalRecords([base, duplicate, newer]).map(record => record.txHash), ['0x3', '0x2'])
})
