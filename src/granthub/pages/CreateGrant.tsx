import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { getGrant, getMyOrgs, createGrant, createOrg, updateGrant } from '../api'
import { useAuth } from '../useAuth'
import { useAccount } from 'wagmi'
import { AuthBanner } from '../components/AuthBanner'
import type { CustomQuestion, GrantProgram, Organization } from '../types'
import { GRANT_CATEGORY_OPTIONS } from '../grant-form'
import { toast } from 'sonner'
import { PlusCircle, Trash2 } from 'lucide-react'
import { ACTIVE_CHAIN_ID, CHAIN_ENV } from '../../networkConfig'

const emptyQuestion = (): CustomQuestion => ({ id: `question_${Date.now()}`, prompt: '', required: true })
const dateInput = (timestamp?: number | null) => timestamp ? new Date(timestamp * 1000).toISOString().slice(0, 10) : ''
const timestamp = (value: string) => value ? Math.floor(new Date(`${value}T23:59:59`).getTime() / 1000) : undefined

export function CreateGrant() {
  const { id } = useParams<{ id: string }>()
  const isEditing = Boolean(id)
  const { address: walletAddr } = useAccount()
  const { address: sessionAddr } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [orgId, setOrgId] = useState(searchParams.get('orgId') ?? '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [goals, setGoals] = useState('')
  const [eligibility, setEligibility] = useState('')
  const [requirements, setRequirements] = useState('')
  const [deliverables, setDeliverables] = useState('')
  const [fundingTerms, setFundingTerms] = useState('')
  const [category, setCategory] = useState('general')
  const [totalBudget, setTotalBudget] = useState('')
  const [minAward, setMinAward] = useState('')
  const [maxAward, setMaxAward] = useState('')
  const [poolAddress, setPoolAddress] = useState('')
  const [cliffDays, setCliffDays] = useState('90')
  const [vestingDays, setVestingDays] = useState('365')
  const [startDate, setStartDate] = useState('')
  const [closeDate, setCloseDate] = useState('')
  const [revocable, setRevocable] = useState(true)
  const [allowMultiple, setAllowMultiple] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [questions, setQuestions] = useState<CustomQuestion[]>([])
  const [loading, setLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(false)
  const [orgsLoading, setOrgsLoading] = useState(false)

  useEffect(() => {
    if (!sessionAddr) return
    let active = true
    const load = async () => {
      setOrgsLoading(true)
      try {
        const list = await getMyOrgs()
        if (!active) return
        setOrgs(list)
        if (!orgId && list.length > 0) setOrgId(list[0].id)
        if (id) {
          setPageLoading(true)
          const grant = await getGrant(id)
          if (!active) return
          populate(grant)
          setOrgId(grant.org_id)
        }
      } catch (error) {
        if (active) toast.error((error as Error).message)
      } finally {
        if (active) { setOrgsLoading(false); setPageLoading(false) }
      }
    }
    void load()
    return () => { active = false }
  // orgId is only the initial selection; changing it must not reload the form.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionAddr, id])

  const populate = (grant: GrantProgram) => {
    setTitle(grant.title ?? '')
    setDescription(grant.description ?? '')
    setGoals(grant.goals ?? '')
    setEligibility(grant.eligibility ?? '')
    setRequirements(grant.requirements ?? '')
    setDeliverables(grant.deliverables ?? '')
    setFundingTerms(grant.funding_terms ?? '')
    setCategory(grant.category ?? 'general')
    setTotalBudget(grant.declared_budget != null ? String(grant.declared_budget) : '')
    setMinAward(grant.min_award != null ? String(grant.min_award) : '')
    setMaxAward(grant.max_award != null ? String(grant.max_award) : '')
    setPoolAddress(grant.pool_contract_address ?? '')
    setCliffDays(String(grant.vesting_cliff_days ?? grant.cliff_days ?? 0))
    setVestingDays(String(grant.vesting_total_days ?? grant.vesting_days ?? 365))
    setStartDate(dateInput(grant.start_date))
    setCloseDate(dateInput(grant.deadline ?? grant.end_date))
    setRevocable(grant.revocable !== false)
    setAllowMultiple(Boolean(grant.allow_multiple_applications))
    setQuestions(grant.custom_questions ?? [])
    setTags((grant.tags ?? []).map(String))
  }

  const ensureOrg = async (): Promise<string | null> => {
    if (orgs.length > 0 && orgId) return orgId
    if (orgs.length > 0) return orgs[0].id
    try {
      const addrShort = walletAddr ? walletAddr.slice(2, 8) : 'anon'
      const org = await createOrg({ name: `Personal (${addrShort})`, description: 'Personal grant workspace' })
      setOrgs([org]); setOrgId(org.id); return org.id
    } catch (error) {
      toast.error(`Could not create workspace: ${(error as Error).message}`); return null
    }
  }

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase()
    if (tag && !tags.includes(tag)) setTags([...tags, tag])
    setTagInput('')
  }

  const addQuestion = () => setQuestions([...questions, emptyQuestion()])
  const updateQuestion = (index: number, patch: Partial<CustomQuestion>) =>
    setQuestions(questions.map((question, i) => i === index ? { ...question, ...patch } : question))

  const handleSubmit = async (status: 'draft' | 'open' | 'closed') => {
    if (!title.trim()) { toast.error('Title is required'); return }
    if (status === 'open' && (!totalBudget || Number(totalBudget) <= 0)) {
      toast.error('A published grant needs a positive budget'); return
    }
    if (Number(maxAward || totalBudget || 0) < Number(minAward || 0)) {
      toast.error('Minimum award cannot exceed maximum award'); return
    }
    setLoading(true)
    try {
      const resolvedOrgId = isEditing ? orgId : await ensureOrg()
      if (!resolvedOrgId) return
      const body = {
        title: title.trim(), description, goals, eligibility, requirements, deliverables, funding_terms: fundingTerms,
        category, declared_budget: Number(totalBudget || 0), min_award: Number(minAward || 0),
        max_award: Number(maxAward || totalBudget || 0), vesting_cliff_days: parseInt(cliffDays, 10) || 0,
        vesting_total_days: parseInt(vestingDays, 10) || 365, start_date: timestamp(startDate),
        deadline: timestamp(closeDate), end_date: timestamp(closeDate), faqs: tags.map(tag => ({ tag })),
        custom_questions: questions.filter(question => question.prompt.trim()), allow_multiple_applications: allowMultiple,
        revocable, pool_contract_address: poolAddress.trim() || undefined,
        pool_chain_id: poolAddress.trim() ? ACTIVE_CHAIN_ID : undefined, status,
      }
      const grant = isEditing && id ? await updateGrant(id, body) : await createGrant(resolvedOrgId, body)
      toast.success(status === 'draft' ? 'Draft saved' : status === 'closed' ? 'Applications closed' : 'Grant published')
      void navigate(`/granthub/grants/${grant.id}`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally { setLoading(false) }
  }

  if (!walletAddr || !sessionAddr) return <div className="max-w-3xl mx-auto py-8"><h1 className="display text-2xl font-bold mb-4" style={{ color: 'var(--ink)' }}>{isEditing ? 'Edit Grant Program' : 'Create Grant Program'}</h1><AuthBanner /></div>
  if (orgsLoading || pageLoading) return <div className="max-w-3xl mx-auto py-10 text-sm" style={{ color: 'var(--muted)' }}>Loading grant workspace…</div>

  const field = 'w-full rounded-md text-sm px-3 py-2.5 outline-none focus:ring-2 ring-[var(--accent)]'
  const fieldStyle = { background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }
  const label = 'block text-xs font-semibold mb-1 tracking-widest uppercase'
  return (
    <div className="max-w-3xl mx-auto py-6">
      <div className="mb-6"><h1 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>{isEditing ? 'Edit Grant Program' : 'Create Grant Program'}</h1><p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Define the program, applicant requirements, and award terms. Funding remains separate from publication.</p></div>
      <div className="space-y-5 rounded-lg p-6" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        {orgs.length > 1 && <div><label className={label} style={{ color: 'var(--subtle)' }}>Workspace</label><select value={orgId} onChange={e => setOrgId(e.target.value)} className={field} style={fieldStyle}>{orgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></div>}
        {!isEditing && orgs.length === 0 && <div className="text-xs px-3 py-2 rounded-md" style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>A personal workspace will be created when you save.</div>}
        <div><label className={label} style={{ color: 'var(--subtle)' }}>Program title</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Arc Ecosystem Grants" className={field} style={fieldStyle} /></div>
        <div><label className={label} style={{ color: 'var(--subtle)' }}>Description</label><textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} className={`${field} resize-none`} style={fieldStyle} /></div>
        <div className="grid md:grid-cols-2 gap-4">
          <div><label className={label} style={{ color: 'var(--subtle)' }}>Funding objectives</label><textarea value={goals} onChange={e => setGoals(e.target.value)} rows={4} className={`${field} resize-none`} style={fieldStyle} /></div>
          <div><label className={label} style={{ color: 'var(--subtle)' }}>Eligibility criteria</label><textarea value={eligibility} onChange={e => setEligibility(e.target.value)} rows={4} className={`${field} resize-none`} style={fieldStyle} /></div>
        </div>
        <div className="grid md:grid-cols-2 gap-4"><div><label className={label} style={{ color: 'var(--subtle)' }}>Applicant requirements</label><textarea value={requirements} onChange={e => setRequirements(e.target.value)} rows={3} className={`${field} resize-none`} style={fieldStyle} /></div><div><label className={label} style={{ color: 'var(--subtle)' }}>Expected deliverables</label><textarea value={deliverables} onChange={e => setDeliverables(e.target.value)} rows={3} className={`${field} resize-none`} style={fieldStyle} /></div></div>
        <div><label className={label} style={{ color: 'var(--subtle)' }}>Funding and vesting terms</label><textarea value={fundingTerms} onChange={e => setFundingTerms(e.target.value)} rows={3} className={`${field} resize-none`} style={fieldStyle} placeholder="Describe award and vesting expectations." /></div>
        <div className="grid md:grid-cols-3 gap-3">
          <div><label className={label} style={{ color: 'var(--subtle)' }}>Category</label><select value={category} onChange={e => setCategory(e.target.value)} className={field} style={fieldStyle}>{GRANT_CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
          <div><label className={label} style={{ color: 'var(--subtle)' }}>Opening date</label><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={field} style={fieldStyle} /></div>
          <div><label className={label} style={{ color: 'var(--subtle)' }}>Closing date</label><input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} className={field} style={fieldStyle} /></div>
        </div>
        <div className="grid md:grid-cols-3 gap-3"><div><label className={label} style={{ color: 'var(--subtle)' }}>Total budget (USDC)</label><input type="number" min="0" value={totalBudget} onChange={e => setTotalBudget(e.target.value)} className={field} style={fieldStyle} /></div><div><label className={label} style={{ color: 'var(--subtle)' }}>Minimum award</label><input type="number" min="0" value={minAward} onChange={e => setMinAward(e.target.value)} className={field} style={fieldStyle} /></div><div><label className={label} style={{ color: 'var(--subtle)' }}>Maximum award</label><input type="number" min="0" value={maxAward} onChange={e => setMaxAward(e.target.value)} placeholder="Full budget" className={field} style={fieldStyle} /></div></div>
        <div className="grid grid-cols-2 gap-3"><div><label className={label} style={{ color: 'var(--subtle)' }}>Cliff (days)</label><input type="number" min="0" value={cliffDays} onChange={e => setCliffDays(e.target.value)} className={field} style={fieldStyle} /></div><div><label className={label} style={{ color: 'var(--subtle)' }}>Vesting duration (days)</label><input type="number" min="1" value={vestingDays} onChange={e => setVestingDays(e.target.value)} className={field} style={fieldStyle} /></div></div>
        <div><label className={label} style={{ color: 'var(--subtle)' }}>Custom application questions</label><div className="space-y-2">{questions.map((question, index) => <div key={question.id} className="flex gap-2 items-center"><input value={question.prompt} onChange={e => updateQuestion(index, { prompt: e.target.value })} placeholder="Question for applicants" className={`${field} flex-1`} style={fieldStyle} /><label className="flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}><input type="checkbox" checked={question.required} onChange={e => updateQuestion(index, { required: e.target.checked })} /> Required</label><button type="button" onClick={() => setQuestions(questions.filter((_, i) => i !== index))} aria-label="Remove question" style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button></div>)}</div><button type="button" onClick={addQuestion} className="mt-2 inline-flex items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}><PlusCircle size={13} /> Add question</button></div>
        <div><label className={label} style={{ color: 'var(--subtle)' }}>GrantPool address ({CHAIN_ENV})</label><input value={poolAddress} onChange={e => setPoolAddress(e.target.value)} placeholder="Optional until authorized deployment" spellCheck={false} className={field} style={fieldStyle} /></div>
        <div className="flex flex-wrap gap-5 text-sm" style={{ color: 'var(--ink-2)' }}><label className="flex items-center gap-2"><input type="checkbox" checked={revocable} onChange={e => setRevocable(e.target.checked)} /> Revocable vesting</label><label className="flex items-center gap-2"><input type="checkbox" checked={allowMultiple} onChange={e => setAllowMultiple(e.target.checked)} /> Allow multiple applications</label></div>
        <div><label className={label} style={{ color: 'var(--subtle)' }}>Tags</label><div className="flex gap-2 mb-2 flex-wrap">{tags.map(tag => <span key={tag} className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-md" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>{tag}<button type="button" onClick={() => setTags(tags.filter(value => value !== tag))} aria-label={`Remove ${tag}`}><Trash2 size={10} /></button></span>)}</div><div className="flex gap-2"><input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} placeholder="Add a tag" className={`flex-1 ${field}`} style={fieldStyle} /><button type="button" onClick={addTag} className="px-3 rounded-md" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}><PlusCircle size={13} /></button></div></div>
        <div className="flex flex-wrap gap-3 pt-2"><button type="button" onClick={() => void handleSubmit('draft')} disabled={loading} className="flex-1 min-w-[140px] py-2.5 rounded-md text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink)' }}>Save Draft</button><button type="button" onClick={() => void handleSubmit('open')} disabled={loading} className="flex-1 min-w-[140px] py-2.5 rounded-md text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}>{loading ? 'Saving…' : 'Publish Grant'}</button>{isEditing && <button type="button" onClick={() => void handleSubmit('closed')} disabled={loading} className="min-w-[150px] py-2.5 rounded-md text-sm font-semibold disabled:opacity-50" style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--danger)' }}>Close Applications</button>}</div>
      </div>
    </div>
  )
}
