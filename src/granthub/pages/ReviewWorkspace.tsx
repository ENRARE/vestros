import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getApplication, getApplicationHistory, getApplicationReviews, reviewApplication, createAward } from '../api'
import { useAuth } from '../useAuth'
import { fmtDate, fmtAddr } from '../../formatters'
import { parseUsdc } from '@/onchain-money'
import { AuthBanner } from '../components/AuthBanner'
import { FinancialGateBanner } from '../components/FinancialGateBanner'
import { GRANTHUB_FINANCIAL_ENABLED } from '../feature-flags'
import { isComingSoonFeature } from '../featureAvailability'
import { ComingSoonOverlay } from '@/components/ui/ComingSoonOverlay'
import { AppStatusChip } from '../components/Chips'
import type { GrantApplication, ReviewDecision } from '../types'
import { Star, ArrowLeft, CheckCircle, XCircle, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

const criteria = [
  ['eligibility', 'Eligibility'], ['project_quality', 'Project quality'], ['feasibility', 'Feasibility'],
  ['ecosystem_relevance', 'Ecosystem relevance'], ['budget_justification', 'Budget justification'],
  ['team_capability', 'Team capability'], ['expected_impact', 'Expected impact'],
] as const
const checks = ['Meets published eligibility', 'Requested amount is within limits', 'Deliverables are clear']

export function ReviewWorkspace() {
  const { id } = useParams<{ id: string }>()
  const { address: sessionAddr } = useAuth()
  const [app, setApp] = useState<GrantApplication | null>(null)
  const [reviews, setReviews] = useState<ReviewDecision[]>([])
  const [history, setHistory] = useState<Array<{ id: string; actor_addr: string; action: string; note: string | null; created_at: number }>>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [score, setScore] = useState(3)
  const [criteriaScores, setCriteriaScores] = useState<Record<string, number>>({})
  const [eligibilityChecks, setEligibilityChecks] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [awardAmount, setAwardAmount] = useState('')
  const [awardCliff, setAwardCliff] = useState('90')
  const [awardVest, setAwardVest] = useState('365')
  const [awarding, setAwarding] = useState(false)

  const reload = async () => {
    if (!id) return
    try {
      const [application, applicationReviews, applicationHistory] = await Promise.all([
        getApplication(id), getApplicationReviews(id), getApplicationHistory(id),
      ])
      setApp(application); setReviews(applicationReviews); setHistory(applicationHistory)
      setAwardAmount(application.requested_amount ?? '')
    } catch (error) { setErr((error as Error).message) }
  }

  useEffect(() => {
    void reload().finally(() => setLoading(false))
  // id is the route key; reload intentionally follows it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const submitReview = async (nextDecision: 'shortlist' | 'request_info' | 'approve' | 'reject' | 'note') => {
    if (!id) return
    if (nextDecision === 'approve' && eligibilityChecks.length !== checks.length) { toast.error('Complete the eligibility checklist before approval'); return }
    setSubmitting(true)
    try {
      const completeScores = Object.values(criteriaScores).filter(value => value > 0)
      const overall = completeScores.length > 0 ? Math.round(completeScores.reduce((sum, value) => sum + value, 0) / completeScores.length) : score
      await reviewApplication(id, { decision: nextDecision, score: overall, notes: comment, criteria_scores: criteriaScores, eligibility_checks: eligibilityChecks })
      toast.success(nextDecision === 'request_info' ? 'Information request sent' : 'Review saved')
      setComment(''); setSubmitting(false); await reload()
    } catch (error) { toast.error((error as Error).message); setSubmitting(false) }
  }

  const handleAward = async () => {
    if (!id || !awardAmount) return
    setAwarding(true)
    try {
      const amountRaw = parseUsdc(awardAmount)
      if (amountRaw <= 0n) throw new Error('Award amount must be greater than zero')
      await createAward(id, { amount_raw: Number(amountRaw), vesting_cliff_days: parseInt(awardCliff, 10), vesting_total_days: parseInt(awardVest, 10) })
      toast.success('Award created and left pending funding')
      await reload()
    } catch (error) { toast.error((error as Error).message) }
    finally { setAwarding(false) }
  }

  if (!sessionAddr) return <div className="max-w-2xl mx-auto px-4 py-10"><h1 className="display text-2xl font-bold mb-4" style={{ color: 'var(--ink)' }}>Review Workspace</h1><AuthBanner /></div>
  if (loading) return <div className="max-w-2xl mx-auto px-4 py-10 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (err || !app) return <div className="max-w-2xl mx-auto px-4 py-10 text-sm" style={{ color: 'var(--danger)' }}>{err ?? 'Application not found'}</div>

  const myReview = reviews.find(review => review.reviewer_addr?.toLowerCase() === sessionAddr.toLowerCase())
  const canReview = app.viewer_role != null && !['approved', 'rejected', 'pending_funding', 'funded'].includes(app.status)
  const canApprove = app.viewer_role === 'admin'
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Link to="/granthub/dashboard" className="inline-flex items-center gap-1.5 text-sm mb-6 hover:underline" style={{ color: 'var(--muted)' }}><ArrowLeft size={14} /> Back to Dashboard</Link>
      <div className="flex items-start justify-between mb-6"><div><h1 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>{app.project_title ?? app.project_name}</h1><p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>by {fmtAddr(app.applicant_addr)} · {app.requested_amount} USDC{app.submitted_at != null && <> · submitted {fmtDate(app.submitted_at)}</>}</p></div><AppStatusChip status={app.status} /></div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          <section className="rounded-lg p-5 space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}><h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Applicant and project</h2><div className="grid sm:grid-cols-2 gap-3 text-sm"><div><p className="text-xs" style={{ color: 'var(--muted)' }}>Applicant</p><p style={{ color: 'var(--ink-2)' }}>{app.applicant_name || app.name || '—'} · {app.applicant_type ?? 'individual'}</p></div><div><p className="text-xs" style={{ color: 'var(--muted)' }}>Contact</p><p style={{ color: 'var(--ink-2)' }}>{app.email || '—'} · {app.country || '—'}</p></div><div><p className="text-xs" style={{ color: 'var(--muted)' }}>Category / stage</p><p style={{ color: 'var(--ink-2)' }}>{app.project_category || '—'} · {app.development_stage || '—'}</p></div><div><p className="text-xs" style={{ color: 'var(--muted)' }}>Technology</p><p style={{ color: 'var(--ink-2)' }}>{app.tech_stack || '—'}</p></div></div><div><h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>Description</h3><p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--ink-2)' }}>{app.description}</p></div><div className="grid sm:grid-cols-2 gap-4"><div><h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>Problem</h3><p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--ink-2)' }}>{app.problem || '—'}</p></div><div><h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>Solution and ecosystem benefit</h3><p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--ink-2)' }}>{app.solution || '—'}{app.ecosystem_benefit ? `\n\n${app.ecosystem_benefit}` : ''}</p></div></div></section>
          <section className="rounded-lg p-5 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}><h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Funding and delivery</h2><p className="text-sm" style={{ color: 'var(--ink-2)' }}><span className="mono">{app.requested_amount} USDC</span> requested · completion {app.completion_date ? fmtDate(app.completion_date) : '—'}</p><div className="grid sm:grid-cols-2 gap-4"><div><h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>Use of funds</h3><p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--ink-2)' }}>{app.use_of_funds || '—'}</p></div><div><h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>Budget breakdown</h3><p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--ink-2)' }}>{app.budget_breakdown || '—'}</p></div></div>{app.milestones.length > 0 && <div className="space-y-2">{app.milestones.map((milestone, index) => <div key={index} className="flex justify-between gap-3 text-sm border-t pt-2" style={{ borderColor: 'var(--border)' }}><span style={{ color: 'var(--ink-2)' }}>{milestone.title ?? milestone.label ?? 'Milestone'}</span><span className="mono text-xs" style={{ color: 'var(--muted)' }}>{milestone.amount ?? milestone.value ?? '—'} · day {milestone.days_after_start ?? '—'}</span></div>)}</div>}</section>
          {app.links && app.links.length > 0 && <section className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}><h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--ink)' }}>Supporting links</h2>{app.links.map((link, index) => <a key={index} href={link} target="_blank" rel="noopener noreferrer" className="block text-xs truncate hover:underline mb-1" style={{ color: 'var(--accent)' }}><ExternalLink size={10} className="inline mr-1" />{link}</a>)}</section>}
          <section className="rounded-lg p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}><h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink)' }}>Review history ({reviews.length})</h2>{reviews.length === 0 && <p className="text-xs" style={{ color: 'var(--muted)' }}>No reviews yet.</p>}{reviews.map(review => <div key={review.id} className="mb-3 pb-3 border-b last:border-0 last:mb-0 last:pb-0" style={{ borderColor: 'var(--border)' }}><div className="flex items-center justify-between"><span className="text-xs mono" style={{ color: 'var(--muted)' }}>{fmtAddr(review.reviewer_addr)}</span><span className="text-xs" style={{ color: 'var(--muted)' }}>{review.decision ?? 'note'} · {review.score ?? '—'}/5</span></div>{review.notes && <p className="text-xs mt-1" style={{ color: 'var(--ink-2)' }}>{review.notes}</p>}</div>)}</section>
          <section className="rounded-lg p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}><h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink)' }}>Application history</h2>{history.length === 0 ? <p className="text-xs" style={{ color: 'var(--muted)' }}>No activity recorded.</p> : history.map(item => <div key={item.id} className="flex justify-between gap-3 text-xs border-t py-2" style={{ borderColor: 'var(--border)', color: 'var(--ink-2)' }}><span>{item.action}{item.note ? ` · ${item.note}` : ''}</span><span className="mono" style={{ color: 'var(--muted)' }}>{fmtDate(item.created_at)}</span></div>)}</section>
        </div>
        <ComingSoonOverlay locked={app.status === 'approved' && canApprove && isComingSoonFeature('granthub-financial', GRANTHUB_FINANCIAL_ENABLED)}>
        <div className="space-y-4">
          {canReview && <section className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}><h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink)' }}>{myReview ? 'Update your review' : 'Your review'}</h2><div className="flex items-center gap-1 mb-3">{[1,2,3,4,5].map(value => <button type="button" key={value} onClick={() => setScore(value)} aria-label={`Score ${value}`}><Star size={17} fill={value <= score ? 'currentColor' : 'none'} style={{ color: '#f59e0b' }} /></button>)}</div><div className="space-y-2 mb-3">{criteria.map(([key, label]) => <div key={key} className="flex items-center justify-between gap-2"><span className="text-xs" style={{ color: 'var(--ink-2)' }}>{label}</span><select value={criteriaScores[key] ?? ''} onChange={event => setCriteriaScores(current => ({ ...current, [key]: Number(event.target.value) }))} className="rounded-md px-2 py-1 text-xs" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}><option value="">—</option>{[1,2,3,4,5].map(value => <option key={value} value={value}>{value}/5</option>)}</select></div>)}</div><div className="space-y-1 mb-3">{checks.map(check => <label key={check} className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-2)' }}><input type="checkbox" checked={eligibilityChecks.includes(check)} onChange={event => setEligibilityChecks(current => event.target.checked ? [...current, check] : current.filter(item => item !== check))} />{check}</label>)}</div><textarea value={comment} onChange={event => setComment(event.target.value)} placeholder="Reviewer notes or applicant feedback" rows={4} className="w-full rounded-md text-sm px-3 py-2 mb-3 resize-none" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} /><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => void submitReview('shortlist')} disabled={submitting} className="py-2 rounded-md text-xs font-semibold disabled:opacity-50" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink)' }}>Shortlist</button><button type="button" onClick={() => void submitReview('request_info')} disabled={submitting} className="py-2 rounded-md text-xs font-semibold disabled:opacity-50" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink)' }}>Request info</button>{canApprove && <><button type="button" onClick={() => void submitReview('approve')} disabled={submitting} className="py-2 rounded-md text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--success)' }}><CheckCircle size={12} className="inline mr-1" />Approve</button><button type="button" onClick={() => void submitReview('reject')} disabled={submitting} className="py-2 rounded-md text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--danger)' }}><XCircle size={12} className="inline mr-1" />Reject</button></>}</div></section>}
          {app.status === 'approved' && canApprove && <section className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}><h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink)' }}>Create pending award</h2><FinancialGateBanner /><p className="text-xs my-3" style={{ color: 'var(--muted)' }}>Approval reserves a database award only. Activation and USDC movement require separate authorized, verified onchain steps.</p><label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Amount (USDC)</label><input value={awardAmount} onChange={event => setAwardAmount(event.target.value)} className="w-full rounded-md text-sm px-3 py-2 mb-2" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} /><div className="flex gap-2 mb-3"><input type="number" min="0" value={awardCliff} onChange={event => setAwardCliff(event.target.value)} className="w-full rounded-md text-sm px-3 py-2" placeholder="Cliff days" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} /><input type="number" min="1" value={awardVest} onChange={event => setAwardVest(event.target.value)} className="w-full rounded-md text-sm px-3 py-2" placeholder="Vesting days" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} /></div><button type="button" onClick={() => void handleAward()} disabled={awarding} className="w-full py-2 rounded-md text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>{awarding ? 'Creating…' : 'Create pending award'}</button></section>}
        </div>
        </ComingSoonOverlay>
      </div>
    </div>
  )
}
