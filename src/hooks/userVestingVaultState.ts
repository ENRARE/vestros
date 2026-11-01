import { isAddress, type Address } from 'viem'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export const SELF_SERVICE_UNAVAILABLE_TITLE = 'Self-service vaults unavailable'
export const SELF_SERVICE_UNAVAILABLE_COPY = 'Personal vesting vaults will be available after the VestingFactory is deployed and verified on Arc Testnet.'

export interface UserVaultCreationState {
  isConnected: boolean
  activeChainId: number
  connectedChainId?: number
  factoryDeployed: boolean
  vaultAddress?: Address
}

export function normalizeVaultAddress(value: unknown): Address | undefined {
  if (typeof value !== 'string' || !isAddress(value) || value.toLowerCase() === ZERO_ADDRESS) return undefined
  return value
}

export function canCreateUserVault(state: UserVaultCreationState): boolean {
  return state.isConnected &&
    state.connectedChainId === state.activeChainId &&
    state.factoryDeployed &&
    state.vaultAddress === undefined
}

export function userVaultStateKey(address: string | undefined, chainId: number | undefined): string {
  return `${address?.toLowerCase() ?? 'disconnected'}:${chainId ?? 'unknown'}`
}
