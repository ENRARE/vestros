const USDC_SCALE = 1_000_000n
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

function assertSafePositive(raw: bigint): number {
  if (raw <= 0n || raw > MAX_SAFE_BIGINT) {
    throw new Error('USDC amount must be a positive safe integer')
  }
  return Number(raw)
}

/** Parse a human-readable USDC amount without using floating-point math. */
export function parseUsdcRaw(value: unknown): number {
  const text = String(value ?? '').trim()
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    throw new Error('USDC amount must be a positive decimal number')
  }

  const [whole = '0', fraction = ''] = text.split('.')
  if (fraction.length > 6) {
    throw new Error('USDC amount may have at most 6 decimal places')
  }

  const paddedFraction = fraction.padEnd(6, '0')
  return assertSafePositive(BigInt(whole || '0') * USDC_SCALE + BigInt(paddedFraction || '0'))
}

/** Validate a raw 6-decimal USDC amount received from a client. */
export function parseRawUsdc(value: unknown): number {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) {
    throw new Error('USDC amount must be a positive safe integer')
  }
  return assertSafePositive(BigInt(text))
}

export function formatUsdcRaw(_value: number): string {
  if (!Number.isSafeInteger(_value) || _value < 0) {
    throw new Error('USDC amount must be a non-negative safe integer')
  }
  if (_value === 0) return '0'

  const digits = BigInt(_value).toString().padStart(7, '0')
  const whole = digits.slice(0, -6)
  const fraction = digits.slice(-6).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

export function canMarkAwardFailed(status: string): boolean {
  return status === 'activating'
}

export function isGrantAcceptingApplications(status: string): boolean {
  return status === 'open' || status === 'review' || status === 'reviewing'
}

export function blocksDuplicateApplication(status: string, allowMultiple: boolean): boolean {
  return !allowMultiple && status !== 'rejected'
}

export function canMakeFinalApplicationDecision(role: string, decision: string): boolean {
  return !['approve', 'reject'].includes(decision) || role === 'admin'
}

export function normalizeApplicationPayload(body: Record<string, unknown>): {
  projectName: string
  summary: string
  requestedRaw: number
} {
  const projectName = String(body.project_name ?? body.project_title ?? '').trim()
  const summary = String(body.summary ?? body.description ?? '').trim()
  const requestedRaw = body.requested_raw != null
    ? parseRawUsdc(body.requested_raw)
    : parseUsdcRaw(body.requested_amount)

  return { projectName, summary, requestedRaw }
}
