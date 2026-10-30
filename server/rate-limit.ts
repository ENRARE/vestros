/**
 * rate-limit.ts — in-process sliding-window rate limiter.
 *
 * No external dependencies; stores counters in memory. Suitable for a single-process
 * Bun server. For multi-process or multi-instance deployments, replace with Redis.
 *
 * Usage:
 *   const { allowed, retryAfter } = rateLimit(key, maxRequests, windowMs)
 *   if (!allowed) return Response.json({ error: 'Too many requests' }, { status: 429,
 *     headers: { 'Retry-After': String(Math.ceil(retryAfter / 1000)) } })
 */

interface WindowEntry {
  count: number
  windowStart: number
}

const store = new Map<string, WindowEntry>()

// Purge stale entries periodically to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now - entry.windowStart > 60 * 60 * 1000) store.delete(key)
  }
}, 5 * 60 * 1000)

/**
 * Sliding fixed-window rate limit.
 * @param key       Unique key (e.g. `"nonce:${ip}"` or `"activate:${address}"`)
 * @param max       Maximum requests allowed in the window
 * @param windowMs  Window duration in milliseconds
 * @returns { allowed, retryAfter } — retryAfter is ms until reset (0 when allowed)
 */
export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
): { allowed: boolean; retryAfter: number } {
  const now     = Date.now()
  const entry   = store.get(key)

  if (!entry || now - entry.windowStart >= windowMs) {
    store.set(key, { count: 1, windowStart: now })
    return { allowed: true, retryAfter: 0 }
  }

  if (entry.count < max) {
    entry.count++
    return { allowed: true, retryAfter: 0 }
  }

  const retryAfter = windowMs - (now - entry.windowStart)
  return { allowed: false, retryAfter }
}

// ── Pre-defined limits ─────────────────────────────────────────────────────────

/** Nonce generation: 5 per minute per IP (prevents nonce-spam) */
export function limitNonce(ip: string) {
  return rateLimit(`nonce:${ip}`, 5, 60_000)
}

/** Signature verification: 10 per 5 minutes per IP (prevents brute-force) */
export function limitVerify(ip: string) {
  return rateLimit(`verify:${ip}`, 10, 5 * 60_000)
}

/** Award activation: 5 per minute per wallet (prevents duplicate submissions) */
export function limitActivate(address: string) {
  return rateLimit(`activate:${address}`, 5, 60_000)
}

/** General authenticated write endpoints: 60 per minute per wallet */
export function limitWrite(address: string) {
  return rateLimit(`write:${address}`, 60, 60_000)
}

/** Unauthenticated read endpoints: 120 per minute per IP */
export function limitRead(ip: string) {
  return rateLimit(`read:${ip}`, 120, 60_000)
}

/** Extract best-effort client IP from a Request (handles X-Forwarded-For) */
export function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('cf-connecting-ip') ??
    'unknown'
  )
}

/** Helper: produce a 429 response with Retry-After header */
export function tooManyRequests(retryAfterMs: number): Response {
  return Response.json(
    { error: 'Too many requests — please slow down.' },
    {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
    },
  )
}
