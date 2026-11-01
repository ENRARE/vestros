import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAccount, useReadContract } from 'wagmi'
import { BarChart3, Coins, Layers, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { CONTRACT } from '@/contractConfig'
import { fmtUsdc } from '@/formatters'
import { useVestingEvents } from '@/hooks/useVestingEvents'
import { summarizeEventLogs } from './workspace-utils'
import { Card, EmptyState, IndexerBanner, MetricTile, SectionHeader } from '@/components/ui/Primitives'
import { useUserVestingVault } from '@/hooks/useUserVestingVault'

export function AnalyticsPage() {
  const { address } = useAccount()
  const vault = useUserVestingVault()
  const { data: ownerAddr } = useReadContract({ ...(vault.contract ?? CONTRACT), functionName: 'owner' })
  const { logs, loading, error, indexedBlock, headBlock, progressPct, refresh } = useVestingEvents()
  const isOwner = !!address && typeof ownerAddr === 'string' && address.toLowerCase() === ownerAddr.toLowerCase()
  const ownerScopedLogs = useMemo(() => {
    const managedAddress = (vault.vaultAddress ?? CONTRACT.address).toLowerCase()
    return logs.filter(log => log.vaultAddress.toLowerCase() === managedAddress)
  }, [logs, vault.vaultAddress])
  const visibleLogs = useMemo(() => {
    if (!address) return []
    if (isOwner) return ownerScopedLogs
    return logs.filter(log => log.beneficiary.toLowerCase() === address.toLowerCase())
  }, [address, isOwner, logs, ownerScopedLogs])
  const summary = useMemo(() => summarizeEventLogs(visibleLogs), [visibleLogs])
  const maxAmount = Math.max(...Object.values(summary.counts), 1)

  if (!address) return <div className="max-w-4xl mx-auto px-6 py-8"><SectionHeader title="Analytics" sub="Onchain vesting activity metrics" /><EmptyState icon={<BarChart3 size={22} />} title="Connect your wallet" sub="Analytics is scoped to the connected wallet or the contract owner." /></div>

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 space-y-5">
      <SectionHeader title="Analytics" sub={isOwner ? 'Contract-wide event metrics from Arc' : 'Wallet-scoped event metrics from Arc'} action={<button onClick={refresh} className="p-2 rounded-xl" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--muted)' }} aria-label="Refresh analytics"><RefreshCw size={14} /></button>} />
      <IndexerBanner progress={progressPct} error={error} indexedBlock={indexedBlock} headBlock={headBlock} onRetry={refresh} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricTile label="Created" value={fmtUsdc(summary.created)} sub={`${summary.counts.created} event${summary.counts.created === 1 ? '' : 's'}`} />
        <MetricTile label="Claimed" value={fmtUsdc(summary.claimed)} sub={`${summary.counts.claimed} event${summary.counts.claimed === 1 ? '' : 's'}`} accent="var(--success)" />
        <MetricTile label="Revoked" value={fmtUsdc(summary.revoked)} sub={`${summary.counts.revoked} event${summary.counts.revoked === 1 ? '' : 's'}`} accent="var(--danger)" />
        <MetricTile label="Events" value={String(visibleLogs.length)} sub="Indexed records" accent="var(--accent)" />
      </div>
      <Card>
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink)' }}>Event volume</h2>
        {loading && visibleLogs.length === 0 ? <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading available activity…</p> : visibleLogs.length === 0 ? <EmptyState icon={<BarChart3 size={22} />} title={error ? 'Analytics history is unavailable' : 'No metrics yet'} sub={error ? 'Direct vesting data remains available. Retry when the network is ready.' : 'Create or receive a vesting schedule to populate analytics.'} /> : (
          <div className="space-y-4">{(['created', 'claimed', 'revoked'] as const).map(type => <div key={type} className="flex items-center gap-3"><span className="w-20 text-xs capitalize" style={{ color: 'var(--muted)' }}>{type}</span><div className="h-3 rounded-full overflow-hidden flex-1" style={{ background: 'var(--surface-muted)' }}><div className="h-full rounded-full" style={{ width: `${(summary.counts[type] / maxAmount) * 100}%`, background: type === 'created' ? 'var(--accent)' : type === 'claimed' ? 'var(--success)' : 'var(--danger)' }} /></div><span className="w-10 text-right text-xs font-semibold tabular-nums" style={{ color: 'var(--ink-2)' }}>{summary.counts[type]}</span></div>)}</div>
        )}
      </Card>
      <Card>
        <div className="flex items-center gap-2 mb-3"><Coins size={15} style={{ color: 'var(--accent)' }} /><h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Interpretation</h2></div>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>These totals come from indexed contract events and are not estimates. For current vested, claimable, and still-locked balances, open the Treasury dashboard.</p>
        <Link to="/treasury" className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold" style={{ color: 'var(--accent)' }}><TrendingUp size={13} /> Open Treasury</Link>
        <span className="inline-flex items-center gap-1.5 mt-3 ml-4 text-xs" style={{ color: 'var(--subtle)' }}><Layers size={13} /> {isOwner ? 'Owner scope' : 'Beneficiary scope'} <TrendingDown size={13} /></span>
      </Card>
    </div>
  )
}
