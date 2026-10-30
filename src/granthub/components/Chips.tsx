import type { GrantStatus, AppStatus, AwardStatus } from '../types'

const GRANT_STATUS: Record<GrantStatus, { label: string; bg: string; color: string }> = {
  draft:   { label: 'Draft',     bg: 'rgba(18,45,69,0.06)',  color: 'var(--subtle)' },
  open:    { label: 'Open',      bg: 'rgba(26,128,71,0.10)', color: 'var(--success)' },
  review:  { label: 'In Review', bg: 'rgba(16,97,166,0.10)', color: '#1061a6' },
  closed:  { label: 'Closed',    bg: 'rgba(18,45,69,0.06)',  color: 'var(--subtle)' },
}

const APP_STATUS: Record<AppStatus, { label: string; color: string }> = {
  draft:           { label: 'Draft',           color: 'var(--subtle)' },
  submitted:       { label: 'Submitted',       color: 'var(--muted)' },
  reviewing:       { label: 'Reviewing',       color: '#1061a6' },
  shortlisted:     { label: 'Shortlisted',     color: '#1a7a80' },
  approved:        { label: 'Approved',        color: 'var(--success)' },
  rejected:        { label: 'Rejected',        color: 'var(--danger)' },
  pending_funding: { label: 'Pending Funding', color: '#b45309' },
  funded:          { label: 'Funded',          color: 'var(--success)' },
  awarded:         { label: 'Awarded',         color: 'var(--success)' },
}

const AWARD_STATUS: Record<AwardStatus, { label: string; color: string }> = {
  pending:           { label: 'Pending',    color: 'var(--muted)' },
  activating:        { label: 'Activating', color: '#1061a6' },
  active:            { label: 'Active',     color: 'var(--success)' },
  vesting_activated: { label: 'Vesting',    color: 'var(--success)' },
  failed:            { label: 'Failed',     color: 'var(--danger)' },
  cancelled:         { label: 'Cancelled',  color: 'var(--danger)' },
}

const CATEGORY_COLORS: Record<string, string> = {
  infrastructure:  '#1061a6',
  defi:            '#1a8047',
  tooling:         '#c46b33',
  research:        '#6b33c4',
  education:       '#1a7a80',
  community:       '#1a5080',
  general:         '#6b6580',
}

export function StatusChip({ status }: { status: GrantStatus }) {
  const s = GRANT_STATUS[status] ?? { label: status, bg: 'rgba(18,45,69,0.06)', color: 'var(--subtle)' }
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

export function AppStatusChip({ status }: { status: AppStatus }) {
  const s = APP_STATUS[status] ?? { label: status, color: 'var(--muted)' }
  return (
    <span className="text-xs font-semibold" style={{ color: s.color }}>{s.label}</span>
  )
}

export function AwardStatusChip({ status }: { status: AwardStatus }) {
  const s = AWARD_STATUS[status] ?? { label: status, color: 'var(--muted)' }
  return (
    <span className="text-xs font-semibold" style={{ color: s.color }}>{s.label}</span>
  )
}

export function CategoryChip({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category?.toLowerCase()] ?? '#6b6580'
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-medium capitalize"
      style={{ background: `${color}14`, color, border: `1px solid ${color}28` }}
    >
      {category}
    </span>
  )
}

export function TagChip({ tag }: { tag: string }) {
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs"
      style={{ background: 'var(--surface-muted)', color: 'var(--muted)', border: '1px solid var(--border)' }}
    >
      {tag}
    </span>
  )
}
