export type FeatureKey =
  | 'granthub-financial'
  | 'granthub-award-management'
  | 'granthub-discovery'
  | 'granthub-review'

export type GrantHubRouteKey =
  | 'explorer'
  | 'grant-detail'
  | 'org-profile'
  | 'apply'
  | 'dashboard'
  | 'review'
  | 'my-grants'
  | 'applications'
  | 'awards'
  | 'create-grant'
  | 'create-org'
  | 'funding'

/**
 * GrantHub currently depends on the optional Bun/API backend for these routes.
 * Keep this map explicit so a route can be removed as soon as it has genuine
 * end-to-end support in the target runtime.
 */
export const GRANTHUB_COMING_SOON_ROUTES: Readonly<Record<GrantHubRouteKey, true>> = {
  explorer: true,
  'grant-detail': true,
  'org-profile': true,
  apply: true,
  dashboard: true,
  review: true,
  'my-grants': true,
  applications: true,
  awards: true,
  'create-grant': true,
  'create-org': true,
  funding: true,
}

export function isGrantHubRouteComingSoon(route: GrantHubRouteKey): boolean {
  return GRANTHUB_COMING_SOON_ROUTES[route]
}

/**
 * Keeps incomplete surface decisions in one place. The financial gate is
 * intentionally passed in by the caller so this module stays independent of
 * Vite's environment and remains easy to test.
 */
export function isComingSoonFeature(feature: FeatureKey, financialEnabled: boolean): boolean {
  return (feature === 'granthub-financial' || feature === 'granthub-award-management') && !financialEnabled
}
