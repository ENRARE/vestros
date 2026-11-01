import { beforeEach, describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, keccak256, toBytes } from 'viem'
import { verifyActivationTx } from './onchain-verify.ts'

const CHAIN_ID = 5_042_002
const USDC = '0x3600000000000000000000000000000000000000'
const POOL = '0x1111111111111111111111111111111111111111'
const BENEFICIARY = '0x2222222222222222222222222222222222222222'
const VESTING = '0x3333333333333333333333333333333333333333'
const TX_HASH = `0x${'cd'.repeat(32)}`
const AWARD_INDEX = 4
const SCHEDULE_ID = 9
const AMOUNT = 250_500_000
const TRANSFER_SIG = keccak256(toBytes('Transfer(address,address,uint256)'))
const AWARD_ACTIVATED_SIG = keccak256(toBytes('AwardActivated(uint256,address,uint256,uint32,uint32,uint256,address)'))
const SCHEDULE_CREATED_SIG = keccak256(toBytes('ScheduleCreated(uint256,address,uint256,uint48,uint48,uint48)'))
const GRANT_VESTING_SELECTOR = `0x${keccak256(toBytes('grantVesting()')).slice(2, 10)}`
const OWNER_SELECTOR = `0x${keccak256(toBytes('owner()')).slice(2, 10)}`
const OTHER_VESTING = '0x4444444444444444444444444444444444444444'

const topicAddress = (address: string) => `0x${address.slice(2).padStart(64, '0')}`
const topicUint = (value: number) => `0x${BigInt(value).toString(16).padStart(64, '0')}`
const encoded = (types: Array<{ type: string }>, values: readonly unknown[]) => encodeAbiParameters(types, values as never)
const encodedAmount = (amount: number) => encoded([{ type: 'uint256' }], [BigInt(amount)])
const encodedAddress = (address: string) => encoded([{ type: 'address' }], [address as `0x${string}`])

function activationLogs(includeFunding = true) {
  const logs = [
    {
      address: POOL,
      topics: [AWARD_ACTIVATED_SIG, topicUint(AWARD_INDEX), topicAddress(BENEFICIARY)],
      data: encoded([
        { type: 'uint256' }, { type: 'uint32' }, { type: 'uint32' },
        { type: 'uint256' }, { type: 'address' },
      ], [BigInt(AMOUNT), 90, 365, BigInt(SCHEDULE_ID), VESTING]),
    },
    {
      address: VESTING,
      topics: [SCHEDULE_CREATED_SIG, topicUint(SCHEDULE_ID), topicAddress(BENEFICIARY)],
      data: encoded([
        { type: 'uint256' }, { type: 'uint48' }, { type: 'uint48' }, { type: 'uint48' },
      ], [BigInt(AMOUNT), BigInt(100), BigInt(100 + 90 * 86400), BigInt(100 + 365 * 86400)]),
    },
  ]
  if (includeFunding) {
    logs.push({
      address: USDC,
      topics: [TRANSFER_SIG, topicAddress(POOL), topicAddress(VESTING)],
      data: encodedAmount(AMOUNT),
    })
  }
  return logs
}

function mockRpc(includeFunding = true, poolVesting = VESTING) {
  return async (_input: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      method: string; params?: Array<{ to?: string; data?: string }>
    }
    let result: unknown
    if (request.method === 'eth_chainId') result = `0x${CHAIN_ID.toString(16)}`
    else if (request.method === 'eth_getTransactionReceipt') {
      result = { status: '0x1', to: POOL, blockNumber: '0x10', logs: activationLogs(includeFunding) }
    } else if (request.method === 'eth_call') {
      const call = request.params?.[0]
      if (call?.data === GRANT_VESTING_SELECTOR) result = encodedAddress(poolVesting)
      else if (call?.data === OWNER_SELECTOR) result = encodedAddress(POOL)
      else result = encodedAddress(USDC)
    }
    else throw new Error(`unexpected RPC method ${request.method}`)
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }))
  }
}

beforeEach(() => {
  process.env.VITE_ARC_TESTNET_RPC = 'https://rpc.test.invalid'
})

afterEach(() => {
  delete process.env.VITE_ARC_TESTNET_RPC
  delete (globalThis as { fetch?: unknown }).fetch
})

describe('GrantHub award activation verification', () => {
  it('requires the funded GrantVesting transfer in the activation receipt', async () => {
    globalThis.fetch = mockRpc()
    const result = await verifyActivationTx(TX_HASH, {
      awardDbId: 'award-1',
      onchainAwardIndex: AWARD_INDEX,
      poolContractAddress: POOL,
      beneficiaryAddr: BENEFICIARY,
      amountRaw: AMOUNT,
      vestingCliffDays: 90,
      vestingDays: 365,
      chainId: CHAIN_ID,
    })

    assert.deepEqual(result, {
      ok: true,
      scheduleId: String(SCHEDULE_ID),
      vestingContract: VESTING,
      blockNumber: 16,
      vestingStartTime: 100,
    })
  })

  it('rejects a schedule event when no matching USDC funding transfer exists', async () => {
    globalThis.fetch = mockRpc(false)
    const result = await verifyActivationTx(TX_HASH, {
      awardDbId: 'award-1',
      onchainAwardIndex: AWARD_INDEX,
      poolContractAddress: POOL,
      beneficiaryAddr: BENEFICIARY,
      amountRaw: AMOUNT,
      vestingCliffDays: 90,
      vestingDays: 365,
      chainId: CHAIN_ID,
    })

    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /Expected exactly one GrantVesting funding Transfer, found 0/)
  })

  it('rejects a vesting contract that is not configured by the pool', async () => {
    globalThis.fetch = mockRpc(true, OTHER_VESTING)
    const result = await verifyActivationTx(TX_HASH, {
      awardDbId: 'award-1',
      onchainAwardIndex: AWARD_INDEX,
      poolContractAddress: POOL,
      beneficiaryAddr: BENEFICIARY,
      amountRaw: AMOUNT,
      vestingCliffDays: 90,
      vestingDays: 365,
      chainId: CHAIN_ID,
    })

    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /configured GrantVesting mismatch/)
  })
})
