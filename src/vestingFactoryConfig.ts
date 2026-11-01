import { type Abi } from 'viem'
import { getUsdc } from './onchain-facts'
import { ARC_MAINNET_ID, ARC_TESTNET_ID } from './networkConfig'
import { isFactoryConfigured, resolveVestingFactoryAddress, type VestingFactoryEnvironment } from './vestingFactoryAddress'
import factoryArtifact from '../contracts/out/VestingFactory.sol/VestingFactory.json'
import vaultArtifact from '../contracts/out/SelfServiceVesting.sol/SelfServiceVesting.json'

function envString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

const env: Record<string, string | undefined> = {
  VITE_CHAIN_ENV: envString(import.meta.env?.VITE_CHAIN_ENV),
  VITE_VESTING_FACTORY_MAINNET: envString(import.meta.env?.VITE_VESTING_FACTORY_MAINNET),
  VITE_VESTING_FACTORY_TESTNET: envString(import.meta.env?.VITE_VESTING_FACTORY_TESTNET),
  VITE_VESTING_FACTORY_DEPLOY_TX_MAINNET: envString(import.meta.env?.VITE_VESTING_FACTORY_DEPLOY_TX_MAINNET),
  VITE_VESTING_FACTORY_DEPLOY_TX_TESTNET: envString(import.meta.env?.VITE_VESTING_FACTORY_DEPLOY_TX_TESTNET),
}
export const VESTING_FACTORY_ENV: VestingFactoryEnvironment = env.VITE_CHAIN_ENV === 'mainnet' ? 'mainnet' : 'testnet'
export const SELF_SERVICE_CHAIN_ID = VESTING_FACTORY_ENV === 'mainnet' ? ARC_MAINNET_ID : ARC_TESTNET_ID
export const SELF_SERVICE_USDC_INFO = getUsdc(SELF_SERVICE_CHAIN_ID)!
export const SELF_SERVICE_USDC_ADDRESS = SELF_SERVICE_USDC_INFO.address as `0x${string}`
export const SELF_SERVICE_USDC_DECIMALS = SELF_SERVICE_USDC_INFO.decimals

export const VESTING_FACTORY_ADDRESS = resolveVestingFactoryAddress(VESTING_FACTORY_ENV, env)
export const VESTING_FACTORY_DEPLOY_TX = VESTING_FACTORY_ENV === 'mainnet'
  ? env.VITE_VESTING_FACTORY_DEPLOY_TX_MAINNET
  : env.VITE_VESTING_FACTORY_DEPLOY_TX_TESTNET
export const VESTING_FACTORY_DEPLOYED = isFactoryConfigured(VESTING_FACTORY_ADDRESS)
export const VESTING_FACTORY_CONFIG_ERROR = VESTING_FACTORY_DEPLOYED
  ? null
  : `No self-service VestingFactory address configured for Arc ${VESTING_FACTORY_ENV}. Set ` +
    (VESTING_FACTORY_ENV === 'mainnet' ? 'VITE_VESTING_FACTORY_MAINNET' : 'VITE_VESTING_FACTORY_TESTNET')

export const VESTING_FACTORY_ABI = factoryArtifact.abi as Abi
export const SELF_SERVICE_VESTING_ABI = vaultArtifact.abi as Abi

export const VESTING_FACTORY_CONTRACT = {
  address: VESTING_FACTORY_ADDRESS ?? '0x0000000000000000000000000000000000000000',
  abi: VESTING_FACTORY_ABI,
  chainId: SELF_SERVICE_CHAIN_ID,
} as const

export function selfServiceVestingContract(address: `0x${string}`) {
  return {
    address,
    abi: SELF_SERVICE_VESTING_ABI,
    chainId: SELF_SERVICE_CHAIN_ID,
  } as const
}
