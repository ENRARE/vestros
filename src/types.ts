// Shared Vestros types — do not import from App.tsx
import type { DurationUnit } from './vestingDuration'

export interface VestingSchedule {
  beneficiary: string
  revoked: boolean
  startTime: number
  cliffTime: number
  endTime: number
  revokeTime: number
  totalAmount: bigint
  claimedAmount: bigint
}

export type ScheduleStatus = 'locked' | 'vesting' | 'fully_vested' | 'revoked'

export interface EnrichedSchedule {
  id: bigint
  schedule: VestingSchedule
  status: ScheduleStatus
  vested: bigint
  claimable: bigint
  locked: bigint
}

export interface BulkEntry {
  id: string
  beneficiary: string
  amount: string          // decimal USDC string
  cliffValue: string
  cliffUnit: DurationUnit
  vestingValue: string
  vestingUnit: DurationUnit
  error?: string
}

export type BulkTxStatus = 'idle' | 'approving' | 'approved' | 'creating' | 'done' | 'failed'

export interface BulkTxState {
  index: number
  beneficiary: string
  status: BulkTxStatus
  txHash?: string
  error?: string
  errorMsg?: string
}

export interface TreasuryMetrics {
  totalAllocated: bigint
  totalClaimed: bigint
  totalVestedUnclaimed: bigint
  totalUnvested: bigint
  totalRevoked: bigint    // unvested returned from revocations
  activeCount: number
  revokedCount: number
  beneficiaryCount: number
  scheduleCount: number
}
