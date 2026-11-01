import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { parseUsdc } from '@/onchain-money'
import { getGrant, getMyApplications, submitApplication, updateApplication } from '../api'
import { AuthBanner } from '../components/AuthBanner'
import { useAuth } from '../useAuth'
import {
  APPLICATION_STEPS,
  APPLICATION_REQUIRED_NOTE,
  validateApplicationStep,
  type ApplicationForm,
  type MilestoneInput,
} from '../application-form'
import type { GrantApplication, GrantProgram } from '../types'

const initialForm: ApplicationForm = {
  applicant_name: '', email: '', country: '', applicant_type: 'individual', github_url: '', portfolio_url: '', bio: '',
  project_name: '', summary: '', problem: '', solution: '', project_category: '', development_stage: '', tech_stack: '',
  ecosystem_benefit: '', previous_experience: '', requested_amount: '', use_of_funds: '', budget_breakdown: '', completion_date: '', links: '',
}

const dateInput = (timestamp?: number | null) => timestamp ? new Date(timestamp * 1000).toISOString().slice(0, 10) : ''
const toTimestamp = (value: string) => value ? Math.floor(new Date(`${value}T12:00:00`).getTime() / 1000) : undefined

function Field({
  label, required, children, hint,
}: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--ink-2)' }}>
        {label}{required ? <span aria-hidden="true" style={{ color: 'var(--accent)' }}> *</span> : null}
      </label>
      {children}
      {hint && <p className="text-[11px] mt-1" style={{ color: 'var(--subtle)' }}>{hint}</p>}
    </div>
  )
}

function ReviewValue({ label, value }: { label: string; value?: string | number | null }) {
  const text = String(value ?? '').trim()
  return (
    <div className="py-2" style={{ borderBottom: '1px solid var(--border)' }}>
      <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>{label}</p>
      <p className="text-sm mt-0.5 whitespace-pre-wrap" style={{ color: text ? 'var(--ink-2)' : 'var(--muted)' }}>{text || 'Not provided'}</p>
    </div>
  )
}

export function ApplyPage() {
  const { grantId } = useParams<{ grantId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { address: walletAddr } = useAccount()
  const { address: sessionAddr } = useAuth()
  const [grant, setGrant] = useState<GrantProgram | null>(null)
  const [applicationId, setApplicationId] = useState(searchParams.get('applicationId') ?? '')
  const [form, setForm] = useState<ApplicationForm>(initialForm)
  const [milestones, setMilestones] = useState<MilestoneInput[]>([{ title: '', description: '', amount: '', days_after_start: 30 }])
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const [step, setStep] = useState(0)
  const [furthestStep, setFurthestStep] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!grantId) return
    let active = true
    const load = async () => {
      try {
        const loadedGrant = await getGrant(grantId)
        if (!active) return
        setGrant(loadedGrant)
        if (sessionAddr) {
          const apps = await getMyApplications()
          const requested = apps.find(app => app.id === applicationId && app.status === 'draft')
          const draft = requested ?? apps.find(app => app.grant_id === grantId && app.status === 'draft')
          if (draft && active) { setApplicationId(draft.id); populate(draft) }
        }
      } catch (error) {
        if (active) toast.error((error as Error).message)
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  // populate is stable for this page; session changes should reload the draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grantId, sessionAddr])

  const populate = (application: GrantApplication) => {
    setForm({
      applicant_name: application.applicant_name ?? application.name ?? '', email: application.email ?? '', country: application.country ?? '',
      applicant_type: application.applicant_type === 'team' ? 'team' : 'individual', github_url: application.github_url ?? '',
      portfolio_url: application.portfolio_url ?? '', bio: application.bio ?? '', project_name: application.project_name ?? application.project_title ?? '',
      summary: application.summary ?? '', problem: application.problem ?? '', solution: application.solution ?? '', project_category: application.project_category ?? '',
      development_stage: application.development_stage ?? '', tech_stack: application.tech_stack ?? '', ecosystem_benefit: application.ecosystem_benefit ?? '',
      previous_experience: application.previous_experience ?? '', requested_amount: application.requested_amount ?? '', use_of_funds: application.use_of_funds ?? '',
      budget_breakdown: application.budget_breakdown ?? '', completion_date: dateInput(application.completion_date), links: (application.links ?? []).join('\n'),
    })
    const parsedMilestones = application.milestones.filter(item => Boolean(item && (item.title || item.label))).map(item => ({
      title: item.title ?? item.label ?? '', description: item.description ?? '', amount: item.amount ?? item.value ?? '', days_after_start: item.days_after_start ?? 30,
    }))
    setMilestones(parsedMilestones.length > 0 ? parsedMilestones : [{ title: '', description: '', amount: '', days_after_start: 30 }])
    setCustomAnswers(application.custom_answers ?? {})
  }

  const setField = <K extends keyof ApplicationForm>(key: K, value: ApplicationForm[K]) => setForm(current => ({ ...current, [key]: value }))
  const addMilestone = () => setMilestones(current => [...current, { title: '', description: '', amount: '', days_after_start: 30 * (current.length + 1) }])
  const removeMilestone = (index: number) => setMilestones(current => current.filter((_, i) => i !== index))
  const updateMilestone = (index: number, key: keyof MilestoneInput, value: string | number) => setMilestones(current => current.map((item, i) => i === index ? { ...item, [key]: value } : item))

  const validateStep = (index: number) => validateApplicationStep(index, form, milestones, grant?.custom_questions ?? [], customAnswers)

  const goNext = () => {
    const error = validateStep(step)
    if (error) { toast.error(error); return }
    const next = Math.min(APPLICATION_STEPS.length - 1, step + 1)
    setStep(next)
    setFurthestStep(current => Math.max(current, next))
  }

  const save = async (submit: boolean) => {
    if (!grantId || !walletAddr || !sessionAddr) return
    if (submit) {
      for (let index = 0; index < 4; index += 1) {
        const stepError = validateStep(index)
        if (stepError) { toast.error(stepError); setStep(index); return }
      }
      const required: Array<[keyof ApplicationForm, string]> = [
        ['applicant_name', 'Full name or team representative'], ['email', 'Email'], ['country', 'Country'], ['project_name', 'Project name'],
        ['summary', 'Project description'], ['problem', 'Problem statement'], ['solution', 'Proposed solution'], ['project_category', 'Project category'],
        ['development_stage', 'Development stage'], ['tech_stack', 'Technology stack'], ['ecosystem_benefit', 'Ecosystem benefit'], ['use_of_funds', 'Use of funds'],
        ['budget_breakdown', 'Budget breakdown'], ['completion_date', 'Expected completion date'], ['requested_amount', 'Requested amount'],
      ]
      const missing = required.find(([key]) => !String(form[key]).trim())
      if (missing) { toast.error(`${missing[1]} is required`); return }
    }

    let raw: bigint | undefined
    try { raw = form.requested_amount.trim() ? parseUsdc(form.requested_amount) : undefined } catch { toast.error('Requested amount is invalid'); return }
    if (submit && (!raw || raw <= 0n)) { toast.error('Enter a valid requested amount'); return }
    if (raw && grant) {
      if (grant.min_award && Number(raw) < grant.min_award * 1_000_000) { toast.error('Requested amount is below the minimum award'); return }
      if (grant.max_award && Number(raw) > Number(grant.max_award) * 1_000_000) { toast.error('Requested amount exceeds the maximum award'); return }
    }

    setSaving(true)
    try {
      const linkEntries = form.links.split('\n').map(value => value.trim()).filter(Boolean)
      const milestonePayload = [...milestones, ...linkEntries.map((value, index) => ({ label: `link_${index + 1}`, value }))]
      const body = {
        applicant_name: form.applicant_name, email: form.email, country: form.country, applicant_type: form.applicant_type,
        github_url: form.github_url, portfolio_url: form.portfolio_url, project_name: form.project_name, summary: form.summary,
        problem: form.problem, solution: form.solution, project_category: form.project_category, development_stage: form.development_stage,
        tech_stack: form.tech_stack, ecosystem_benefit: form.ecosystem_benefit, previous_experience: form.previous_experience,
        requested_raw: raw ? Number(raw) : undefined, use_of_funds: form.use_of_funds, budget_breakdown: form.budget_breakdown,
        completion_date: toTimestamp(form.completion_date), custom_answers: customAnswers,
        attachments: linkEntries.map(url => ({ name: 'Supporting link', url })), milestones: milestonePayload, submit,
      }
      if (applicationId) await updateApplication(applicationId, body)
      else { const created = await submitApplication(grantId, body); setApplicationId(created.id) }
      toast.success(submit ? 'Application submitted' : 'Draft saved')
      if (submit) void navigate(`/granthub/grants/${grantId}`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-24" style={{ color: 'var(--muted)' }}>Loading grant…</div>
  if (!grant) return <div className="flex items-center justify-center py-24" style={{ color: 'var(--danger)' }}>Grant not found.</div>
  const accepting = ['open', 'review', 'reviewing'].includes(grant.status)
  const field = 'w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 ring-[var(--accent)]'
  const style = { background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <Link to={`/granthub/grants/${grantId}`} className="inline-flex items-center gap-1 text-sm" style={{ color: 'var(--muted)' }}><ArrowLeft size={14} /> Back to grant</Link>
      <header>
        <p className="text-xs uppercase tracking-[0.16em] mb-2" style={{ color: 'var(--accent)' }}>Grant application</p>
        <h1 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>{applicationId ? 'Continue application' : 'Apply to'}: {grant.title}</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Award range: {grant.min_award ?? 0}–{grant.max_award ?? grant.total_budget ?? '—'} USDC</p>
      </header>
      <AuthBanner />
      {!accepting && <div className="rounded-md px-4 py-3 text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>Applications are closed for this program.</div>}

      {accepting && sessionAddr && <form onSubmit={event => { event.preventDefault(); if (step === APPLICATION_STEPS.length - 1) void save(true); else goNext() }} className="space-y-5">
        <nav aria-label="Application progress" className="rounded-md p-3 sm:p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-start justify-between gap-1 sm:gap-2">
            {APPLICATION_STEPS.map((item, index) => {
              const complete = index < step
              const selected = index === step
              return (
                <div key={item.id} className="flex items-center flex-1 min-w-0">
                  <button type="button" disabled={index > furthestStep} onClick={() => setStep(index)} aria-current={selected ? 'step' : undefined} className="flex items-center gap-2 text-left min-w-0 disabled:cursor-default" style={{ color: selected ? 'var(--ink)' : complete ? 'var(--accent)' : 'var(--muted)' }}>
                    <span className="w-6 h-6 shrink-0 flex items-center justify-center text-xs font-semibold" style={{ border: `1px solid ${selected || complete ? 'var(--accent)' : 'var(--border)'}`, background: selected ? 'var(--accent-dim)' : 'transparent', color: selected || complete ? 'var(--accent)' : 'var(--muted)', borderRadius: 'var(--radius-control)' }}>{complete ? <Check size={13} /> : index + 1}</span>
                    <span className="hidden md:block text-xs font-semibold truncate">{item.label}</span>
                  </button>
                  {index < APPLICATION_STEPS.length - 1 && <span className="h-px flex-1 mx-1 sm:mx-2" style={{ background: index < step ? 'var(--accent)' : 'var(--border)' }} />}
                </div>
              )
            })}
          </div>
          <div className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>Step {step + 1} of {APPLICATION_STEPS.length}</div>
        </nav>

        {step === 0 && <section className="rounded-md p-5 sm:p-6 space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div><h2 className="display text-lg font-semibold" style={{ color: 'var(--ink)' }}>Applicant information</h2><p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Tell the grant team who is applying.</p></div>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Full name or team representative" required><input value={form.applicant_name} onChange={e => setField('applicant_name', e.target.value)} className={field} style={style} autoComplete="name" /></Field>
            <Field label="Email" required><input type="email" value={form.email} onChange={e => setField('email', e.target.value)} className={field} style={style} autoComplete="email" /></Field>
            <Field label="Country" required><input value={form.country} onChange={e => setField('country', e.target.value)} className={field} style={style} autoComplete="country-name" /></Field>
            <Field label="Application type" required><select value={form.applicant_type} onChange={e => setField('applicant_type', e.target.value as 'individual' | 'team')} className={field} style={style}><option value="individual">Individual</option><option value="team">Team</option></select></Field>
            <Field label="GitHub"><input value={form.github_url} onChange={e => setField('github_url', e.target.value)} className={field} style={style} placeholder="https://github.com/…" /></Field>
            <Field label="Portfolio / website"><input value={form.portfolio_url} onChange={e => setField('portfolio_url', e.target.value)} className={field} style={style} placeholder="https://…" /></Field>
          </div>
          <div className="rounded-md px-3 py-2.5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>Connected wallet</p>
            <p className="mono text-sm mt-1" style={{ color: 'var(--ink-2)' }}>{walletAddr ? `${walletAddr.slice(0, 10)}…${walletAddr.slice(-8)}` : 'Connect a wallet to continue'}</p>
          </div>
          <Field label="Previous experience"><textarea value={form.previous_experience} onChange={e => setField('previous_experience', e.target.value)} rows={4} className={`${field} resize-none`} style={style} placeholder="Relevant projects, teams, or experience." /></Field>
        </section>}

        {step === 1 && <section className="rounded-md p-5 sm:p-6 space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div><h2 className="display text-lg font-semibold" style={{ color: 'var(--ink)' }}>Project information</h2><p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Describe the work, the problem, and the ecosystem impact.</p></div>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Project name" required><input value={form.project_name} onChange={e => setField('project_name', e.target.value)} className={field} style={style} /></Field>
            <Field label="Project category" required><input value={form.project_category} onChange={e => setField('project_category', e.target.value)} className={field} style={style} /></Field>
            <Field label="Development stage" required hint="For example: prototype, beta, or live."><input value={form.development_stage} onChange={e => setField('development_stage', e.target.value)} className={field} style={style} /></Field>
            <Field label="Technology stack" required><input value={form.tech_stack} onChange={e => setField('tech_stack', e.target.value)} className={field} style={style} /></Field>
          </div>
          <Field label="Project description" required><textarea value={form.summary} onChange={e => setField('summary', e.target.value)} rows={4} className={`${field} resize-none`} style={style} /></Field>
          <div className="grid md:grid-cols-2 gap-4"><Field label="Problem being solved" required><textarea value={form.problem} onChange={e => setField('problem', e.target.value)} rows={4} className={`${field} resize-none`} style={style} /></Field><Field label="Proposed solution" required><textarea value={form.solution} onChange={e => setField('solution', e.target.value)} rows={4} className={`${field} resize-none`} style={style} /></Field></div>
          <Field label="Target users and ecosystem benefit" required><textarea value={form.ecosystem_benefit} onChange={e => setField('ecosystem_benefit', e.target.value)} rows={4} className={`${field} resize-none`} style={style} /></Field>
        </section>}

        {step === 2 && <section className="rounded-md p-5 sm:p-6 space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div><h2 className="display text-lg font-semibold" style={{ color: 'var(--ink)' }}>Funding proposal</h2><p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Show the requested amount and how it will be used.</p></div>
          <div className="grid md:grid-cols-2 gap-4"><Field label="Requested USDC" required hint={`Grant range: ${grant.min_award ?? 0}–${grant.max_award ?? grant.total_budget ?? '—'} USDC`}><input type="number" step="0.000001" min="0" value={form.requested_amount} onChange={e => setField('requested_amount', e.target.value)} className={`${field} mono`} style={style} /></Field><Field label="Expected completion date" required><input type="date" value={form.completion_date} onChange={e => setField('completion_date', e.target.value)} className={field} style={style} /></Field></div>
          <Field label="Use of funds" required><textarea value={form.use_of_funds} onChange={e => setField('use_of_funds', e.target.value)} rows={4} className={`${field} resize-none`} style={style} /></Field>
          <Field label="Budget breakdown" required hint="Separate major cost areas so reviewers can assess the request."><textarea value={form.budget_breakdown} onChange={e => setField('budget_breakdown', e.target.value)} rows={5} className={`${field} resize-none`} style={style} placeholder="Personnel: 60 USDC\nInfrastructure: 25 USDC\nResearch: 15 USDC" /></Field>
        </section>}

        {step === 3 && <section className="rounded-md p-5 sm:p-6 space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div><h2 className="display text-lg font-semibold" style={{ color: 'var(--ink)' }}>Milestones and supporting links</h2><p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Give the grant team a measurable delivery plan.</p></div>
          <div className="space-y-3">{milestones.map((milestone, index) => <div key={index} className="rounded-md p-4 space-y-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}><div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>Milestone {index + 1}</span>{milestones.length > 1 && <button type="button" onClick={() => removeMilestone(index)} aria-label="Remove milestone" style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>}</div><Field label="Milestone title" required><input value={milestone.title} onChange={e => updateMilestone(index, 'title', e.target.value)} placeholder="What will be delivered?" className={field} style={style} /></Field><Field label="Description"><textarea value={milestone.description} onChange={e => updateMilestone(index, 'description', e.target.value)} rows={2} placeholder="Describe the outcome." className={`${field} resize-none`} style={style} /></Field><div className="grid grid-cols-2 gap-3"><Field label="Amount (USDC)"><input value={milestone.amount} onChange={e => updateMilestone(index, 'amount', e.target.value)} type="number" step="0.000001" min="0" placeholder="0.00" className={`${field} mono`} style={style} /></Field><Field label="Days after start"><input value={milestone.days_after_start} onChange={e => updateMilestone(index, 'days_after_start', Number(e.target.value))} type="number" min="1" className={`${field} mono`} style={style} /></Field></div></div>)}</div>
          <button type="button" onClick={addMilestone} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md" style={{ color: 'var(--accent)', border: '1px solid var(--border)' }}><Plus size={14} /> Add milestone</button>
          <Field label="Supporting links" hint="One URL per line: repository, demo, pitch deck, or supporting document."><textarea value={form.links} onChange={e => setField('links', e.target.value)} rows={4} className={`${field} resize-none`} style={style} placeholder="https://github.com/…\nhttps://example.com/demo" /></Field>
          {(grant.custom_questions ?? []).length > 0 && <div className="pt-2 space-y-4"><div><h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Program questions</h3><p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Answer the questions set by this grant program.</p></div>{grant.custom_questions?.map(question => <Field key={question.id} label={question.prompt} required={question.required}><textarea value={customAnswers[question.id] ?? ''} onChange={e => setCustomAnswers(current => ({ ...current, [question.id]: e.target.value }))} rows={3} className={`${field} resize-none`} style={style} /></Field>)}</div>}
        </section>}

        {step === 4 && <section className="rounded-md p-5 sm:p-6 space-y-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div><h2 className="display text-lg font-semibold" style={{ color: 'var(--ink)' }}>Review and submit</h2><p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Check the details before sending this application to the grant team.</p></div>
          <div className="grid md:grid-cols-2 gap-x-6 gap-y-4"><div><h3 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--accent)' }}>Applicant</h3><ReviewValue label="Name" value={form.applicant_name} /><ReviewValue label="Email" value={form.email} /><ReviewValue label="Country / type" value={`${form.country} · ${form.applicant_type}`} /><ReviewValue label="GitHub / portfolio" value={[form.github_url, form.portfolio_url].filter(Boolean).join(' · ')} /></div><div><h3 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--accent)' }}>Funding</h3><ReviewValue label="Requested" value={form.requested_amount ? `${form.requested_amount} USDC` : ''} /><ReviewValue label="Completion" value={form.completion_date} /><ReviewValue label="Use of funds" value={form.use_of_funds} /><ReviewValue label="Budget" value={form.budget_breakdown} /></div></div>
          <div><h3 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--accent)' }}>Project</h3><ReviewValue label="Name / category / stage" value={[form.project_name, form.project_category, form.development_stage].filter(Boolean).join(' · ')} /><ReviewValue label="Description" value={form.summary} /><ReviewValue label="Problem and solution" value={`${form.problem}\n\n${form.solution}`} /><ReviewValue label="Ecosystem benefit" value={form.ecosystem_benefit} /></div>
          <div><h3 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--accent)' }}>Delivery plan</h3>{milestones.map((milestone, index) => <ReviewValue key={index} label={`Milestone ${index + 1}`} value={`${milestone.title} · day ${milestone.days_after_start}${milestone.amount ? ` · ${milestone.amount} USDC` : ''}\n${milestone.description}`} />)}<ReviewValue label="Supporting links" value={form.links} /></div>
          {(grant.custom_questions ?? []).length > 0 && <div><h3 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--accent)' }}>Program questions</h3>{grant.custom_questions?.map(question => <ReviewValue key={question.id} label={question.prompt} value={customAnswers[question.id]} />)}</div>}
        </section>}

        <p className="text-xs" style={{ color: 'var(--muted)' }}>{APPLICATION_REQUIRED_NOTE}</p>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1"><div className="flex gap-2"><button type="button" onClick={() => setStep(current => Math.max(0, current - 1))} disabled={step === 0 || saving} className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-sm font-semibold disabled:opacity-40" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}><ChevronLeft size={15} /> Back</button><button type="button" onClick={() => void save(false)} disabled={saving} className="px-3 py-2 rounded-md text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>{saving ? 'Saving…' : 'Save draft'}</button></div>{step < APPLICATION_STEPS.length - 1 ? <button type="submit" disabled={saving} className="inline-flex items-center gap-1 px-4 py-2 rounded-md text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>Continue <ChevronRight size={15} /></button> : <button type="submit" disabled={saving} className="px-4 py-2 rounded-md text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>{saving ? 'Submitting…' : 'Submit application'}</button>}</div>
      </form>}
    </div>
  )
}
