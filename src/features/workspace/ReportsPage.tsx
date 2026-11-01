import { useEffect, useMemo, useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { Download, FileBarChart, RefreshCw } from 'lucide-react'
import { fmtAddr, fmtDate, fmtUsdc } from '@/formatters'
import { CHAIN_ID, CONTRACT } from '@/contractConfig'
import { useVestingEvents } from '@/hooks/useVestingEvents'
import { buildCsv, filterEventLogs } from './workspace-utils'
import { getMyApplications, getMyAwards } from '@/granthub/api'
import { useAuth } from '@/granthub/useAuth'
import type { GrantApplication, GrantAward } from '@/granthub/types'
import { AuthBanner } from '@/granthub/components/AuthBanner'
import { Card, EmptyState, SectionHeader } from '@/components/ui/Primitives'
import { useUserVestingVault } from '@/hooks/useUserVestingVault'

type ReportTab = 'vesting' | 'granthub'
type EventFilter = 'all' | 'created' | 'claimed' | 'revoked'

function downloadCsv(filename: string, csv: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

export function ReportsPage() {
  const { address } = useAccount()
  const vault = useUserVestingVault()
  const { data: ownerAddr } = useReadContract({ ...(vault.contract ?? CONTRACT), functionName: 'owner' })
  const { address: sessionAddr } = useAuth()
  const { logs, refresh } = useVestingEvents()
  const [tab, setTab] = useState<ReportTab>('vesting')
  const [eventFilter, setEventFilter] = useState<EventFilter>('all')
  const [query, setQuery] = useState('')
  const [applications, setApplications] = useState<GrantApplication[]>([])
  const [awards, setAwards] = useState<GrantAward[]>([])
  const isOwner = !!address && typeof ownerAddr === 'string' && address.toLowerCase() === ownerAddr.toLowerCase()

  useEffect(() => {
    if (!sessionAddr) return
    void Promise.all([getMyApplications(), getMyAwards()]).then(([apps, awds]) => { setApplications(apps); setAwards(awds) }).catch(() => { setApplications([]); setAwards([]) })
  }, [sessionAddr])

  const visibleLogs = useMemo(() => {
    const ownerScopedLogs = logs.filter(log => log.vaultAddress.toLowerCase() === (vault.vaultAddress ?? CONTRACT.address).toLowerCase())
    const walletLogs = address
      ? isOwner ? ownerScopedLogs : logs.filter(log => log.beneficiary.toLowerCase() === address.toLowerCase())
      : []
    return filterEventLogs(walletLogs, eventFilter, query)
  }, [address, eventFilter, isOwner, logs, query, vault.vaultAddress])

  const exportVesting = () => downloadCsv(`vestros-vesting-${Date.now()}.csv`, buildCsv(
    ['vaultAddress', 'event', 'scheduleId', 'beneficiary', 'amountUsdc', 'block', 'txHash'],
    visibleLogs.map(log => [log.vaultAddress, log.type, log.scheduleId, log.beneficiary, fmtUsdc(log.amount), log.blockNumber, log.txHash]),
  ))
  const exportGrantHub = () => downloadCsv(`vestros-granthub-${Date.now()}.csv`, buildCsv(
    ['recordType', 'id', 'title', 'status', 'amountUsdc', 'updatedAt'],
    [
      ...applications.map(app => ['application', app.id, app.project_title ?? app.project_name, app.status, app.requested_amount ?? '', fmtDate(app.updated_at)]),
      ...awards.map(award => ['award', award.id, award.grant_title ?? award.grant_id, award.status, award.amount ?? '', fmtDate(award.updated_at)]),
    ],
  ))

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 space-y-5">
      <SectionHeader title="Reports" sub="Filter and export records sourced from Arc and GrantHub" action={<button onClick={refresh} className="p-2 rounded-xl" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--muted)' }} aria-label="Refresh reports"><RefreshCw size={14} /></button>} />
      {!address && <AuthBanner />}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--surface-muted)' }}>
        {([['vesting', 'Vesting events'], ['granthub', 'GrantHub records']] as const).map(([value, label]) => <button key={value} onClick={() => setTab(value)} className="flex-1 py-2 rounded-lg text-xs font-semibold" style={{ background: tab === value ? 'var(--surface-strong)' : 'transparent', color: tab === value ? 'var(--ink)' : 'var(--muted)' }}>{label}</button>)}
      </div>
      {tab === 'vesting' ? (
        <Card>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <select value={eventFilter} onChange={e => setEventFilter(e.target.value as EventFilter)} className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}><option value="all">All event types</option><option value="created">Created</option><option value="claimed">Claimed</option><option value="revoked">Revoked</option></select>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search address, tx, schedule, or block" className="flex-1 rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
            <button onClick={exportVesting} disabled={visibleLogs.length === 0} className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}><Download size={13} /> CSV</button>
          </div>
          {visibleLogs.length === 0 ? <EmptyState icon={<FileBarChart size={22} />} title="No matching vesting events" sub="Connect the beneficiary wallet or change the filters." /> : <div className="space-y-2">{visibleLogs.slice(0, 100).map((log, index) => <div key={`${log.vaultAddress}-${log.txHash}-${index}`} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: 'var(--surface-muted)' }}><span className="text-xs uppercase" style={{ color: 'var(--subtle)' }}>{log.type}</span><span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>#{log.scheduleId.toString()}</span><span className="mono text-[10px]" style={{ color: 'var(--subtle)' }}>{fmtAddr(log.vaultAddress)}</span><span className="flex-1 text-xs truncate" style={{ color: 'var(--muted)' }}>{fmtAddr(log.beneficiary)}</span><span className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>{fmtUsdc(log.amount)} USDC</span><span className="text-[10px]" style={{ color: 'var(--subtle)' }}>chain {CHAIN_ID}</span></div>)}</div>}
        </Card>
      ) : (
        <Card>
          {!sessionAddr ? <AuthBanner /> : <><div className="flex justify-end mb-4"><button onClick={exportGrantHub} disabled={applications.length + awards.length === 0} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}><Download size={13} /> CSV</button></div><div className="space-y-2">{applications.map(app => <div key={app.id} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: 'var(--surface-muted)' }}><span className="text-xs" style={{ color: 'var(--accent)' }}>Application</span><span className="flex-1 text-sm truncate" style={{ color: 'var(--ink)' }}>{app.project_title ?? app.project_name}</span><span className="text-xs" style={{ color: 'var(--muted)' }}>{app.requested_amount} USDC · {app.status}</span></div>)}{awards.map(award => <div key={award.id} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: 'var(--surface-muted)' }}><span className="text-xs" style={{ color: 'var(--success)' }}>Award</span><span className="flex-1 text-sm truncate" style={{ color: 'var(--ink)' }}>{award.grant_title ?? award.grant_id}</span><span className="text-xs" style={{ color: 'var(--muted)' }}>{award.amount} USDC · {award.status}</span></div>)}{applications.length + awards.length === 0 && <EmptyState icon={<FileBarChart size={22} />} title="No GrantHub records" sub="Your applications and awards will be available after signing in." />}</div></>}
        </Card>
      )}
    </div>
  )
}
