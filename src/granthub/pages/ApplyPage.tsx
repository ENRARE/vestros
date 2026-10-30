import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getGrant, submitApplication } from '../api'
import { useAuth } from '../useAuth'
import { useAccount } from 'wagmi'
import { AuthBanner } from '../components/AuthBanner'
import { parseUsdc } from '@/onchain-money'
import { toast } from 'sonner'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import type { GrantProgram } from '../types'

interface MilestoneInput {
  title: string
  description: string
  amount: string
  days_after_start: number
}

export function ApplyPage() {
  const { grantId } = useParams<{ grantId: string }>()
  const navigate = useNavigate()
  const { address: walletAddr } = useAccount()
  const { address: sessionAddr } = useAuth()

  const [grant, setGrant] = useState<GrantProgram | null>(null)
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [projectTitle, setProjectTitle] = useState('')
  const [projectDesc, setProjectDesc] = useState('')
  const [requestedAmount, setRequestedAmount] = useState('')
  const [milestones, setMilestones] = useState<MilestoneInput[]>([
    { title: '', description: '', amount: '', days_after_start: 30 }
  ])
  const [links, setLinks] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!grantId) return
    getGrant(grantId).then(setGrant).catch(console.error).finally(() => setLoading(false))
  }, [grantId])

  const addMilestone = () =>
    setMilestones(ms => [...ms, { title: '', description: '', amount: '', days_after_start: 30 * (ms.length + 1) }])

  const removeMilestone = (i: number) =>
    setMilestones(ms => ms.filter((_, idx) => idx !== i))

  const updateMilestone = (i: number, field: keyof MilestoneInput, value: string | number) =>
    setMilestones(ms => ms.map((m, idx) => idx === i ? { ...m, [field]: value } : m))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!grantId || !walletAddr || !sessionAddr) return

    try {
      const raw = parseUsdc(requestedAmount)
      if (!raw || raw === 0n) { toast.error('Enter a valid requested amount'); return }
    } catch { toast.error('Invalid amount'); return }

    setSubmitting(true)
    try {
      const linkArr = links.split('\n').map(l => l.trim()).filter(Boolean)
      await submitApplication(grantId, {
        name,
        bio,
        project_title: projectTitle,
        description: projectDesc,
        requested_amount: requestedAmount,
        milestones,
        links: linkArr,
        submit: true,
      })
      toast.success('Application submitted!')
      void navigate(`/granthub/grants/${grantId}`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24" style={{ color: 'var(--muted)' }}>Loading grant…</div>
  )

  if (!grant) return (
    <div className="flex items-center justify-center py-24" style={{ color: 'var(--danger)' }}>Grant not found.</div>
  )

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <Link to={`/grants/${grantId}`} className="inline-flex items-center gap-1 text-sm" style={{ color: 'var(--muted)' }}>
        <ArrowLeft size={14} /> Back to grant
      </Link>

      <div>
        <h1 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>Apply: {grant.title}</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Max award: {grant.max_award} USDC
        </p>
      </div>

      <AuthBanner />

      {sessionAddr && (
        <form onSubmit={e => void handleSubmit(e)} className="space-y-5">
          <fieldset className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <legend className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: 'var(--subtle)' }}>About you</legend>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-2)' }}>Your name</label>
              <input value={name} onChange={e => setName(e.target.value)} required
                placeholder="Full name or handle"
                className="w-full rounded-xl px-3 py-2 text-sm"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-2)' }}>Short bio</label>
              <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} required
                placeholder="Who are you and what do you work on?"
                className="w-full rounded-xl px-3 py-2 text-sm resize-none"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
            </div>
          </fieldset>

          <fieldset className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <legend className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: 'var(--subtle)' }}>Your project</legend>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-2)' }}>Project title</label>
              <input value={projectTitle} onChange={e => setProjectTitle(e.target.value)} required
                placeholder="Concise project name"
                className="w-full rounded-xl px-3 py-2 text-sm"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-2)' }}>Description</label>
              <textarea value={projectDesc} onChange={e => setProjectDesc(e.target.value)} rows={5} required
                placeholder="Describe what you're building, why it matters, and how the funds will be used."
                className="w-full rounded-xl px-3 py-2 text-sm resize-none"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-2)' }}>Requested amount (USDC)</label>
              <input value={requestedAmount} onChange={e => setRequestedAmount(e.target.value)} required
                type="number" step="0.01" min="0" placeholder="e.g. 5000"
                className="w-full rounded-xl px-3 py-2 text-sm mono tabular-nums"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-2)' }}>Links (one per line)</label>
              <textarea value={links} onChange={e => setLinks(e.target.value)} rows={3}
                placeholder="GitHub, portfolio, website, previous work…"
                className="w-full rounded-xl px-3 py-2 text-sm resize-none"
                style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
            </div>
          </fieldset>

          <fieldset className="rounded-2xl p-5 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <legend className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: 'var(--subtle)' }}>Milestones</legend>
            {milestones.map((m, i) => (
              <div key={i} className="rounded-xl p-3 space-y-2" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Milestone {i + 1}</span>
                  {milestones.length > 1 && (
                    <button type="button" onClick={() => removeMilestone(i)} style={{ color: 'var(--danger)' }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <input value={m.title} onChange={e => updateMilestone(i, 'title', e.target.value)} required
                  placeholder="Milestone title"
                  className="w-full rounded-lg px-2 py-1.5 text-sm"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
                <textarea value={m.description} onChange={e => updateMilestone(i, 'description', e.target.value)} rows={2}
                  placeholder="What will be delivered?"
                  className="w-full rounded-lg px-2 py-1.5 text-sm resize-none"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs" style={{ color: 'var(--muted)' }}>Amount (USDC)</label>
                    <input value={m.amount} onChange={e => updateMilestone(i, 'amount', e.target.value)}
                      type="number" step="0.01" min="0" placeholder="0.00"
                      className="w-full rounded-lg px-2 py-1.5 text-sm mono tabular-nums"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
                  </div>
                  <div>
                    <label className="text-xs" style={{ color: 'var(--muted)' }}>Days after start</label>
                    <input value={m.days_after_start} onChange={e => updateMilestone(i, 'days_after_start', Number(e.target.value))}
                      type="number" min="1"
                      className="w-full rounded-lg px-2 py-1.5 text-sm mono tabular-nums"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
                  </div>
                </div>
              </div>
            ))}
            <button type="button" onClick={addMilestone}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl"
              style={{ color: 'var(--accent)', background: 'rgba(18,45,69,0.06)', border: '1px solid var(--border)' }}>
              <Plus size={14} /> Add milestone
            </button>
          </fieldset>

          <button type="submit" disabled={submitting || !sessionAddr}
            className="w-full py-3 rounded-2xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--accent)', minHeight: 48 }}>
            {submitting ? 'Submitting…' : 'Submit application'}
          </button>
        </form>
      )}
    </div>
  )
}
