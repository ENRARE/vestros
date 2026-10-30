/**
 * Vestros Design System — shared UI primitives.
 * All components use CSS variables from index.css.
 */
import type { ReactNode, CSSProperties } from 'react'

// ── PageHeader ───────────────────────────────────────────────────────────────
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h2 className="display font-bold" style={{ fontSize: 22, color: 'var(--ink)', margin: 0, lineHeight: 1.2 }}>
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)', maxWidth: '52ch' }}>
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

// ── MetricTile ───────────────────────────────────────────────────────────────
export function MetricTile({
  label,
  value,
  sub,
  accent,
  loading,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  accent?: boolean
  loading?: boolean
}) {
  return (
    <div
      className="rounded-xl px-4 py-4 flex flex-col gap-1"
      style={{
        background: accent ? 'var(--accent-dim)' : 'var(--surface-muted)',
        border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
        minWidth: 0,
      }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.07em]" style={{ color: 'var(--subtle)' }}>
        {label}
      </span>
      {loading ? (
        <div className="h-6 rounded" style={{ background: 'var(--border)', width: '60%', animation: 'pulse 1.5s infinite' }} />
      ) : (
        <div
          className="display font-bold tabnum"
          style={{ fontSize: 20, color: accent ? 'var(--accent)' : 'var(--ink)', lineHeight: 1.2 }}
        >
          {value}
        </div>
      )}
      {sub && !loading && (
        <div className="text-[11px]" style={{ color: 'var(--muted)' }}>{sub}</div>
      )}
    </div>
  )
}

// ── StatusBadge ──────────────────────────────────────────────────────────────
type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'accent'

const BADGE_STYLES: Record<BadgeVariant, CSSProperties> = {
  success: { background: 'var(--success-dim)', color: 'var(--success)' },
  danger:  { background: 'var(--danger-dim)',  color: 'var(--danger)' },
  warning: { background: 'var(--warning-dim)', color: 'var(--warning)' },
  info:    { background: 'rgba(96,165,250,0.12)', color: '#60A5FA' },
  neutral: { background: 'var(--surface-muted)', color: 'var(--muted)' },
  accent:  { background: 'var(--accent-dim)', color: 'var(--accent)' },
}

export function StatusBadge({ label, variant = 'neutral', dot = true }: {
  label: string; variant?: BadgeVariant; dot?: boolean
}) {
  const s = BADGE_STYLES[variant]
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={s}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />}
      {label}
    </span>
  )
}

// ── EmptyState ───────────────────────────────────────────────────────────────
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-3">
      <div
        className="flex items-center justify-center w-14 h-14 rounded-2xl"
        style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}
      >
        {icon}
      </div>
      <div>
        <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{title}</p>
        {body && <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{body}</p>}
      </div>
      {action}
    </div>
  )
}

// ── Skeleton ─────────────────────────────────────────────────────────────────
export function Skeleton({ w = '100%', h = 16, rounded = 8 }: {
  w?: string | number; h?: number; rounded?: number
}) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: rounded,
        background: 'var(--surface-muted)',
        animation: 'pulse 1.5s cubic-bezier(0.4,0,0.6,1) infinite',
      }}
    />
  )
}

// ── Divider ──────────────────────────────────────────────────────────────────
export function Divider({ className = '' }: { className?: string }) {
  return <hr className={className} style={{ border: 'none', borderTop: '1px solid var(--border)', margin: 0 }} />
}

// ── Button ───────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BTN: Record<ButtonVariant, CSSProperties> = {
  primary:   { background: 'var(--accent)', color: 'var(--accent-text)', border: 'none' },
  secondary: { background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' },
  ghost:     { background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)' },
  danger:    { background: 'var(--danger-dim)', color: 'var(--danger)', border: '1px solid var(--danger)' },
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  type = 'button',
  fullWidth = false,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  type?: 'button' | 'submit'
  fullWidth?: boolean
}) {
  const pad = size === 'sm' ? '6px 12px' : size === 'lg' ? '10px 24px' : '8px 16px'
  const fs  = size === 'sm' ? 12 : size === 'lg' ? 15 : 13
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...BTN[variant],
        padding: pad,
        fontSize: fs,
        fontWeight: 600,
        borderRadius: 10,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        width: fullWidth ? '100%' : undefined,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        transition: 'opacity 150ms, background 150ms',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────────
export function Card({
  children,
  className = '',
  style,
  padding = true,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  padding?: boolean
}) {
  return (
    <div
      className={className}
      style={{
        background: 'var(--surface-muted)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: padding ? '20px 20px' : 0,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// ── InputField ───────────────────────────────────────────────────────────────
export function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  error,
  hint,
  disabled,
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  error?: string
  hint?: string
  disabled?: boolean
  required?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-semibold" style={{ color: 'var(--ink-2)' }}>
        {label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className="w-full rounded-xl px-3 py-2.5 text-sm"
        style={{
          background: 'var(--surface-muted)',
          border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
          color: 'var(--ink)',
          outline: 'none',
          fontFamily: 'inherit',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = error ? 'var(--danger)' : 'var(--accent)' }}
        onBlur={e => { e.currentTarget.style.borderColor = error ? 'var(--danger)' : 'var(--border)' }}
      />
      {error && <p className="text-[11px]" style={{ color: 'var(--danger)' }}>{error}</p>}
      {hint && !error && <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>{hint}</p>}
    </div>
  )
}
