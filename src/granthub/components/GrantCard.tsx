import { Calendar } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { GrantProgram } from '../types'
import { fmtDate } from '@/formatters'
import { StatusChip, CategoryChip } from './Chips'

export function GrantCard({ grant }: { grant: GrantProgram }) {
  const budget = parseFloat(grant.total_budget ?? '0')
  const funded = parseFloat(grant.confirmed_funded ?? '0')
  const fundedPct = budget > 0 ? Math.min(100, Math.round((funded / budget) * 100)) : 0
  const initials = (grant.org_name ?? '?').slice(0, 2).toUpperCase()

  return (
    <Link
      to={`/granthub/grants/${grant.id}`}
      className="flex flex-col rounded-2xl p-5 gap-4 transition-all hover:shadow-md group"
      style={{
        background: 'var(--surface-muted)',
        border: '1px solid var(--border)',
        textDecoration: 'none',
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold"
          style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{grant.org_name}</span>
            <StatusChip status={grant.status} />
          </div>
          <h3
            className="text-sm font-bold leading-snug mt-0.5 group-hover:underline"
            style={{ color: 'var(--ink)', textUnderlineOffset: '3px' }}
          >
            {grant.title}
          </h3>
        </div>
      </div>

      {/* Description */}
      <p
        className="text-xs line-clamp-2"
        style={{ color: 'var(--muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
      >
        {grant.description}
      </p>

      {/* Funding bar */}
      {budget > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs" style={{ color: 'var(--subtle)' }}>
            <span>Funding progress</span>
            <span className="tabular-nums font-semibold" style={{ color: 'var(--ink-2)' }}>
              {funded > 0 ? `${funded.toLocaleString()} / ${budget.toLocaleString()}` : `${budget.toLocaleString()}`} USDC
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
            <div className="h-full rounded-full" style={{ width: `${fundedPct}%`, background: 'var(--accent)' }} />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <CategoryChip category={grant.category} />
          {grant.max_award && parseFloat(grant.max_award) > 0 && (
            <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
              Up to {grant.max_award} USDC
            </span>
          )}
        </div>
        {grant.close_date && (
          <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--subtle)' }}>
            <Calendar size={11} />
            <span>Closes {fmtDate(grant.close_date)}</span>
          </div>
        )}
      </div>
    </Link>
  )
}
