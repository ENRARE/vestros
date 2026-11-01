import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getMyOrgs, getGrantApplications, getGrantAwards, listGrants, addOrgMember, removeOrgMember } from '../api'
import { useAuth } from '../useAuth'
import { useAccount } from 'wagmi'
import { fmtDate, fmtAddr } from '../../formatters'
import { AuthBanner } from '../components/AuthBanner'
import { StatusChip, AppStatusChip, AwardStatusChip } from '../components/Chips'
import { GRANTHUB_FINANCIAL_ENABLED } from '../feature-flags'
import { isComingSoonFeature } from '../featureAvailability'
import { ComingSoonOverlay } from '@/components/ui/ComingSoonOverlay'
import type { Organization, GrantProgram, GrantApplication, GrantAward } from '../types'
import { PlusCircle, Users, BarChart2, Award, ChevronRight, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

type DashTab = 'overview' | 'grants' | 'applications' | 'review' | 'awards' | 'members'

export function OrgDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const { address: walletAddr } = useAccount()
  const { address: sessionAddr } = useAuth()

  const [orgs, setOrgs] = useState<Organization[]>([])
  const [activeOrg, setActiveOrg] = useState<Organization | null>(null)
  const [grants, setGrants] = useState<GrantProgram[]>([])
  const [applications, setApplications] = useState<GrantApplication[]>([])
  const [awards, setAwards] = useState<GrantAward[]>([])
  const [tab, setTab] = useState<DashTab>(isDashTab(tabParam) ? tabParam : 'overview')
  const [memberAddress, setMemberAddress] = useState('')
  const [memberRole, setMemberRole] = useState('reviewer')
  const [memberBusy, setMemberBusy] = useState(false)
  const [loading, setLoading] = useState(!!sessionAddr)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionAddr) return
    const load = async () => {
      try {
        const orgList = await getMyOrgs()
        setOrgs(orgList)
        if (orgList.length > 0) setActiveOrg(orgList[0])
        setErr(null)
      } catch (e) {
        setErr((e as Error).message)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [sessionAddr])

  useEffect(() => {
    if (!activeOrg) return
    const fetchOrgData = async () => {
      try {
        const grantResult = await listGrants({ orgId: activeOrg.id })
        const nextGrants = grantResult.grants ?? []
        setGrants(nextGrants)
        const appsByGrant = await Promise.all(nextGrants.map(g => getGrantApplications(g.id)))
        setApplications(appsByGrant.flat())
        const awardsByGrant = await Promise.all(nextGrants.map(g => getGrantAwards(g.id)))
        setAwards(awardsByGrant.flat())
      } catch {}
    }
    void fetchOrgData()
  }, [activeOrg])

  if (!walletAddr || !sessionAddr) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="display text-2xl font-bold mb-4" style={{ color: 'var(--ink)' }}>Organisation Dashboard</h1>
        <AuthBanner />
      </div>
    )
  }

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-10 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (err) return <div className="max-w-2xl mx-auto px-4 py-10 text-sm text-red-600">{err}</div>

  if (orgs.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="display text-2xl font-bold mb-2" style={{ color: 'var(--ink)' }}>Organisation Dashboard</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--muted)' }}>You don't manage any organisations yet.</p>
        <Link
          to="/granthub/orgs/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'var(--accent)' }}
        >
          <PlusCircle size={15} /> Create an Organisation
        </Link>
      </div>
    )
  }

  const org = activeOrg!
  const openGrants = grants.filter(g => g.status === 'open').length
  const pendingApps = applications.filter(a => a.status === 'submitted' || a.status === 'reviewing').length
  const pendingAwards = awards.filter(a => a.status === 'pending').length

  const tabs: { key: DashTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'grants', label: `Grants (${grants.length})` },
    { key: 'applications', label: `Applications (${applications.length})` },
    { key: 'review', label: `Review Queue (${applications.filter(a => ['submitted', 'reviewing', 'shortlisted'].includes(a.status)).length})` },
    { key: 'awards', label: `Awards (${awards.length})` },
    { key: 'members', label: `Team (${org.members?.length ?? 0})` },
  ]

  const reviewApplications = applications.filter(a => ['submitted', 'reviewing', 'shortlisted'].includes(a.status))
  const activeTab = isDashTab(tabParam) ? tabParam : tab
  const addMember = async () => {
    const normalized = memberAddress.trim().toLowerCase()
    if (!/^0x[0-9a-f]{40}$/.test(normalized)) { toast.error('Enter a valid EVM address'); return }
    setMemberBusy(true)
    try {
      await addOrgMember(org.id, normalized, memberRole)
      setActiveOrg(current => current ? { ...current, members: [...(current.members ?? []).filter(m => m.address !== normalized), { address: normalized, role: memberRole }] } : current)
      setMemberAddress('')
      toast.success('Organisation member saved')
    } catch (e) { toast.error((e as Error).message) } finally { setMemberBusy(false) }
  }
  const removeMember = async (address: string) => {
    setMemberBusy(true)
    try {
      await removeOrgMember(org.id, address)
      setActiveOrg(current => current ? { ...current, members: (current.members ?? []).filter(m => m.address !== address) } : current)
      toast.success('Member removed')
    } catch (e) { toast.error((e as Error).message) } finally { setMemberBusy(false) }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          {org.logo_url ? (
            <img src={org.logo_url} alt={org.name} className="w-10 h-10 rounded-lg object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-white"
              style={{ background: 'var(--accent)', fontSize: 18 }}>
              {org.name[0]}
            </div>
          )}
          <div>
            <h1 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>{org.name}</h1>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>/{org.slug ?? org.id}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/granthub/grants/new?orgId=${org.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            <PlusCircle size={13} /> New Grant
          </Link>
          <Link
            to={`/granthub/orgs/${org.slug ?? org.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
          >
            <ExternalLink size={13} /> View Public Page
          </Link>
        </div>
      </div>

      {/* Organisation selector if multiple */}
      {orgs.length > 1 && (
        <div className="flex gap-2 mb-4">
          {orgs.map(o => (
            <button
              key={o.id}
              onClick={() => setActiveOrg(o)}
              className="px-3 py-1.5 text-xs font-medium"
              style={{
                background: o.id === org.id ? 'var(--accent)' : 'var(--surface-muted)',
                color: o.id === org.id ? '#fff' : 'var(--ink-2)',
                border: '1px solid var(--border)',
              }}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Open Grants', value: openGrants, icon: <BarChart2 size={15} /> },
          { label: 'Pending Review', value: pendingApps, icon: <Users size={15} /> },
          { label: 'Pending Awards', value: pendingAwards, icon: <Award size={15} /> },
        ].map(s => (
          <div
            key={s.label}
            className="rounded-xl px-4 py-3"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--subtle)' }}>
              {s.icon} {s.label}
            </div>
            <p className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 p-1 rounded-xl" style={{ background: 'var(--surface-muted)' }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSearchParams({ tab: t.key }) }}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors"
            style={{
              background: (isDashTab(tabParam) ? tabParam : tab) === t.key ? 'var(--surface-strong)' : 'transparent',
              color: (isDashTab(tabParam) ? tabParam : tab) === t.key ? 'var(--ink)' : 'var(--muted)',
              boxShadow: (isDashTab(tabParam) ? tabParam : tab) === t.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>{org.description || 'No description set.'}</p>
          <div className="flex gap-3 text-xs" style={{ color: 'var(--muted)' }}>
            {org.website && <a href={org.website} target="_blank" rel="noopener noreferrer" className="hover:underline">{org.website}</a>}
            {org.twitter && <span>@{org.twitter}</span>}
          </div>
          {org.owner_addr && <p className="text-xs" style={{ color: 'var(--subtle)' }}>Owner: <span className="mono">{fmtAddr(org.owner_addr)}</span></p>}
        </div>
      )}

      {activeTab === 'grants' && (
        <div className="space-y-2">
          {grants.length === 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>No grants yet.</p>}
          {grants.map(g => (
            <div
              key={g.id}
              className="flex items-center justify-between rounded-xl px-4 py-3 hover:shadow-sm transition-shadow"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div>
                <Link to={`/granthub/grants/${g.id}`} className="text-sm font-medium hover:underline" style={{ color: 'var(--ink)' }}>{g.title}</Link>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  {g.applicant_count ?? 0} applicants · closes {fmtDate(g.close_date ?? 0)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusChip status={g.status} />
                <Link to={`/granthub/grants/${g.id}/edit`} className="text-xs hover:underline" style={{ color: 'var(--accent)' }}>Edit</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'applications' && (
        <div className="space-y-2">
          {applications.length === 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>No applications yet.</p>}
          {applications.map(a => (
            <Link
              key={a.id}
              to={`/granthub/review/${a.id}`}
              className="flex items-center justify-between rounded-xl px-4 py-3 hover:shadow-sm transition-shadow"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{a.project_title}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  {fmtAddr(a.applicant_addr)} · {a.requested_amount} USDC
                </p>
              </div>
              <div className="flex items-center gap-2">
                <AppStatusChip status={a.status} />
                <ChevronRight size={14} style={{ color: 'var(--subtle)' }} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {activeTab === 'review' && (
        <div className="space-y-2">
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>Review access is enforced by the organisation member role on the server.</p>
          {reviewApplications.length === 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>No applications are waiting for review.</p>}
          {reviewApplications.map(a => (
            <Link key={a.id} to={`/granthub/review/${a.id}`} className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div><p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{a.project_title ?? a.project_name}</p><p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{fmtAddr(a.applicant_addr)} · {a.requested_amount} USDC</p></div><AppStatusChip status={a.status} />
            </Link>
          ))}
        </div>
      )}

      {activeTab === 'awards' && (
        <ComingSoonOverlay locked={isComingSoonFeature('granthub-award-management', GRANTHUB_FINANCIAL_ENABLED)}>
          <div className="space-y-2">
            {awards.length === 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>No awards yet.</p>}
            {awards.map(a => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-xl px-4 py-3"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    {fmtAddr(a.beneficiary_addr ?? a.recipient_addr ?? '')} — {a.amount} USDC
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                    {a.vesting_cliff_days}d cliff / {a.vesting_total_days}d vest
                    {a.tx_hash && <> · <span className="mono">{fmtAddr(a.tx_hash)}</span></>}
                  </p>
                </div>
                <AwardStatusChip status={a.status} />
              </div>
            ))}
          </div>
        </ComingSoonOverlay>
      )}

      {activeTab === 'members' && (
        <div className="space-y-4">
          <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>Admins can add reviewers and members. Every mutation is checked by the GrantHub server.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={memberAddress} onChange={e => setMemberAddress(e.target.value)} placeholder="0x wallet address" className="flex-1 rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
              <select value={memberRole} onChange={e => setMemberRole(e.target.value)} className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}><option value="reviewer">Reviewer</option><option value="member">Member</option><option value="admin">Admin</option></select>
              <button onClick={() => void addMember()} disabled={memberBusy} className="rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}>Save member</button>
            </div>
          </div>
          {(org.members ?? []).map(member => <div key={member.address} className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}><span className="mono text-xs flex-1" style={{ color: 'var(--ink-2)' }}>{fmtAddr(member.address)}</span><span className="text-xs" style={{ color: 'var(--muted)' }}>{member.role}</span><button onClick={() => void removeMember(member.address)} disabled={memberBusy} className="text-xs underline disabled:opacity-40" style={{ color: 'var(--danger)' }}>Remove</button></div>)}
        </div>
      )}
    </div>
  )
}

function isDashTab(value: string | null): value is DashTab {
  return value === 'overview' || value === 'grants' || value === 'applications' || value === 'review' || value === 'awards' || value === 'members'
}
