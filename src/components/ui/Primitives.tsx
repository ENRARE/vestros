import { useState, useRef, useEffect, type ReactNode } from 'react'
import { Info, ChevronDown, ChevronUp, CheckCircle2, XCircle, Clock, Lock, Unlock } from 'lucide-react'
import type { ScheduleStatus } from '@/types'

// ─── Tooltip ─────────────────────────────────────────────────────────────────
export function Tooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])
  return (
    <span className="relative inline-flex items-center">
      <button
        ref={ref}
        type="button"
        onClick={() => setShow(v => !v)}
        className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full transition-opacity opacity-60 hover:opacity-100"
        style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}
        aria-label="Info"
      >
        <Info size={10} />
      </button>
      {show && (
        <span
          className="absolute z-20 left-5 top-0 w-56 rounded-xl px-3 py-2 text-xs shadow-lg"
          style={{ background: 'var(--ink)', color: 'white', lineHeight: '1.5' }}
        >
          {text}
        </span>
      )}
    </span>
  )
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────
export function StatusBadge({ status }: { status: ScheduleStatus }) {
  const map: Record<ScheduleStatus, { label: string; bg: string; color: string; icon: ReactNode }> = {
    locked:       { label: 'Locked',       bg: 'rgba(18,45,69,0.08)',   color: 'var(--muted)',   icon: <Lock size={11} /> },
    vesting:      { label: 'Vesting',      bg: 'rgba(26,128,71,0.10)',  color: 'var(--success)', icon: <Unlock size={11} /> },
    fully_vested: { label: 'Fully Vested', bg: 'rgba(26,128,71,0.15)', color: 'var(--success)', icon: <CheckCircle2 size={11} /> },
    revoked:      { label: 'Revoked',      bg: 'rgba(186,43,76,0.10)', color: 'var(--danger)',  icon: <XCircle size={11} /> },
  }
  const { label, bg, color, icon } = map[status]
  return (
    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: bg, color }}>
      {icon}{label}
    </span>
  )
}

// ─── ProgressBar ─────────────────────────────────────────────────────────────
export function ProgressBar({ vested, claimed }: { vested: number; claimed: number }) {
  return (
    <div className="relative h-2.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
      <div className="absolute left-0 top-0 h-full rounded-full transition-all" style={{ width: `${vested}%`, background: 'rgba(18,45,69,0.18)' }} />
      <div className="absolute left-0 top-0 h-full rounded-full transition-all" style={{ width: `${claimed}%`, background: 'var(--accent)' }} />
    </div>
  )
}

// ─── MiniProgressBar ─────────────────────────────────────────────────────────
export function MiniProgressBar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="relative h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
      <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: `${value}%`, background: color ?? 'var(--accent)' }} />
    </div>
  )
}

// ─── Card ────────────────────────────────────────────────────────────────────
export function Card({ children, danger, className = '' }: { children: ReactNode; danger?: boolean; className?: string }) {
  return (
    <div
      className={`rounded-2xl flex flex-col ${className}`}
      style={{
        background: 'var(--surface-strong)',
        border: `1px solid ${danger ? 'rgba(186,43,76,0.25)' : 'var(--border)'}`,
        boxShadow: '0 1px 4px rgba(18,45,69,0.07)',
      }}
    >
      {children}
    </div>
  )
}

// ─── MetricTile ──────────────────────────────────────────────────────────────
export function MetricTile({
  label, value, sub, accent, tooltip,
}: { label: string; value: string; sub?: string; accent?: string; tooltip?: string }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1" style={{ background: 'var(--surface-muted)' }}>
      <span className="flex items-center text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>
        {label}
        {tooltip && <Tooltip text={tooltip} />}
      </span>
      <span className="text-xl font-bold tabular-nums" style={{ color: accent ?? 'var(--ink)' }}>{value}</span>
      {sub && <span className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>{sub}</span>}
    </div>
  )
}

// ─── Collapsible ─────────────────────────────────────────────────────────────
export function Collapsible({ label, children, defaultOpen = false }: {
  label: string; children: ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--surface-strong)' }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center justify-between w-full px-4 py-3 text-xs font-semibold"
        style={{ color: 'var(--subtle)' }}
      >
        <span>{label}</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─── SectionHeader ───────────────────────────────────────────────────────────
export function SectionHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>{title}</h2>
        {sub && <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{sub}</p>}
      </div>
      {action}
    </div>
  )
}

// ─── IndexerBanner ───────────────────────────────────────────────────────────
export function IndexerBanner({ progress, error, indexedBlock, headBlock }: {
  progress: number; error: string | null; indexedBlock: bigint; headBlock: bigint
}) {
  if (error) {
    return (
      <div className="rounded-xl px-3 py-2 text-xs" style={{ background: 'rgba(186,43,76,0.06)', border: '1px solid rgba(186,43,76,0.15)', color: 'var(--danger)' }}>
        Event indexing error: {error}. Some history may be incomplete.
      </div>
    )
  }
  if (progress < 100) {
    const behind = headBlock - indexedBlock
    return (
      <div className="rounded-xl px-3 py-2 text-xs flex items-center gap-2" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
        <Clock size={12} className="shrink-0" />
        Indexing onchain history… {progress}% ({behind.toLocaleString()} blocks remaining)
        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
          <div className="h-full rounded-full" style={{ width: `${progress}%`, background: 'var(--accent)' }} />
        </div>
      </div>
    )
  }
  return null
}

// ─── EmptyState ──────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}>
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>{title}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{sub}</p>}
      </div>
    </div>
  )
}
