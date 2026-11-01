import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

const COLLAPSE_KEY = 'vestros-sidebar-collapsed'
const TABLET_BREAKPOINT = 1280

interface AppShellProps {
  children: ReactNode
  onRefresh?: () => void
}

export function AppShell({ children, onRefresh }: AppShellProps) {
  const location = useLocation()

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(COLLAPSE_KEY)
      if (stored !== null) return stored === '1'
    } catch { /* ignore */ }
    return typeof window !== 'undefined' && window.innerWidth < TABLET_BREAKPOINT
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const wasMobileOpenRef = useRef(false)

  const toggleCollapse = useCallback(() => setCollapsed(v => !v), [])
  const toggleMobile   = useCallback(() => setMobileOpen(v => !v), [])
  const closeMobile    = useCallback(() => setMobileOpen(false), [])

  // Persist collapse preference
  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed])

  // Track the previous pathname in a ref, only touched inside an effect
  const prevPathRef = useRef(location.pathname)
  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      prevPathRef.current = location.pathname
      closeMobile()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // Escape key closes mobile drawer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMobile() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [closeMobile])

  useEffect(() => {
    if (wasMobileOpenRef.current && !mobileOpen) menuButtonRef.current?.focus()
    wasMobileOpenRef.current = mobileOpen
  }, [mobileOpen])

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* ── Desktop sidebar ────────────────────────────────────────────────── */}
      <div className="hidden lg:flex h-full overflow-visible shrink-0">
        <Sidebar key={`${location.pathname}${location.search}`} collapsed={collapsed} onToggle={toggleCollapse} />
      </div>

      {/* ── Mobile sidebar backdrop ────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile sidebar drawer ──────────────────────────────────────────── */}
      <div
        className="fixed top-0 left-0 h-full z-50 lg:hidden"
        style={{
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 220ms cubic-bezier(0.4,0,0.2,1)',
          width: 256,
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        <Sidebar key={`mobile-${location.pathname}${location.search}`} collapsed={false} onToggle={closeMobile} onNavigate={closeMobile} mobile mobileOpen={mobileOpen} />
      </div>

      {/* ── Right panel: topbar + main ─────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar
          onMenuClick={toggleMobile}
          showMenu={true}
          onRefresh={onRefresh}
          menuButtonRef={menuButtonRef}
        />
        <main
          className="flex-1 overflow-y-auto overflow-x-hidden"
          id="main-content"
          style={{ background: 'var(--bg)' }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
