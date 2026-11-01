import assert from 'node:assert/strict'
import test from 'node:test'
import { APP_PATH, LANDING_PATH, workspacePathname } from './appRoutes.ts'

void test('defines the public landing and workspace entry paths', () => {
  assert.equal(LANDING_PATH, '/')
  assert.equal(APP_PATH, '/app')
})

void test('normalizes explicit app routes for shared workspace navigation', () => {
  assert.equal(workspacePathname('/app'), '/')
  assert.equal(workspacePathname('/app/vesting/timeline'), '/vesting/timeline')
  assert.equal(workspacePathname('/app/granthub/dashboard'), '/granthub/dashboard')
})

void test('preserves legacy workspace routes', () => {
  assert.equal(workspacePathname('/vesting'), '/vesting')
  assert.equal(workspacePathname('/granthub/applications'), '/granthub/applications')
})
