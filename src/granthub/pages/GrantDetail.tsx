import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getGrant, getGrantApplications, getGrantDeposits, getGrantAwards } from '../api'
import { useAuth } from '../useAuth'
import { useAccount } from 'wagmi'
import { fmtDate, fmtAddr } from '../../formatters'
import { ExternalLink, Calendar, Users, Award, DollarSign, ArrowLeft, Clock } from 'lucide-react'
import { StatusChip, AwardStatusChip } from '../components/Chips'
import type { GrantProgram, GrantApplication, GrantAward } from '../types'
import { CHAIN_ID } from '@/contractConfig'
import { usdcDecimalsFor } from '@/onchain-money'

export function GrantDetail() {
  const { id } = useParams<{ id: string }>()
  const [grant, setGrant] = useState<GrantProgram | null>(null)
  const [apps, setApps] = useState<GrantApplication[]>([])
  const [awards, setAwards] = useState<GrantAward[]>([])
  const [depositTotal, setDepositTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const { address: sessionAddr } = useAuth()
  const { address: walletAddr } = useAccount()

  useEffect(() => {
    if (!id) return
    const load = async () => {
      try {
        const [g, a, d, aw] = await Promise.all([
          getGrant(id),
          getGrantApplications(id).catch(() => [] as GrantApplication[]),
          getGrantDeposits(id).catch(() => ({ deposits: [] as unknown[], confirmed_total: 0 })),
          getGrantAwards(id).catch(() => [] as GrantAward[]),
        ])
        setGrant(g)
        setApps(a)
        setDepositTotal((d).confirmed_total)
        setAwards(aw)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [id])

  if (loading) return <div className="flex items-center justify-center py-24" style={{ color: 'var(--subtle)' }}>Loading…</div>
  if (!grant) return <div className="flex items-center justify-center py-24" style={{ color: 'var(--danger)' }}>Grant not found.</div>

  const canReview = !!sessionAddr
  const hasApplied = walletAddr && apps.some(a => a.applicant_addr.toLowerCase() === walletAddr.toLowerCase())
  const budgetN = parseFloat(grant.total_budget ?? '0')
  const depositHuman = depositTotal / 10 ** usdcDecimalsFor(CHAIN_ID)
  const depositPct = budgetN > 0 ? Math.min(100, (depositHuman / budgetN) * 100) : 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Back */}
      <Link to="/granthub" className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--muted)' }}>
        <ArrowLeft size={14} /> All grants
      </Link>

      {/* Header card */}
      <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusChip status={grant.status} />
              {grant.tags?.slice(0,3).map(t => (
                <span key={t} className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}>{t}</span>
              ))}
            </div>
            <h1 className="display text-2xl font-semibold mt-2" style={{ color: 'var(--ink)' }}>{grant.title}</h1>
            <div className="flex items-center gap-1 text-sm mt-1" style={{ color: 'var(--muted)' }}>
              <span>by</span>
              <Link to={`/granthub/orgs/${grant.org_slug ?? grant.org_id}`} className="font-medium hover:underline" style={{ color: 'var(--accent-hover)' }}>
                {grant.org_name}
              </Link>
            </div>
          </div>

          {grant.status === 'open' && !hasApplied && (
            <Link
              to={`/granthub/apply/${id}`}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'var(--accent)', minHeight: 44 }}
            >
              Apply now
            </Link>
          )}
          {hasApplied && (
            <span className="px-4 py-2 rounded-xl text-sm" style={{ background: 'rgba(26,128,71,0.1)', color: 'var(--success)' }}>
              Applied
            </span>
          )}
          {canReview && (
            <Link
              to={`/granthub/dashboard`}
              className="px-4 py-2 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)', minHeight: 44 }}
            >
              Review applications
            </Link>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <StatCell icon={<DollarSign size={14} />} label="Total budget" value={`${grant.total_budget} USDC`} />
          <StatCell icon={<Award size={14} />} label="Max award" value={`${grant.max_award} USDC`} />
          <StatCell icon={<Users size={14} />} label="Applicants" value={String(apps.length)} />
          <StatCell icon={<Calendar size={14} />} label="Deadline" value={grant.close_date ? fmtDate(grant.close_date) : 'Rolling'} />
        </div>

        {/* Funding progress */}
        {budgetN > 0 && (
          <div className="mt-4 space-y-1">
            <div className="flex justify-between text-xs" style={{ color: 'var(--subtle)' }}>
              <span>Confirmed deposits</span>
              <span>{depositHuman.toFixed(2)} / {grant.total_budget} USDC ({depositPct.toFixed(0)}%)</span>
            </div>
            <div className="rounded-full h-1.5 overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${depositPct}%`, background: 'var(--success)' }} />
            </div>
          </div>
        )}
      </div>

      {/* Description */}
      <div className="rounded-2xl p-6 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h2 className="font-semibold" style={{ color: 'var(--ink)' }}>About this grant</h2>
        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--ink-2)' }}>{grant.description}</p>
      </div>

      {/* Requirements */}
      {grant.requirements && (
        <div className="rounded-2xl p-6 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--ink)' }}>Requirements</h2>
          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--ink-2)' }}>{grant.requirements}</p>
        </div>
      )}

      {/* Vesting terms */}
      {((grant.cliff_days ?? 0) > 0 || (grant.vesting_days ?? 0) > 0) && (
        <div className="rounded-2xl p-6 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <Clock size={16} style={{ color: 'var(--subtle)' }} />
            <h2 className="font-semibold" style={{ color: 'var(--ink)' }}>Vesting terms</h2>
          </div>
          <div className="flex gap-6 text-sm" style={{ color: 'var(--ink-2)' }}>
            {(grant.cliff_days ?? 0) > 0 && <span><b>{grant.cliff_days}</b> day cliff</span>}
            {(grant.vesting_days ?? 0) > 0 && <span><b>{grant.vesting_days}</b> day linear vest</span>}
          </div>
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>
            Awards are distributed via Vestros USDC Vesting and unlock linearly after the cliff period.
          </p>
        </div>
      )}

      {/* Recent awards */}
      {awards.length > 0 && (
        <div className="rounded-2xl p-6 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--ink)' }}>Awards ({awards.length})</h2>
          <div className="space-y-2">
            {awards.map(award => (
              <div key={award.id} className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="space-y-0.5">
                  <div className="text-sm font-medium mono" style={{ color: 'var(--ink)' }}>{fmtAddr(award.beneficiary_addr ?? award.recipient_addr ?? '')}</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>{award.amount} USDC</div>
                </div>
                <AwardStatusChip status={award.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Org link */}
      <Link to={`/granthub/orgs/${grant.org_slug ?? grant.org_id}`}
        className="inline-flex items-center gap-1.5 text-sm"
        style={{ color: 'var(--accent-hover)' }}
      >
        View organisation <ExternalLink size={12} />
      </Link>
    </div>
  )
}

function StatCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl p-3 space-y-0.5" style={{ background: 'var(--surface-muted)' }}>
      <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--subtle)' }}>
        {icon} {label}
      </div>
      <div className="text-sm font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>{value}</div>
    </div>
  )
}
