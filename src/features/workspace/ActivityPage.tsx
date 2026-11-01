import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount, useReadContract } from 'wagmi'
import { Activity as ActivityIcon, Award, CheckCircle2, ExternalLink, FileText, Layers, RefreshCw, XCircle } from 'lucide-react'
import { CONTRACT, CHAIN_ID } from '@/contractConfig'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { fmtAddr, fmtDate, fmtTimestamp, fmtUsdc } from '@/formatters'
import { useVestingEvents } from '@/hooks/useVestingEvents'
import { AuthBanner } from '@/granthub/components/AuthBanner'
import { useAuth } from '@/granthub/useAuth'
import { getMyApplications, getMyAwards } from '@/granthub/api'
import type { GrantApplication, GrantAward } from '@/granthub/types'
import { EmptyState, IndexerBanner, SectionHeader, Card } from '@/components/ui/Primitives'
import { useUserVestingVault } from '@/hooks/useUserVestingVault'

export function ActivityPage() {
  const { address, isConnected } = useAccount()
  const { address: sessionAddr } = useAuth()
  const vault = useUserVestingVault()
  const { data: ownerAddr } = useReadContract({ ...(vault.contract ?? CONTRACT), functionName: 'owner' })
  const { logs, loading, error, indexedBlock, headBlock, progressPct, refresh } = useVestingEvents()
  const [applications, setApplications] = useState<GrantApplication[]>([])
  const [awards, setAwards] = useState<GrantAward[]>([])
  const [apiError, setApiError] = useState<string | null>(null)

  const isOwner = !!address && typeof ownerAddr === 'string' && address.toLowerCase() === ownerAddr.toLowerCase()
  const ownerScopedLogs = useMemo(() => logs.filter(log => log.vaultAddress.toLowerCase() === (vault.vaultAddress ?? CONTRACT.address).toLowerCase()), [logs, vault.vaultAddress])
  const walletLogs = useMemo(() => {
    if (!address) return []
    if (isOwner) return ownerScopedLogs
    const wallet = address.toLowerCase()
    return logs.filter(log => log.beneficiary.toLowerCase() === wallet)
  }, [address, isOwner, logs, ownerScopedLogs])

  useEffect(() => {
    if (!sessionAddr) return
    let cancelled = false
    void Promise.allSettled([getMyApplications(), getMyAwards()]).then(([apps, awds]) => {
      if (cancelled) return
      const rejected = [apps, awds].find(result => result.status === 'rejected')
      setApiError(rejected?.status === 'rejected' ? (rejected.reason as Error).message : null)
      setApplications(apps.status === 'fulfilled' ? apps.value : [])
      setAwards(awds.status === 'fulfilled' ? awds.value : [])
    })
    return () => { cancelled = true }
  }, [sessionAddr])

  const visibleApplications = sessionAddr ? applications : []
  const visibleAwards = sessionAddr ? awards : []

  if (!isConnected) {
    return <div className="max-w-3xl mx-auto px-6 py-8"><SectionHeader title="Activity" sub="Your onchain vesting and GrantHub history" /><AuthBanner /></div>
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 space-y-5">
      <SectionHeader
        title="Activity"
        sub={isOwner ? 'Recent activity across the vesting contract and your GrantHub account' : 'Recent activity involving your wallet'}
        action={<button onClick={refresh} className="p-2 rounded-xl" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--muted)' }} aria-label="Refresh activity"><RefreshCw size={14} /></button>}
      />
      {!sessionAddr && <AuthBanner />}
      {apiError && <p className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}>{apiError}</p>}
      <IndexerBanner progress={progressPct} error={error} indexedBlock={indexedBlock} headBlock={headBlock} onRetry={refresh} />

      <Card className="p-4">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Vesting events</h2>
        {loading && walletLogs.length === 0 ? <p className="py-6 text-sm" style={{ color: 'var(--muted)' }}>Loading available activity…</p> : walletLogs.length === 0 ? (
          <EmptyState icon={<ActivityIcon size={22} />} title={error ? 'Activity history is unavailable' : 'No vesting activity yet'} sub={error ? 'Direct vesting data remains available. Retry when the network is ready.' : 'Schedule creation, claims, and revocations will appear here.'} />
        ) : (
          <div className="mt-3">
            {walletLogs.slice(0, 50).map((log, index) => {
              const isCreated = log.type === 'created'
              const isClaimed = log.type === 'claimed'
              return (
                <div key={`${log.txHash}-${log.logIndex}-${index}`} className="flex items-center gap-3 py-3" style={{ borderTop: '1px solid var(--border)' }}>
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-muted)' }}>
                    {isCreated ? <Layers size={14} style={{ color: 'var(--accent)' }} /> : isClaimed ? <CheckCircle2 size={14} style={{ color: 'var(--success)' }} /> : <XCircle size={14} style={{ color: 'var(--danger)' }} />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{isCreated ? 'Schedule created' : isClaimed ? 'USDC claimed' : 'Schedule revoked'}</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>Schedule #{log.scheduleId.toString()} · {fmtAddr(log.beneficiary)} · {log.timestamp === undefined ? `block ${log.blockNumber.toString()}` : fmtTimestamp(Number(log.timestamp))}</p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums" style={{ color: isClaimed ? 'var(--success)' : 'var(--ink-2)' }}>{fmtUsdc(log.amount)} USDC</span>
                  {log.txHash && <a href={buildTxExplorerUrl(CHAIN_ID, log.txHash)} target="_blank" rel="noopener noreferrer" aria-label="Open transaction"><ExternalLink size={13} style={{ color: 'var(--subtle)' }} /></a>}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="p-4 h-full">
          <div className="flex items-center gap-2 mb-3"><FileText size={15} style={{ color: 'var(--accent)' }} /><h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Grant applications</h2></div>
          {!sessionAddr ? <p className="text-xs" style={{ color: 'var(--muted)' }}>Sign in to load GrantHub applications.</p> : visibleApplications.length === 0 ? <EmptyState icon={<FileText size={20} />} title="No applications" sub="Applications you submit will be listed here." /> : (
            <div className="space-y-2">{visibleApplications.slice(0, 8).map(app => <Link key={app.id} to={`/granthub/grants/${app.grant_id}`} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: 'var(--surface-muted)' }}><span className="min-w-0"><span className="block text-sm truncate" style={{ color: 'var(--ink)' }}>{app.project_title ?? app.project_name}</span><span className="text-xs" style={{ color: 'var(--muted)' }}>{app.grant_title ?? app.grant_id} · {fmtDate(app.updated_at)}</span></span><span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>{app.status}</span></Link>)}</div>
          )}
        </Card>
        <Card className="p-4 h-full">
          <div className="flex items-center gap-2 mb-3"><Award size={15} style={{ color: 'var(--accent)' }} /><h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Grant awards</h2></div>
          {!sessionAddr ? <p className="text-xs" style={{ color: 'var(--muted)' }}>Sign in to load GrantHub awards.</p> : visibleAwards.length === 0 ? <EmptyState icon={<Award size={20} />} title="No awards" sub="Activated awards will appear here." /> : (
            <div className="space-y-2">{visibleAwards.slice(0, 8).map(award => <div key={award.id} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: 'var(--surface-muted)' }}><span className="min-w-0"><span className="block text-sm truncate" style={{ color: 'var(--ink)' }}>{award.amount} USDC</span><span className="text-xs" style={{ color: 'var(--muted)' }}>{award.grant_title ?? award.grant_id} · {fmtDate(award.updated_at)}</span></span><span className="text-xs font-semibold" style={{ color: award.status === 'vesting_activated' ? 'var(--success)' : 'var(--muted)' }}>{award.status}</span></div>)}</div>
          )}
        </Card>
      </div>
    </div>
  )
}
