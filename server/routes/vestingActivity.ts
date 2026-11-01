import { db } from '../db'
import { queryVestingEvents, type VestingEventType } from '../vestingStorage'

const ARC_TESTNET_CHAIN_ID = 5042002
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const MAX_LIMIT = 100

export interface VestingActivityOptions {
  database?: import('bun:sqlite').Database
}

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

function validAddress(value: string | null): string | undefined {
  if (!value) return undefined
  return ADDRESS_PATTERN.test(value) ? value.toLowerCase() : undefined
}

export function handleVestingActivity(
  request: Request,
  url: URL,
  options: VestingActivityOptions = {},
): Response | null {
  if (url.pathname !== '/api/vesting/activity') return null
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const pageValue = Number(url.searchParams.get('page') ?? '1')
  const limitValue = Number(url.searchParams.get('limit') ?? '50')
  if (!Number.isSafeInteger(pageValue) || pageValue < 1 || !Number.isSafeInteger(limitValue) || limitValue < 1 || limitValue > MAX_LIMIT) {
    return json({ error: `page must be positive and limit must be between 1 and ${MAX_LIMIT}` }, 400)
  }

  const walletValue = url.searchParams.get('wallet')
  const organizationValue = url.searchParams.get('organization')
  const vaultValue = url.searchParams.get('vault')
  const beneficiaryValue = url.searchParams.get('beneficiary')
  for (const [name, value] of [['wallet', walletValue], ['organization', organizationValue], ['vault', vaultValue], ['beneficiary', beneficiaryValue]] as const) {
    if (value !== null && !ADDRESS_PATTERN.test(value)) return json({ error: `${name} must be an EVM address` }, 400)
  }

  const scheduleId = url.searchParams.get('scheduleId') ?? undefined
  if (scheduleId !== undefined && !/^\d+$/.test(scheduleId)) return json({ error: 'scheduleId must be a nonnegative integer' }, 400)
  const typeValue = url.searchParams.get('type') ?? undefined
  if (typeValue !== undefined && !['created', 'claimed', 'revoked'].includes(typeValue)) return json({ error: 'Unsupported event type' }, 400)

  const result = queryVestingEvents(options.database ?? db, {
    chainId: ARC_TESTNET_CHAIN_ID,
    wallet: validAddress(walletValue),
    organization: validAddress(organizationValue),
    vaultAddress: validAddress(vaultValue),
    beneficiary: validAddress(beneficiaryValue),
    scheduleId,
    type: typeValue as VestingEventType | undefined,
    page: pageValue,
    limit: limitValue,
  })
  return json(result as unknown as Record<string, unknown>)
}
