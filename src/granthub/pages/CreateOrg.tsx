import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createOrg } from '../api'
import { useAuth } from '../useAuth'
import { useAccount } from 'wagmi'
import { AuthBanner } from '../components/AuthBanner'
import { toast } from 'sonner'

export function CreateOrg() {
  const { address: walletAddr } = useAccount()
  const { address: sessionAddr } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [website, setWebsite] = useState('')
  const [twitter, setTwitter] = useState('')
  const [loading, setLoading] = useState(false)

  const handleNameChange = (v: string) => {
    setName(v)
    setSlug(v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
  }

  const handleSubmit = async () => {
    if (!name || !slug) { toast.error('Name and slug are required'); return }
    setLoading(true)
    try {
      await createOrg({ name, slug, description, website, twitter })
      toast.success('Organisation created')
      void navigate(`/granthub/dashboard`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (!walletAddr || !sessionAddr) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="display text-2xl font-bold mb-4" style={{ color: 'var(--ink)' }}>Create Organisation</h1>
        <AuthBanner />
      </div>
    )
  }

  const field = 'w-full rounded-xl text-sm px-3 py-2 outline-none focus:ring-2 ring-[var(--focus)]'
  const fieldStyle = { background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <h1 className="display text-2xl font-bold mb-6" style={{ color: 'var(--ink)' }}>Create Organisation</h1>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Organisation Name</label>
          <input value={name} onChange={e => handleNameChange(e.target.value)} placeholder="e.g. Arc Ecosystem Fund" className={field} style={fieldStyle} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Slug (URL handle)</label>
          <div className="flex items-center rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <span className="px-3 py-2 text-xs" style={{ background: 'var(--surface-muted)', color: 'var(--subtle)', borderRight: '1px solid var(--border)' }}>granthub/orgs/</span>
            <input
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              className="flex-1 px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={`${field} resize-none`} style={fieldStyle} placeholder="What does your organisation fund?" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Website</label>
          <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://…" className={field} style={fieldStyle} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--muted)' }}>Twitter handle</label>
          <div className="flex items-center rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <span className="px-3 py-2 text-xs" style={{ background: 'var(--surface-muted)', color: 'var(--subtle)', borderRight: '1px solid var(--border)' }}>@</span>
            <input
              value={twitter}
              onChange={e => setTwitter(e.target.value.replace(/^@/, ''))}
              className="flex-1 px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
            />
          </div>
        </div>

        <button
          onClick={() => void handleSubmit()}
          disabled={loading || !name || !slug}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 mt-4"
          style={{ background: 'var(--accent)' }}
        >
          {loading ? 'Creating…' : 'Create Organisation'}
        </button>
      </div>
    </div>
  )
}
