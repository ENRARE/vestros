export interface LandingFeature {
  art: 'vesting' | 'treasury' | 'grants'
  title: string
  description: string
}

export interface LandingLink {
  label: string
  href: string
  external?: boolean
}

export const LANDING_FEATURES: LandingFeature[] = [
  {
    art: 'vesting',
    title: 'USDC vesting',
    description: 'Schedule unlocks with clear claims and control.',
  },
  {
    art: 'treasury',
    title: 'Treasury visibility',
    description: 'See allocations, activity, and runway in one view.',
  },
  {
    art: 'grants',
    title: 'GrantHub workflows',
    description: 'Run grants from application to award.',
  },
]

export const FOOTER_LINKS: LandingLink[] = [
  { label: 'Docs', href: '/help' },
  { label: 'App', href: '/app' },
  { label: 'GitHub', href: 'https://github.com/ENRARE/vestros', external: true },
]
