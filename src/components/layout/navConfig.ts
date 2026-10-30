/**
 * Vestros navigation configuration.
 * Each item maps to a route and an optional role gate.
 * Role gates are purely visual — server/onchain checks remain in each feature.
 */

export type NavRole = 'public' | 'connected' | 'beneficiary' | 'owner' | 'reviewer'

export interface NavItem {
  id: string
  label: string
  to: string
  icon: string          // lucide icon name — resolved in Sidebar
  roles: NavRole[]      // who sees this item (union — show if any role matches)
  exact?: boolean       // highlight only on exact route match
  badge?: string        // optional static badge text e.g. 'New'
  disabled?: boolean
}

export interface NavGroup {
  id: string
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { id: 'overview',  label: 'Overview',   to: '/',        icon: 'LayoutDashboard', roles: ['public'], exact: true },
      { id: 'activity',  label: 'Activity',   to: '/activity', icon: 'Activity',       roles: ['connected'] },
    ],
  },
  {
    id: 'vesting',
    label: 'Vesting',
    items: [
      { id: 'my-vesting',    label: 'My Vesting',      to: '/vesting',         icon: 'Coins',     roles: ['connected'] },
      { id: 'create-vest',   label: 'Create Vesting',  to: '/vesting/create',  icon: 'PlusCircle', roles: ['owner'] },
      { id: 'bulk-vest',     label: 'Bulk Vesting',    to: '/vesting/bulk',    icon: 'Layers',    roles: ['owner'] },
      { id: 'timeline',      label: 'Timeline',        to: '/vesting/timeline', icon: 'TrendingUp', roles: ['connected'] },
      { id: 'team',          label: 'Team Management', to: '/vesting/team',    icon: 'Users',     roles: ['owner'] },
    ],
  },
  {
    id: 'granthub',
    label: 'GrantHub',
    items: [
      { id: 'explore-grants',  label: 'Explore Grants',    to: '/granthub',           icon: 'Telescope',  roles: ['public'] },
      { id: 'my-applications', label: 'My Applications',   to: '/granthub/my',        icon: 'FileText',   roles: ['connected'] },
      { id: 'my-grants',       label: 'My Awards',         to: '/granthub/my',        icon: 'Award',      roles: ['connected'] },
      { id: 'create-grant',    label: 'Create Program',    to: '/granthub/grants/new', icon: 'FolderPlus', roles: ['owner'] },
    ],
  },
  {
    id: 'organization',
    label: 'Organization',
    items: [
      { id: 'org-overview',  label: 'Overview',       to: '/granthub/dashboard',  icon: 'Building2',  roles: ['connected'] },
      { id: 'org-grants',    label: 'Grant Programs', to: '/granthub/dashboard',  icon: 'BookOpen',   roles: ['connected'] },
      { id: 'org-apps',      label: 'Applications',   to: '/granthub/dashboard',  icon: 'Inbox',      roles: ['connected'] },
      { id: 'review-queue',  label: 'Review Queue',   to: '/granthub/dashboard',  icon: 'ClipboardList', roles: ['reviewer', 'owner'] },
      { id: 'org-awards',    label: 'Award Management', to: '/granthub/dashboard', icon: 'Trophy',    roles: ['owner'] },
    ],
  },
  {
    id: 'financial',
    label: 'Financial Tools',
    items: [
      { id: 'treasury',  label: 'Treasury',   to: '/treasury',   icon: 'Vault',      roles: ['owner'] },
      { id: 'analytics', label: 'Analytics',  to: '/analytics',  icon: 'BarChart3',  roles: ['owner'], disabled: true },
      { id: 'reports',   label: 'Reports',    to: '/reports',    icon: 'FileBarChart', roles: ['owner'], disabled: true },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    items: [
      { id: 'settings', label: 'Settings',        to: '/settings', icon: 'Settings',   roles: ['connected'], disabled: true },
      { id: 'help',     label: 'Help & Docs',      to: '/help',     icon: 'HelpCircle', roles: ['public'],    disabled: true },
    ],
  },
]

/** Page title map for the topbar */
export const PAGE_TITLES: Record<string, string> = {
  '/':                    'Overview',
  '/activity':            'Activity',
  '/vesting':             'My Vesting',
  '/vesting/create':      'Create Vesting',
  '/vesting/bulk':        'Bulk Vesting',
  '/vesting/timeline':    'Vesting Timeline',
  '/vesting/team':        'Team Management',
  '/treasury':            'Treasury',
  '/granthub':            'Explore Grants',
  '/granthub/my':         'My Grants',
  '/granthub/dashboard':  'Organization Dashboard',
  '/granthub/grants/new': 'Create Grant Program',
  '/granthub/orgs/new':   'Create Organization',
}
