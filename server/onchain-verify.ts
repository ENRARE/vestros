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

import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  parseAbi,
  toBytes,
} from 'viem'

// Event signatures
const AWARD_ACTIVATED_SIG  = keccak256(toBytes(
  'AwardActivated(uint256,address,uint256,uint32,uint32,uint256,address)'
))
const SCHEDULE_CREATED_SIG = keccak256(toBytes(
  'ScheduleCreated(uint256,address,uint256,uint48,uint48,uint48)'
))
const TRANSFER_SIG = keccak256(toBytes('Transfer(address,address,uint256)'))
const DEPOSITED_SIG = keccak256(toBytes('Deposited(address,uint256)'))

const AWARD_ACTIVATED_ABI = parseAbi([
  'event AwardActivated(uint256 indexed awardId, address indexed beneficiary, uint256 amount, uint32 vestingCliffDays, uint32 vestingDays, uint256 vestingScheduleId, address vestingContract)',
])
const SCHEDULE_CREATED_ABI = parseAbi([
  'event ScheduleCreated(uint256 indexed scheduleId, address indexed beneficiary, uint256 amount, uint48 startTime, uint48 cliffTime, uint48 endTime)',
])
const TRANSFER_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])
const DEPOSITED_ABI = parseAbi([
  'event Deposited(address indexed depositor, uint256 amount)',
])
const POOL_USDC_ABI = parseAbi([
  'function usdc() view returns (address)',
])
const POOL_GRANT_VESTING_ABI = parseAbi([
  'function grantVesting() view returns (address)',
])
const OWNABLE_ABI = parseAbi([
  'function owner() view returns (address)',
])

const ARC_TESTNET_ID = 5042002
const ARC_MAINNET_ID = 5042
const ARC_USDC = '0x3600000000000000000000000000000000000000'

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
  vestingStartTime?: number
}

export interface AwardExpectation {
  awardDbId: string            // UUID for logging
  onchainAwardIndex: number    // uint256 index in the pool's awards[] array
  poolContractAddress: string  // expected pool contract
  beneficiaryAddr: string      // from DB
  amountRaw: number            // raw 6-decimal USDC amount from DB
  vestingCliffDays: number     // expected schedule parameters from DB
  vestingDays: number
  chainId: number
}

type RpcLog = { address: string; topics: string[]; data: string }
type RpcReceipt = {
  status: string
  to: string | null
  blockNumber: string
  logs: RpcLog[]
}
type RpcTransaction = { from: string; to: string | null }

export interface DepositExpectation {
  chainId: number
  poolContractAddress: string
  expectedDepositor: string
}

export interface DepositVerifyResult {
  ok: boolean
  error?: string
  depositor?: string
  amountRaw?: number
  blockNumber?: number
  tokenAddress?: string
}

/**
 * Independently verify a GrantPool.deposit transaction.
 *
 * The database must use only the values returned by this function. In
 * particular, amount, depositor, block number, token, and confirmation state
 * are derived from the chain rather than from request metadata.
 */
export async function verifyDepositTx(
  txHash: string,
  expected: DepositExpectation,
): Promise<DepositVerifyResult> {
  if (![ARC_TESTNET_ID, ARC_MAINNET_ID].includes(expected.chainId)) {
    return { ok: false, error: `Unsupported Arc chain id ${expected.chainId}` }
  }

  const poolAddress = expected.poolContractAddress.toLowerCase()
  const expectedDepositor = expected.expectedDepositor.toLowerCase()
  const tokenAddress = ARC_USDC.toLowerCase()

  let rpcUrl: string
  try {
    rpcUrl = resolveRpcUrl(expected.chainId)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  try {
    const rpcChainId = await rpcCall<string>(rpcUrl, 'eth_chainId', [])
    const actualChainId = Number(BigInt(rpcChainId))
    if (actualChainId !== expected.chainId) {
      return { ok: false, error: `RPC chain id ${actualChainId} != expected ${expected.chainId}` }
    }

    const transaction = await rpcCall<RpcTransaction | null>(
      rpcUrl, 'eth_getTransactionByHash', [txHash],
    )
    if (!transaction) return { ok: false, error: 'Transaction not found' }
    if (transaction.from.toLowerCase() !== expectedDepositor) {
      return { ok: false, error: `Transaction sender ${transaction.from} != expected depositor ${expected.expectedDepositor}` }
    }
    if ((transaction.to ?? '').toLowerCase() !== poolAddress) {
      return { ok: false, error: `tx.to ${transaction.to ?? ''} != expected pool ${expected.poolContractAddress}` }
    }

    const receipt = await rpcCall<RpcReceipt | null>(
      rpcUrl, 'eth_getTransactionReceipt', [txHash],
    )
    if (!receipt) return { ok: false, error: 'Transaction not found or not yet mined' }
    if (receipt.status !== '0x1') return { ok: false, error: 'Transaction reverted on-chain' }
    if ((receipt.to ?? '').toLowerCase() !== poolAddress) {
      return { ok: false, error: `receipt.to ${receipt.to ?? ''} != expected pool ${expected.poolContractAddress}` }
    }

    const transferLogs = receipt.logs.filter(
      log => log.address.toLowerCase() === tokenAddress &&
        log.topics[0]?.toLowerCase() === TRANSFER_SIG.toLowerCase(),
    )
    if (transferLogs.length !== 1) return { ok: false, error: `Expected exactly one USDC Transfer event, found ${transferLogs.length}` }
    const transferLog = transferLogs[0]

    let transfer: { from: string; to: string; value: bigint }
    try {
      const decoded = decodeEventLog({
        abi: TRANSFER_ABI,
        data: transferLog.data as `0x${string}`,
        topics: transferLog.topics as [`0x${string}`, ...`0x${string}`[]],
      })
      transfer = decoded.args
    } catch (e) {
      return { ok: false, error: `USDC Transfer decode failed: ${(e as Error).message}` }
    }
    if (transfer.from.toLowerCase() !== expectedDepositor) {
      return { ok: false, error: 'USDC Transfer sender mismatch' }
    }
    if (transfer.to.toLowerCase() !== poolAddress) {
      return { ok: false, error: 'USDC Transfer recipient mismatch' }
    }

    const depositedLogs = receipt.logs.filter(
      log => log.address.toLowerCase() === poolAddress &&
        log.topics[0]?.toLowerCase() === DEPOSITED_SIG.toLowerCase(),
    )
    if (depositedLogs.length !== 1) return { ok: false, error: `Expected exactly one GrantPool Deposited event, found ${depositedLogs.length}` }
    const depositedLog = depositedLogs[0]

    let deposited: { depositor: string; amount: bigint }
    try {
      const decoded = decodeEventLog({
        abi: DEPOSITED_ABI,
        data: depositedLog.data as `0x${string}`,
        topics: depositedLog.topics as [`0x${string}`, ...`0x${string}`[]],
      })
      deposited = decoded.args
    } catch (e) {
      return { ok: false, error: `GrantPool Deposited decode failed: ${(e as Error).message}` }
    }
    if (deposited.depositor.toLowerCase() !== expectedDepositor) {
      return { ok: false, error: 'Deposited event sender mismatch' }
    }
    if (transfer.value !== deposited.amount) {
      return { ok: false, error: `Transfer amount ${transfer.value} != Deposited amount ${deposited.amount}` }
    }

    const usdcCall = encodeFunctionData({ abi: POOL_USDC_ABI, functionName: 'usdc' })
    const poolTokenRaw = await rpcCall<string>(rpcUrl, 'eth_call', [
      { to: expected.poolContractAddress, data: usdcCall },
      receipt.blockNumber,
    ])
    const poolToken = decodeFunctionResult({
      abi: POOL_USDC_ABI,
      functionName: 'usdc',
      data: poolTokenRaw as `0x${string}`,
    }) as string
    if (poolToken.toLowerCase() !== tokenAddress) {
      return { ok: false, error: `GrantPool usdc ${poolToken} != expected USDC ${ARC_USDC}` }
    }

    const blockNumber = Number(BigInt(receipt.blockNumber))
    if (!Number.isSafeInteger(blockNumber)) {
      return { ok: false, error: 'Receipt block number is not a safe integer' }
    }
    const amountRaw = Number(deposited.amount)
    if (!Number.isSafeInteger(amountRaw) || amountRaw <= 0) {
      return { ok: false, error: 'Deposit amount is not a safe positive integer' }
    }

    return { ok: true, depositor: transfer.from, amountRaw, blockNumber, tokenAddress: poolToken }
  } catch (e) {
    return { ok: false, error: `Deposit verification failed: ${(e as Error).message}` }
  }
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

  try {
    const rpcChainId = await rpcCall<string>(rpcUrl, 'eth_chainId', [])
    const actualChainId = Number(BigInt(rpcChainId))
    if (actualChainId !== award.chainId) {
      return { ok: false, error: `RPC chain id ${actualChainId} != expected ${award.chainId}` }
    }
  } catch (e) {
    return { ok: false, error: `Chain verification failed: ${(e as Error).message}` }
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

  let evA: {
    awardId: bigint; beneficiary: string; amount: bigint
    vestingCliffDays: number; vestingDays: number
    vestingScheduleId: bigint; vestingContract: string
  }
  try {
    const d = decodeEventLog({
      abi: AWARD_ACTIVATED_ABI,
      data: activatedLog.data as `0x${string}`,
      topics: activatedLog.topics as [`0x${string}`, ...`0x${string}`[]],
    })
    evA = d.args
  } catch (e) {
    return { ok: false, error: `AwardActivated decode failed: ${(e as Error).message}` }
  }

  if (evA.awardId !== BigInt(award.onchainAwardIndex))              return { ok: false, error: `Event awardId ${evA.awardId} != expected ${award.onchainAwardIndex}` }
  if (evA.beneficiary.toLowerCase() !== award.beneficiaryAddr.toLowerCase()) return { ok: false, error: `Event beneficiary mismatch` }
  if (evA.amount !== BigInt(award.amountRaw))                       return { ok: false, error: `Event amount ${evA.amount} != DB ${award.amountRaw}` }
  if (evA.vestingCliffDays !== award.vestingCliffDays)              return { ok: false, error: `Event cliff ${evA.vestingCliffDays} != DB ${award.vestingCliffDays}` }
  if (evA.vestingDays !== award.vestingDays)                        return { ok: false, error: `Event vesting days ${evA.vestingDays} != DB ${award.vestingDays}` }
  if (!evA.vestingContract || evA.vestingContract === '0x0000000000000000000000000000000000000000') {
    return { ok: false, error: 'vestingContract is zero — direct transfer fallback was used' }
  }

  let configuredVestingRaw: string
  try {
    configuredVestingRaw = await rpcCall<string>(rpcUrl, 'eth_call', [
      { to: award.poolContractAddress, data: encodeFunctionData({ abi: POOL_GRANT_VESTING_ABI, functionName: 'grantVesting' }) },
      receipt.blockNumber,
    ])
  } catch (e) {
    return { ok: false, error: `GrantPool grantVesting() call failed: ${(e as Error).message}` }
  }
  let configuredVesting: string
  try {
    configuredVesting = decodeFunctionResult({
      abi: POOL_GRANT_VESTING_ABI,
      functionName: 'grantVesting',
      data: configuredVestingRaw as `0x${string}`,
    })
  } catch (e) {
    return { ok: false, error: `GrantPool grantVesting() decode failed: ${(e as Error).message}` }
  }
  if (configuredVesting.toLowerCase() !== evA.vestingContract.toLowerCase()) {
    return { ok: false, error: 'configured GrantVesting mismatch' }
  }

  let vestingOwnerRaw: string
  try {
    vestingOwnerRaw = await rpcCall<string>(rpcUrl, 'eth_call', [
      { to: evA.vestingContract, data: encodeFunctionData({ abi: OWNABLE_ABI, functionName: 'owner' }) },
      receipt.blockNumber,
    ])
  } catch (e) {
    return { ok: false, error: `GrantVesting owner() call failed: ${(e as Error).message}` }
  }
  let vestingOwner: string
  try {
    vestingOwner = decodeFunctionResult({
      abi: OWNABLE_ABI,
      functionName: 'owner',
      data: vestingOwnerRaw as `0x${string}`,
    })
  } catch (e) {
    return { ok: false, error: `GrantVesting owner() decode failed: ${(e as Error).message}` }
  }
  if (vestingOwner.toLowerCase() !== award.poolContractAddress.toLowerCase()) {
    return { ok: false, error: 'GrantVesting owner is not the configured pool' }
  }

  // Decode ScheduleCreated from GrantVesting
  const scheduleLog = receipt.logs.find(
    l => l.address.toLowerCase() === evA.vestingContract.toLowerCase() &&
         l.topics[0]?.toLowerCase() === SCHEDULE_CREATED_SIG.toLowerCase()
  )
  if (!scheduleLog) return { ok: false, error: 'ScheduleCreated not found in GrantVesting logs' }

  let evS: {
    scheduleId: bigint; beneficiary: string; amount: bigint
    startTime: number; cliffTime: number; endTime: number
  }
  try {
    const d = decodeEventLog({
      abi: SCHEDULE_CREATED_ABI,
      data: scheduleLog.data as `0x${string}`,
      topics: scheduleLog.topics as [`0x${string}`, ...`0x${string}`[]],
    })
    evS = d.args
  } catch (e) {
    return { ok: false, error: `ScheduleCreated decode failed: ${(e as Error).message}` }
  }

  if (evS.amount !== BigInt(award.amountRaw))                       return { ok: false, error: `ScheduleCreated amount ${evS.amount} != DB ${award.amountRaw}` }
  if (evS.beneficiary.toLowerCase() !== award.beneficiaryAddr.toLowerCase()) return { ok: false, error: `ScheduleCreated beneficiary mismatch` }
  if (evA.vestingScheduleId !== evS.scheduleId)                     return { ok: false, error: `Schedule ID mismatch between events` }
  if (evS.cliffTime < evS.startTime || evS.endTime < evS.startTime) {
    return { ok: false, error: 'ScheduleCreated timestamps are inconsistent' }
  }
  if (BigInt(evS.cliffTime - evS.startTime) !== BigInt(award.vestingCliffDays) * 86_400n) {
    return { ok: false, error: 'ScheduleCreated cliff duration mismatch' }
  }
  if (BigInt(evS.endTime - evS.startTime) !== BigInt(award.vestingDays) * 86_400n) {
    return { ok: false, error: 'ScheduleCreated vesting duration mismatch' }
  }
  const vestingStartTime = evS.startTime
  if (!Number.isSafeInteger(vestingStartTime)) {
    return { ok: false, error: 'ScheduleCreated start time is not a safe integer' }
  }

  // GrantVesting.createSchedule funds the schedule with transferFrom(pool,
  // vestingContract). Require that exact token movement in the same receipt;
  // the ScheduleCreated event alone is not sufficient proof of funding.
  const fundingTransferLogs = receipt.logs.filter(
    log => log.address.toLowerCase() === ARC_USDC.toLowerCase() &&
      log.topics[0]?.toLowerCase() === TRANSFER_SIG.toLowerCase(),
  )
  if (fundingTransferLogs.length !== 1) return { ok: false, error: `Expected exactly one GrantVesting funding Transfer, found ${fundingTransferLogs.length}` }
  const fundingTransferLog = fundingTransferLogs[0]
  let fundingTransfer: { from: string; to: string; value: bigint }
  try {
    const d = decodeEventLog({
      abi: TRANSFER_ABI,
      data: fundingTransferLog.data as `0x${string}`,
      topics: fundingTransferLog.topics as [`0x${string}`, ...`0x${string}`[]],
    })
    fundingTransfer = d.args
  } catch (e) {
    return { ok: false, error: `GrantVesting funding Transfer decode failed: ${(e as Error).message}` }
  }
  if (fundingTransfer.from.toLowerCase() !== award.poolContractAddress.toLowerCase()) {
    return { ok: false, error: 'GrantVesting funding sender mismatch' }
  }
  if (fundingTransfer.to.toLowerCase() !== evA.vestingContract.toLowerCase()) {
    return { ok: false, error: 'GrantVesting funding recipient mismatch' }
  }
  if (fundingTransfer.value !== BigInt(award.amountRaw)) {
    return { ok: false, error: `GrantVesting funding amount ${fundingTransfer.value} != DB ${award.amountRaw}` }
  }

  let vestingUsdcRaw: string
  try {
    vestingUsdcRaw = await rpcCall<string>(rpcUrl, 'eth_call', [
      { to: evA.vestingContract, data: encodeFunctionData({ abi: POOL_USDC_ABI, functionName: 'usdc' }) },
      receipt.blockNumber,
    ])
  } catch (e) {
    return { ok: false, error: `GrantVesting usdc() call failed: ${(e as Error).message}` }
  }
  let vestingUsdc: string
  try {
    vestingUsdc = decodeFunctionResult({
      abi: POOL_USDC_ABI,
      functionName: 'usdc',
      data: vestingUsdcRaw as `0x${string}`,
    })
  } catch (e) {
    return { ok: false, error: `GrantVesting usdc() decode failed: ${(e as Error).message}` }
  }
  if (vestingUsdc.toLowerCase() !== ARC_USDC.toLowerCase()) {
    return { ok: false, error: `GrantVesting usdc ${vestingUsdc} != expected USDC ${ARC_USDC}` }
  }

  return {
    ok: true,
    scheduleId: evA.vestingScheduleId.toString(),
    vestingContract: evA.vestingContract,
    blockNumber: parseInt(receipt.blockNumber, 16),
    vestingStartTime,
  }
}
