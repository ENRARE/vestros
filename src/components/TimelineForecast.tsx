/**
 * TimelineForecast — interactive per-schedule timeline view with projection.
 * Shows the vesting curve as a simple SVG line chart (no d3 dep needed).
 */
import { useState, useMemo } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import type { Abi, Address } from 'viem'
import { ExternalLink, TrendingUp, AlertCircle } from 'lucide-react'
import { CONTRACT } from '@/contractConfig'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { fmtUsdc, fmtDate, fmtAddr } from '@/formatters'
import { computeVested, getStatus, pct } from '@/vestingMath'
import { StatusBadge, ProgressBar, Card, SectionHeader, EmptyState } from '@/components/ui/Primitives'
import type { VestingSchedule } from '@/types'
import { useChainTime } from '@/hooks/useChainTime'
import { useUserVestingVault } from '@/hooks/useUserVestingVault'
import { useBeneficiaryVestingSchedules } from '@/hooks/useBeneficiaryVestingSchedules'
import { useVestingEvents } from '@/hooks/useVestingEvents'
import { selfServiceVestingContract } from '@/vestingFactoryConfig'
import { selectTimelineSchedules, type TimelineScheduleRef } from '@/features/vesting/timelineLookup'

type VestingContractConfig = { address: Address; abi: Abi; chainId: number }

// ─── Vesting curve SVG ───────────────────────────────────────────────────────
function VestingChart({
  schedule, currentTs,
}: { schedule: VestingSchedule; currentTs: number }) {
  const { startTime, cliffTime, endTime, totalAmount, claimedAmount, revoked, revokeTime } = schedule

  const points = useMemo(() => {
    const pts: { x: number; y: number }[] = []
    const effectiveEnd = revoked && revokeTime > 0 ? revokeTime : endTime
    const rangeStart = startTime
    const rangeEnd = effectiveEnd + Math.max(86400 * 30, (effectiveEnd - startTime) * 0.1)
    const steps = 80

    for (let i = 0; i <= steps; i++) {
      const ts = rangeStart + Math.floor((i / steps) * (rangeEnd - rangeStart))
      const v = computeVested(schedule, ts)
      pts.push({
        x: (ts - rangeStart) / (rangeEnd - rangeStart),
        y: Number((v * 1000n) / (totalAmount || 1n)) / 1000,
      })
    }
    return pts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule])

  const effectiveEnd = revoked && revokeTime > 0 ? revokeTime : endTime
  const rangeStart = startTime
  const rangeEnd = effectiveEnd + Math.max(86400 * 30, (effectiveEnd - startTime) * 0.1)

  const nowX = Math.max(0, Math.min(1, (currentTs - rangeStart) / (rangeEnd - rangeStart)))
  const vestedNow = computeVested(schedule, currentTs)
  const nowY = Number((vestedNow * 1000n) / (totalAmount || 1n)) / 1000

  const W = 400
  const H = 160
  const PAD = { top: 12, right: 16, bottom: 28, left: 52 }
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom

  const toSvg = (x: number, y: number) => ({
    sx: PAD.left + x * cW,
    sy: PAD.top + (1 - y) * cH,
  })

  const pathD = points.map((p, i) => {
    const { sx, sy } = toSvg(p.x, p.y)
    return `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)}`
  }).join(' ')

  const claimedY = Number((claimedAmount * 1000n) / (totalAmount || 1n)) / 1000
  const { sx: nowSx, sy: nowSy } = toSvg(nowX, nowY)
  const { sy: claimedSy } = toSvg(nowX, claimedY)

  const cliffX = Math.max(0, Math.min(1, (cliffTime - rangeStart) / (rangeEnd - rangeStart)))
  const { sx: cliffSx } = toSvg(cliffX, 0)

  const labels = [
    { label: 'Start', ts: startTime },
    { label: 'Cliff', ts: cliffTime },
    { label: revoked ? 'Revoked' : 'End', ts: revoked && revokeTime > 0 ? revokeTime : endTime },
  ]

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160 }}>
        {/* Y axis labels */}
        {[0, 25, 50, 75, 100].map(v => {
          const { sy } = toSvg(0, v / 100)
          return (
            <g key={v}>
              <line x1={PAD.left - 4} x2={PAD.left} y1={sy} y2={sy} stroke="var(--border)" />
              <text x={PAD.left - 6} y={sy + 4} textAnchor="end" fontSize={8} fill="var(--subtle)">{v}%</text>
            </g>
          )
        })}

        {/* Cliff vertical */}
        <line x1={cliffSx} x2={cliffSx} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--border)" strokeDasharray="3,2" />
        <text x={cliffSx + 2} y={PAD.top + 8} fontSize={7} fill="var(--subtle)">Cliff</text>

        {/* Vesting curve */}
        <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={2} />

        {/* Claimed line */}
        <line
          x1={PAD.left} x2={nowSx}
          y1={claimedSy} y2={claimedSy}
          stroke="var(--success)" strokeWidth={1.5} strokeDasharray="4,2"
        />

        {/* Now indicator */}
        <line x1={nowSx} x2={nowSx} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth={1} />
        <circle cx={nowSx} cy={nowSy} r={4} fill="var(--accent)" stroke="white" strokeWidth={1.5} />

        {/* X axis */}
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="var(--border)" />

        {/* X axis date labels */}
        {labels.map(({ label, ts }) => {
          const lx = Math.max(0, Math.min(1, (ts - rangeStart) / (rangeEnd - rangeStart)))
          const { sx } = toSvg(lx, 0)
          const d = new Date(ts * 1000)
          const dateStr = `${d.toLocaleString('en-US', { month: 'short' })} '${String(d.getFullYear()).slice(2)}`
          return (
            <g key={label}>
              <text x={sx} y={H - 4} textAnchor="middle" fontSize={7} fill="var(--subtle)">{dateStr}</text>
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div className="px-4 pb-3 flex gap-4 flex-wrap">
        {[
          { color: 'var(--accent)', label: 'Vested' },
          { color: 'var(--success)', label: 'Claimed', dashed: true },
          { color: 'var(--muted)', label: 'Now', dashed: true },
        ].map(({ color, label, dashed }) => (
          <div key={label} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
            <span className="w-8 h-0.5 inline-block rounded-full" style={{ background: color, borderBottom: dashed ? `2px dashed ${color}` : undefined, backgroundImage: dashed ? 'none' : undefined }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Forecast table ──────────────────────────────────────────────────────────
function ForecastTable({ schedule, now }: { schedule: VestingSchedule; now: number }) {
  const milestones = [
    { label: 'Now', ts: now },
    { label: '30 days', ts: now + 86400 * 30 },
    { label: '90 days', ts: now + 86400 * 90 },
    { label: '180 days', ts: now + 86400 * 180 },
    { label: '1 year', ts: now + 86400 * 365 },
    { label: 'Full vest', ts: schedule.endTime },
  ]

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Point', 'Date', 'Vested', '% of total'].map(h => (
              <th key={h} className="px-3 py-2 text-left font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {milestones.map(({ label, ts }) => {
            const v = computeVested(schedule, ts)
            const p = pct(v, schedule.totalAmount)
            const isPast = ts <= now
            return (
              <tr key={label} style={{ borderBottom: '1px solid var(--border)', opacity: isPast ? 0.7 : 1 }}>
                <td className="px-3 py-2 font-medium" style={{ color: label === 'Now' ? 'var(--accent)' : 'var(--ink-2)' }}>{label}</td>
                <td className="px-3 py-2 mono" style={{ color: 'var(--muted)' }}>{fmtDate(ts)}</td>
                <td className="px-3 py-2 font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>{fmtUsdc(v)} USDC</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                      <div className="h-full rounded-full" style={{ width: `${p}%`, background: 'var(--accent)' }} />
                    </div>
                    <span className="tabular-nums" style={{ color: 'var(--muted)' }}>{p.toFixed(1)}%</span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── ScheduleDetail ──────────────────────────────────────────────────────────
function ScheduleDetail({ id, currentTs, contractConfig }: { id: bigint; currentTs: number; contractConfig: VestingContractConfig }) {
  const now = currentTs  // timestamp captured once at parent mount
  const [showForecast, setShowForecast] = useState(false)

  const { data: raw } = useReadContract({
    ...contractConfig,
    functionName: 'getSchedule',
    args: [id],
  })
  const { data: claimable } = useReadContract({
    ...contractConfig,
    functionName: 'claimableAmount',
    args: [id],
  })

  const s = raw as VestingSchedule | undefined
  if (!s || s.totalAmount === 0n) return null

  const status = getStatus(s, now)
  const vested = computeVested(s, now)
  const vestedPct = pct(vested, s.totalAmount)
  const claimedPct = pct(s.claimedAmount, s.totalAmount)
  const claimableAmt = (claimable as bigint | undefined) ?? 0n

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5 pb-4 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>Schedule #{id.toString()}</span>
              <StatusBadge status={status} />
            </div>
            <a
              href={buildAddressExplorerUrl(contractConfig.chainId, s.beneficiary)}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm font-medium hover:underline mt-0.5"
              style={{ color: 'var(--ink-2)' }}
            >
              <span className="mono">{fmtAddr(s.beneficiary)}</span>
              <ExternalLink size={11} />
            </a>
          </div>
          {claimableAmt > 0n && (
            <div className="rounded-xl px-3 py-2 flex flex-col items-end" style={{ background: 'rgba(26,128,71,0.08)', border: '1px solid rgba(26,128,71,0.2)' }}>
              <span className="text-xs font-medium" style={{ color: 'var(--success)' }}>Claimable now</span>
              <span className="text-base font-bold tabular-nums" style={{ color: 'var(--success)' }}>+{fmtUsdc(claimableAmt)} USDC</span>
            </div>
          )}
        </div>

        <ProgressBar vested={vestedPct} claimed={claimedPct} />

        {/* Chart */}
        <VestingChart schedule={s} currentTs={now} />

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Total', value: `${fmtUsdc(s.totalAmount)} USDC` },
            { label: 'Vested', value: `${fmtUsdc(vested)} USDC`, accent: 'var(--ink)' },
            { label: 'Claimed', value: `${fmtUsdc(s.claimedAmount)} USDC` },
            { label: 'Remaining', value: `${fmtUsdc(s.totalAmount - vested)} USDC` },
          ].map(({ label, value, accent }) => (
            <div key={label} className="rounded-xl px-3 py-2.5 flex flex-col gap-0.5" style={{ background: 'var(--surface-muted)' }}>
              <span className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>{label}</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: accent ?? 'var(--ink)' }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Timeline milestones */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Start', ts: s.startTime },
            { label: 'Cliff', ts: s.cliffTime },
            { label: s.revoked ? 'Revoked' : 'End', ts: s.revoked ? s.revokeTime : s.endTime },
          ].map(({ label, ts }) => (
            <div key={label} className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-muted)' }}>
              <span className="block text-xs tracking-widest uppercase font-medium mb-1" style={{ color: 'var(--subtle)' }}>{label}</span>
              <span className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>{fmtDate(ts)}</span>
            </div>
          ))}
        </div>

        {/* Forecast toggle */}
        <button
          onClick={() => setShowForecast(v => !v)}
          className="flex items-center gap-2 text-xs font-semibold py-2.5 px-4 rounded-xl transition-all"
          style={{ background: showForecast ? 'var(--accent)' : 'var(--surface-muted)', color: showForecast ? 'white' : 'var(--ink-2)', border: '1px solid var(--border)' }}
        >
          <TrendingUp size={13} />
          {showForecast ? 'Hide projection table' : 'Show projection table'}
        </button>

        {showForecast && <ForecastTable schedule={s} now={now} />}
      </div>
    </Card>
  )
}

// ─── TimelineForecast ─────────────────────────────────────────────────────────
export default function TimelineForecast() {
  const [input, setInput] = useState('')
  const [legacyIds, setLegacyIds] = useState<bigint[] | null>(null)
  const [scheduleRefs, setScheduleRefs] = useState<TimelineScheduleRef[] | null>(null)
  const [lookupDone, setLookupDone] = useState(false)
  const [lookupWalletKey, setLookupWalletKey] = useState<string | null>(null)
  const { address: connectedAddress, chainId } = useAccount()
  const vault = useUserVestingVault()
  const contractConfig = vault.contract ?? CONTRACT
  const { byBeneficiary, loading: indexLoading, syncing: indexSyncing } = useVestingEvents()
  const directBeneficiary = input.startsWith('0x') && input.length === 42 ? input as Address : undefined
  const directReads = useBeneficiaryVestingSchedules(directBeneficiary)
  // useChainTime polls block.timestamp every 30 s — keeps vesting curves live
  const currentTs = useChainTime()
  const walletStateKey = `${connectedAddress?.toLowerCase() ?? 'disconnected'}:${chainId ?? 'unknown'}`
  const hasCurrentLookup = lookupDone && lookupWalletKey === walletStateKey

  const { refetch: fetchByAddress } = useReadContract({
    ...contractConfig,
    functionName: 'getScheduleIds',
    args: [input as `0x${string}`],
    query: { enabled: false },
  })

  const handleLookup = async () => {
    if (!input.startsWith('0x') || input.length !== 42) {
      return
    }

    if (directReads.isLoading) {
      setLookupDone(false)
      return
    }

    if (directReads.refs.length > 0) {
      setScheduleRefs(directReads.refs)
      setLegacyIds(null)
      setLookupDone(true)
      setLookupWalletKey(walletStateKey)
      return
    }

    const indexedRefs = selectTimelineSchedules(byBeneficiary, input)
    if (indexedRefs.length > 0) {
      setScheduleRefs(indexedRefs)
      setLegacyIds(null)
      setLookupDone(true)
      setLookupWalletKey(walletStateKey)
      return
    }

    const res = await fetchByAddress()
    setScheduleRefs([])
    setLegacyIds((res.data as bigint[] | undefined) ?? [])
    setLookupDone(true)
    setLookupWalletKey(walletStateKey)
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Timeline & Forecast"
        sub="Visualize a beneficiary's vesting curve and project future unlock dates."
      />

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Beneficiary address 0x…"
          value={input}
          onChange={e => {
            setInput(e.target.value)
            setLegacyIds(null)
            setScheduleRefs(null)
            setLookupDone(false)
            setLookupWalletKey(null)
          }}
          onKeyDown={e => { if (e.key === 'Enter') void handleLookup() }}
          className="flex-1 rounded-xl px-4 py-3 text-sm font-medium mono outline-none"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink)', minHeight: 44 }}
        />
        <button
          onClick={() => void handleLookup()}
          className="px-4 py-3 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'var(--accent)', minHeight: 44 }}
        >
          Load
        </button>
      </div>

      {(indexLoading || indexSyncing) && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Syncing vesting schedules across supported vaults…
        </p>
      )}
      {directReads.error && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Some schedule details are temporarily unavailable. Press Load to retry.
        </p>
      )}

      {hasCurrentLookup && scheduleRefs !== null && scheduleRefs.length === 0 && legacyIds !== null && legacyIds.length === 0 && (
        <EmptyState icon={<AlertCircle size={24} />} title="No schedules found" sub="No vesting schedules exist for this address." />
      )}

      {hasCurrentLookup && scheduleRefs !== null && scheduleRefs.length > 0 && (
        <div className="flex flex-col gap-4">
          {scheduleRefs.map(ref => {
            const refConfig = ref.vaultAddress.toLowerCase() === CONTRACT.address.toLowerCase()
              ? CONTRACT
              : selfServiceVestingContract(ref.vaultAddress as Address)
            return (
              <ScheduleDetail
                key={`${ref.vaultAddress.toLowerCase()}:${ref.scheduleId.toString()}`}
                id={ref.scheduleId}
                currentTs={currentTs}
                contractConfig={refConfig}
              />
            )
          })}
        </div>
      )}

      {hasCurrentLookup && legacyIds !== null && legacyIds.length > 0 && (
        <div className="flex flex-col gap-4">
          {legacyIds.map(id => <ScheduleDetail key={id.toString()} id={id} currentTs={currentTs} contractConfig={contractConfig} />)}
        </div>
      )}
    </div>
  )
}
