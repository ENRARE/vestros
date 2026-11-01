import type { Address } from 'viem'
import type { VestingSchedule } from '@/types'

export interface DirectScheduleRef {
  vaultAddress: Address
  scheduleId: bigint
}

export interface VaultScheduleIds {
  vaultAddress: Address
  scheduleIds: readonly bigint[]
}

export function scheduleRefKey(ref: DirectScheduleRef): string {
  return `${ref.vaultAddress.toLowerCase()}:${ref.scheduleId.toString()}`
}

export function collectScheduleRefs(vaults: readonly VaultScheduleIds[]): DirectScheduleRef[] {
  const seen = new Set<string>()
  const refs: DirectScheduleRef[] = []

  for (const vault of vaults) {
    for (const scheduleId of vault.scheduleIds) {
      const ref = { vaultAddress: vault.vaultAddress, scheduleId }
      const key = scheduleRefKey(ref)
      if (seen.has(key)) continue
      seen.add(key)
      refs.push(ref)
    }
  }

  return refs
}

export function mergeScheduleRefs(...groups: readonly (readonly DirectScheduleRef[])[]): DirectScheduleRef[] {
  const seen = new Set<string>()
  const refs: DirectScheduleRef[] = []
  for (const group of groups) {
    for (const ref of group) {
      const key = scheduleRefKey(ref)
      if (seen.has(key)) continue
      seen.add(key)
      refs.push(ref)
    }
  }
  return refs
}

export function normalizeVestingSchedule(value: unknown): VestingSchedule | undefined {
  if (!value || typeof value !== 'object') return undefined
  const schedule = value as Record<string, unknown>
  if (typeof schedule.beneficiary !== 'string') return undefined

  const timestamp = (field: string): number => {
    const value = schedule[field]
    const numberValue = typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
    return Number.isSafeInteger(numberValue) ? numberValue : 0
  }

  try {
    return {
      beneficiary: schedule.beneficiary,
      revoked: Boolean(schedule.revoked),
      startTime: timestamp('startTime'),
      cliffTime: timestamp('cliffTime'),
      endTime: timestamp('endTime'),
      revokeTime: timestamp('revokeTime'),
      totalAmount: BigInt(schedule.totalAmount as bigint | number | string),
      claimedAmount: BigInt(schedule.claimedAmount as bigint | number | string),
    }
  } catch {
    return undefined
  }
}
