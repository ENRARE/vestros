import assert from 'node:assert/strict'
import test from 'node:test'
import { FOOTER_LINKS, LANDING_FEATURES } from './landingContent.ts'

void test('defines the core landing feature set without duplicate labels', () => {
  assert.equal(LANDING_FEATURES.length, 3)
  assert.deepEqual(
    LANDING_FEATURES.map(feature => feature.title),
    ['USDC vesting', 'Treasury visibility', 'GrantHub workflows'],
  )
  assert.deepEqual(
    LANDING_FEATURES.map(feature => feature.art),
    ['vesting', 'treasury', 'grants'],
  )
  assert.equal(new Set(LANDING_FEATURES.map(feature => feature.title)).size, LANDING_FEATURES.length)
  assert.equal(new Set(LANDING_FEATURES.map(feature => feature.art)).size, LANDING_FEATURES.length)
})

void test('keeps footer links inside the existing application surface', () => {
  assert.deepEqual(FOOTER_LINKS.map(link => link.href), ['/help', '/app', 'https://github.com/ENRARE/vestros'])
})
