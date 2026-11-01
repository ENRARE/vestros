import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  canMarkAwardFailed,
  blocksDuplicateApplication,
  canMakeFinalApplicationDecision,
  formatUsdcRaw,
  isGrantAcceptingApplications,
  normalizeApplicationPayload,
  parseRawUsdc,
  parseUsdcRaw,
} from './granthub-utils.ts'

describe('GrantHub money and application boundaries', () => {
  it('parses a human USDC amount into exact 6-decimal raw units', () => {
    assert.equal(parseUsdcRaw('12.345678'), 12_345_678)
  })

  it('rejects amounts with more precision than USDC supports', () => {
    assert.throws(() => parseUsdcRaw('1.0000001'), /at most 6 decimal places/)
  })

  it('normalizes the application form payload used by the current frontend', () => {
    assert.deepEqual(
      normalizeApplicationPayload({
        project_title: 'Arc tooling',
        description: 'Build useful tooling',
        requested_amount: '250.50',
      }),
      {
        projectName: 'Arc tooling',
        summary: 'Build useful tooling',
        requestedRaw: 250_500_000,
      },
    )
  })

  it('accepts only positive safe integer raw amounts for awards and deposits', () => {
    assert.equal(parseRawUsdc(250_500_000), 250_500_000)
    assert.throws(() => parseRawUsdc(250.5), /positive safe integer/)
  })

  it('formats raw funding totals as human USDC values', () => {
    assert.equal(formatUsdcRaw(250_500_000), '250.5')
  })
})

describe('GrantHub feature flag', () => {
  it('is disabled when no authorization flag is set', async () => {
    delete process.env.GRANTHUB_FINANCIAL_ENABLED
    delete process.env.VITE_GRANTHUB_FINANCIAL
    const flags = await import(`./feature-flags.ts?test=default-${Date.now()}`)
    assert.equal(flags.GRANTHUB_FINANCIAL_ENABLED, false)
  })

  it('accepts the explicit server authorization flag', async () => {
    process.env.GRANTHUB_FINANCIAL_ENABLED = 'true'
    delete process.env.VITE_GRANTHUB_FINANCIAL
    const flags = await import(`./feature-flags.ts?test=enabled-${Date.now()}`)
    assert.equal(flags.GRANTHUB_FINANCIAL_ENABLED, true)
  })

  it('does not treat the frontend flag as server authorization', async () => {
    delete process.env.GRANTHUB_FINANCIAL_ENABLED
    process.env.VITE_GRANTHUB_FINANCIAL = 'true'
    const flags = await import(`./feature-flags.ts?test=frontend-only-${Date.now()}`)
    assert.equal(flags.GRANTHUB_FINANCIAL_ENABLED, false)
  })
})

describe('GrantHub award state transitions', () => {
  it('allows failure only for an in-flight activation', () => {
    assert.equal(canMarkAwardFailed('activating'), true)
    assert.equal(canMarkAwardFailed('pending'), false)
    assert.equal(canMarkAwardFailed('active'), false)
  })
})

describe('GrantHub application workflow boundaries', () => {
  it('only organization admins can approve or reject', () => {
    assert.equal(canMakeFinalApplicationDecision('reviewer', 'approve'), false)
    assert.equal(canMakeFinalApplicationDecision('admin', 'approve'), true)
    assert.equal(canMakeFinalApplicationDecision('reviewer', 'shortlist'), true)
  })

  it('blocks duplicate non-rejected applications when a grant disallows multiples', () => {
    assert.equal(blocksDuplicateApplication('draft', false), true)
    assert.equal(blocksDuplicateApplication('submitted', false), true)
    assert.equal(blocksDuplicateApplication('rejected', false), false)
    assert.equal(blocksDuplicateApplication('submitted', true), false)
  })

  it('accepts only published/reviewing grant states for applications', () => {
    assert.equal(isGrantAcceptingApplications('draft'), false)
    assert.equal(isGrantAcceptingApplications('open'), true)
    assert.equal(isGrantAcceptingApplications('review'), true)
    assert.equal(isGrantAcceptingApplications('closed'), false)
  })
})
