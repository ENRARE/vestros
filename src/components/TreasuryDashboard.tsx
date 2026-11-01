/**
 * TreasuryDashboard — organization-wide view of all vesting activity.
 * Shows aggregated metrics, per-beneficiary breakdown, and event history.
 * Data sourced from on-chain event logs via useVestingEvents.
 */
import { useState, useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { Download, RefreshCw, Users, TrendingUp, Clock, CheckCircle2, XCircle, ExternalLink } from 'lucide-react'
import { CONTRACT, CHAIN_ID } from '@/contractConfig'
import { buildAddressExplorerUrl, buildTxExplorerUrl } from '@/onchain-facts'
import { fmtUsdc, fmtUsdcShort, fmtAddr, fmtUsdcCsv, fmtTimestamp } from '@/formatters'
import { computeVested, getStatus } from '@/vestingMath'
import { MetricTile, SectionHeader, EmptyState, MiniProgressBar, Card, IndexerBanner } from '@/components/ui/Primitives'
import { useVestingEvents } from '@/hooks/useVestingEvents'
import { useChainTime } from '@/hooks/useChainTime'
import type { ScheduleRef } from '@/hooks/useVestingEvents'
import type { VestingSchedule, TreasuryMetrics } from '@/types'

// ─── Types ───────────────────────────────────────────────────────────────────
interface ScheduleSummary {
  vaultAddress: string
  id: bigint
  schedule: VestingSchedule
  vested: bigint
  claimable: bigint
}

// ─── AllScheduleReader ───────────────────────────────────────────────────────
// Reads all schedules from the contract given a list of IDs from the event index.
// chainNow: live block timestamp from useChainTime, passed in from the parent
// so all components share the same reference time.
function useAllSchedules(scheduleRefs: ScheduleRef[], chainNow: number) {
  const calls = scheduleRefs.map(ref => ({
    ...CONTRACT,
    address: ref.vaultAddress,
    functionName: 'getSchedule' as const,
    args: [ref.scheduleId] as const,
  }))

  const { data, isLoading, refetch } = useReadContracts({
    contracts: calls,
    query: { enabled: scheduleRefs.length > 0 },
  })

  const schedules: ScheduleSummary[] = useMemo(() => {
    if (!data) return []
    const result: ScheduleSummary[] = []
    for (let i = 0; i < scheduleRefs.length; i++) {
      const r = data[i]
      if (r?.status === 'success' && r.result) {
        const s = r.result as unknown as VestingSchedule
        if (s.totalAmount === 0n) continue
        const vested = computeVested(s, chainNow)
        // Guard against underflow if claimedAmount > vested
        const claimable = vested > s.claimedAmount ? vested - s.claimedAmount : 0n
        result.push({ vaultAddress: scheduleRefs[i].vaultAddress, id: scheduleRefs[i].scheduleId, schedule: s, vested, claimable })
      }
    }
    return result
  }, [data, chainNow, scheduleRefs])

  return { schedules, isLoading, refetch }
}

// ─── Metrics computation ─────────────────────────────────────────────────────
function computeMetrics(summaries: ScheduleSummary[]): TreasuryMetrics {
  let totalAllocated = 0n
  let totalClaimed = 0n
  let totalVestedUnclaimed = 0n
  let totalUnvested = 0n
  let totalRevoked = 0n
  let activeCount = 0
  let revokedCount = 0
  const beneficiaries = new Set<string>()

  for (const { schedule: s, vested } of summaries) {
    totalAllocated += s.totalAmount
    totalClaimed += s.claimedAmount
    totalVestedUnclaimed += (vested - s.claimedAmount > 0n ? vested - s.claimedAmount : 0n)
    beneficiaries.add(s.beneficiary.toLowerCase())
    if (s.revoked) {
      revokedCount++
      const unvested = s.totalAmount - vested
      totalRevoked += unvested
    } else {
      activeCount++
      totalUnvested += (s.totalAmount - vested)
    }
  }

  return {
    totalAllocated,
    totalClaimed,
    totalVestedUnclaimed,
    totalUnvested,
    totalRevoked,
    activeCount,
    revokedCount,
    beneficiaryCount: beneficiaries.size,
    scheduleCount: summaries.length,
  }
}

// ─── BeneficiaryRow ──────────────────────────────────────────────────────────
function BeneficiaryRow({ addr, summaries, chainNow }: { addr: string; summaries: ScheduleSummary[]; chainNow: number }) {
  const [expanded, setExpanded] = useState(false)
  const totalAlloc = summaries.reduce((a, s) => a + s.schedule.totalAmount, 0n)
  const totalClaimed = summaries.reduce((a, s) => a + s.schedule.claimedAmount, 0n)
  const totalVested = summaries.reduce((a, s) => a + s.vested, 0n)
  const claimedPct = totalAlloc > 0n ? Math.min(100, Number((totalClaimed * 10000n) / totalAlloc) / 100) : 0

  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:opacity-80 transition-opacity"
        style={{ borderBottom: expanded ? 'none' : '1px solid var(--border)' }}
      >
        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
          style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>
          {fmtAddr(addr).slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold mono" style={{ color: 'var(--ink-2)' }}>{fmtAddr(addr)}</span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              {summaries.length} schedule{summaries.length !== 1 ? 's' : ''}
            </span>
          </div>
          <MiniProgressBar value={claimedPct} />
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{fmtUsdc(totalVested)} <span style={{ color: 'var(--subtle)' }}>/ {fmtUsdc(totalAlloc)}</span></div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>vested</div>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-3 flex flex-col gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
          {summaries.map(({ id, vaultAddress, schedule: s }) => {
            const status = getStatus(s, chainNow)
            return (
              <div key={`${vaultAddress}-${id.toString()}`} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--surface-muted)' }}>
                <span className="font-medium" style={{ color: 'var(--subtle)' }}>#{id.toString()}</span>
                <span className="mono" style={{ color: 'var(--subtle)' }}>{fmtAddr(vaultAddress)}</span>
                <span className="flex-1 tabular-nums font-semibold" style={{ color: 'var(--ink-2)' }}>{fmtUsdc(s.totalAmount)} USDC</span>
                <span style={{ color: status === 'revoked' ? 'var(--danger)' : status === 'fully_vested' ? 'var(--success)' : 'var(--muted)' }}>
                  {status.replace('_', ' ')}
                </span>
                <a href={buildAddressExplorerUrl(CHAIN_ID, s.beneficiary)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={11} style={{ color: 'var(--subtle)' }} />
                </a>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── EventRow ────────────────────────────────────────────────────────────────
function EventRow({ log }: { log: import('@/hooks/useVestingEvents').EventLog }) {
  const icon = log.type === 'created' ? <TrendingUp size={12} style={{ color: 'var(--accent)' }} />
    : log.type === 'claimed' ? <CheckCircle2 size={12} style={{ color: 'var(--success)' }} />
    : <XCircle size={12} style={{ color: 'var(--danger)' }} />

  const label = log.type === 'created' ? 'Schedule created'
    : log.type === 'claimed' ? 'Claimed'
    : 'Revoked'

  return (
    <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
      <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--surface-muted)' }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0 text-xs">
        <span className="font-semibold" style={{ color: 'var(--ink-2)' }}>{label}</span>
        <span className="ml-1 mono" style={{ color: 'var(--subtle)' }}>#{log.scheduleId.toString()}</span>
        <span className="ml-1 mono" style={{ color: 'var(--subtle)' }}>{fmtAddr(log.vaultAddress)}</span>
        <span className="ml-1" style={{ color: 'var(--muted)' }}>{fmtAddr(log.beneficiary)}</span>
        <span className="ml-1" style={{ color: 'var(--subtle)' }}>{log.timestamp === undefined ? `block ${log.blockNumber.toString()}` : fmtTimestamp(Number(log.timestamp))}</span>
      </div>
      <span className="text-xs font-semibold tabular-nums shrink-0" style={{ color: 'var(--ink-2)' }}>{fmtUsdc(log.amount)}</span>
      {log.txHash && (
        <a href={buildTxExplorerUrl(CHAIN_ID, log.txHash)} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={11} style={{ color: 'var(--subtle)' }} />
        </a>
      )}
    </div>
  )
}

// ─── CSV export ──────────────────────────────────────────────────────────────
// chainNow passed in from the parent so the export reflects the same
// timestamp used for displayed calculations.
function exportCsv(summaries: ScheduleSummary[], chainNow: number) {
  const rows = [
    ['vaultAddress', 'scheduleId', 'beneficiary', 'status', 'totalAmount', 'claimedAmount', 'vestedAmount', 'claimableAmount', 'startDate', 'cliffDate', 'endDate'].join(','),
    ...summaries.map(({ vaultAddress, id, schedule: s, vested, claimable }) => {
      const status = getStatus(s, chainNow)
      return [
        vaultAddress,
        id.toString(),
        s.beneficiary,
        status,
        fmtUsdcCsv(s.totalAmount),
        fmtUsdcCsv(s.claimedAmount),
        fmtUsdcCsv(vested),
        fmtUsdcCsv(claimable > 0n ? claimable : 0n),
        fmtTimestamp(s.startTime),
        fmtTimestamp(s.cliffTime),
        fmtTimestamp(s.endTime),
      ].join(',')
    }),
  ].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }))
  a.download = `vestros-treasury-${Date.now()}.csv`
  a.click()
}

// ─── TreasuryDashboard ───────────────────────────────────────────────────────
export default function TreasuryDashboard({ vaultAddress }: { vaultAddress?: string } = {}) {
  const {
    logs, loading: indexLoading, syncing, error: indexError,
    indexedBlock, headBlock, progressPct, refresh,
  } = useVestingEvents()
  const [activeTab, setActiveTab] = useState<'overview' | 'beneficiaries' | 'history'>('overview')

  // Live chain time — shared by all vesting calculations in this component
  const chainNow = useChainTime()

  const scopedLogs = useMemo(() => {
    if (!vaultAddress) return logs
    return logs.filter(log => log.vaultAddress.toLowerCase() === vaultAddress.toLowerCase())
  }, [logs, vaultAddress])

  // A schedule id is only unique within its originating vault.
  const scheduleRefs = useMemo(() => {
    const refs = new Map<string, ScheduleRef>()
    for (const log of scopedLogs) {
      if (log.type !== 'created') continue
      const key = `${log.vaultAddress.toLowerCase()}:${log.scheduleId.toString()}`
      refs.set(key, { vaultAddress: log.vaultAddress, scheduleId: log.scheduleId })
    }
    return Array.from(refs.values())
  }, [scopedLogs])

  const { schedules, isLoading: schedulesLoading, refetch } = useAllSchedules(scheduleRefs, chainNow)
  const metrics = useMemo(() => computeMetrics(schedules), [schedules])

  const isLoading = schedulesLoading || (indexLoading && schedules.length === 0 && !indexError)
  const hasNoManagedSchedules = !isLoading && schedules.length === 0

  // Group schedules by beneficiary
  const byBeneficiarySchedules = useMemo(() => {
    const map = new Map<string, ScheduleSummary[]>()
    for (const s of schedules) {
      const addr = s.schedule.beneficiary.toLowerCase()
      if (!map.has(addr)) map.set(addr, [])
      map.get(addr)!.push(s)
    }
    return map
  }, [schedules])

  const recentLogs = scopedLogs.slice(0, 50)

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'beneficiaries', label: `Team (${metrics.beneficiaryCount})` },
    { id: 'history', label: `History (${scopedLogs.length})` },
  ] as const

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Treasury Dashboard"
        sub="Organization-wide view of all vesting activity"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => { refresh(); void refetch() }}
              className="p-2 rounded-xl transition-all"
              style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
            >
              <RefreshCw size={14} style={{ color: 'var(--muted)' }} />
            </button>
            <button
              onClick={() => exportCsv(schedules, chainNow)}
              disabled={schedules.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-40"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}
            >
              <Download size={13} /> Export CSV
            </button>
          </div>
        }
      />

      {/* Indexer progress — shows during initial load, incremental sync, and on error */}
      <IndexerBanner
        progress={progressPct}
        error={indexError}
        indexedBlock={indexedBlock}
        headBlock={headBlock}
        onRetry={refresh}
      />
      {syncing && progressPct >= 100 && (
        <div className="rounded-xl px-3 py-2 text-xs flex items-center gap-2"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
          <Clock size={12} className="shrink-0 animate-spin" style={{ animationDuration: '2s' }} />
          Syncing new blocks…
        </div>
      )}

      {/* Tab bar */}
      <div className="flex rounded-xl p-1 gap-1" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
            style={activeTab === t.id ? { background: 'var(--accent)', color: 'white' } : { color: 'var(--subtle)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {activeTab === 'overview' && (
        <div className="flex flex-col gap-4">
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl p-4 h-20 animate-pulse" style={{ background: 'var(--surface-muted)' }} />
              ))}
            </div>
          ) : hasNoManagedSchedules ? (
            <EmptyState
              icon={<Users size={22} />}
              title={indexError ? 'Treasury history is unavailable' : 'No managed schedules'}
              sub={indexError ? 'Your direct vesting balances remain available. Retry history when the network is ready.' : 'Create a vesting schedule to populate treasury values.'}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <MetricTile label="Total Allocated" value={fmtUsdcShort(metrics.totalAllocated)} sub="USDC" tooltip="Sum of all vesting schedule amounts." />
                <MetricTile label="Total Claimed" value={fmtUsdcShort(metrics.totalClaimed)} sub="USDC" accent="var(--success)" tooltip="USDC already withdrawn by beneficiaries." />
                <MetricTile label="Claimable Now" value={fmtUsdcShort(metrics.totalVestedUnclaimed)} sub="USDC" accent="var(--accent)" tooltip="Vested USDC waiting to be claimed." />
                <MetricTile label="Still Vesting" value={fmtUsdcShort(metrics.totalUnvested)} sub="USDC" tooltip="Unvested USDC in active schedules." />
                <MetricTile label="Active Schedules" value={metrics.activeCount.toString()} sub={`${metrics.beneficiaryCount} beneficiar${metrics.beneficiaryCount === 1 ? 'y' : 'ies'}`} />
                <MetricTile label="Revoked" value={metrics.revokedCount.toString()} sub={`${fmtUsdcShort(metrics.totalRevoked)} returned`} tooltip="Schedules stopped early. Unvested USDC returned to owner." />
              </div>

              {/* Allocation donut (SVG approximation) */}
              {metrics.totalAllocated > 0n && (
                <Card className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--subtle)' }}>Allocation breakdown</p>
                  <AllocationBar metrics={metrics} />
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* Beneficiaries tab */}
      {activeTab === 'beneficiaries' && (
        <Card>
          {isLoading ? (
            <div className="p-4 flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: 'var(--surface-muted)' }} />
              ))}
            </div>
          ) : byBeneficiarySchedules.size === 0 ? (
            <EmptyState icon={<Users size={24} />} title={indexError ? 'Treasury history is unavailable' : 'No managed schedules'} sub={indexError ? 'Retry history when the network is ready.' : 'Create a vesting schedule to see beneficiaries here.'} />
          ) : (
            <div>
              {Array.from(byBeneficiarySchedules.entries()).map(([addr, sums]) => (
                <BeneficiaryRow key={addr} addr={addr} summaries={sums} chainNow={chainNow} />
              ))}
            </div>
          )}
        </Card>
      )}

      {/* History tab */}
      {activeTab === 'history' && (
        <Card>
          {indexLoading ? (
            <div className="p-4 flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 rounded-xl animate-pulse" style={{ background: 'var(--surface-muted)' }} />
              ))}
            </div>
          ) : recentLogs.length === 0 ? (
            <EmptyState icon={<Clock size={24} />} title={indexError ? 'History is unavailable' : 'No events yet'} sub={indexError ? 'Retry history when the network is ready.' : 'Verified on-chain events will appear here.'} />
          ) : (
            <div>
              {recentLogs.map((log, i) => (
                <EventRow key={`${log.txHash}-${log.type}-${i}`} log={log} />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

// ─── AllocationBar ───────────────────────────────────────────────────────────
function AllocationBar({ metrics }: { metrics: TreasuryMetrics }) {
  const total = metrics.totalAllocated
  if (!total) return null
  // FIX-10: use bigint arithmetic to avoid Number() overflow on large USDC amounts
  const pctBig = (n: bigint) => Math.min(100, Number((n * 10000n) / total) / 100)
  const claimed = pctBig(metrics.totalClaimed)
  const vested = pctBig(metrics.totalVestedUnclaimed)
  const vesting = pctBig(metrics.totalUnvested)
  const revoked = pctBig(metrics.totalRevoked)

  return (
    <div className="flex flex-col gap-3">
      <div className="h-3 rounded-full overflow-hidden flex" style={{ background: 'var(--surface-muted)' }}>
        <div style={{ width: `${claimed}%`, background: 'var(--success)' }} />
        <div style={{ width: `${vested}%`, background: 'var(--accent)' }} />
        <div style={{ width: `${vesting}%`, background: 'rgba(18,45,69,0.15)' }} />
        <div style={{ width: `${revoked}%`, background: 'rgba(186,43,76,0.35)' }} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Claimed', color: 'var(--success)', value: fmtUsdcShort(metrics.totalClaimed) },
          { label: 'Claimable', color: 'var(--accent)', value: fmtUsdcShort(metrics.totalVestedUnclaimed) },
          { label: 'Still vesting', color: 'rgba(18,45,69,0.4)', value: fmtUsdcShort(metrics.totalUnvested) },
          { label: 'Returned (revoked)', color: 'var(--danger)', value: fmtUsdcShort(metrics.totalRevoked) },
        ].map(({ label, color, value }) => (
          <div key={label} className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
            <span style={{ color: 'var(--muted)' }}>{label}</span>
            <span className="ml-auto font-semibold tabular-nums" style={{ color: 'var(--ink-2)' }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
