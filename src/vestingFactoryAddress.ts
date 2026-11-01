import { isAddress } from 'viem'

export type VestingFactoryEnvironment = 'testnet' | 'mainnet'

export function resolveVestingFactoryAddress(
  environment: VestingFactoryEnvironment,
  env: Record<string, string | undefined>,
): `0x${string}` | undefined {
  const candidate = environment === 'mainnet'
    ? env.VITE_VESTING_FACTORY_MAINNET
    : env.VITE_VESTING_FACTORY_TESTNET

  return typeof candidate === 'string' && isAddress(candidate)
    ? candidate
    : undefined
}

export function isFactoryConfigured(address: string | undefined): address is `0x${string}` {
  return typeof address === 'string' && isAddress(address)
}
