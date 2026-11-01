import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { CheckCircle2, CircleDollarSign, ExternalLink, ShieldAlert } from 'lucide-react'
import { ACTIVE_CHAIN_ID } from '@/networkConfig'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { fmtAddr, fmtUsdc } from '@/formatters'
import { getGrantDeposits, getMyOrgs, listGrants } from '@/granthub/api'
import { useAuth } from '@/granthub/useAuth'
import { AuthBanner } from '@/granthub/components/AuthBanner'
import type { Deposit, GrantProgram, Organization } from '@/granthub/types'
import { Card, EmptyState, MetricTile, SectionHeader } from '@/components/ui/Primitives'

interface FundingGrant { grant: GrantProgram; org: Organization; deposits: Deposit[]; confirmed: number }

export function FundingPage() {
  const { address: walletAddr } = useAccount()
  const { address: sessionAddr } = useAuth()
  const [rows, setRows] = useState<FundingGrant[]>([])
  const [loading, setLoading] = useState(!!sessionAddr)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionAddr) return
    let cancelled = false
    void (async () => {
      try {
        const orgs = await getMyOrgs()
        const grantGroups = await Promise.all(orgs.map(async org => {
          const listed = await listGrants({ orgId: org.id })
          return Promise.all((listed.grants ?? []).map(async grant => {
            const funding = await getGrantDeposits(grant.id).catch(() => ({ deposits: [], confirmed_total: 0 }))
            return { grant, org, deposits: funding.deposits, confirmed: funding.confirmed_total }
          }))
        }))
        if (!cancelled) { setRows(grantGroups.flat()); setError(null) }
      } catch (e) { if (!cancelled) setError((e as Error).message) } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [sessionAddr])

  const totalConfirmed = useMemo(() => rows.reduce((sum, row) => sum + row.confirmed, 0), [rows])
  const totalDeclared = useMemo(() => rows.reduce((sum, row) => sum + Number(row.grant.declared_budget ?? row.grant.total_budget ?? 0), 0), [rows])

  if (!walletAddr || !sessionAddr) return <div className="max-w-4xl mx-auto px-6 py-8"><SectionHeader title="Funding & Sponsors" sub="Read-only funding ledger for organisations you belong to" /><AuthBanner /></div>
  if (loading) return <div className="max-w-4xl mx-auto px-6 py-8 text-sm" style={{ color: 'var(--muted)' }}>Loading verified funding records…</div>
  if (error) return <div className="max-w-4xl mx-auto px-6 py-8"><SectionHeader title="Funding & Sponsors" /><p className="rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}>{error}</p></div>

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 space-y-5">
      <SectionHeader title="Funding & Sponsors" sub="Verified USDC deposits associated with your organisations" />
      <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)', color: 'var(--muted)' }}><ShieldAlert size={14} style={{ color: '#EAB308' }} /><span>Financial writes are paused by default. This page is read-only; it does not initiate deposits or award activation.</span></div>
      <div className="grid grid-cols-2 gap-3"><MetricTile label="Declared budgets" value={`${totalDeclared.toFixed(2)} USDC`} sub={`${rows.length} grant programs`} /><MetricTile label="Verified deposits" value={fmtUsdc(BigInt(Math.max(0, Math.round(totalConfirmed))))} sub="Confirmed onchain funding" accent="var(--success)" /></div>
      {rows.length === 0 ? <Card><EmptyState icon={<CircleDollarSign size={22} />} title="No organisation grant programs" sub="Create an organisation and grant program to see funding records." /><div className="text-center pb-6"><Link to="/granthub/orgs/new" className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Create organisation</Link></div></Card> : rows.map(row => <Card key={row.grant.id}><div className="flex items-start justify-between gap-3"><div><Link to={`/granthub/grants/${row.grant.id}`} className="text-sm font-semibold hover:underline" style={{ color: 'var(--ink)' }}>{row.grant.title}</Link><p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{row.org.name} · {fmtUsdc(BigInt(Math.max(0, Math.round(row.confirmed))))} / {row.grant.total_budget ?? row.grant.declared_budget ?? 0} USDC verified</p></div><span className="text-xs" style={{ color: row.grant.pool_contract_address ? 'var(--success)' : 'var(--subtle)' }}>{row.grant.pool_contract_address ? 'Pool configured' : 'Pool not configured'}</span></div><div className="mt-4 space-y-2">{row.deposits.length === 0 ? <p className="text-xs" style={{ color: 'var(--muted)' }}>No deposit records for this program.</p> : row.deposits.map(deposit => <div key={deposit.id} className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: 'var(--surface-muted)' }}><CheckCircle2 size={14} style={{ color: deposit.verified ? 'var(--success)' : 'var(--subtle)' }} /><span className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>{fmtUsdc(BigInt(deposit.amount_raw))} USDC</span><span className="flex-1 text-xs" style={{ color: 'var(--muted)' }}>{fmtAddr(deposit.sponsor_addr)} · block {deposit.block_number ?? '—'}</span><span className="text-[10px] font-semibold" style={{ color: deposit.verified ? 'var(--success)' : 'var(--muted)' }}>{deposit.verified ? 'Verified' : 'Pending'}</span>{deposit.tx_hash && <a href={buildTxExplorerUrl(deposit.verified_chain_id ?? ACTIVE_CHAIN_ID, deposit.tx_hash)} target="_blank" rel="noopener noreferrer" aria-label="Open deposit transaction"><ExternalLink size={12} style={{ color: 'var(--subtle)' }} /></a>}</div>)}</div></Card>)}
    </div>
  )
}
