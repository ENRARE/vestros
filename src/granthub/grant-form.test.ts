import assert from 'node:assert/strict'
import test from 'node:test'
import { GRANT_CATEGORY_OPTIONS } from './grant-form.ts'

void test('grant category options preserve lowercase filter values', () => {
  assert.deepEqual(GRANT_CATEGORY_OPTIONS[0], { value: 'general', label: 'General' })
  assert.ok(GRANT_CATEGORY_OPTIONS.every(option => option.value === option.value.toLowerCase()))
})
