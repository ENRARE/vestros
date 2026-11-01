import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useDisconnect, useReadContract } from 'wagmi'
import {
  Activity, Award, BarChart3, BookOpen, Building2, ChevronDown, ChevronLeft,
  ChevronRight, ClipboardList, Coins, FileBarChart, FileText, FolderPlus,
  HelpCircle, Inbox, Layers, LayoutDashboard, Lock, LogOut, Network,
  PlusCircle, Search, Settings, Telescope, TrendingUp, Trophy, Users, Vault,
  Wifi, WifiOff, X,
} from 'lucide-react'
import { CONTRACT } from '@/contractConfig'
import { fmtAddr } from '@/formatters'
import { ACTIVE_ARC_CHAIN } from '@/arcChains'
import { NAV_GROUPS, type NavGroup, type NavItem, type NavRole } from './navConfig'
import { activeNavGroupId, activeNavItemId, navTarget, searchNavGroups, visibleNavGroups } from './sidebar-utils'
import { ProfileAvatar } from '@/components/profile/ProfileAvatar'
import { useProfilePreferences } from '@/features/profile/ProfilePreferences'
import type { LucideIcon } from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  Activity, Award, BarChart3, BookOpen, Building2, ClipboardList, Coins,
  FileBarChart, FileText, FolderPlus, HelpCircle, Inbox, Layers, LayoutDashboard,
  PlusCircle, Settings, Telescope, TrendingUp, Trophy, Users, Vault,
}

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  onNavigate?: () => void
  mobile?: boolean
  mobileOpen?: boolean
}

interface FlyoutState {
  groupId: string
  top: number
}

function useRoles(): Set<NavRole> {
  const { address, isConnected } = useAccount()
  const { data: ownerAddr } = useReadContract({ ...CONTRACT, functionName: 'owner' })
  const roles = new Set<NavRole>(['public'])
  if (isConnected) {
    roles.add('connected')
    roles.add('beneficiary')
  }
  if (address && ownerAddr && address.toLowerCase() === (ownerAddr as string).toLowerCase()) {
    roles.add('owner')
  }
  return roles
}

function NavItemRow({
  item,
  active,
  onNavigate,
  compact = false,
}: {
  item: NavItem
  active: boolean
  onNavigate: () => void
  compact?: boolean
}) {
  const Icon = ICON_MAP[item.icon] ?? Coins
  const target = navTarget(item)

  if (item.disabled) {
    return (
      <div className="sidebar-nav-item sidebar-nav-item-disabled" aria-disabled="true">
        <Icon size={16} strokeWidth={1.8} />
        {!compact && <span className="truncate">{item.label}</span>}
      </div>
    )
  }

  return (
    <Link
      to={target}
      onClick={onNavigate}
      className={`sidebar-nav-item${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      title={compact ? item.label : undefined}
    >
      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
      {!compact && <span className="truncate">{item.label}</span>}
      {!compact && item.badge && <span className="sidebar-nav-badge">{item.badge}</span>}
    </Link>
  )
}

function GroupIcon({ group }: { group: NavGroup }) {
  const Icon = ICON_MAP[group.icon] ?? LayoutDashboard
  return <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
}

function AccountMenu({
  address,
  isConnected,
  collapsed,
  onNavigate,
}: {
  address?: `0x${string}`
  isConnected: boolean
  collapsed: boolean
  onNavigate: () => void
}) {
  const { disconnect } = useDisconnect()
  const { avatarId } = useProfilePreferences()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleSettings = () => {
    setOpen(false)
    onNavigate()
    void navigate('/settings')
  }

  const handleDisconnect = () => {
    setOpen(false)
    disconnect()
  }

  if (!isConnected || !address) {
    return (
      <ConnectKitButton.Custom>
        {({ show }) => (
          <button
            type="button"
            onClick={() => show?.()}
            className="sidebar-connect-button"
            title="Connect wallet"
          >
            <WifiOff size={15} strokeWidth={1.8} />
            {!collapsed && <span>Connect wallet</span>}
          </button>
        )}
      </ConnectKitButton.Custom>
    )
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        className={`sidebar-account-trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={collapsed ? `Wallet ${fmtAddr(address)}` : undefined}
      >
        <ProfileAvatar avatarId={avatarId} size={26} className="sidebar-avatar" />
        {!collapsed && (
          <span className="min-w-0 flex-1 text-left">
            <span className="sidebar-account-name">Connected wallet</span>
            <span className="sidebar-account-address mono">{fmtAddr(address)}</span>
          </span>
        )}
        {!collapsed && <ChevronDown size={14} className={open ? 'rotate-180' : ''} />}
      </button>

      {open && (
        <div className="sidebar-account-menu" role="menu" aria-label="Wallet account menu">
          <div className="sidebar-account-summary">
            <ProfileAvatar avatarId={avatarId} size={30} className="sidebar-avatar large" />
            <div className="min-w-0">
              <p className="sidebar-menu-eyebrow">Wallet account</p>
              <p className="mono sidebar-menu-address truncate">{address}</p>
            </div>
          </div>
          <div className="sidebar-menu-divider" />
          <div className="sidebar-network-row">
            <Network size={14} />
            <span>{ACTIVE_ARC_CHAIN.name}</span>
            <span className="sidebar-network-dot" />
          </div>
          <button type="button" className="sidebar-menu-action" role="menuitem" onClick={handleSettings}>
            <Settings size={14} />
            <span>Account settings</span>
          </button>
          <button type="button" className="sidebar-menu-action danger" role="menuitem" onClick={handleDisconnect}>
            <LogOut size={14} />
            <span>Disconnect wallet</span>
          </button>
        </div>
      )}
    </div>
  )
}

export function Sidebar({ collapsed, onToggle, onNavigate, mobile = false, mobileOpen = false }: SidebarProps) {
  const location = useLocation()
  const { address, isConnected } = useAccount()
  const roles = useRoles()
  const sidebarRef = useRef<HTMLElement>(null)
  const mobileCloseRef = useRef<HTMLButtonElement>(null)
  const visibleGroups = useMemo(() => visibleNavGroups(NAV_GROUPS, roles), [roles])
  const activeGroupId = activeNavGroupId(visibleGroups, location.pathname, location.search)
  const activeItemId = activeNavItemId(visibleGroups, location.pathname, location.search)
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(() => activeGroupId ?? visibleGroups[0]?.id ?? null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [flyout, setFlyout] = useState<FlyoutState | null>(null)

  useEffect(() => {
    if (mobile && mobileOpen) mobileCloseRef.current?.focus()
  }, [mobile, mobileOpen])

  useEffect(() => {
    if (!flyout && !searchOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!sidebarRef.current?.contains(event.target as Node)) {
        setFlyout(null)
        setSearchOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFlyout(null)
        setSearchOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [flyout, searchOpen])

  const searchedGroups = useMemo(() => searchNavGroups(visibleGroups, searchQuery), [visibleGroups, searchQuery])
  const handleNavigate = () => {
    setFlyout(null)
    setSearchOpen(false)
    onNavigate?.()
  }

  const toggleGroup = (group: NavGroup, event?: ReactMouseEvent<HTMLButtonElement>) => {
    if (collapsed) {
      const rect = event?.currentTarget.getBoundingClientRect()
      setFlyout(current => current?.groupId === group.id ? null : {
        groupId: group.id,
        top: Math.min(Math.max(12, rect?.top ?? 12), window.innerHeight - 220),
      })
      return
    }
    setExpandedGroupId(current => current === group.id ? null : group.id)
  }

  const renderGroupItems = (group: NavGroup, compact = false) => (
    <div className={compact ? 'sidebar-flyout-items' : 'sidebar-subnav'}>
      {group.items.map(item => (
        <NavItemRow
          key={item.id}
          item={item}
          compact={compact}
          active={activeItemId === item.id}
          onNavigate={handleNavigate}
        />
      ))}
    </div>
  )

  const flyoutGroup = flyout ? visibleGroups.find(group => group.id === flyout.groupId) : undefined

  return (
    <aside
      ref={sidebarRef}
      className={`sidebar-shell${collapsed ? ' is-collapsed' : ''}${mobile ? ' is-mobile' : ''}`}
      style={{ width: collapsed ? 68 : 260, minWidth: collapsed ? 68 : 260 }}
    >
      <div className="sidebar-brand-row">
        <Link to="/app" onClick={handleNavigate} className="sidebar-brand" aria-label="Vestros overview">
          <span className="sidebar-brand-mark"><Lock size={16} strokeWidth={2.1} /></span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="sidebar-wordmark display">Vestros</span>
              <span className="sidebar-subtitle">USDC Infrastructure</span>
            </span>
          )}
        </Link>
        <button
          ref={mobile ? mobileCloseRef : undefined}
          type="button"
          onClick={onToggle}
          className="sidebar-icon-button"
          aria-label={mobile ? 'Close navigation' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={mobile ? 'Close navigation' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {mobile ? <X size={16} /> : collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <div className="sidebar-search-wrap">
        {collapsed ? (
          <button
            type="button"
            className="sidebar-search-button"
            onClick={() => setSearchOpen(value => !value)}
            aria-label="Search navigation"
            aria-expanded={searchOpen}
            title="Search navigation"
          >
            <Search size={16} />
          </button>
        ) : (
          <label className="sidebar-search-field">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search navigation"
              aria-label="Search navigation"
            />
            {searchQuery && (
              <button type="button" className="sidebar-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear navigation search">
                <X size={13} />
              </button>
            )}
          </label>
        )}
      </div>

      <nav className="sidebar-scroll" aria-label="Main navigation">
        {searchQuery && !collapsed ? (
          <div className="sidebar-search-results" aria-live="polite">
            <p className="sidebar-section-label">Search results</p>
            {searchedGroups.length === 0 ? (
              <p className="sidebar-empty-search">No matching pages</p>
            ) : searchedGroups.map(group => (
              <div key={group.id} className="sidebar-search-group">
                <p className="sidebar-search-group-label">{group.label}</p>
                {renderGroupItems(group)}
              </div>
            ))}
          </div>
        ) : (
          visibleGroups.map(group => {
            const groupActive = group.id === activeGroupId
            const expanded = expandedGroupId === group.id
            return (
              <div key={group.id} className="sidebar-group">
                <button
                  type="button"
                  className={`sidebar-group-trigger${collapsed && groupActive ? ' is-current-group' : ''}${!collapsed && expanded ? ' is-open' : ''}`}
                  onClick={event => toggleGroup(group, event)}
                  aria-expanded={collapsed ? undefined : expanded}
                  aria-label={collapsed ? group.label : undefined}
                  title={collapsed ? group.label : undefined}
                >
                  <GroupIcon group={group} />
                  {!collapsed && <span className="truncate flex-1 text-left">{group.label}</span>}
                  {!collapsed && <ChevronDown size={14} className={`sidebar-chevron${expanded ? ' is-open' : ''}`} />}
                </button>
                {!collapsed && expanded && renderGroupItems(group)}
              </div>
            )
          })
        )}
      </nav>

      {collapsed && searchOpen && (
        <div className="sidebar-floating-panel sidebar-search-panel" role="dialog" aria-label="Search navigation">
          <label className="sidebar-search-field floating">
            <Search size={15} aria-hidden="true" />
            <input
              autoFocus
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search navigation"
              aria-label="Search navigation"
            />
            <button type="button" className="sidebar-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear navigation search">
              <X size={13} />
            </button>
          </label>
          <div className="sidebar-floating-results">
            {searchedGroups.length === 0 ? (
              <p className="sidebar-empty-search">No matching pages</p>
            ) : searchedGroups.map(group => (
              <div key={group.id} className="sidebar-search-group">
                <p className="sidebar-search-group-label">{group.label}</p>
                {group.items.map(item => (
                  <NavItemRow
                    key={item.id}
                    item={item}
                    active={activeItemId === item.id}
                    onNavigate={handleNavigate}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {collapsed && flyoutGroup && flyout && (
        <div
          className="sidebar-floating-panel sidebar-group-flyout"
          style={{ top: flyout.top, left: 76 }}
          role="dialog"
          aria-label={`${flyoutGroup.label} navigation`}
        >
          <p className="sidebar-flyout-title">{flyoutGroup.label}</p>
          {renderGroupItems(flyoutGroup, true)}
        </div>
      )}

      <div className="sidebar-footer">
        <div className="sidebar-network-status" title={isConnected ? `Connected to ${ACTIVE_ARC_CHAIN.name}` : 'Wallet not connected'}>
          {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
          {!collapsed && <span>{isConnected ? ACTIVE_ARC_CHAIN.name : 'Not connected'}</span>}
          {isConnected && <span className="sidebar-network-dot" />}
        </div>
        <AccountMenu
          address={address}
          isConnected={isConnected}
          collapsed={collapsed}
          onNavigate={handleNavigate}
        />
      </div>
    </aside>
  )
}
