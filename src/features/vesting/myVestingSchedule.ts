export interface MyVestingScheduleLog {
  vaultAddress: string
  scheduleId: bigint
  beneficiary: string
  type: 'created' | 'claimed' | 'revoked'
}

export function selectMyVestingScheduleLogs<T extends MyVestingScheduleLog>(
  logs: readonly T[],
  wallet: string,
  managedVault?: string,
): T[] {
  const walletKey = wallet.toLowerCase()
  const managedVaultKey = managedVault?.toLowerCase()
  const seen = new Set<string>()

  return logs.filter(log => {
    if (log.type !== 'created') return false

    const isBeneficiary = log.beneficiary.toLowerCase() === walletKey
    const managesVault = managedVaultKey !== undefined && log.vaultAddress.toLowerCase() === managedVaultKey
    if (!isBeneficiary && !managesVault) return false

    const key = `${log.vaultAddress.toLowerCase()}:${log.scheduleId.toString()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
