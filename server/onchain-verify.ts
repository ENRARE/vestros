/**
 * onchain-verify.ts — independent onchain receipt verification for award activation.
 *
 * Reads AwardActivated + ScheduleCreated events from the GrantPool tx on Arc,
 * confirming chain, contract, awardId, beneficiary, amount, and vesting creation.
 *
 * RPC: prefers process.env.RPC_PROXY_BASE_URL (Arc Studio RPC proxy).
 * Public fallbacks are read from VITE_ARC_TESTNET_RPC / VITE_ARC_MAINNET_RPC env vars,
 * which must be set in .env. Never hardcoded.
 */

import { keccak256, toBytes, decodeEventLog, parseAbi } from 'viem'

// Event signatures
const AWARD_ACTIVATED_SIG  = keccak256(toBytes(
  'AwardActivated(uint256,address,uint256,uint32,uint32,uint256,address)'
))
const SCHEDULE_CREATED_SIG = keccak256(toBytes(
  'ScheduleCreated(uint256,address,uint256,uint48,uint48,uint48)'
))

const AWARD_ACTIVATED_ABI = parseAbi([
  'event AwardActivated(uint256 indexed awardId, address indexed beneficiary, uint256 amount, uint32 vestingCliffDays, uint32 vestingDays, uint256 vestingScheduleId, address vestingContract)',
])
const SCHEDULE_CREATED_ABI = parseAbi([
  'event ScheduleCreated(uint256 indexed scheduleId, address indexed beneficiary, uint256 amount, uint48 startTime, uint48 cliffTime, uint48 endTime)',
])

const ARC_TESTNET_ID = 5042002
const ARC_MAINNET_ID = 5042

// Proxy chain keys used in RPC_PROXY_CHAINS
const PROXY_KEY: Record<number, string> = {
  [ARC_TESTNET_ID]: 'Arc_Testnet',
  [ARC_MAINNET_ID]: 'Arc',
}

function resolveRpcUrl(chainId: number): string {
  const proxyBase   = process.env.RPC_PROXY_BASE_URL
  const proxyToken  = process.env.RPC_PROXY_TOKEN
  const proxyChains = (process.env.RPC_PROXY_CHAINS ?? '').split(',')
  const key         = PROXY_KEY[chainId]
  if (proxyBase && proxyToken && key && proxyChains.includes(key)) {
    return `${proxyBase}/api/rpc/${key}?_rpc_token=${proxyToken}`
  }
  // Fallback: read from env vars written at deploy time (never hardcoded).
  // Set VITE_ARC_TESTNET_RPC and VITE_ARC_MAINNET_RPC in .env.
  const fallback =
    chainId === ARC_TESTNET_ID ? process.env.VITE_ARC_TESTNET_RPC :
    chainId === ARC_MAINNET_ID ? process.env.VITE_ARC_MAINNET_RPC :
    undefined
  if (fallback) return fallback
  throw new Error(
    `No RPC URL configured for chain ${chainId}. ` +
    `Set RPC_PROXY_BASE_URL/RPC_PROXY_TOKEN or VITE_ARC_TESTNET_RPC/VITE_ARC_MAINNET_RPC in .env`
  )
}

async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`)
  const json = await res.json() as { result?: T; error?: { message: string } }
  if (json.error) throw new Error(`RPC error: ${json.error.message}`)
  return json.result as T
}

export interface VerifyResult {
  ok: boolean
  error?: string
  scheduleId?: string
  vestingContract?: string
  blockNumber?: number
}

export interface AwardExpectation {
  awardDbId: string            // UUID for logging
  onchainAwardIndex: number    // uint256 index in the pool's awards[] array
  poolContractAddress: string  // expected pool contract
  beneficiaryAddr: string      // from DB
  amountRaw: number            // raw 6-decimal USDC amount from DB
  chainId: number
}

type RpcLog = { address: string; topics: string[]; data: string }
type RpcReceipt = {
  status: string
  to: string | null
  blockNumber: string
  logs: RpcLog[]
}

/**
 * Independently verify that txHash activated the award record on-chain.
 * Checks receipt success, correct pool target, AwardActivated event fields,
 * and ScheduleCreated event in GrantVesting — all without trusting the caller.
 */
export async function verifyActivationTx(
  txHash: string,
  award: AwardExpectation,
): Promise<VerifyResult> {
  let rpcUrl: string
  try {
    rpcUrl = resolveRpcUrl(award.chainId)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  let receipt: RpcReceipt | null
  try {
    receipt = await rpcCall<RpcReceipt | null>(
      rpcUrl, 'eth_getTransactionReceipt', [txHash]
    )
  } catch (e) {
    return { ok: false, error: `Receipt fetch failed: ${(e as Error).message}` }
  }

  if (!receipt) return { ok: false, error: 'Transaction not found or not yet mined' }
  if (receipt.status !== '0x1') return { ok: false, error: 'Transaction reverted on-chain' }

  const toAddr = (receipt.to ?? '').toLowerCase()
  if (toAddr !== award.poolContractAddress.toLowerCase()) {
    return { ok: false, error: `tx.to ${toAddr} != expected pool ${award.poolContractAddress}` }
  }

  // Decode AwardActivated
  const activatedLog = receipt.logs.find(
    l => l.address.toLowerCase() === award.poolContractAddress.toLowerCase() &&
         l.topics[0]?.toLowerCase() === AWARD_ACTIVATED_SIG.toLowerCase()
  )
  if (!activatedLog) return { ok: false, error: 'AwardActivated event not found in receipt' }

  let evA: { awardId: bigint; beneficiary: string; amount: bigint; vestingScheduleId: bigint; vestingContract: string }
  try {
    const d = decodeEventLog({
      abi: AWARD_ACTIVATED_ABI,
      data: activatedLog.data as `0x${string}`,
      topics: activatedLog.topics as [`0x${string}`, ...`0x${string}`[]],
    })
    evA = d.args as typeof evA
  } catch (e) {
    return { ok: false, error: `AwardActivated decode failed: ${(e as Error).message}` }
  }

  if (Number(evA.awardId)   !== award.onchainAwardIndex)            return { ok: false, error: `Event awardId ${evA.awardId} != expected ${award.onchainAwardIndex}` }
  if (evA.beneficiary.toLowerCase() !== award.beneficiaryAddr.toLowerCase()) return { ok: false, error: `Event beneficiary mismatch` }
  if (Number(evA.amount)    !== award.amountRaw)                    return { ok: false, error: `Event amount ${evA.amount} != DB ${award.amountRaw}` }
  if (!evA.vestingContract || evA.vestingContract === '0x0000000000000000000000000000000000000000') {
    return { ok: false, error: 'vestingContract is zero — direct transfer fallback was used' }
  }

  // Decode ScheduleCreated from GrantVesting
  const scheduleLog = receipt.logs.find(
    l => l.address.toLowerCase() === evA.vestingContract.toLowerCase() &&
         l.topics[0]?.toLowerCase() === SCHEDULE_CREATED_SIG.toLowerCase()
  )
  if (!scheduleLog) return { ok: false, error: 'ScheduleCreated not found in GrantVesting logs' }

  let evS: { scheduleId: bigint; beneficiary: string; amount: bigint }
  try {
    const d = decodeEventLog({
      abi: SCHEDULE_CREATED_ABI,
      data: scheduleLog.data as `0x${string}`,
      topics: scheduleLog.topics as [`0x${string}`, ...`0x${string}`[]],
    })
    evS = d.args as typeof evS
  } catch (e) {
    return { ok: false, error: `ScheduleCreated decode failed: ${(e as Error).message}` }
  }

  if (Number(evS.amount)    !== award.amountRaw)                    return { ok: false, error: `ScheduleCreated amount ${evS.amount} != DB ${award.amountRaw}` }
  if (evS.beneficiary.toLowerCase() !== award.beneficiaryAddr.toLowerCase()) return { ok: false, error: `ScheduleCreated beneficiary mismatch` }
  if (evA.vestingScheduleId !== evS.scheduleId)                     return { ok: false, error: `Schedule ID mismatch between events` }

  return {
    ok: true,
    scheduleId: evA.vestingScheduleId.toString(),
    vestingContract: evA.vestingContract,
    blockNumber: parseInt(receipt.blockNumber, 16),
  }
}
