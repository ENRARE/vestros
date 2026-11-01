import { useEffect } from 'react'
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import type { Address } from 'viem'
import {
  SELF_SERVICE_CHAIN_ID,
  VESTING_FACTORY_ADDRESS,
  VESTING_FACTORY_CONFIG_ERROR,
  VESTING_FACTORY_CONTRACT,
  VESTING_FACTORY_DEPLOYED,
  selfServiceVestingContract,
} from '@/vestingFactoryConfig'
import { canCreateUserVault, normalizeVaultAddress, userVaultStateKey } from './userVestingVaultState'

export interface UserVestingVaultState {
  vaultAddress?: Address
  isConnected: boolean
  isLoading: boolean
  isCreating: boolean
  isConfigured: boolean
  canCreate: boolean
  createTxHash?: `0x${string}`
  creationConfirmed: boolean
  error?: Error
  configError: string | null
  contract: ReturnType<typeof selfServiceVestingContract> | undefined
  createVault: () => void
  refetch: () => void
}

export function useUserVestingVault(): UserVestingVaultState {
  const { address, isConnected, chainId } = useAccount()
  const enabled = isConnected && address !== undefined && chainId === SELF_SERVICE_CHAIN_ID && VESTING_FACTORY_DEPLOYED
  const { data, isLoading, refetch } = useReadContract({
    ...VESTING_FACTORY_CONTRACT,
    functionName: 'vaultOf',
    args: address ? [address] : undefined,
    query: { enabled },
  })
  const { writeContract, data: createTxHash, isPending, error: writeError, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: creationConfirmed, error: receiptError } = useWaitForTransactionReceipt({
    hash: createTxHash,
  })
  const vaultAddress = normalizeVaultAddress(data)
  const canCreate = canCreateUserVault({
    isConnected,
    activeChainId: SELF_SERVICE_CHAIN_ID,
    connectedChainId: chainId,
    factoryDeployed: VESTING_FACTORY_DEPLOYED,
    vaultAddress,
  })

  const walletStateKey = userVaultStateKey(address, chainId)

  useEffect(() => {
    if (creationConfirmed) void refetch()
  }, [creationConfirmed, refetch])

  useEffect(() => {
    // The read key includes the account, while write state does not. Resetting
    // here prevents one wallet from seeing another wallet's old tx/hash state.
    reset()
  }, [walletStateKey, reset])

  const createVault = () => {
    if (!canCreate || !VESTING_FACTORY_ADDRESS) return
    writeContract({
      ...VESTING_FACTORY_CONTRACT,
      functionName: 'createVault',
    })
  }

  const error = writeError ?? receiptError ?? undefined

  return {
    vaultAddress,
    isConnected,
    isLoading: enabled && isLoading,
    isCreating: isPending || isConfirming,
    isConfigured: VESTING_FACTORY_DEPLOYED,
    canCreate,
    createTxHash,
    creationConfirmed,
    error,
    configError: VESTING_FACTORY_CONFIG_ERROR,
    contract: vaultAddress ? selfServiceVestingContract(vaultAddress) : undefined,
    createVault,
    refetch: () => { void refetch() },
  }
}
