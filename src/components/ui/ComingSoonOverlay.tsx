import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { LockKeyhole } from 'lucide-react'

const DEFAULT_DESCRIPTION = 'This section is still being completed and is not yet available end-to-end.'
const DEFAULT_SECONDARY = 'Available in a future update.'

export interface ComingSoonOverlayProps {
  children: ReactNode
  locked?: boolean
  dismissible?: boolean
  description?: string
  secondaryText?: string
  className?: string
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ))
}

/**
 * Presents unfinished content as a visible preview while keeping its controls
 * unavailable until the user dismisses the notice.
 */
export function ComingSoonOverlay({
  children,
  locked = true,
  dismissible = true,
  description = DEFAULT_DESCRIPTION,
  secondaryText = DEFAULT_SECONDARY,
  className = '',
}: ComingSoonOverlayProps) {
  const [dismissed, setDismissed] = useState(false)
  const open = locked && !dismissed
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (dismissible) {
          event.preventDefault()
          setDismissed(true)
        }
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return

      const focusable = focusableElements(dialogRef.current)
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === dialogRef.current || document.activeElement === first)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === dialogRef.current || document.activeElement === last)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused.current?.focus()
      previouslyFocused.current = null
    }
  }, [dismissible, open])

  if (!locked || !open) return <>{children}</>

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (dismissible && event.target === event.currentTarget) setDismissed(true)
  }

  return (
    <div className={`relative isolate ${className}`}>
      <div
        aria-hidden="true"
        className="pointer-events-none select-none blur-[1.5px] opacity-45"
      >
        {children}
      </div>

      <div
        className="absolute inset-0 z-20 flex items-center justify-center p-4"
        role="presentation"
        onMouseDown={handleBackdropMouseDown}
        style={{ background: 'rgba(11,13,16,0.48)', backdropFilter: 'blur(2px)' }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          className="w-full max-w-sm p-5 shadow-2xl outline-none"
          onMouseDown={event => event.stopPropagation()}
          style={{
            background: 'var(--surface-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-modal)',
            boxShadow: '0 18px 45px rgba(0,0,0,0.38)',
          }}
        >
          <div className="flex items-start gap-3">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center"
              style={{ background: 'var(--surface-muted)', color: 'var(--muted)', borderRadius: 'var(--radius-control)' }}
            >
              <LockKeyhole size={15} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id={titleId} className="display text-base font-semibold" style={{ color: 'var(--ink)' }}>
                Coming soon
              </h2>
              <p id={descriptionId} className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                {description}
              </p>
              {secondaryText && <p className="mt-2 text-[11px]" style={{ color: 'var(--subtle)' }}>{secondaryText}</p>}
            </div>
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="mt-5 w-full px-3 py-2 text-xs font-semibold transition-colors"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)', borderRadius: 'var(--radius-control)' }}
            >
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
