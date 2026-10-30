// Shared vesting math utilities — pure functions, no React
import type { VestingSchedule, ScheduleStatus } from './types'

export function getNow(): number {
  return Math.floor(Date.now() / 1000)
}

export function computeVested(s: VestingSchedule, nowTs: number): bigint {
  if (!s || s.totalAmount === 0n) return 0n
  let eff = nowTs
  if (s.revoked && s.revokeTime > 0) eff = Math.min(nowTs, s.revokeTime)
  if (eff < s.cliffTime) return 0n
  if (eff >= s.endTime) return s.totalAmount
  const duration = BigInt(s.endTime - s.startTime)
  if (duration === 0n) return s.totalAmount
  return (s.totalAmount * BigInt(eff - s.startTime)) / duration
}

export function getStatus(s: VestingSchedule, now: number): ScheduleStatus {
  if (s.revoked) return 'revoked'
  if (now < s.cliffTime) return 'locked'
  if (now >= s.endTime || s.claimedAmount >= s.totalAmount) return 'fully_vested'
  return 'vesting'
}

export function pct(a: bigint, b: bigint): number {
  if (!b) return 0
  return Math.min(100, Number((a * 10000n) / b) / 100)
}

/**
 * Build a series of { ts, vestedRaw } points for a chart.
 * Covers startTime to endTime (or revokeTime), sampled at `numPoints`.
 */
export function buildVestingSeries(
  s: VestingSchedule,
  numPoints = 60,
): Array<{ ts: number; vested: bigint; claimed: bigint }> {
  const stop = s.revoked && s.revokeTime > 0 ? s.revokeTime : s.endTime
  const start = s.startTime
  const step = Math.max(1, Math.floor((stop - start) / numPoints))
  const points: Array<{ ts: number; vested: bigint; claimed: bigint }> = []
  for (let ts = start; ts <= stop + step; ts += step) {
    const clampedTs = Math.min(ts, stop)
    points.push({ ts: clampedTs, vested: computeVested(s, clampedTs), claimed: s.claimedAmount })
  }
  // Always include exact endpoint
  if (points[points.length - 1]?.ts !== stop) {
    points.push({ ts: stop, vested: computeVested(s, stop), claimed: s.claimedAmount })
  }
  return points
}

/** Forecast: how much will be vested at a given future timestamp */
export function forecastVested(s: VestingSchedule, futureTs: number): bigint {
  return computeVested(s, futureTs)
}

/** Parse an error message from a rejected transaction */
export function parseOnchainError(err: unknown): string {
  const msg = (err as Error)?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('4001')) return 'Transaction cancelled.'
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance')) return 'Insufficient USDC balance.'
  if (msg.includes('reverted')) {
    const m = msg.match(/revert reason: "([^"]+)"/) ?? msg.match(/error: ([a-z]+\(\))/i)
    return m ? `Transaction failed: ${m[1]}` : 'Transaction reverted.'
  }
  return 'Something went wrong. Please try again.'
}
