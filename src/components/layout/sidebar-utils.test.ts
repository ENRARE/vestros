import assert from 'node:assert/strict'
import test from 'node:test'
import { NAV_GROUPS } from './navConfig.ts'
import {
  activeNavGroupId,
  activeNavItemId,
  navTarget,
  searchNavGroups,
  visibleNavGroups,
} from './sidebar-utils.ts'

void test('builds query-aware navigation targets', () => {
  const review = NAV_GROUPS.find(group => group.id === 'organization')?.items.find(item => item.id === 'review-queue')
  assert.equal(review ? navTarget(review) : '', '/granthub/dashboard?tab=review')
})

void test('filters navigation by authorized roles before searching', () => {
  const publicGroups = visibleNavGroups(NAV_GROUPS, new Set(['public']))
  const vesting = publicGroups.find(group => group.id === 'vesting')
  assert.deepEqual(vesting?.items.map(item => item.id), [
    'my-vesting',
    'create-vest',
    'bulk-vest',
    'timeline',
    'team',
  ])
  const results = searchNavGroups(publicGroups, 'create')
  assert.deepEqual(results.map(group => group.id), ['vesting'])
  assert.equal(results[0]?.items[0]?.id, 'create-vest')
})

void test('searches item and group labels while preserving group structure', () => {
  const connectedGroups = visibleNavGroups(NAV_GROUPS, new Set(['public', 'connected', 'beneficiary']))
  const results = searchNavGroups(connectedGroups, 'funding')
  assert.equal(results.length, 1)
  assert.equal(results[0]?.id, 'organization')
  assert.equal(results[0]?.items[0]?.to, '/granthub/funding')
})

void test('selects the active group from route and query tab', () => {
  assert.equal(activeNavGroupId(NAV_GROUPS, '/granthub/dashboard', '?tab=review'), 'organization')
  assert.equal(activeNavGroupId(NAV_GROUPS, '/reports', ''), 'financial')
})

void test('selects one exact navigation item for nested and query routes', () => {
  assert.equal(activeNavItemId(NAV_GROUPS, '/granthub/grants/new', ''), 'create-grant')
  assert.equal(activeNavItemId(NAV_GROUPS, '/granthub/grants/123', ''), 'explore-grants')
  assert.equal(activeNavItemId(NAV_GROUPS, '/granthub/dashboard', '?tab=review'), 'review-queue')
  assert.equal(activeNavItemId(NAV_GROUPS, '/granthub/dashboard', '?tab=grants'), 'org-grants')
  assert.equal(activeNavItemId(NAV_GROUPS, '/reports', ''), 'reports')
})

void test('keeps each vesting page addressable in legacy and /app namespaces', () => {
  const routes = [
    ['/vesting', 'my-vesting'],
    ['/vesting/create', 'create-vest'],
    ['/vesting/bulk', 'bulk-vest'],
    ['/vesting/timeline', 'timeline'],
    ['/vesting/team', 'team'],
    ['/app/vesting', 'my-vesting'],
    ['/app/vesting/create', 'create-vest'],
    ['/app/vesting/bulk', 'bulk-vest'],
    ['/app/vesting/timeline', 'timeline'],
    ['/app/vesting/team', 'team'],
  ] as const

  for (const [pathname, expectedId] of routes) {
    assert.equal(activeNavItemId(NAV_GROUPS, pathname, ''), expectedId, pathname)
    assert.equal(activeNavGroupId(NAV_GROUPS, pathname, ''), 'vesting', pathname)
  }
})
