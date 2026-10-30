import { useLocation, Link } from 'react-router-dom'
import { useAccount, useReadContract } from 'wagmi'
import {
  LayoutDashboard, Activity, Coins, PlusCircle, Layers, TrendingUp, Users,
  Telescope, FileText, Award, FolderPlus, Building2, BookOpen, Inbox,
  ClipboardList, Trophy, Vault, BarChart3, FileBarChart, Settings, HelpCircle,
  ChevronLeft, ChevronRight, Lock, Wifi, WifiOff,
} from 'lucide-react'
import { CONTRACT } from '@/contractConfig'
import { fmtAddr } from '@/formatters'
import { NAV_GROUPS, type NavItem, type NavRole } from './navConfig'
import type { LucideIcon } from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard, Activity, Coins, PlusCircle, Layers, TrendingUp, Users,
  Telescope, FileText, Award, FolderPlus, Building2, BookOpen, Inbox,
  ClipboardList, Trophy, Vault, BarChart3, FileBarChart, Settings, HelpCircle,
}

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  onNavigate?: () => void
}

function useRoles(): Set<NavRole> {
  const { address, isConnected } = useAccount()
  const { data: ownerAddr } = useReadContract({ ...CONTRACT, functionName: 'owner' })
  const roles = new Set<NavRole>(['public'])
  if (isConnected) {
    roles.add('connected')
    roles.add('beneficiary')
    roles.add('reviewer')
  }
  if (address && ownerAddr && address.toLowerCase() === (ownerAddr as string).toLowerCase()) {
    roles.add('owner')
  }
  return roles
}

function NavItemRow({ item, collapsed, active, onNavigate }: {
  item: NavItem; collapsed: boolean; active: boolean; onNavigate?: () => void
}) {
  const Icon = ICON_MAP[item.icon] ?? Coins

  const inner = (
    <span
      className="nav-item-transition flex items-center gap-3 rounded-lg px-2.5 py-2 w-full relative"
      style={{
        background: active ? 'var(--sidebar-active)' : undefined,
        color: active ? 'var(--sidebar-active-text)' : item.disabled ? 'var(--subtle)' : 'var(--muted)',
        cursor: item.disabled ? 'not-allowed' : 'pointer',
        opacity: item.disabled ? 0.5 : 1,
      }}
      title={collapsed ? item.label : undefined}
    >
      <Icon size={18} strokeWidth={1.75} style={{ flexShrink: 0 }} />
      {!collapsed && (
        <span className="text-[13px] font-medium truncate flex-1">{item.label}</span>
      )}
      {!collapsed && active && (
        <span
          className="absolute right-2.5 w-1.5 h-1.5 rounded-full"
          style={{ background: 'var(--accent)' }}
        />
      )}
      {!collapsed && item.badge && !item.disabled && (
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
        >
          {item.badge}
        </span>
      )}
    </span>
  )

  if (item.disabled) {
    return <div className="px-2">{inner}</div>
  }

  return (
    <Link to={item.to} onClick={onNavigate} className="block px-2 hover:no-underline" style={{ textDecoration: 'none' }}>
      <span
        className="nav-item-transition flex items-center gap-3 rounded-lg px-2.5 py-2 w-full relative"
        onMouseEnter={e => { if (!active) (e.currentTarget).style.background = 'var(--sidebar-hover)' }}
        onMouseLeave={e => { if (!active) (e.currentTarget).style.background = '' }}
        style={{
          background: active ? 'var(--sidebar-active)' : undefined,
          color: active ? 'var(--sidebar-active-text)' : 'var(--muted)',
        }}
        title={collapsed ? item.label : undefined}
      >
        <Icon size={18} strokeWidth={1.75} style={{ flexShrink: 0 }} />
        {!collapsed && (
          <span className="text-[13px] font-medium truncate flex-1">{item.label}</span>
        )}
        {!collapsed && active && (
          <span className="absolute right-2.5 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
        )}
        {!collapsed && item.badge && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
            {item.badge}
          </span>
        )}
      </span>
    </Link>
  )
}

export function Sidebar({ collapsed, onToggle, onNavigate }: SidebarProps) {
  const location = useLocation()
  const { address, isConnected } = useAccount()
  const roles = useRoles()

  const isActive = (item: NavItem) => {
    if (item.exact) return location.pathname === item.to
    return location.pathname === item.to || location.pathname.startsWith(item.to + '/')
  }

  const isVisible = (item: NavItem) => item.roles.some(r => roles.has(r))

  return (
    <aside
      className="sidebar-transition flex flex-col h-full"
      style={{
        background: 'var(--sidebar)',
        borderRight: '1px solid var(--sidebar-border)',
        width: collapsed ? 68 : 256,
        minWidth: collapsed ? 68 : 256,
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center shrink-0 px-3 py-4"
        style={{
          borderBottom: '1px solid var(--sidebar-border)',
          height: 64,
          justifyContent: collapsed ? 'center' : 'space-between',
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="flex items-center justify-center rounded-xl shrink-0"
            style={{ width: 34, height: 34, background: 'var(--accent-dim)', border: '1px solid var(--accent)' }}
          >
            <Lock size={16} style={{ color: 'var(--accent)' }} strokeWidth={2} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <span className="display text-[15px] font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
                Vestros
              </span>
              <div className="text-[10px] font-medium" style={{ color: 'var(--subtle)' }}>
                Arc Testnet
              </div>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={onToggle}
            className="flex items-center justify-center rounded-lg p-1.5 nav-item-transition shrink-0"
            style={{ color: 'var(--subtle)', background: 'transparent' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--sidebar-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            aria-label="Collapse sidebar"
          >
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      {/* Collapsed toggle */}
      {collapsed && (
        <button
          onClick={onToggle}
          className="flex items-center justify-center mx-auto mt-2 mb-1 rounded-lg p-1.5 nav-item-transition"
          style={{ width: 36, color: 'var(--subtle)', background: 'transparent' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--sidebar-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          aria-label="Expand sidebar"
        >
          <ChevronRight size={16} />
        </button>
      )}

      {/* Nav groups */}
      <nav className="sidebar-scroll py-2" aria-label="Main navigation">
        {NAV_GROUPS.map(group => {
          const visible = group.items.filter(isVisible)
          if (visible.length === 0) return null
          return (
            <div key={group.id} className="mb-1">
              {!collapsed && (
                <div
                  className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
                  style={{ color: 'var(--subtle)' }}
                >
                  {group.label}
                </div>
              )}
              {collapsed && (
                <div className="mx-3 mb-1 mt-2" style={{ height: 1, background: 'var(--sidebar-border)' }} />
              )}
              {visible.map(item => (
                <NavItemRow
                  key={item.id}
                  item={item}
                  collapsed={collapsed}
                  active={isActive(item)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div
        className="shrink-0 px-3 py-3 flex flex-col gap-1"
        style={{ borderTop: '1px solid var(--sidebar-border)' }}
      >
        {/* Network status */}
        <div
          className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
          style={{ color: isConnected ? 'var(--success)' : 'var(--subtle)' }}
          title={isConnected ? 'Connected to Arc Testnet' : 'Not connected'}
        >
          {isConnected
            ? <Wifi size={14} strokeWidth={2} />
            : <WifiOff size={14} strokeWidth={2} />
          }
          {!collapsed && (
            <span className="text-[12px] font-medium truncate">
              {isConnected ? 'Arc Testnet' : 'Not connected'}
            </span>
          )}
        </div>
        {/* Address */}
        {isConnected && address && !collapsed && (
          <div
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
            style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
          >
            <div
              className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
            >
              {address.slice(2, 4).toUpperCase()}
            </div>
            <span className="mono text-[11px] truncate">{fmtAddr(address)}</span>
          </div>
        )}
      </div>
    </aside>
  )
}
