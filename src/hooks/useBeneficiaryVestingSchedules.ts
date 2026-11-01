import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import type { Address } from 'viem'
import { ACTIVE_ARC_CHAIN } from '@/arcChains'
import { CONTRACT, CONTRACT_ADDRESS, CONTRACT_DEPLOYED } from '@/contractConfig'
import type { VestingSchedule } from '@/types'
import {
  SELF_SERVICE_CHAIN_ID,
  VESTING_FACTORY_CONTRACT,
  VESTING_FACTORY_DEPLOYED,
  selfServiceVestingContract,
} from '@/vestingFactoryConfig'
import { classifyRpcError } from './vestingRpcReliability'
import { collectScheduleRefs, normalizeVestingSchedule, type DirectScheduleRef } from './beneficiaryScheduleDiscovery'

const MAX_FACTORY_VAULTS = 100
const DIRECT_READ_STALE_TIME = 10_000

export interface DirectVestingSchedule {
  vaultAddress: Address
  scheduleId: bigint
  schedule: VestingSchedule
  claimable?: bigint
}

export interface BeneficiaryVestingSchedulesState {
  schedules: DirectVestingSchedule[]
  refs: DirectScheduleRef[]
  isLoading: boolean
  error: string | null
  refresh: () => void
}

function contractForVault(address: Address) {
  return address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase()
    ? CONTRACT
    : selfServiceVestingContract(address)
}

function readResultValue(result: unknown): unknown {
  return result && typeof result === 'object' && 'status' in result && result.status === 'success'
    ? (result as unknown as { result: unknown }).result
    : undefined
}

function readResultError(result: unknown): unknown {
  return result && typeof result === 'object' && 'status' in result && result.status === 'failure'
    ? (result as { error?: unknown }).error
    : undefined
}

function directReadError(errors: unknown[]): string | null {
  const first = errors.find(Boolean)
  if (!first) return null
  switch (classifyRpcError(first)) {
    case 'rate_limited': return 'Direct vesting reads are temporarily rate limited. Retry shortly.'
    case 'network_unavailable': return 'The Arc network is temporarily unavailable. Retry shortly.'
    case 'contract_read': return 'A vesting vault read failed. Some schedules may be unavailable.'
    default: return 'Some vesting schedules could not be read from the network.'
  }
}

export function useBeneficiaryVestingSchedules(beneficiary?: Address): BeneficiaryVestingSchedulesState {
  const { chainId } = useAccount()
  const active = beneficiary !== undefined && chainId === SELF_SERVICE_CHAIN_ID
  const factoryActive = active && VESTING_FACTORY_DEPLOYED
  const legacyActive = active && CONTRACT_DEPLOYED

  const {
    data: rawVaultCount,
    isLoading: factoryCountLoading,
    error: factoryCountError,
    refetch: refetchFactoryCount,
  } = useReadContract({
    ...VESTING_FACTORY_CONTRACT,
    functionName: 'vaultCount',
    query: { enabled: factoryActive, retry: false, staleTime: DIRECT_READ_STALE_TIME },
  })

  const factoryVaultCount = Math.min(
    MAX_FACTORY_VAULTS,
    rawVaultCount === undefined ? 0 : Number(rawVaultCount),
  )
  const tooManyVaults = rawVaultCount !== undefined && Number(rawVaultCount) > MAX_FACTORY_VAULTS

  const vaultAtContracts = Array.from({ length: factoryVaultCount }, (_, index) => ({
    ...VESTING_FACTORY_CONTRACT,
    functionName: 'vaultAt' as const,
    args: [BigInt(index)] as const,
  }))
  const {
    data: vaultAtResults,
    isLoading: vaultsLoading,
    error: vaultsError,
    refetch: refetchVaults,
  } = useReadContracts({
    contracts: vaultAtContracts,
    query: { enabled: factoryActive && factoryVaultCount > 0, retry: false, staleTime: DIRECT_READ_STALE_TIME },
  })

  const factoryVaults = (vaultAtResults ?? [])
    .map(readResultValue)
    .filter((value): value is Address => typeof value === 'string' && value.startsWith('0x'))
  const vaultAddresses = Array.from(new Set([
    ...(legacyActive ? [CONTRACT_ADDRESS] : []),
    ...factoryVaults,
  ].map(address => address.toLowerCase()))) as Address[]

  const scheduleIdContracts = vaultAddresses.map(vaultAddress => ({
    ...contractForVault(vaultAddress),
    functionName: 'getScheduleIds' as const,
    args: [beneficiary!] as const,
  }))
  const {
    data: scheduleIdResults,
    isLoading: scheduleIdsLoading,
    error: scheduleIdsError,
    refetch: refetchScheduleIds,
  } = useReadContracts({
    contracts: scheduleIdContracts,
    query: { enabled: active && vaultAddresses.length > 0, retry: false, staleTime: DIRECT_READ_STALE_TIME },
  })

  const scheduleSources = vaultAddresses.map((vaultAddress, index) => ({
    vaultAddress,
    scheduleIds: (readResultValue(scheduleIdResults?.[index]) as bigint[] | undefined) ?? [],
  }))
  const refs = collectScheduleRefs(scheduleSources)

  const scheduleContracts = refs.map(ref => ({
    ...contractForVault(ref.vaultAddress),
    functionName: 'getSchedule' as const,
    args: [ref.scheduleId] as const,
  }))
  const claimableContracts = refs.map(ref => ({
    ...contractForVault(ref.vaultAddress),
    functionName: 'claimableAmount' as const,
    args: [ref.scheduleId] as const,
  }))
  const {
    data: scheduleResults,
    isLoading: schedulesLoading,
    error: schedulesError,
    refetch: refetchSchedules,
  } = useReadContracts({
    contracts: scheduleContracts,
    query: { enabled: active && refs.length > 0, retry: false, staleTime: DIRECT_READ_STALE_TIME },
  })
  const {
    data: claimableResults,
    isLoading: claimablesLoading,
    error: claimablesError,
    refetch: refetchClaimables,
  } = useReadContracts({
    contracts: claimableContracts,
    query: { enabled: active && refs.length > 0, retry: false, staleTime: DIRECT_READ_STALE_TIME },
  })

  const schedules: DirectVestingSchedule[] = refs.flatMap((ref, index) => {
    const schedule = normalizeVestingSchedule(readResultValue(scheduleResults?.[index]))
    if (!schedule) return []
    const rawClaimable = readResultValue(claimableResults?.[index])
    return [{
      ...ref,
      schedule,
      claimable: rawClaimable === undefined ? undefined : BigInt(rawClaimable as bigint),
    }]
  })

  const errors = [
    factoryCountError,
    vaultsError,
    scheduleIdsError,
    schedulesError,
    claimablesError,
    ...(vaultAtResults ?? []).map(readResultError),
    ...(scheduleIdResults ?? []).map(readResultError),
    ...(scheduleResults ?? []).map(readResultError),
    ...(claimableResults ?? []).map(readResultError),
  ]
  const wrongChainError = beneficiary !== undefined && chainId !== undefined && chainId !== SELF_SERVICE_CHAIN_ID
    ? `Switch to ${ACTIVE_ARC_CHAIN.name} to read vesting schedules.`
    : null
  const error = wrongChainError ?? (tooManyVaults
    ? `Direct vault discovery is capped at ${MAX_FACTORY_VAULTS} vaults.`
    : directReadError(errors))

  const refresh = () => {
    void Promise.all([
      refetchFactoryCount(),
      refetchVaults(),
      refetchScheduleIds(),
      refetchSchedules(),
      refetchClaimables(),
    ])
  }

  return {
    schedules,
    refs,
    isLoading: active && (factoryCountLoading || vaultsLoading || scheduleIdsLoading || schedulesLoading || claimablesLoading),
    error,
    refresh,
  }
}
