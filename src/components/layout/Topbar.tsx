import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight, Menu, RefreshCw } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { PAGE_TITLES } from './navConfig'

interface TopbarProps {
  onMenuClick: () => void
  showMenu: boolean
  onRefresh?: () => void
}

function getBreadcrumb(pathname: string): { label: string; to?: string }[] {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return [{ label: 'Overview' }]

  const crumbs: { label: string; to?: string }[] = []

  if (segments[0] === 'granthub') {
    crumbs.push({ label: 'GrantHub', to: '/granthub' })
    if (segments[1] === 'grants' && segments[2]) {
      crumbs.push({ label: segments[2] === 'new' ? 'Create Program' : 'Grant Detail' })
    } else if (segments[1] === 'orgs' && segments[2]) {
      crumbs.push({ label: segments[2] === 'new' ? 'Create Organization' : 'Organization' })
    } else if (segments[1] === 'apply') {
      crumbs.push({ label: 'Apply' })
    } else if (segments[1] === 'review') {
      crumbs.push({ label: 'Review' })
    } else if (segments[1] === 'dashboard') {
      crumbs.push({ label: 'Dashboard' })
    } else if (segments[1] === 'my') {
      crumbs.push({ label: 'My Grants' })
    }
  } else if (segments[0] === 'vesting') {
    crumbs.push({ label: 'Vesting', to: '/vesting' })
    if (segments[1]) {
      const sub: Record<string, string> = { create: 'Create', bulk: 'Bulk Vesting', timeline: 'Timeline', team: 'Team' }
      crumbs.push({ label: sub[segments[1]] ?? segments[1] })
    }
  } else if (segments[0] === 'treasury') {
    crumbs.push({ label: 'Treasury' })
  }

  return crumbs
}

export function Topbar({ onMenuClick, showMenu, onRefresh }: TopbarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const title = PAGE_TITLES[location.pathname] ?? 'Vestros'
  const crumbs = getBreadcrumb(location.pathname)
  const isHome = location.pathname === '/'

  return (
    <header
      className="flex items-center px-4 gap-3 shrink-0 sticky top-0 z-30 backdrop-blur-sm"
      style={{
        height: 60,
        background: 'var(--topbar)',
        borderBottom: '1px solid var(--topbar-border)',
      }}
    >
      {/* Mobile menu button */}
      {showMenu && (
        <button
          onClick={onMenuClick}
          className="flex items-center justify-center rounded-lg p-2 nav-item-transition lg:hidden"
          style={{ color: 'var(--muted)', background: 'transparent' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-strong)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          aria-label="Open navigation"
        >
          <Menu size={18} />
        </button>
      )}

      {/* Title / breadcrumb */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {crumbs.length > 1 ? (
          <div className="flex items-center gap-1 text-sm min-w-0">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight size={12} style={{ color: 'var(--subtle)', flexShrink: 0 }} />}
                {c.to && i < crumbs.length - 1 ? (
                  <button
                    onClick={() => void navigate(c.to!)}
                    className="font-medium truncate hover:underline"
                    style={{ color: 'var(--muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  >
                    {c.label}
                  </button>
                ) : (
                  <span
                    className="font-semibold truncate display"
                    style={{ color: i === crumbs.length - 1 ? 'var(--ink)' : 'var(--muted)', fontSize: 14 }}
                  >
                    {c.label}
                  </span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <h1
            className="display font-bold truncate"
            style={{ fontSize: 15, color: 'var(--ink)', margin: 0 }}
          >
            {isHome ? 'Vestros' : title}
          </h1>
        )}
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2 shrink-0">
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="flex items-center justify-center rounded-lg p-2 nav-item-transition"
            style={{ color: 'var(--subtle)', background: 'transparent' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-strong)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw size={15} />
          </button>
        )}

        {/* Network pill */}
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
          style={{ background: 'var(--surface-muted)', color: 'var(--accent)', border: '1px solid var(--accent-dim)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
          Arc Testnet
        </div>

        <ConnectKitButton />
      </div>
    </header>
  )
}
