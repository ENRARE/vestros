/**
 * GrantExplorer — public grant discovery page.
 */
import { useState, useEffect } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import { GrantCard } from '../components/GrantCard'
import { listGrants } from '../api'
import type { GrantProgram, GrantStatus } from '../types'

const CATEGORIES = ['general', 'infrastructure', 'defi', 'tooling', 'research', 'education', 'community']

const STATUS_OPTIONS: { value: GrantStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'review', label: 'Reviewing' },
  { value: 'closed', label: 'Closed' },
]

export function GrantExplorer() {
  const [grants, setGrants] = useState<GrantProgram[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<GrantStatus | ''>('')
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState('created_at')

  const [pageReq, setPageReq] = useState<{ pg: number; key: number }>({ pg: 1, key: 0 })

  useEffect(() => {
    const pg = pageReq.pg
    const doFetch = async () => {
      try {
        const data = await listGrants({ status: status || undefined, category: category || undefined, q: q || undefined, sort, page: pg })
        setGrants(data.grants)
        setTotal(data.total)
        setPages(data.pages)
        setPage(data.page)
        setError('')
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    }
    void doFetch()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, category, sort, pageReq])

  const go = (pg: number) => setPageReq(r => ({ pg, key: r.key + 1 }))

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="display text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
          Grant Explorer
        </h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Discover and apply for USDC grants from leading organizations.
        </p>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col gap-3">
        {/* Search bar */}
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search grants…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
            style={{
              background: 'var(--surface-strong)',
              border: '1px solid var(--border)',
              color: 'var(--ink)',
            }}
            onKeyDown={e => e.key === 'Enter' && go(1)}
          />
        </div>

        {/* Filter row */}
        <div className="flex gap-2 flex-wrap items-center">
          <SlidersHorizontal size={13} style={{ color: 'var(--subtle)' }} />
          <div className="flex gap-1 flex-wrap">
            {STATUS_OPTIONS.map(o => (
              <button
                key={o.value}
                onClick={() => setStatus(o.value)}
                className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
                style={{
                  background: status === o.value ? 'var(--accent)' : 'var(--surface-muted)',
                  color: status === o.value ? '#fff' : 'var(--muted)',
                  border: '1px solid var(--border)',
                }}
              >{o.label}</button>
            ))}
          </div>
          <div className="h-4 w-px" style={{ background: 'var(--border)' }} />
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="px-2 py-1 rounded-lg text-xs outline-none"
            style={{
              background: 'var(--surface-muted)',
              border: '1px solid var(--border)',
              color: 'var(--muted)',
            }}
          >
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="px-2 py-1 rounded-lg text-xs outline-none"
            style={{
              background: 'var(--surface-muted)',
              border: '1px solid var(--border)',
              color: 'var(--muted)',
            }}
          >
            <option value="created_at">Newest</option>
            <option value="deadline">Deadline</option>
            <option value="budget">Budget</option>
          </select>
        </div>
      </div>

      {/* Results */}
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(186,43,76,0.07)', color: 'var(--danger)' }}>
          {error}
          <button onClick={() => go(1)} className="ml-2 underline text-xs">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-52 rounded-2xl animate-pulse" style={{ background: 'var(--surface-muted)' }} />
          ))}
        </div>
      ) : grants.length === 0 ? (
        <div className="py-16 text-center flex flex-col items-center gap-3">
          <span className="text-4xl">
            <Search size={36} style={{ color: 'var(--subtle)' }} />
          </span>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No grants match your filters.</p>
          <button
            onClick={() => { setQ(''); setStatus(''); setCategory(''); go(1) }}
            className="text-xs underline"
            style={{ color: 'var(--accent-hover)' }}
          >Clear filters</button>
        </div>
      ) : (
        <>
          <div className="text-xs" style={{ color: 'var(--subtle)' }}>{total} grant{total !== 1 ? 's' : ''}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            {grants.map(g => <GrantCard key={g.id} grant={g} />)}
          </div>
          {pages > 1 && (
            <div className="flex justify-center gap-2 py-2">
              <button
                disabled={page <= 1}
                onClick={() => go(page - 1)}
                className="px-3 py-1 rounded-lg text-xs disabled:opacity-40"
                style={{ background: 'var(--surface-muted)', color: 'var(--muted)', border: '1px solid var(--border)' }}
              >Prev</button>
              <span className="px-3 py-1 text-xs" style={{ color: 'var(--muted)' }}>{page} / {pages}</span>
              <button
                disabled={page >= pages}
                onClick={() => go(page + 1)}
                className="px-3 py-1 rounded-lg text-xs disabled:opacity-40"
                style={{ background: 'var(--surface-muted)', color: 'var(--muted)', border: '1px solid var(--border)' }}
              >Next</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
