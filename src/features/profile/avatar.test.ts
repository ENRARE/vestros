import assert from 'node:assert/strict'
import test from 'node:test'
import { AVATAR_PRESETS, DEFAULT_AVATAR_ID, avatarStorageKey, isAvatarPresetId } from './avatar.ts'

void test('provides five distinct profile avatar presets with a valid default', () => {
  assert.equal(AVATAR_PRESETS.length, 5)
  assert.equal(new Set(AVATAR_PRESETS.map(preset => preset.id)).size, 5)
  assert.ok(AVATAR_PRESETS.some(preset => preset.id === DEFAULT_AVATAR_ID))
  assert.ok(AVATAR_PRESETS.every(preset => preset.label && preset.background && preset.foreground))
})

void test('scopes avatar persistence to a normalized wallet address', () => {
  assert.equal(
    avatarStorageKey('0xAbCd000000000000000000000000000000001234'),
    'vestros-avatar:0xabcd000000000000000000000000000000001234',
  )
  assert.equal(avatarStorageKey(undefined), null)
})

void test('validates stored avatar IDs before rendering them', () => {
  assert.equal(isAvatarPresetId(DEFAULT_AVATAR_ID), true)
  assert.equal(isAvatarPresetId('not-a-preset'), false)
  assert.equal(isAvatarPresetId(null), false)
})
