import assert from 'node:assert/strict'
import test from 'node:test'
import { GRANTHUB_COMING_SOON_ROUTES, isComingSoonFeature, isGrantHubRouteComingSoon, type FeatureKey } from './featureAvailability.ts'

void test('financial GrantHub surfaces are locked until the authorized flag is enabled', () => {
  const feature: FeatureKey = 'granthub-financial'

  assert.equal(isComingSoonFeature(feature, false), true)
  assert.equal(isComingSoonFeature('granthub-award-management', false), true)
  assert.equal(isComingSoonFeature(feature, true), false)
  assert.equal(isComingSoonFeature('granthub-award-management', true), false)
})

void test('working GrantHub surfaces are not classified as coming soon', () => {
  assert.equal(isComingSoonFeature('granthub-discovery', false), false)
  assert.equal(isComingSoonFeature('granthub-review', false), false)
})

void test('all current backend-dependent GrantHub routes are explicitly gated', () => {
  assert.deepEqual(Object.values(GRANTHUB_COMING_SOON_ROUTES), Object.values(GRANTHUB_COMING_SOON_ROUTES).map(() => true))
  assert.equal(isGrantHubRouteComingSoon('explorer'), true)
  assert.equal(isGrantHubRouteComingSoon('applications'), true)
  assert.equal(isGrantHubRouteComingSoon('awards'), true)
  assert.equal(isGrantHubRouteComingSoon('create-grant'), true)
  assert.equal(isGrantHubRouteComingSoon('dashboard'), true)
})
