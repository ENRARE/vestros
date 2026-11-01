import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Coins, PlusCircle, Layers, Telescope, ArrowRight, Lock, Unlock, Clock } from 'lucide-react'
import { CONTRACT } from '@/contractConfig'
import { CHAIN_ID } from '@/contractConfig'
import { getChain } from '@/onchain-facts'
import { fmtUsdc } from '@/formatters'
import { getStatus } from '@/vestingMath'
import { useChainTime } from '@/hooks/useChainTime'
import { MetricTile, EmptyState, Card, Button, StatusBadge } from '@/components/ui/DesignSystem'
import { IndexerBanner } from '@/components/ui/Primitives'
import type { VestingSchedule, ScheduleStatus } from '@/types'
import { getMyApplications, getMyAwards } from '@/granthub/api'
import { useAuth } from '@/granthub/useAuth'
import { useUserVestingVault } from '@/hooks/useUserVestingVault'
import { useBeneficiaryVestingSchedules } from '@/hooks/useBeneficiaryVestingSchedules'
import { useVestingEvents } from '@/hooks/useVestingEvents'
import { normalizeVestingSchedule } from '@/hooks/beneficiaryScheduleDiscovery'
import { selfServiceVestingContract } from '@/vestingFactoryConfig'
import { selectOverviewScheduleRefs } from './overviewScheduleRefs'
import type { GrantApplication, GrantAward } from '@/granthub/types'

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
  const { address: sessionAddr } = useAuth()
  const navigate = useNavigate()
  const chainNow = useChainTime()
  const activeChain = getChain(CHAIN_ID)
  const vault = useUserVestingVault()
  const activeContract = vault.contract ?? CONTRACT

  // Owner check
  const { data: ownerAddr } = useReadContract({ ...activeContract, functionName: 'owner', query: { enabled: vault.vaultAddress !== undefined } })
  const isOwner = !!address && address.toLowerCase() === (ownerAddr as string | undefined)?.toLowerCase()

  // Schedule references come from every indexed vault. A beneficiary may own
  // a separate vault while receiving schedules from other vault owners.
  const {
    logs,
    loading: indexLoading,
    syncing: indexSyncing,
    error: indexError,
    indexedBlock,
    headBlock,
    progressPct,
    refresh: refreshIndex,
  } = useVestingEvents()
  const directReads = useBeneficiaryVestingSchedules(address)
  const managedVault = isOwner ? (vault.vaultAddress ?? CONTRACT.address) : undefined
  const indexedScheduleRefs = useMemo(
    () => address ? selectOverviewScheduleRefs(logs, address, managedVault) : [],
    [address, logs, managedVault],
  )
  const directScheduleKeys = useMemo(
    () => new Set(directReads.refs.map(ref => `${ref.vaultAddress.toLowerCase()}:${ref.scheduleId.toString()}`)),
    [directReads.refs],
  )
  const fallbackScheduleRefs = useMemo(
    () => indexedScheduleRefs.filter(ref => !directScheduleKeys.has(`${ref.vaultAddress.toLowerCase()}:${ref.scheduleId.toString()}`)),
    [directScheduleKeys, indexedScheduleRefs],
  )

  const contractForVault = (vaultAddress: string) => vaultAddress.toLowerCase() === CONTRACT.address.toLowerCase()
    ? CONTRACT
    : selfServiceVestingContract(vaultAddress as `0x${string}`)
  const scheduleContracts = fallbackScheduleRefs.map(ref => ({
    ...contractForVault(ref.vaultAddress),
    functionName: 'getSchedule' as const,
    args: [ref.scheduleId] as const,
  }))
  const { data: schedulesRaw, isLoading: fallbackSchedulesLoading } = useReadContracts({
    contracts: scheduleContracts,
    query: { enabled: fallbackScheduleRefs.length > 0, retry: false, staleTime: 10_000 },
  })

  const fallbackSchedules: Array<VestingSchedule & { scheduleId: bigint; vaultAddress: string }> = (schedulesRaw ?? [])
    .map((r, i) => r.status === 'success' ? { ...normalizeVestingSchedule(r.result), ...fallbackScheduleRefs[i] } : null)
    .filter(Boolean) as Array<VestingSchedule & { scheduleId: bigint; vaultAddress: string }>

  const fallbackClaimableContracts = fallbackScheduleRefs.map(ref => ({
    ...contractForVault(ref.vaultAddress),
    functionName: 'claimableAmount' as const,
    args: [ref.scheduleId] as const,
  }))
  const { data: claimablesRaw, isLoading: fallbackClaimablesLoading } = useReadContracts({
    contracts: fallbackClaimableContracts,
    query: { enabled: fallbackScheduleRefs.length > 0, retry: false, staleTime: 10_000 },
  })
  const directSchedules = directReads.schedules.map(item => ({
    ...item.schedule,
    scheduleId: item.scheduleId,
    vaultAddress: item.vaultAddress,
  }))
  const directClaimables = directReads.schedules.map(item => item.claimable)
  const fallbackClaimables = (claimablesRaw ?? []).map(r => r.status === 'success' ? (r.result as bigint) : undefined)
  const schedules = [...directSchedules, ...fallbackSchedules]
  const claimables = [...directClaimables, ...fallbackClaimables]
  const claimableValues = claimables.map(value => value ?? ZERO_B)

  const totalAllocated = schedules.reduce((a, s) => a + BigInt(s.totalAmount ?? 0), ZERO_B)
  const totalClaimed   = schedules.reduce((a, s) => a + BigInt(s.claimedAmount ?? 0), ZERO_B)
  const totalClaimable = claimableValues.reduce((a, b) => a + b, ZERO_B)
  const totalLocked    = totalAllocated - totalClaimed - totalClaimable

  // Active schedules (not revoked, not fully vested)
  const activeSchedules = schedules.filter(s => {
    const st = getStatus(s, chainNow)
    return st !== 'revoked' && st !== 'fully_vested'
  })
  const historyRequired = isOwner && directReads.schedules.length === 0
  const historyLoading = historyRequired && (indexLoading || indexSyncing)
  const directDataUnavailable = directReads.error !== null && directReads.schedules.length === 0
  const partialClaimableRead = directReads.schedules.some(item => item.claimable === undefined)
  const scheduleListLoading = directReads.isLoading || directDataUnavailable || historyLoading || fallbackSchedulesLoading
  const scheduleDataLoading = scheduleListLoading || partialClaimableRead || fallbackClaimablesLoading

  const [grantApps, setGrantApps] = useState<GrantApplication[]>([])
  const [grantAwards, setGrantAwards] = useState<GrantAward[]>([])
  const [grantHubError, setGrantHubError] = useState<string | null>(null)
  useEffect(() => {
    if (!sessionAddr) return
    let cancelled = false
    void Promise.all([getMyApplications(), getMyAwards()]).then(([apps, awards]) => {
      if (cancelled) return
      setGrantApps(apps)
      setGrantAwards(awards)
      setGrantHubError(null)
    }).catch(error => {
      if (!cancelled) setGrantHubError((error as Error).message)
    })
    return () => { cancelled = true }
  }, [sessionAddr, _refreshKey])

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
            View your vesting schedules, claim unlocked USDC, manage grants, and track your treasury on {activeChain?.name ?? 'Arc'}.
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
          loading={scheduleDataLoading}
        />
        <MetricTile
          label="Claimable Now"
          value={fmtUsdc(totalClaimable)}
          sub="Ready to withdraw"
          accent={totalClaimable > ZERO_B}
          loading={scheduleDataLoading}
        />
        <MetricTile
          label="Claimed"
          value={fmtUsdc(totalClaimed)}
          sub="All time"
          loading={scheduleDataLoading}
        />
        <MetricTile
          label="Still Locked"
          value={fmtUsdc(totalLocked > ZERO_B ? totalLocked : ZERO_B)}
          sub={`${activeSchedules.length} active schedule${activeSchedules.length !== 1 ? 's' : ''}`}
          loading={scheduleDataLoading}
        />
      </div>

      <IndexerBanner progress={progressPct} error={indexError} indexedBlock={indexedBlock} headBlock={headBlock} onRetry={refreshIndex} />
      {directReads.error && (
        <div className="text-xs rounded-xl px-3 py-2 mb-2" style={{ color: 'var(--danger)', background: 'rgba(186,43,76,0.06)', border: '1px solid rgba(186,43,76,0.15)' }}>
          {directReads.error} <button onClick={directReads.refresh} className="font-semibold" style={{ color: 'var(--accent)', background: 'none', border: 0, padding: 0 }}>Retry direct reads</button>
        </div>
      )}
      {indexError && (
        <button
          onClick={refreshIndex}
          className="text-xs font-semibold self-start"
          style={{ color: 'var(--accent)', background: 'none', border: 0, padding: 0 }}
        >
          Retry vesting index
        </button>
      )}

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
          {scheduleListLoading ? (
            <EmptyState
              icon={<Clock size={22} />}
              title="Loading vesting schedules"
              body="Syncing schedules across supported vaults."
            />
          ) : schedules.length === 0 ? (
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
                  <div key={`${s.vaultAddress}:${String(s.scheduleId)}`} className="flex items-center gap-3 px-5 py-3">
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

          {/* GrantHub snapshot */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.07em]" style={{ color: 'var(--subtle)' }}>GrantHub snapshot</p>
              <button onClick={() => void navigate('/granthub/applications')} className="text-xs font-semibold" style={{ color: 'var(--accent)', background: 'none', border: 0, cursor: 'pointer' }}>View details</button>
            </div>
            {!sessionAddr ? (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Sign in to GrantHub to see your applications and awards.</p>
            ) : grantHubError ? (
              <p className="text-xs" style={{ color: 'var(--danger)' }}>{grantHubError}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl px-3 py-2" style={{ background: 'var(--surface-elevated)' }}><p className="text-xs" style={{ color: 'var(--muted)' }}>Applications</p><p className="text-lg font-bold" style={{ color: 'var(--ink)' }}>{grantApps.length}</p></div>
                <div className="rounded-xl px-3 py-2" style={{ background: 'var(--surface-elevated)' }}><p className="text-xs" style={{ color: 'var(--muted)' }}>Awards</p><p className="text-lg font-bold" style={{ color: grantAwards.length ? 'var(--success)' : 'var(--ink)' }}>{grantAwards.length}</p></div>
              </div>
            )}
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
