import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { getMyApplications, getMyAwards, getNotifications, markNotificationRead } from '../api'
import { useAuth } from '../useAuth'
import { useAccount } from 'wagmi'
import { fmtDate, fmtAddr } from '../../formatters'
import { AuthBanner } from '../components/AuthBanner'
import { AppStatusChip, AwardStatusChip } from '../components/Chips'
import type { GrantApplication, GrantAward, GrantNotification } from '../types'
import { isFundedApplicationStatus } from '../app-status'
import { ExternalLink, Award } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID } from '@/contractConfig'

type TabKey = 'applications' | 'awards'

export function MyGrants() {
  const location = useLocation()
  const navigate = useNavigate()
  const { address: walletAddr } = useAccount()
  const { address: sessionAddr } = useAuth()

  const pathTab: TabKey = location.pathname.endsWith('/awards') || new URLSearchParams(location.search).get('tab') === 'awards' ? 'awards' : 'applications'
  const tab = pathTab
  const [apps, setApps] = useState<GrantApplication[]>([])
  const [awards, setAwards] = useState<GrantAward[]>([])
  const [loading, setLoading] = useState(!!sessionAddr)
  const [err, setErr] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<GrantNotification[]>([])

  useEffect(() => {
    if (!sessionAddr) return
    const load = async () => {
      try {
        const [a, aw, notes] = await Promise.all([getMyApplications(), getMyAwards(), getNotifications()])
        setApps(a)
        setAwards(aw)
        setNotifications(notes.filter(note => !note.read).slice(0, 5))
        setErr(null)
      } catch (e) {
        setErr((e as Error).message)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [sessionAddr])

  if (!walletAddr || !sessionAddr) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="display text-2xl font-bold mb-4" style={{ color: 'var(--ink)' }}>My Grants</h1>
        <AuthBanner />
      </div>
    )
  }

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-10 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (err) return <div className="max-w-2xl mx-auto px-4 py-10 text-sm text-red-600">{err}</div>

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="display text-2xl font-bold mb-6" style={{ color: 'var(--ink)' }}>My Grants</h1>

      {notifications.length > 0 && <div className="mb-5 rounded-md px-4 py-3 space-y-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}><p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Updates</p>{notifications.map(note => <button key={note.id} type="button" onClick={() => { setNotifications(current => current.filter(item => item.id !== note.id)); void markNotificationRead(note.id) }} className="block w-full text-left text-xs hover:underline" style={{ color: 'var(--ink-2)' }}>{note.message}</button>)}</div>}

      <div className="flex gap-1 mb-5 p-1 rounded-xl" style={{ background: 'var(--surface-muted)' }}>
        {([
          { key: 'applications' as TabKey, label: `Applications (${apps.length})` },
          { key: 'awards' as TabKey, label: `Awards (${awards.length})` },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => void navigate(t.key === 'awards' ? '/granthub/awards' : '/granthub/applications')}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors"
            style={{
              background: tab === t.key ? 'var(--surface-strong)' : 'transparent',
              color: tab === t.key ? 'var(--ink)' : 'var(--muted)',
              boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'applications' && (
        <div className="space-y-3">
          {apps.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>No applications yet.</p>
              <Link
                to="/granthub"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'var(--accent)' }}
              >
                Browse Grants
              </Link>
            </div>
          )}
          {apps.map(a => (
            <div
              key={a.id}
              className="rounded-xl px-4 py-4"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{a.project_title}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                    <Link to={`/granthub/grants/${a.grant_id}`} className="hover:underline">{a.grant_title ?? a.grant_id}</Link>
                    {' · '}{a.requested_amount} USDC
                  </p>
                </div>
                <AppStatusChip status={a.status} />
              </div>
              {a.status === 'reviewing' && (
                <p className="text-xs mt-2 px-2 py-1 rounded-lg inline-block" style={{ background: 'rgba(16,97,166,0.08)', color: '#1061a6' }}>
                  Under review
                </p>
              )}
              {a.status === 'draft' && (
                <Link to={`/granthub/apply/${a.grant_id}?applicationId=${a.id}`} className="inline-block text-xs mt-2 hover:underline" style={{ color: 'var(--accent)' }}>Continue application</Link>
              )}
              {a.status === 'approved' && (
                <p className="text-xs mt-2" style={{ color: 'var(--success)' }}>
                  Approved — awaiting award activation
                </p>
              )}
              {a.status === 'rejected' && (
                <p className="text-xs mt-2" style={{ color: 'var(--danger)' }}>
                  Not selected for this round
                </p>
              )}
              {isFundedApplicationStatus(a.status) && (
                <p className="text-xs mt-2" style={{ color: 'var(--success)' }}>
                  Award activated — check your vesting schedule below
                </p>
              )}
              {a.submitted_at != null && <p className="text-xs mt-2" style={{ color: 'var(--subtle)' }}>Submitted {fmtDate(a.submitted_at)}</p>}
            </div>
          ))}
        </div>
      )}

      {tab === 'awards' && (
        <div className="space-y-3">
          {awards.length === 0 && (
            <p className="text-sm text-center py-12" style={{ color: 'var(--muted)' }}>No awards yet.</p>
          )}
          {awards.map(a => (
            <div
              key={a.id}
              className="rounded-xl px-4 py-4"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Award size={14} style={{ color: '#1061a6' }} />
                    <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{a.amount} USDC</p>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    {a.vesting_cliff_days}d cliff / {a.vesting_total_days}d vesting
                    {a.schedule_id != null && (
                      <> · <Link to="/vesting" className="hover:underline">Schedule #{a.schedule_id}</Link></>
                    )}
                  </p>
                  {a.tx_hash && (
                    <a
                      href={buildTxExplorerUrl(a.chain_id ?? CHAIN_ID, a.tx_hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs mt-1 hover:underline"
                      style={{ color: '#1061a6' }}
                    >
                      <ExternalLink size={10} /> {fmtAddr(a.tx_hash)}
                    </a>
                  )}
                </div>
                <AwardStatusChip status={a.status} />
              </div>
              {a.status === 'pending' && (
                <div className="mt-3 text-xs rounded-xl px-3 py-2" style={{ background: 'rgba(245,158,11,0.08)', color: '#b45309' }}>
                  Waiting for vesting activation by the grant sponsor. You will see a new vesting schedule in the Vesting tab once activated.
                </div>
              )}
              {a.status === 'vesting_activated' && (
                <div className="mt-3 text-xs rounded-xl px-3 py-2" style={{ background: 'rgba(26,128,71,0.08)', color: 'var(--success)' }}>
                  Vesting schedule activated onchain. Visit the <Link to="/vesting" className="underline">Vesting tab</Link> to track and claim.
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
