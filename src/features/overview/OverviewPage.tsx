import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import { useNavigate } from 'react-router-dom'
import { Coins, PlusCircle, Layers, Telescope, ArrowRight, Lock, Unlock, Clock } from 'lucide-react'
import { CONTRACT } from '@/contractConfig'
import { fmtUsdc, fmtAddr } from '@/formatters'
import { getStatus } from '@/vestingMath'
import { useChainTime } from '@/hooks/useChainTime'
import { MetricTile, EmptyState, Card, Button, StatusBadge } from '@/components/ui/DesignSystem'
import type { VestingSchedule, ScheduleStatus } from '@/types'

const ZERO_B = 0n

function getStatusVariant(s: ScheduleStatus): 'accent' | 'success' | 'danger' | 'neutral' {
  if (s === 'vesting') return 'accent'
  if (s === 'fully_vested') return 'success'
  if (s === 'revoked') return 'danger'
  return 'neutral'
}

function getStatusLabel(s: ScheduleStatus) {
  const m: Record<ScheduleStatus, string> = {
    vesting: 'Vesting', locked: 'Locked', fully_vested: 'Fully Vested', revoked: 'Revoked',
  }
  return m[s]
}

export function OverviewPage({ refreshKey: _refreshKey }: { refreshKey: number }) {
  const { address, isConnected } = useAccount()
  const navigate = useNavigate()
  const chainNow = useChainTime()

  // Owner check
  const { data: ownerAddr } = useReadContract({ ...CONTRACT, functionName: 'owner' })
  const isOwner = !!address && address.toLowerCase() === (ownerAddr as string | undefined)?.toLowerCase()

  // Schedule IDs for connected wallet
  const { data: scheduleIds } = useReadContract({
    ...CONTRACT,
    functionName: 'getScheduleIds',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  const ids = (scheduleIds as bigint[] | undefined) ?? []

  // Fetch all schedules
  const scheduleContracts = ids.map(id => ({
    ...CONTRACT,
    functionName: 'getSchedule' as const,
    args: [id] as const,
  }))
  const { data: schedulesRaw } = useReadContracts({ contracts: scheduleContracts, query: { enabled: ids.length > 0 } })

  const schedules: Array<VestingSchedule & { scheduleId: bigint }> = (schedulesRaw ?? [])
    .map((r, i) => r.status === 'success' ? { ...(r.result as VestingSchedule), scheduleId: ids[i] } : null)
    .filter(Boolean) as Array<VestingSchedule & { scheduleId: bigint }>

  // Claimable amounts
  const claimableContracts = ids.map(id => ({
    ...CONTRACT,
    functionName: 'claimableAmount' as const,
    args: [id] as const,
  }))
  const { data: claimablesRaw } = useReadContracts({ contracts: claimableContracts, query: { enabled: ids.length > 0 } })
  const claimables = (claimablesRaw ?? []).map(r => r.status === 'success' ? (r.result as bigint) : ZERO_B)

  const totalAllocated = schedules.reduce((a, s) => a + BigInt(s.totalAmount ?? 0), ZERO_B)
  const totalClaimed   = schedules.reduce((a, s) => a + BigInt(s.claimedAmount ?? 0), ZERO_B)
  const totalClaimable = claimables.reduce((a, b) => a + b, ZERO_B)
  const totalLocked    = totalAllocated - totalClaimed - totalClaimable

  // Active schedules (not revoked, not fully vested)
  const activeSchedules = schedules.filter(s => {
    const st = getStatus(s, chainNow)
    return st !== 'revoked' && st !== 'fully_vested'
  })

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 px-4 text-center gap-6">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent)' }}
        >
          <Lock size={28} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h2 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>
            Connect your wallet
          </h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--muted)', maxWidth: '40ch', margin: '8px auto 0' }}>
            View your vesting schedules, claim unlocked USDC, manage grants, and track your treasury on Arc Testnet.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto w-full">

      {/* Welcome row */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>
            {isOwner ? 'Workspace Overview' : 'My Overview'}
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            {fmtAddr(address ?? '')} · Arc Testnet
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && (
            <Button variant="primary" size="sm" onClick={() => void navigate('/vesting/create')}>
              <PlusCircle size={14} /> New Schedule
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => void navigate('/granthub')}>
            <Telescope size={14} /> Explore Grants
          </Button>
        </div>
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <MetricTile
          label="Total Allocated"
          value={fmtUsdc(totalAllocated)}
          sub="USDC locked at creation"
          loading={ids.length > 0 && schedules.length === 0}
        />
        <MetricTile
          label="Claimable Now"
          value={fmtUsdc(totalClaimable)}
          sub="Ready to withdraw"
          accent={totalClaimable > ZERO_B}
          loading={ids.length > 0 && claimables.length === 0}
        />
        <MetricTile
          label="Claimed"
          value={fmtUsdc(totalClaimed)}
          sub="All time"
          loading={ids.length > 0 && schedules.length === 0}
        />
        <MetricTile
          label="Still Locked"
          value={fmtUsdc(totalLocked > ZERO_B ? totalLocked : ZERO_B)}
          sub={`${activeSchedules.length} active schedule${activeSchedules.length !== 1 ? 's' : ''}`}
          loading={ids.length > 0 && schedules.length === 0}
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Active schedules */}
        <Card padding={false}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>My Vesting Schedules</span>
            <button
              onClick={() => void navigate('/vesting')}
              className="flex items-center gap-1 text-xs font-medium nav-item-transition"
              style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              View all <ArrowRight size={12} />
            </button>
          </div>
          {schedules.length === 0 ? (
            <EmptyState
              icon={<Coins size={22} />}
              title="No schedules yet"
              body="Vesting schedules assigned to your wallet appear here."
            />
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {schedules.slice(0, 5).map((s, i) => {
                const st = getStatus(s, chainNow)
                const claimable = claimables[i] ?? ZERO_B
                return (
                  <div key={String(s.scheduleId)} className="flex items-center gap-3 px-5 py-3">
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: 'var(--surface-elevated)' }}
                    >
                      {claimable > ZERO_B ? (
                        <Unlock size={14} style={{ color: 'var(--success)' }} />
                      ) : (
                        <Clock size={14} style={{ color: 'var(--muted)' }} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium tabnum" style={{ color: 'var(--ink)' }}>
                          {fmtUsdc(BigInt(s.totalAmount ?? 0))} USDC
                        </span>
                        <StatusBadge label={getStatusLabel(st)} variant={getStatusVariant(st)} />
                      </div>
                      {claimable > ZERO_B && (
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--success)' }}>
                          {fmtUsdc(claimable)} claimable now
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Quick actions */}
        <div className="flex flex-col gap-3">
          {/* Quick actions card */}
          <Card>
            <p className="text-[11px] font-semibold uppercase tracking-[0.07em] mb-3" style={{ color: 'var(--subtle)' }}>
              Quick Actions
            </p>
            <div className="flex flex-col gap-2">
              <QuickAction
                icon={<Coins size={16} />}
                label="View my schedules"
                desc="Track vesting and claim USDC"
                onClick={() => void navigate('/vesting')}
              />
              {isOwner && (
                <QuickAction
                  icon={<PlusCircle size={16} />}
                  label="Create a new vesting schedule"
                  desc="Lock USDC for a beneficiary"
                  onClick={() => void navigate('/vesting/create')}
                  accent
                />
              )}
              {isOwner && (
                <QuickAction
                  icon={<Layers size={16} />}
                  label="Bulk vesting"
                  desc="Import a CSV and vest for multiple recipients"
                  onClick={() => void navigate('/vesting/bulk')}
                />
              )}
              <QuickAction
                icon={<Telescope size={16} />}
                label="Explore grant programs"
                desc="Browse open USDC grants on Arc"
                onClick={() => void navigate('/granthub')}
              />
            </div>
          </Card>

          {/* Network info */}
          <Card style={{ padding: '14px 20px' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.07em]" style={{ color: 'var(--subtle)' }}>Network</p>
                <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--ink)' }}>Arc Testnet · Chain 5042002</p>
              </div>
              <StatusBadge label="Live" variant="success" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function QuickAction({
  icon,
  label,
  desc,
  onClick,
  accent,
}: {
  icon: React.ReactNode
  label: string
  desc: string
  onClick: () => void
  accent?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left nav-item-transition"
      style={{
        background: accent ? 'var(--accent-dim)' : 'var(--surface-elevated)',
        border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
        cursor: 'pointer',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
    >
      <span style={{ color: accent ? 'var(--accent)' : 'var(--muted)' }}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold" style={{ color: accent ? 'var(--accent)' : 'var(--ink)' }}>{label}</p>
        <p className="text-[11px]" style={{ color: 'var(--muted)' }}>{desc}</p>
      </div>
      <ArrowRight size={13} style={{ color: accent ? 'var(--accent)' : 'var(--subtle)', flexShrink: 0 }} />
    </button>
  )
}
