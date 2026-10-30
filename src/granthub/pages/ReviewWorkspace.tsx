import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getApplication, getApplicationReviews, reviewApplication, createAward } from '../api'
import { useAuth } from '../useAuth'
import { fmtDate, fmtAddr } from '../../formatters'
import { AuthBanner } from '../components/AuthBanner'
import { AppStatusChip } from '../components/Chips'
import type { GrantApplication, ReviewDecision } from '../types'
import { Star, ArrowLeft, CheckCircle, XCircle, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'


export function ReviewWorkspace() {
  const { id } = useParams<{ id: string }>()
  const { address: sessionAddr } = useAuth()

  const [app, setApp] = useState<GrantApplication | null>(null)
  const [reviews, setReviews] = useState<ReviewDecision[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [score, setScore] = useState<number>(3)
  const [comment, setComment] = useState('')
  const [decision, setDecision] = useState<'approve' | 'reject' | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [awardAmount, setAwardAmount] = useState('')
  const [awardCliff, setAwardCliff] = useState('90')
  const [awardVest, setAwardVest] = useState('365')
  const [awarding, setAwarding] = useState(false)

  useEffect(() => {
    if (!id) return
    const load = async () => {
      try {
        const [a, r] = await Promise.all([getApplication(id), getApplicationReviews(id)])
        setApp(a)
        setReviews(r)
        if (a) setAwardAmount(a.requested_amount ?? '')
        setErr(null)
      } catch (e) {
        setErr((e as Error).message)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [id])

  const reload = async () => {
    if (!id) return
    try {
      const [a, r] = await Promise.all([getApplication(id), getApplicationReviews(id)])
      setApp(a)
      setReviews(r)
    } catch { /* ignore */ }
  }

  const submitReview = async () => {
    if (!id || !decision) return
    setSubmitting(true)
    try {
      await reviewApplication(id, { decision, score, notes: comment })
      toast.success('Review submitted')
      setComment('')
      setDecision('')
      await reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleAward = async () => {
    if (!id || !awardAmount) return
    setAwarding(true)
    try {
      await createAward(id, {
        amount: awardAmount,
        vesting_cliff_days: parseInt(awardCliff, 10),
        vesting_duration_days: parseInt(awardVest, 10),
      })
      toast.success('Award created — activate vesting from the Awards tab')
      await reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setAwarding(false)
    }
  }

  if (!sessionAddr) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="display text-2xl font-bold mb-4" style={{ color: 'var(--ink)' }}>Review Workspace</h1>
        <AuthBanner />
      </div>
    )
  }

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-10 text-sm" style={{ color: 'var(--muted)' }}>Loading…</div>
  if (err || !app) return <div className="max-w-2xl mx-auto px-4 py-10 text-sm text-red-600">{err ?? 'Application not found'}</div>

  const myReview = reviews.find(r => r.reviewer_addr?.toLowerCase() === sessionAddr?.toLowerCase())

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link to="/granthub/dashboard" className="inline-flex items-center gap-1.5 text-sm mb-6 hover:underline" style={{ color: 'var(--muted)' }}>
        <ArrowLeft size={14} /> Back to Dashboard
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>{app.project_title}</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            by {fmtAddr(app.applicant_addr)} · {app.requested_amount} USDC{app.submitted_at != null && <> · submitted {fmtDate(app.submitted_at)}</>}
          </p>
        </div>
        <AppStatusChip status={app.status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-5">
          <section className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--ink)' }}>Project Description</h2>
            <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--ink-2)' }}>{app.description}</p>
          </section>

          {app.milestones && app.milestones.length > 0 && (
            <section className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink)' }}>Milestones</h2>
              <div className="space-y-2">
                {app.milestones.map((m, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span style={{ color: 'var(--ink-2)' }}>{m.title}</span>
                    <span className="font-mono" style={{ color: 'var(--muted)' }}>{m.amount} USDC · day {m.days_after_start}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Reviews */}
          <section className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink)' }}>Reviews ({reviews.length})</h2>
            {reviews.length === 0 && <p className="text-xs" style={{ color: 'var(--muted)' }}>No reviews yet.</p>}
            {reviews.map(r => (
              <div key={r.id} className="mb-3 pb-3 border-b last:border-0 last:mb-0 last:pb-0" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-mono" style={{ color: 'var(--muted)' }}>{fmtAddr(r.reviewer_addr)}</span>
                  <div className="flex items-center gap-1">
                    {r.score && Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} size={10} fill={i < r.score! ? 'currentColor' : 'none'} style={{ color: '#f59e0b' }} />
                    ))}
                    {r.decision === 'approve'
                      ? <CheckCircle size={13} style={{ color: 'var(--success)' }} />
                      : r.decision === 'reject'
                        ? <XCircle size={13} style={{ color: 'var(--danger)' }} />
                        : null
                    }
                  </div>
                </div>
                {r.notes && <p className="text-xs" style={{ color: 'var(--ink-2)' }}>{r.notes}</p>}
              </div>
            ))}
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Review form */}
          {!myReview && app.status !== 'awarded' && (
            <section className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink)' }}>Your Review</h2>
              <div className="flex items-center gap-1 mb-3">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => setScore(n)}>
                    <Star size={18} fill={n <= score ? 'currentColor' : 'none'} style={{ color: '#f59e0b' }} />
                  </button>
                ))}
              </div>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Notes (optional)"
                rows={3}
                className="w-full rounded-xl text-sm px-3 py-2 mb-3 resize-none"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setDecision('approve'); void submitReview() }}
                  disabled={submitting}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50"
                  style={{ background: 'var(--success)' }}
                >
                  Approve
                </button>
                <button
                  onClick={() => { setDecision('reject'); void submitReview() }}
                  disabled={submitting}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50"
                  style={{ background: 'var(--danger)' }}
                >
                  Reject
                </button>
              </div>
            </section>
          )}

          {/* Award form */}
          {app.status === 'approved' && (
            <section className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--ink)' }}>Create Award</h2>
              <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Amount (USDC)</label>
              <input
                type="text"
                value={awardAmount}
                onChange={e => setAwardAmount(e.target.value)}
                className="w-full rounded-xl text-sm px-3 py-2 mb-2"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
              />
              <div className="flex gap-2 mb-3">
                <div className="flex-1">
                  <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Cliff (days)</label>
                  <input
                    type="number"
                    value={awardCliff}
                    onChange={e => setAwardCliff(e.target.value)}
                    className="w-full rounded-xl text-sm px-3 py-2"
                    style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Vest (days)</label>
                  <input
                    type="number"
                    value={awardVest}
                    onChange={e => setAwardVest(e.target.value)}
                    className="w-full rounded-xl text-sm px-3 py-2"
                    style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  />
                </div>
              </div>
              <button
                onClick={() => void handleAward()}
                disabled={awarding}
                className="w-full py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}
              >
                {awarding ? 'Creating…' : 'Create Award'}
              </button>
            </section>
          )}

          {/* Applicant links */}
          {app.links && app.links.length > 0 && (
            <section className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--ink)' }}>Links</h2>
              {app.links.map((l, i) => (
                <a key={i} href={l} target="_blank" rel="noopener noreferrer"
                  className="block text-xs truncate hover:underline mb-1"
                  style={{ color: '#1061a6' }}
                >
                  <ExternalLink size={10} className="inline mr-1" />{l}
                </a>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
