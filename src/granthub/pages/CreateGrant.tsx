import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getMyOrgs, createGrant, createOrg } from '../api'
import { useAuth } from '../useAuth'
import { useAccount } from 'wagmi'
import { AuthBanner } from '../components/AuthBanner'
import type { Organization } from '../types'
import { toast } from 'sonner'
import { PlusCircle, Trash2 } from 'lucide-react'

const CATEGORIES = ['general','infrastructure','defi','tooling','research','education','community']

export function CreateGrant() {
  const { address: walletAddr } = useAccount()
  const { address: sessionAddr } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const preselectedOrgId = searchParams.get('orgId') ?? ''

  const [orgs, setOrgs] = useState<Organization[]>([])
  const [orgId, setOrgId] = useState(preselectedOrgId)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [requirements, setRequirements] = useState('')
  const [category, setCategory] = useState('general')
  const [totalBudget, setTotalBudget] = useState('')
  const [maxAward, setMaxAward] = useState('')
  const [cliffDays, setCliffDays] = useState('90')
  const [vestingDays, setVestingDays] = useState('365')
  const [closeDate, setCloseDate] = useState('')
  const [revocable, setRevocable] = useState(true)
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [orgsLoading, setOrgsLoading] = useState(false)

  useEffect(() => {
    if (!sessionAddr) return
    const load = async () => {
      setOrgsLoading(true)
      try {
        const list = await getMyOrgs()
        setOrgs(list)
        if (!orgId && list.length > 0) setOrgId(list[0].id)
      } finally {
        setOrgsLoading(false)
      }
    }
    void load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionAddr])

  // Auto-create a personal org if the user has none
  const ensureOrg = async (): Promise<string | null> => {
    if (orgs.length > 0 && orgId) return orgId
    if (orgs.length > 0) return orgs[0].id
    try {
      const addrShort = walletAddr ? walletAddr.slice(2, 8) : 'anon'
      const org = await createOrg({ name: `Personal (${addrShort})`, description: 'Personal grant workspace' })
      setOrgs([org])
      setOrgId(org.id)
      return org.id
    } catch (e) {
      toast.error(`Could not create workspace: ${(e as Error).message}`)
      return null
    }
  }

  const addTag = () => {
    const t = tagInput.trim().toLowerCase()
    if (t && !tags.includes(t)) setTags([...tags, t])
    setTagInput('')
  }
  const removeTag = (t: string) => setTags(tags.filter(x => x !== t))

  const handleSubmit = async (status: 'draft' | 'open') => {
    if (!title.trim()) { toast.error('Title is required'); return }
    if (!totalBudget || Number(totalBudget) <= 0) { toast.error('Total budget must be greater than 0'); return }
    setLoading(true)
    try {
      const resolvedOrgId = await ensureOrg()
      if (!resolvedOrgId) return

      const g = await createGrant(resolvedOrgId, {
        title: title.trim(),
        description,
        requirements,
        category,
        declared_budget: Number(totalBudget),
        max_award: String(maxAward ? Number(maxAward) : Number(totalBudget)),
        vesting_cliff_days: parseInt(cliffDays, 10) || 0,
        vesting_total_days: parseInt(vestingDays, 10) || 365,
        close_date: closeDate ? Math.floor(new Date(closeDate).getTime() / 1000) : undefined,
        faqs: tags.map(t => ({ tag: t })),
        revocable,
        status,
      })
      toast.success(status === 'draft' ? 'Saved as draft' : 'Grant published — it now appears in Explorer')
      void navigate(`/granthub/grants/${g.id}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (!walletAddr || !sessionAddr) {
    return (
      <div className="max-w-2xl mx-auto py-8">
        <h1 className="display text-2xl font-bold mb-4" style={{ color: 'var(--ink)' }}>Create Grant Program</h1>
        <AuthBanner />
      </div>
    )
  }

  if (orgsLoading) return (
    <div className="max-w-2xl mx-auto py-10 text-sm" style={{ color: 'var(--muted)' }}>Loading workspace…</div>
  )

  const field = 'w-full rounded-xl text-sm px-3 py-2.5 outline-none focus:ring-2 ring-[var(--accent)]'
  const fieldStyle = { background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }

  return (
    <div className="max-w-2xl mx-auto py-6">
      <div className="mb-6">
        <h1 className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>Create Grant Program</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Grants are published to Explorer and open for applications once you click Publish.
          No USDC deposit is required at creation — clearly declared budgets are separate from confirmed funding.
        </p>
      </div>

      <div className="space-y-4 rounded-2xl p-6" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        {/* Org selector — shown only when user has multiple orgs */}
        {orgs.length > 1 && (
          <div>
            <label className="block text-xs font-semibold mb-1 tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>Organization</label>
            <select value={orgId} onChange={e => setOrgId(e.target.value)} className={field} style={fieldStyle}>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
        {orgs.length === 0 && (
          <div className="text-xs px-3 py-2 rounded-xl" style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
            A personal workspace will be created automatically when you save.
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold mb-1 tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Arc Ecosystem Grants Q1 2027" className={field} style={fieldStyle} />
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1 tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            rows={4} className={`${field} resize-none`} style={fieldStyle}
            placeholder="What is this grant program about?" />
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1 tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>Eligibility / Requirements</label>
          <textarea value={requirements} onChange={e => setRequirements(e.target.value)}
            rows={3} className={`${field} resize-none`} style={fieldStyle}
            placeholder="e.g. Must be building on Arc Testnet…" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1 tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>Declared Budget (USDC)</label>
            <p className="text-[10px] mb-1" style={{ color: 'var(--subtle)' }}>Declared — not a deposit</p>
            <input type="number" value={totalBudget} onChange={e => setTotalBudget(e.target.value)}
              placeholder="50000" className={field} style={fieldStyle} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>Max per Award (USDC)</label>
            <p className="text-[10px] mb-1" style={{ color: 'var(--subtle)' }}>Leave blank = full budget</p>
            <input type="number" value={maxAward} onChange={e => setMaxAward(e.target.value)}
              placeholder="5000" className={field} style={fieldStyle} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1 tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>Cliff (days)</label>
            <input type="number" value={cliffDays} onChange={e => setCliffDays(e.target.value)}
              className={field} style={fieldStyle} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>Vesting (days)</label>
            <input type="number" value={vestingDays} onChange={e => setVestingDays(e.target.value)}
              className={field} style={fieldStyle} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1 tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className={field} style={fieldStyle}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>Close Date</label>
            <input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)}
              className={field} style={fieldStyle} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input id="revocable" type="checkbox" checked={revocable} onChange={e => setRevocable(e.target.checked)}
            className="w-4 h-4 rounded" />
          <label htmlFor="revocable" className="text-sm" style={{ color: 'var(--ink-2)' }}>
            Award vesting is revocable (unvested tokens can be reclaimed by admin)
          </label>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1 tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>Tags</label>
          <div className="flex gap-2 mb-2 flex-wrap">
            {tags.map(t => (
              <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
                style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
                {t}
                <button type="button" onClick={() => removeTag(t)}><Trash2 size={10} /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={tagInput} onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
              placeholder="Add a tag…" className={`flex-1 ${field}`} style={fieldStyle} />
            <button type="button" onClick={addTag} className="px-3 py-1.5 rounded-xl text-xs font-semibold"
              style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
              <PlusCircle size={13} />
            </button>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => void handleSubmit('draft')} disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
            Save Draft
          </button>
          <button type="button" onClick={() => void handleSubmit('open')} disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}>
            {loading ? 'Publishing…' : 'Publish Grant'}
          </button>
        </div>
      </div>
    </div>
  )
}
