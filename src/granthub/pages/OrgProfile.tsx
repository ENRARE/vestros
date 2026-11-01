import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getOrg, listGrants } from '../api'
import { fmtAddr } from '../../formatters'
import { Building2, Globe, Twitter, ArrowLeft, Plus } from 'lucide-react'
import { GrantCard } from '../components/GrantCard'
import { AuthBanner } from '../components/AuthBanner'
import { useAuth } from '../useAuth'
import type { Organization, GrantProgram } from '../types'

export function OrgProfile() {
  const { id } = useParams<{ id: string }>()
  const { address: session } = useAuth()
  const [org, setOrg] = useState<Organization | null>(null)
  const [grants, setGrants] = useState<GrantProgram[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    const load = async () => {
      try {
        const [o, g] = await Promise.all([getOrg(id), listGrants({ orgId: id })])
        setOrg(o)
        setGrants(g.grants)
      } catch (e) {
        setErr((e as Error).message)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [id])

  if (loading) return (
    <div className="flex items-center justify-center py-24" style={{ color: 'var(--muted)' }}>
      Loading…
    </div>
  )
  if (err || !org) return (
    <div className="text-center py-24" style={{ color: 'var(--danger)' }}>
      {err ?? 'Organisation not found'}
    </div>
  )

  const isOwner = session?.toLowerCase() === org.owner_addr?.toLowerCase()

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link to="/granthub" className="inline-flex items-center gap-1.5 text-sm mb-6" style={{ color: 'var(--muted)' }}>
        <ArrowLeft size={14} /> All Grants
      </Link>

      {/* Org header */}
      <div className="rounded-2xl p-6 mb-6"
        style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            {org.logo_url
              ? <img src={org.logo_url} alt={org.name} className="w-14 h-14 rounded-xl object-cover" />
              : <Building2 size={24} style={{ color: 'var(--subtle)' }} />}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="display text-2xl font-bold mb-1" style={{ color: 'var(--ink)' }}>{org.name}</h1>
            <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>{org.description}</p>
            <div className="flex flex-wrap gap-3">
              {org.website && (
                <a href={org.website} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--accent-hover)' }}>
                  <Globe size={12} /> {org.website.replace(/^https?:\/\//, '')}
                </a>
              )}
              {org.twitter && (
                <a href={`https://twitter.com/${org.twitter.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--accent-hover)' }}>
                  <Twitter size={12} /> {org.twitter}
                </a>
              )}
              {org.owner_addr && <span className="text-xs font-mono" style={{ color: 'var(--subtle)' }}>
                {fmtAddr(org.owner_addr)}
              </span>}
            </div>
          </div>
          {isOwner && (
            <Link to={`/granthub/grants/new?orgId=${org.id}`}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white"
              style={{ background: 'var(--accent)', minHeight: 36 }}>
              <Plus size={14} /> New Grant
            </Link>
          )}
        </div>
      </div>

      <AuthBanner />

      {/* Grants list */}
      <h2 className="text-base font-semibold mb-3 mt-6" style={{ color: 'var(--ink)' }}>
        Active Grants ({grants.length})
      </h2>
      {grants.length === 0
        ? <p className="text-sm" style={{ color: 'var(--muted)' }}>No active grants from this organisation.</p>
        : <div className="flex flex-col gap-3">
            {grants.map(g => <GrantCard key={g.id} grant={g} />)}
          </div>
      }
    </div>
  )
}
