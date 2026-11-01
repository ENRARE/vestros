export type WorkspaceEventType = 'created' | 'claimed' | 'revoked'

export interface WorkspaceEventLog {
  type: WorkspaceEventType
  beneficiary?: string
  txHash?: string
  amount: bigint
  scheduleId?: bigint
  blockNumber?: bigint
  logIndex?: number
}

export function buildCsv(
  headers: string[],
  rows: Array<Array<string | number | bigint | null | undefined>>,
): string {
  const escape = (value: string | number | bigint | null | undefined) => {
    const text = value == null ? '' : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [headers, ...rows].map(row => row.map(escape).join(',')).join('\n')
}

export function filterEventLogs<T extends WorkspaceEventLog>(
  logs: readonly T[],
  eventType: WorkspaceEventType | 'all',
  query: string,
): T[] {
  const needle = query.trim().toLowerCase()
  return logs.filter(log => {
    if (eventType !== 'all' && log.type !== eventType) return false
    if (!needle) return true
    const haystack = [
      log.type,
      log.beneficiary ?? '',
      log.txHash ?? '',
      log.scheduleId?.toString() ?? '',
      log.blockNumber?.toString() ?? '',
    ].join(' ').toLowerCase()
    return haystack.includes(needle)
  })
}

export function summarizeEventLogs(logs: readonly WorkspaceEventLog[]) {
  const summary = {
    created: 0n,
    claimed: 0n,
    revoked: 0n,
    counts: { created: 0, claimed: 0, revoked: 0 },
  }
  for (const log of logs) {
    summary[log.type] += log.amount
    summary.counts[log.type] += 1
  }
  return summary
}
