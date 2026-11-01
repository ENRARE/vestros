import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCsv, filterEventLogs, summarizeEventLogs } from './workspace-utils.ts'

void test('buildCsv escapes commas, quotes, and newlines', () => {
  const csv = buildCsv(['name', 'note'], [['A, B', 'He said "yes"\nthen left']])
  assert.equal(csv, 'name,note\n"A, B","He said ""yes""\nthen left"')
})

void test('filterEventLogs narrows by event type and searchable fields', () => {
  const logs = [
    { type: 'created' as const, beneficiary: '0xABC', txHash: '0xcreate', amount: 10n, scheduleId: 1n, blockNumber: 10n, logIndex: 0 },
    { type: 'claimed' as const, beneficiary: '0xDEF', txHash: '0xclaim', amount: 4n, scheduleId: 1n, blockNumber: 11n, logIndex: 0 },
  ]
  assert.deepEqual(filterEventLogs(logs, 'claimed', 'def'), [logs[1]])
  assert.deepEqual(filterEventLogs(logs, 'all', '0xcreate'), [logs[0]])
})

void test('summarizeEventLogs returns raw USDC totals without number conversion', () => {
  const summary = summarizeEventLogs([
    { type: 'created' as const, amount: 9_000_000_000_000_000n },
    { type: 'claimed' as const, amount: 2n },
    { type: 'revoked' as const, amount: 3n },
  ])
  assert.deepEqual(summary, {
    created: 9_000_000_000_000_000n,
    claimed: 2n,
    revoked: 3n,
    counts: { created: 1, claimed: 1, revoked: 1 },
  })
})
