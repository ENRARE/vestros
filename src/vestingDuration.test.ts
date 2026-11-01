import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_UINT48,
  MAX_DISPLAYABLE_TIMESTAMP_SECONDS,
  SCHEDULE_START_HEADROOM_SECONDS,
  durationToSeconds,
  scheduleStartFromChainTime,
  validateDuration,
  validateDurationPair,
  validateScheduleTimes,
  isDisplayableTimestamp,
} from './vestingDuration.ts'

void test('converts minute, hour, and day durations using integer seconds', () => {
  assert.equal(durationToSeconds('1', 'minutes'), 60n)
  assert.equal(durationToSeconds('12', 'hours'), 43_200n)
  assert.equal(durationToSeconds('7', 'days'), 604_800n)
})

void test('supports mixed units and rejects a cliff longer than vesting', () => {
  assert.equal(validateDurationPair('1', 'minutes', '10', 'minutes'), undefined)
  assert.equal(validateDurationPair('1', 'hours', '30', 'minutes'), 'Cliff duration cannot exceed vesting duration.')
})

void test('validates whole positive vesting values and a zero cliff', () => {
  assert.equal(validateDuration('0', 'minutes', 'Cliff', true), undefined)
  assert.equal(validateDuration('0', 'minutes', 'Vesting', false), 'Vesting must be greater than 0.')
  assert.equal(validateDuration('1.5', 'hours', 'Vesting', false), 'Vesting must be a whole number.')
  assert.equal(validateDuration('-1', 'days', 'Cliff', true), 'Cliff must be a whole number.')
  assert.equal(validateDuration('NaN', 'days', 'Vesting', false), 'Vesting must be a whole number.')
})

void test('rejects durations that overflow uint48 seconds', () => {
  const maxWholeMinutes = MAX_UINT48 / 60n
  assert.equal(validateDuration(maxWholeMinutes.toString(), 'minutes', 'Vesting', false), undefined)
  assert.equal(validateDuration((maxWholeMinutes + 1n).toString(), 'minutes', 'Vesting', false), 'Vesting duration must fit within uint48 seconds.')
})

void test('adds confirmation headroom to the latest chain timestamp', () => {
  assert.equal(scheduleStartFromChainTime(1_000), 1_000 + SCHEDULE_START_HEADROOM_SECONDS)
})

void test('rejects derived schedule timestamps that overflow uint48', () => {
  assert.equal(validateScheduleTimes(MAX_UINT48 - 600n, 60n, 600n), undefined)
  assert.equal(validateScheduleTimes(MAX_UINT48 - 599n, 60n, 600n), 'Vesting completion exceeds uint48 range.')
})

void test('protects the preview from dates outside JavaScript Date range', () => {
  assert.equal(isDisplayableTimestamp(MAX_DISPLAYABLE_TIMESTAMP_SECONDS), true)
  assert.equal(isDisplayableTimestamp(MAX_DISPLAYABLE_TIMESTAMP_SECONDS + 1n), false)
})
