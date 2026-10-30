// Single source of truth for the deployed contract.
// Import from here everywhere — never hardcode addresses.
import { arcTestnet } from 'viem/chains'
import type { Abi } from 'viem'
import { getUsdc } from '@/onchain-facts'
import { usdcDecimalsFor } from '@/onchain-money'
import artifact from '../contracts/out/USDCVesting.sol/USDCVesting.json'

export const CHAIN_ID = arcTestnet.id
export const USDC_INFO = getUsdc(CHAIN_ID)!
export const USDC_DECIMALS = usdcDecimalsFor(CHAIN_ID)
export const USDC_ADDRESS = USDC_INFO.address as `0x${string}`

export const CONTRACT_ADDRESS = '0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693' as `0x${string}`
export const CONTRACT_ABI = artifact.abi as Abi

export const CONTRACT = {
  address: CONTRACT_ADDRESS,
  abi: CONTRACT_ABI,
  chainId: CHAIN_ID,
} as const
