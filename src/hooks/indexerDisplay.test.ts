import test from 'node:test'
import assert from 'node:assert/strict'
import { getIndexerDisplayState } from './indexerDisplay.ts'

void test('hides progress when the indexer has no chain head yet', () => {
  assert.deepEqual(getIndexerDisplayState({ indexedBlock: 0n, headBlock: 0n, error: null }), { kind: 'hidden' })
})

void test('shows a retryable degraded state when indexing fails before any blocks are available', () => {
  assert.deepEqual(getIndexerDisplayState({ indexedBlock: 0n, headBlock: 0n, error: 'history unavailable' }), { kind: 'error' })
})

void test('hides the banner before the first indexed block is available', () => {
  assert.deepEqual(getIndexerDisplayState({ indexedBlock: 0n, headBlock: 100n, error: null }), { kind: 'hidden' })
})

void test('shows progress only after the indexer has advanced', () => {
  assert.deepEqual(getIndexerDisplayState({ indexedBlock: 25n, headBlock: 100n, error: null }), { kind: 'progress', progress: 25, remaining: 75n })
})

void test('never renders a zero-percent progress state after indexing begins', () => {
  assert.deepEqual(getIndexerDisplayState({ indexedBlock: 1n, headBlock: 1_000_000n, error: null }), { kind: 'progress', progress: 1, remaining: 999_999n })
})

