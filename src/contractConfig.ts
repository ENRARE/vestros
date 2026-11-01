// Single source of truth for the deployed contract.
// Import from here everywhere — never hardcode addresses.
import { isAddress, type Abi } from 'viem'
import { getUsdc } from '@/onchain-facts'
import { usdcDecimalsFor } from '@/onchain-money'
import { ACTIVE_ARC_CHAIN } from './arcChains'
import { CHAIN_ENV } from './networkConfig'
import artifact from '../contracts/out/USDCVesting.sol/USDCVesting.json'

export const CHAIN_ID = ACTIVE_ARC_CHAIN.id
export const USDC_INFO = getUsdc(CHAIN_ID)!
export const USDC_DECIMALS = usdcDecimalsFor(CHAIN_ID)
export const USDC_ADDRESS = USDC_INFO.address as `0x${string}`

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const
function envString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

const env: Record<string, string | undefined> = {
  VITE_USDC_VESTING_CONTRACT_TESTNET: envString(import.meta.env?.VITE_USDC_VESTING_CONTRACT_TESTNET),
  VITE_USDC_VESTING_CONTRACT: envString(import.meta.env?.VITE_USDC_VESTING_CONTRACT),
  VITE_USDC_VESTING_CONTRACT_MAINNET: envString(import.meta.env?.VITE_USDC_VESTING_CONTRACT_MAINNET),
}
const testnetAddress = env.VITE_USDC_VESTING_CONTRACT_TESTNET ??
  env.VITE_USDC_VESTING_CONTRACT ??
  '0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693'
const configuredAddress = CHAIN_ENV === 'mainnet'
  ? env.VITE_USDC_VESTING_CONTRACT_MAINNET
  : testnetAddress
const validAddress = typeof configuredAddress === 'string' && isAddress(configuredAddress)
  ? configuredAddress
  : undefined

export const CONTRACT_ADDRESS = validAddress ?? ZERO_ADDRESS
export const CONTRACT_DEPLOYED = validAddress !== undefined
export const CONTRACT_CONFIG_ERROR = validAddress !== undefined
  ? null
  : `No USDCVesting address configured for Arc ${CHAIN_ENV}. Set ` +
    (CHAIN_ENV === 'mainnet' ? 'VITE_USDC_VESTING_CONTRACT_MAINNET' : 'VITE_USDC_VESTING_CONTRACT_TESTNET')
export const CONTRACT_ABI = artifact.abi as Abi

export const CONTRACT = {
  address: CONTRACT_ADDRESS,
  abi: CONTRACT_ABI,
  chainId: CHAIN_ID,
} as const
