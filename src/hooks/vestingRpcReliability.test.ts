import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyRpcError,
  createRpcRequestQueue,
  nextLogChunkSize,
  retryDelayMs,
} from './vestingRpcReliability.ts'

void test('classifies Arc rate-limit errors and shrinks the next log range', () => {
  const error = new Error('HTTP 429: Request exceeds defined limit')

  assert.equal(classifyRpcError(error), 'rate_limited')
  assert.equal(nextLogChunkSize(2_000n, error), 1_000n)
})

void test('classifies provider-specific HTTP 400 log-range limits without judging credentials', () => {
  const error = new Error('HTTP 400: -32600 Under the Free tier plan, eth_getLogs requests support up to a 10 block range')

  assert.equal(classifyRpcError(error), 'rate_limited')
  assert.equal(nextLogChunkSize(100n, error), 50n)
})

void test('honors Retry-After and applies bounded jittered backoff', () => {
  const error = Object.assign(new Error('429'), { response: { headers: { 'retry-after': '2' } } })

  assert.equal(retryDelayMs(error, 0, () => 0.5), 2_000)
  assert.equal(retryDelayMs(new Error('429'), 3, () => 0), 4_000)
})

void test('deduplicates queued requests with the same key and limits concurrency', async () => {
  const queue = createRpcRequestQueue(1)
  let active = 0
  let maximumActive = 0

  const request = (value: number, wait: number) => queue.enqueue('same-request', async () => {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    await new Promise(resolve => setTimeout(resolve, wait))
    active -= 1
    return value
  })

  const first = request(7, 5)
  const duplicate = request(99, 1)
  assert.strictEqual(first, duplicate)
  assert.equal(await first, 7)
  assert.equal(maximumActive, 1)
})
