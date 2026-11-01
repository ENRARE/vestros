import assert from 'node:assert/strict'
import test from 'node:test'
import { isFundedApplicationStatus } from './app-status.ts'

void test('treats the backend funded status as an activated application', () => {
  assert.equal(isFundedApplicationStatus('funded'), true)
  assert.equal(isFundedApplicationStatus('awarded'), true)
  assert.equal(isFundedApplicationStatus('approved'), false)
})
