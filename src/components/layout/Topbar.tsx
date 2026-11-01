import { useEffect, useRef, useState, type RefObject } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, LogOut, Menu, RefreshCw, WalletCards } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { useDisconnect } from 'wagmi'
import { PAGE_TITLES } from './navConfig'
import { ACTIVE_ARC_CHAIN } from '@/arcChains'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { workspacePathname } from '@/appRoutes'
import { ProfileAvatar } from '@/components/profile/ProfileAvatar'
import { useProfilePreferences } from '@/features/profile/ProfilePreferences'

interface TopbarProps {
  onMenuClick: () => void
  showMenu: boolean
  onRefresh?: () => void
  menuButtonRef?: RefObject<HTMLButtonElement>
}

function getBreadcrumb(pathname: string): { label: string; to?: string }[] {
  const segments = workspacePathname(pathname).split('/').filter(Boolean)
  if (segments.length === 0) return [{ label: 'Overview' }]

  const crumbs: { label: string; to?: string }[] = []

  if (segments[0] === 'granthub') {
    crumbs.push({ label: 'GrantHub', to: '/granthub' })
    if (segments[1] === 'grants' && segments[2]) {
      crumbs.push({ label: segments[2] === 'new' ? 'Create Program' : 'Grant Detail' })
    } else if (segments[1] === 'orgs' && segments[2]) {
      crumbs.push({ label: segments[2] === 'new' ? 'Create Organisation' : 'Organisation' })
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
  } else if (segments[0] === 'activity') {
    crumbs.push({ label: 'Activity' })
  } else if (segments[0] === 'analytics') {
    crumbs.push({ label: 'Analytics' })
  } else if (segments[0] === 'reports') {
    crumbs.push({ label: 'Reports' })
  } else if (segments[0] === 'settings') {
    crumbs.push({ label: 'Settings' })
  } else if (segments[0] === 'help') {
    crumbs.push({ label: 'Help & Documentation' })
  }

  return crumbs
}

function WalletControl() {
  const { disconnect } = useDisconnect()
  const { avatarId } = useProfilePreferences()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <ConnectKitButton.Custom>
      {({ show, isConnected, address, truncatedAddress, chain, unsupported }) => {
        if (!isConnected || !address) {
          return (
            <button type="button" className="topbar-wallet-control" onClick={() => show?.()}>
              <WalletCards size={15} />
              <span>Connect wallet</span>
            </button>
          )
        }

        const shortAddress = truncatedAddress ?? `${address.slice(0, 6)}…${address.slice(-4)}`
        const networkName = unsupported ? 'Unsupported network' : (chain?.name ?? ACTIVE_ARC_CHAIN.name)

        const copyAddress = async () => {
          await navigator.clipboard?.writeText(address)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        }

        return (
          <div ref={menuRef} className="topbar-wallet-wrap">
            <button
              type="button"
              className={`topbar-wallet-control${open ? ' is-open' : ''}`}
              onClick={() => setOpen(value => !value)}
              aria-haspopup="menu"
              aria-expanded={open}
            >
              <ProfileAvatar avatarId={avatarId} size={20} className="topbar-wallet-avatar" />
              <span className="topbar-wallet-address mono">{shortAddress}</span>
              <ChevronDown size={14} className={open ? 'rotate-180' : ''} />
            </button>

            {open && (
              <div className="topbar-wallet-menu" role="menu" aria-label="Wallet account menu">
                <div className="topbar-wallet-summary">
                  <ProfileAvatar avatarId={avatarId} size={30} className="topbar-wallet-avatar large" />
                  <div className="min-w-0">
                    <span className="topbar-wallet-eyebrow">Connected wallet</span>
                    <span className="topbar-wallet-full mono">{address}</span>
                  </div>
                </div>
                <div className="topbar-wallet-divider" />
                <div className={`topbar-wallet-network${unsupported ? ' is-warning' : ''}`}>
                  <span className="topbar-wallet-network-dot" />
                  <span>{networkName}</span>
                  <span className="topbar-wallet-network-state">{unsupported ? 'Switch network' : 'Connected'}</span>
                </div>
                <button type="button" className="topbar-wallet-action" role="menuitem" onClick={() => void copyAddress()}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copied ? 'Copied' : 'Copy address'}</span>
                </button>
                <a
                  className="topbar-wallet-action"
                  role="menuitem"
                  href={buildAddressExplorerUrl(ACTIVE_ARC_CHAIN.id, address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                >
                  <ExternalLink size={14} />
                  <span>View on explorer</span>
                </a>
                <button type="button" className="topbar-wallet-action danger" role="menuitem" onClick={() => { setOpen(false); disconnect() }}>
                  <LogOut size={14} />
                  <span>Disconnect wallet</span>
                </button>
              </div>
            )}
          </div>
        )
      }}
    </ConnectKitButton.Custom>
  )
}

export function Topbar({ onMenuClick, showMenu, onRefresh, menuButtonRef }: TopbarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const title = PAGE_TITLES[location.pathname] ?? PAGE_TITLES[workspacePathname(location.pathname)] ?? 'Vestros'
  const crumbs = getBreadcrumb(location.pathname)
  const isHome = workspacePathname(location.pathname) === '/'

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
          ref={menuButtonRef}
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
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: 'var(--surface-muted)', color: 'var(--accent)', border: '1px solid var(--accent-dim)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
          {ACTIVE_ARC_CHAIN.name}
        </div>

        <WalletControl />
      </div>
    </header>
  )
}
