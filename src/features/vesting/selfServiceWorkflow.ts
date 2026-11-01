import { isAddress } from 'viem'

export interface SelfServiceVaultAccess {
  connectedAddress?: string
  vaultAddress?: string
  vaultOwner?: string
  connectedChainId?: number
  expectedChainId: number
  factoryDeployed: boolean
}

export function isSelfServiceVaultOwner(connectedAddress?: string, vaultOwner?: string): boolean {
  return Boolean(
    connectedAddress &&
    vaultOwner &&
    isAddress(connectedAddress, { strict: false }) &&
    isAddress(vaultOwner, { strict: false }) &&
    connectedAddress.toLowerCase() === vaultOwner.toLowerCase(),
  )
}

export function canUseSelfServiceVault(state: SelfServiceVaultAccess): boolean {
  return Boolean(
    state.factoryDeployed &&
    state.connectedChainId === state.expectedChainId &&
    state.vaultAddress &&
    isAddress(state.vaultAddress, { strict: false }) &&
    isSelfServiceVaultOwner(state.connectedAddress, state.vaultOwner),
  )
}

export function scheduleRefKey(vaultAddress: string, scheduleId: bigint): string {
  return `${vaultAddress.toLowerCase()}:${scheduleId.toString()}`
}
