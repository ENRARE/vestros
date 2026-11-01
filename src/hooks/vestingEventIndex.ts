export interface IndexedVestingLog {
  vaultAddress: string
  scheduleId: bigint
  type: 'created' | 'claimed' | 'revoked'
  beneficiary: string
  amount: bigint
  blockNumber: bigint
  txHash: string
  logIndex: number
}

export function scheduleRefKey(vaultAddress: string, scheduleId: bigint): string {
  return `${vaultAddress.toLowerCase()}:${scheduleId.toString()}`
}

export function vestingLogKey(log: Pick<IndexedVestingLog, 'vaultAddress' | 'txHash' | 'type' | 'logIndex'>): string {
  return `${log.vaultAddress.toLowerCase()}:${log.txHash}:${log.type}:${log.logIndex}`
}

export function deduplicateVestingLogs<T extends IndexedVestingLog>(logs: readonly T[]): T[] {
  const seen = new Set<string>()
  return logs.filter(log => {
    const key = vestingLogKey(log)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function supportedVaultsFromLogs(coreAddress: string, logs: readonly IndexedVestingLog[]): string[] {
  const seen = new Set<string>()
  const addresses: string[] = []
  for (const address of [
    ...logs.filter(log => log.type === 'created').map(log => log.vaultAddress),
    coreAddress,
  ]) {
    const normalized = address.toLowerCase()
    if (!seen.has(normalized)) {
      seen.add(normalized)
      addresses.push(normalized)
    }
  }
  return addresses
}

export function isCachedIndexStale(cachedLastBlock: bigint | null, currentHead: bigint): boolean {
  return cachedLastBlock !== null && cachedLastBlock > currentHead
}

export function filterVestingLogsForWallet(
  logs: readonly IndexedVestingLog[],
  wallet: string,
  managedVault?: string,
  isOwner = false,
): IndexedVestingLog[] {
  if (isOwner && managedVault) {
    return logs.filter(log => log.vaultAddress.toLowerCase() === managedVault.toLowerCase())
  }
  return logs.filter(log => log.beneficiary.toLowerCase() === wallet.toLowerCase())
}
