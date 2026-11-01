/**
 * Vestros navigation configuration.
 * Role gates are navigation hints only; page and server checks remain authoritative.
 */

export type NavRole = 'public' | 'connected' | 'beneficiary' | 'owner' | 'reviewer'

export interface NavItem {
  id: string
  label: string
  to: string
  icon: string
  roles: NavRole[]
  exact?: boolean
  activePaths?: string[]
  query?: string
  badge?: string
  disabled?: boolean
}

export interface NavGroup {
  id: string
  label: string
  icon: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    icon: 'LayoutDashboard',
    items: [
      { id: 'overview', label: 'Overview', to: '/app', icon: 'LayoutDashboard', roles: ['public'], exact: true },
      { id: 'activity', label: 'Activity', to: '/activity', icon: 'Activity', roles: ['connected'] },
    ],
  },
  {
    id: 'vesting',
    label: 'Vesting',
    icon: 'Coins',
    items: [
      // Keep core Vesting destinations discoverable before wallet connection.
      // Each page retains its own wallet/contract-owner guard.
      { id: 'my-vesting', label: 'My Vesting', to: '/vesting', icon: 'Coins', roles: ['public'] },
      { id: 'create-vest', label: 'Create Vesting', to: '/vesting/create', icon: 'PlusCircle', roles: ['public'] },
      { id: 'bulk-vest', label: 'Bulk Vesting', to: '/vesting/bulk', icon: 'Layers', roles: ['public'] },
      { id: 'timeline', label: 'Vesting Timeline', to: '/vesting/timeline', icon: 'TrendingUp', roles: ['public'] },
      { id: 'team', label: 'Team Management', to: '/vesting/team', icon: 'Users', roles: ['public'] },
    ],
  },
  {
    id: 'granthub',
    label: 'GrantHub',
    icon: 'Telescope',
    items: [
      {
        id: 'explore-grants', label: 'Explore Grants', to: '/granthub', icon: 'Telescope', roles: ['public'],
        activePaths: ['/granthub/grants/:id', '/granthub/orgs/:slug', '/granthub/apply/:grantId'],
      },
      { id: 'my-applications', label: 'My Applications', to: '/granthub/applications', icon: 'FileText', roles: ['connected'] },
      { id: 'my-grants', label: 'My Awards', to: '/granthub/awards', icon: 'Award', roles: ['connected'] },
      { id: 'create-grant', label: 'Create Grant Program', to: '/granthub/grants/new', icon: 'FolderPlus', roles: ['connected'] },
    ],
  },
  {
    id: 'organization',
    label: 'Organisation',
    icon: 'Building2',
    items: [
      { id: 'org-overview', label: 'Organisation Overview', to: '/granthub/dashboard', query: 'overview', icon: 'Building2', roles: ['connected'] },
      { id: 'org-grants', label: 'Grant Programs', to: '/granthub/dashboard', query: 'grants', icon: 'BookOpen', roles: ['connected'] },
      { id: 'org-apps', label: 'Applications', to: '/granthub/dashboard', query: 'applications', icon: 'Inbox', roles: ['connected'] },
      {
        id: 'review-queue', label: 'Review Queue', to: '/granthub/dashboard', query: 'review', icon: 'ClipboardList', roles: ['connected'],
        activePaths: ['/granthub/review/:id'],
      },
      { id: 'funding', label: 'Funding & Sponsors', to: '/granthub/funding', icon: 'Coins', roles: ['connected'] },
      { id: 'org-awards', label: 'Award Management', to: '/granthub/dashboard', query: 'awards', icon: 'Trophy', roles: ['connected'] },
    ],
  },
  {
    id: 'financial',
    label: 'Financial Tools',
    icon: 'Vault',
    items: [
      { id: 'treasury', label: 'Treasury', to: '/treasury', icon: 'Vault', roles: ['owner'] },
      { id: 'analytics', label: 'Analytics', to: '/analytics', icon: 'BarChart3', roles: ['owner'] },
      { id: 'reports', label: 'Reports', to: '/reports', icon: 'FileBarChart', roles: ['connected'] },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    icon: 'Settings',
    items: [
      { id: 'settings', label: 'Settings', to: '/settings', icon: 'Settings', roles: ['connected'] },
      { id: 'help', label: 'Help & Documentation', to: '/help', icon: 'HelpCircle', roles: ['public'] },
    ],
  },
]

export const PAGE_TITLES: Record<string, string> = {
  '/': 'Overview',
  '/activity': 'Activity',
  '/vesting': 'My Vesting',
  '/vesting/create': 'Create Vesting',
  '/vesting/bulk': 'Bulk Vesting',
  '/vesting/timeline': 'Vesting Timeline',
  '/vesting/team': 'Team Management',
  '/treasury': 'Treasury',
  '/analytics': 'Analytics',
  '/reports': 'Reports',
  '/settings': 'Settings',
  '/help': 'Help & Documentation',
  '/granthub': 'Explore Grants',
  '/granthub/my': 'My Grants',
  '/granthub/applications': 'My Applications',
  '/granthub/awards': 'My Awards',
  '/granthub/dashboard': 'Organisation Dashboard',
  '/granthub/funding': 'Funding & Sponsors',
  '/granthub/grants/new': 'Create Grant Program',
  '/granthub/orgs/new': 'Create Organisation',
}
