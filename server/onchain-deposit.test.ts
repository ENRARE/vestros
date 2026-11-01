import { beforeEach, describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, keccak256, toBytes } from 'viem'
import { verifyDepositTx } from './onchain-verify.ts'

const CHAIN_ID = 5_042_002
const USDC = '0x3600000000000000000000000000000000000000'
const POOL = '0x1111111111111111111111111111111111111111'
const SPONSOR = '0x2222222222222222222222222222222222222222'
const TX_HASH = `0x${'ab'.repeat(32)}`
const AMOUNT = 250_500_000
const TRANSFER_SIG = keccak256(toBytes('Transfer(address,address,uint256)'))
const DEPOSITED_SIG = keccak256(toBytes('Deposited(address,uint256)'))

const topicAddress = (address: string) => `0x${address.slice(2).padStart(64, '0')}`
const encodedAmount = (amount: number) => encodeAbiParameters([{ type: 'uint256' }], [BigInt(amount)])
const encodedAddress = (address: string) => encodeAbiParameters([{ type: 'address' }], [address as `0x${string}`])

function makeRpcResponse(method: string) {
  if (method === 'eth_chainId') return `0x${CHAIN_ID.toString(16)}`
  if (method === 'eth_getTransactionByHash') return { from: SPONSOR, to: POOL }
  if (method === 'eth_call') return encodedAddress(USDC)
  if (method === 'eth_getTransactionReceipt') {
    return {
      status: '0x1',
      to: POOL,
      blockNumber: '0x10',
      logs: [
        {
          address: USDC,
          topics: [TRANSFER_SIG, topicAddress(SPONSOR), topicAddress(POOL)],
          data: encodedAmount(AMOUNT),
        },
        {
          address: POOL,
          topics: [DEPOSITED_SIG, topicAddress(SPONSOR)],
          data: encodedAmount(AMOUNT),
        },
      ],
    }
  }
  throw new Error(`unexpected RPC method ${method}`)
}

afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch
  delete process.env.VITE_ARC_TESTNET_RPC
})

beforeEach(() => {
  process.env.VITE_ARC_TESTNET_RPC = 'https://rpc.test.invalid'
})

describe('independent GrantPool deposit verification', () => {
  it('accepts only a successful USDC transfer and matching Deposited event', async () => {
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: makeRpcResponse(request.method) }))
    }

    const result = await verifyDepositTx(TX_HASH, {
      chainId: CHAIN_ID,
      poolContractAddress: POOL,
      expectedDepositor: SPONSOR,
    })

    assert.deepEqual(result, {
      ok: true,
      depositor: SPONSOR,
      amountRaw: AMOUNT,
      blockNumber: 16,
      tokenAddress: USDC,
    })
  })

  it('rejects a transaction from the wrong chain before accepting its events', async () => {
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string }
      const result = request.method === 'eth_chainId' ? '0x13' : makeRpcResponse(request.method)
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }))
    }

    const result = await verifyDepositTx(TX_HASH, {
      chainId: CHAIN_ID,
      poolContractAddress: POOL,
      expectedDepositor: SPONSOR,
    })

    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /RPC chain id .* != expected/)
  })

  it('rejects a fake receipt without a matching USDC Transfer and Deposited event', async () => {
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string }
      const result = makeRpcResponse(request.method)
      if (request.method === 'eth_getTransactionReceipt' && result && typeof result === 'object' && 'logs' in result) {
        result.logs = []
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }))
    }

    const result = await verifyDepositTx(TX_HASH, {
      chainId: CHAIN_ID,
      poolContractAddress: POOL,
      expectedDepositor: SPONSOR,
    })

    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /Expected exactly one USDC Transfer event, found 0/)
  })

  it('rejects a transfer amount that disagrees with the pool deposit event', async () => {
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string }
      const result = makeRpcResponse(request.method)
      if (request.method === 'eth_getTransactionReceipt' && result && typeof result === 'object' && 'logs' in result) {
        result.logs[0].data = encodedAmount(AMOUNT + 1)
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }))
    }

    const result = await verifyDepositTx(TX_HASH, {
      chainId: CHAIN_ID,
      poolContractAddress: POOL,
      expectedDepositor: SPONSOR,
    })

    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /Transfer amount .* != Deposited amount/)
  })

  it('rejects reverted receipts', async () => {
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string }
      const result = makeRpcResponse(request.method)
      if (request.method === 'eth_getTransactionReceipt' && result && typeof result === 'object' && 'status' in result) {
        result.status = '0x0'
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }))
    }

    const result = await verifyDepositTx(TX_HASH, {
      chainId: CHAIN_ID,
      poolContractAddress: POOL,
      expectedDepositor: SPONSOR,
    })

    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /Transaction reverted on-chain/)
  })

  it('rejects a transaction from a different depositor', async () => {
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string }
      const result = makeRpcResponse(request.method)
      if (request.method === 'eth_getTransactionByHash' && result && typeof result === 'object' && 'from' in result) {
        result.from = '0x4444444444444444444444444444444444444444'
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }))
    }

    const result = await verifyDepositTx(TX_HASH, {
      chainId: CHAIN_ID,
      poolContractAddress: POOL,
      expectedDepositor: SPONSOR,
    })

    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /Transaction sender .* != expected depositor/)
  })
})
