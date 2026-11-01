/**
 * Grants CRUD + public explorer routes.
 */
import { db, auditLog } from '../db'
import { requireAuth } from '../auth'
import { randomUUID } from 'crypto'
import { formatUsdcRaw } from '../granthub-utils'

// ─── Types ─────────────────────────────────────────────────────────────────────
interface GrantRow {
  id: string; org_id: string; title: string; description: string; goals: string
  eligibility: string; requirements: string; category: string; status: string
  declared_budget: number; min_award: number; max_award: number
  deadline: number | null; start_date: number | null; end_date: number | null
  vesting_cliff_days: number; vesting_total_days: number; revocable: number
  pool_contract_address: string | null; pool_chain_id: number | null
  faqs: string; created_at: number; updated_at: number
  funding_terms: string; deliverables: string; custom_questions: string
  allow_multiple_applications: number
  org_name?: string; org_logo?: string
}

interface OrgMemberRow { org_id: string; address: string; role: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isOrgAdmin(orgId: string, address: string): boolean {
  const m = db.prepare<OrgMemberRow, [string, string]>(
    `SELECT role FROM org_members WHERE org_id = ? AND address = ?`,
  ).get(orgId, address.toLowerCase())
  return m?.role === 'admin'
}

function isOrgMember(orgId: string, address: string): boolean {
  return db.prepare<OrgMemberRow, [string, string]>(
    `SELECT role FROM org_members WHERE org_id = ? AND address = ?`,
  ).get(orgId, address.toLowerCase()) != null
}

function confirmedFunding(grantId: string): number {
  const r = db.prepare<{ total: number | null }, string>(
    `SELECT SUM(amount_raw) as total FROM deposits WHERE grant_id = ? AND confirmed = 1 AND verified = 1`,
  ).get(grantId)
  return r?.total ?? 0
}

function fmtGrant(g: GrantRow) {
  const faqs = JSON.parse(g.faqs ?? '[]') as unknown[]
  return {
    ...g,
    total_budget: String(g.declared_budget),
    max_award: String(g.max_award),
    faqs,
    tags: faqs.flatMap(item => item && typeof item === 'object' && 'tag' in item ? [String((item as { tag?: unknown }).tag ?? '')] : []),
    custom_questions: JSON.parse(g.custom_questions ?? '[]') as unknown[],
    allow_multiple_applications: g.allow_multiple_applications === 1,
    funding_terms: g.funding_terms ?? '',
    deliverables: g.deliverables ?? '',
    confirmed_funded: formatUsdcRaw(confirmedFunding(g.id)),
    revocable: g.revocable === 1,
    close_date: g.deadline,
    cliff_days: g.vesting_cliff_days,
    vesting_days: g.vesting_total_days,
    pool_contract_address: g.pool_contract_address,
    pool_chain_id: g.pool_chain_id,
  }
}

const ARC_CHAIN_IDS = new Set([5042002, 5042])
const SERVER_CHAIN_ID = process.env.VITE_CHAIN_ENV === 'mainnet' ? 5042 : 5042002

function poolConfig(
  addressValue: unknown,
  chainValue: unknown,
): { address: string | null; chainId: number | null } | { error: string } {
  const address = addressValue == null || String(addressValue).trim() === ''
    ? null
    : String(addressValue).trim().toLowerCase()
  const chainId = chainValue == null || String(chainValue).trim() === ''
    ? null
    : Number(chainValue)

  if (address == null && chainId == null) return { address: null, chainId: null }
  if (address == null || chainId == null) return { error: 'pool_contract_address and pool_chain_id must be set together' }
  if (!/^0x[0-9a-f]{40}$/.test(address) || /^0x0{40}$/.test(address)) {
    return { error: 'Invalid pool_contract_address' }
  }
  if (!Number.isSafeInteger(chainId) || !ARC_CHAIN_IDS.has(chainId)) {
    return { error: 'pool_chain_id must be Arc Testnet (5042002) or Arc Mainnet (5042)' }
  }
  if (chainId !== SERVER_CHAIN_ID) {
    return { error: `pool_chain_id ${chainId} does not match this server's configured Arc network (${SERVER_CHAIN_ID})` }
  }
  return { address, chainId }
}

// ─── Public explorer ──────────────────────────────────────────────────────────
function listGrants(url: URL, includeDrafts = false) {
  const status   = url.searchParams.get('status') ?? ''
  const category = url.searchParams.get('category') ?? ''
  const q        = url.searchParams.get('q') ?? ''
  const orgId    = url.searchParams.get('orgId') ?? ''
  const sort     = url.searchParams.get('sort') ?? 'created_at'
  const page     = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const limit    = 20
  const offset   = (page - 1) * limit

  const allowed = ['created_at', 'deadline', 'declared_budget', 'title']
  const orderBy = allowed.includes(sort) ? sort : 'created_at'

  const where: string[]              = includeDrafts ? [] : [`g.status != 'draft'`]
  const params: (string | number)[]  = []

  if (status)   { where.push(`g.status = ?`);                          params.push(status) }
  if (category) { where.push(`g.category = ?`);                        params.push(category) }
  if (orgId)    { where.push(`g.org_id = ?`);                          params.push(orgId) }
  if (q)        { where.push(`(g.title LIKE ? OR g.description LIKE ?)`); params.push(`%${q}%`, `%${q}%`) }

  const whereClause = `WHERE ${where.join(' AND ')}`
  const rows = db.prepare<GrantRow, (string | number)[]>(
    `SELECT g.*, o.name as org_name, o.logo_url as org_logo
     FROM grants g LEFT JOIN orgs o ON o.id = g.org_id
     ${whereClause} ORDER BY g.${orderBy} DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset)

  const total = (db.prepare<{ n: number }, (string | number)[]>(
    `SELECT COUNT(*) as n FROM grants g ${whereClause}`,
  ).get(...params))?.n ?? 0

  return Response.json({ grants: rows.map(fmtGrant), total, page, pages: Math.ceil(total / limit) })
}

function getGrant(id: string, req: Request) {
  const g = db.prepare<GrantRow, string>(`
    SELECT g.*, o.name as org_name, o.logo_url as org_logo
    FROM grants g LEFT JOIN orgs o ON o.id = g.org_id
    WHERE g.id = ?`).get(id)
  if (!g) return Response.json({ error: 'Not found' }, { status: 404 })
  if (g.status === 'draft') {
    const session = requireAuth(req)
    if (!session || !isOrgMember(g.org_id, session.address)) return Response.json({ error: 'Not found' }, { status: 404 })
  }
  return Response.json(fmtGrant(g))
}

// ─── Org-scoped management ────────────────────────────────────────────────────
function createGrant(orgId: string, body: Record<string, unknown>, actorAddr: string) {
  const id  = randomUUID()
  const now = Math.floor(Date.now() / 1000)

  // Accept both old field names (total_budget/cliff_days) and new canonical ones
  const declaredBudget   = Number(body.declared_budget   ?? body.total_budget   ?? 0)
  const maxAward         = Number(body.max_award         ?? declaredBudget)
  const vestingCliffDays = Number(body.vesting_cliff_days ?? body.cliff_days     ?? 0)
  const vestingTotalDays = Number(body.vesting_total_days ?? body.vesting_days   ?? 365)
  const configuredPool = poolConfig(body.pool_contract_address, body.pool_chain_id)
  if ('error' in configuredPool) return Response.json({ error: configuredPool.error }, { status: 400 })
  if (configuredPool.address) {
    const poolConflict = db.prepare<{ id: string }, string>(
      `SELECT id FROM grants WHERE lower(pool_contract_address) = ?`,
    ).get(configuredPool.address)
    if (poolConflict) return Response.json({ error: 'GrantPool address is already configured for another grant' }, { status: 409 })
  }

  const status = ['draft', 'open', 'review', 'closed'].includes(String(body.status))
    ? String(body.status) : 'draft'
  const validationError = validateGrantValues(body, status, declaredBudget, maxAward, vestingCliffDays, vestingTotalDays)
  if (validationError) return Response.json({ error: validationError }, { status: 400 })

  db.prepare(`
    INSERT INTO grants
      (id,org_id,title,description,goals,eligibility,requirements,category,status,
       declared_budget,min_award,max_award,deadline,start_date,end_date,
       vesting_cliff_days,vesting_total_days,revocable,pool_contract_address,pool_chain_id,
       faqs,funding_terms,deliverables,custom_questions,allow_multiple_applications,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, orgId,
    String(body.title ?? '').trim(),
    String(body.description ?? ''),
    String(body.goals ?? ''),
    String(body.eligibility ?? ''),
    String(body.requirements ?? ''),
    String(body.category ?? 'general'),
    status,
    declaredBudget,
    Number(body.min_award ?? 0),
    maxAward,
    body.deadline  ? Number(body.deadline)  : (body.close_date ? Number(body.close_date) : null),
    body.start_date ? Number(body.start_date) : null,
    body.end_date   ? Number(body.end_date)   : null,
    vestingCliffDays,
    vestingTotalDays,
    body.revocable === false ? 0 : 1,
    configuredPool.address,
    configuredPool.chainId,
    JSON.stringify(Array.isArray(body.faqs) ? body.faqs : (Array.isArray(body.tags) ? body.tags : [])),
    String(body.funding_terms ?? ''),
    String(body.deliverables ?? ''),
    JSON.stringify(Array.isArray(body.custom_questions) ? body.custom_questions : []),
    body.allow_multiple_applications === true ? 1 : 0,
    now, now,
  )
  auditLog(actorAddr, 'create', 'grant', id)
  return db.prepare<GrantRow, string>(`
    SELECT g.*, o.name as org_name, o.logo_url as org_logo
    FROM grants g LEFT JOIN orgs o ON o.id = g.org_id
    WHERE g.id = ?`).get(id)!
}

function validateGrantValues(
  body: Record<string, unknown>,
  status: string,
  declaredBudget: number,
  maxAward: number,
  cliffDays: number,
  vestingDays: number,
): string | null {
  const minAward = Number(body.min_award ?? 0)
  if (![declaredBudget, minAward, maxAward].every(value => Number.isFinite(value) && value >= 0)) {
    return 'Budget and award limits must be non-negative numbers'
  }
  if (maxAward > 0 && minAward > maxAward) return 'Minimum award cannot exceed maximum award'
  if (![cliffDays, vestingDays].every(value => Number.isSafeInteger(value) && value >= 0)) {
    return 'Vesting terms must be non-negative whole days'
  }
  if (vestingDays > 0 && cliffDays > vestingDays) return 'Cliff cannot exceed vesting duration'
  if (status === 'open' && declaredBudget <= 0) return 'A published grant needs a positive budget'
  const start = body.start_date == null || body.start_date === '' ? null : Number(body.start_date)
  const end = body.end_date == null || body.end_date === '' ? null : Number(body.end_date)
  const deadline = body.deadline == null || body.deadline === '' ? end : Number(body.deadline)
  if ([start, end, deadline].some(value => value != null && (!Number.isSafeInteger(value) || value <= 0))) {
    return 'Grant dates must be valid timestamps'
  }
  if (start != null && end != null && end <= start) return 'Closing date must be after opening date'
  const questions = body.custom_questions
  if (questions != null && (!Array.isArray(questions) || questions.some(question => {
    if (!question || typeof question !== 'object') return true
    const q = question as Record<string, unknown>
    return !String(q.id ?? '').trim() || !String(q.prompt ?? '').trim()
  }))) return 'Custom questions must include an id and prompt'
  return null
}

function updateGrant(grantId: string, body: Record<string, unknown>, actorAddr: string) {
  const existing = db.prepare<GrantRow, string>(`SELECT * FROM grants WHERE id = ?`).get(grantId)
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

  const hasActiveAwards = (db.prepare<{ n: number }, string>(
    `SELECT COUNT(*) as n FROM awards WHERE grant_id = ? AND status IN ('active','activating')`,
  ).get(grantId))?.n ?? 0
  const hasFinancialHistory = (db.prepare<{ n: number }, string>(
    `SELECT
       (SELECT COUNT(*) FROM deposits WHERE grant_id = ?) +
       (SELECT COUNT(*) FROM awards WHERE grant_id = ?) as n`,
  ).get(grantId, grantId))?.n ?? 0

  const protectedFields = ['declared_budget','min_award','max_award','vesting_cliff_days','vesting_total_days','revocable']
  if (hasActiveAwards > 0) {
    for (const f of protectedFields) {
      if (f in body) return Response.json({ error: `Cannot change ${f} after awards have been activated` }, { status: 409 })
    }
  }

  let nextPool: { address: string | null; chainId: number | null } | null = null
  if ('pool_contract_address' in body || 'pool_chain_id' in body) {
    const configuredPool = poolConfig(
      'pool_contract_address' in body ? body.pool_contract_address : existing.pool_contract_address,
      'pool_chain_id' in body ? body.pool_chain_id : existing.pool_chain_id,
    )
    if ('error' in configuredPool) return Response.json({ error: configuredPool.error }, { status: 400 })
    nextPool = configuredPool
    const unchanged = configuredPool.address === existing.pool_contract_address?.toLowerCase() &&
      configuredPool.chainId === existing.pool_chain_id
    if (hasFinancialHistory > 0 && !unchanged) {
      return Response.json({ error: 'Cannot change the configured pool after financial records exist' }, { status: 409 })
    }
    if (configuredPool.address) {
      const poolConflict = db.prepare<{ id: string }, [string, string]>(
        `SELECT id FROM grants WHERE lower(pool_contract_address) = ? AND id != ?`,
      ).get(configuredPool.address, grantId)
      if (poolConflict) return Response.json({ error: 'GrantPool address is already configured for another grant' }, { status: 409 })
    }
  }

  const allows = new Set([
    'title','description','goals','eligibility','requirements',
    'category','status','declared_budget','min_award','max_award',
    'deadline','start_date','end_date','vesting_cliff_days',
    'vesting_total_days','revocable','faqs','funding_terms','deliverables',
    'custom_questions','allow_multiple_applications',
  ])
  const sets: string[] = []
  const vals: (string | number | null)[] = []

  for (const [k, v] of Object.entries(body)) {
    if (!allows.has(k)) continue
    sets.push(`${k} = ?`)
    if (k === 'faqs' || k === 'custom_questions') vals.push(JSON.stringify(Array.isArray(v) ? v : []))
    else if (k === 'revocable') vals.push(v === false ? 0 : 1)
    else if (k === 'allow_multiple_applications') vals.push(v === true ? 1 : 0)
    else vals.push(v == null ? null : typeof v === 'number' ? v : String(v))
  }
  if (nextPool) {
    sets.push('pool_contract_address = ?', 'pool_chain_id = ?')
    vals.push(nextPool.address, nextPool.chainId)
  }
  const nextStatus = String(body.status ?? existing.status)
  if (!['draft', 'open', 'review', 'closed'].includes(nextStatus)) {
    return Response.json({ error: 'Invalid grant status' }, { status: 400 })
  }
  const validationError = validateGrantValues(
    { ...existing, ...body, custom_questions: 'custom_questions' in body ? body.custom_questions : JSON.parse(existing.custom_questions ?? '[]') }, nextStatus,
    Number(body.declared_budget ?? existing.declared_budget),
    Number(body.max_award ?? existing.max_award),
    Number(body.vesting_cliff_days ?? existing.vesting_cliff_days),
    Number(body.vesting_total_days ?? existing.vesting_total_days),
  )
  if (validationError) return Response.json({ error: validationError }, { status: 400 })
  if (!sets.length) return Response.json({ error: 'Nothing to update' }, { status: 400 })
  sets.push('updated_at = ?')
  vals.push(Math.floor(Date.now() / 1000))
  vals.push(grantId)

  db.prepare(`UPDATE grants SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  auditLog(actorAddr, 'update', 'grant', grantId)
  return db.prepare<GrantRow, string>(`
    SELECT g.*, o.name as org_name, o.logo_url as org_logo
    FROM grants g LEFT JOIN orgs o ON o.id = g.org_id
    WHERE g.id = ?`).get(grantId)!
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function handleGrants(req: Request, url: URL): Promise<Response | null> {
  const p = url.pathname

  // Public explorer; an authenticated org member may also see that org's drafts.
  if (req.method === 'GET' && p === '/api/grants') {
    const orgId = url.searchParams.get('orgId')
    const session = orgId ? requireAuth(req) : null
    const includeDrafts = Boolean(session && orgId && isOrgMember(orgId, session.address))
    return listGrants(url, includeDrafts)
  }

  // Public: GET /api/grants/:id
  const matchId = p.match(/^\/api\/grants\/([^/]+)$/)
  if (req.method === 'GET' && matchId) return getGrant(matchId[1], req)

  // Protected: POST /api/orgs/:orgId/grants
  const matchCreate = p.match(/^\/api\/orgs\/([^/]+)\/grants$/)
  if (req.method === 'POST' && matchCreate) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isOrgAdmin(matchCreate[1], session.address)) {
      return Response.json({ error: 'Forbidden: you must be an org admin to create grants' }, { status: 403 })
    }
    const body = await req.json() as Record<string, unknown>
    if (!String(body.title ?? '').trim()) return Response.json({ error: 'title required' }, { status: 400 })
    const grant = createGrant(matchCreate[1], body, session.address)
    if (grant instanceof Response) return grant
    return Response.json(fmtGrant(grant as GrantRow), { status: 201 })
  }

  // Protected: PATCH /api/grants/:id
  const matchPatch = p.match(/^\/api\/grants\/([^/]+)$/)
  if (req.method === 'PATCH' && matchPatch) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const g = db.prepare<{ org_id: string }, string>(`SELECT org_id FROM grants WHERE id = ?`).get(matchPatch[1])
    if (!g) return Response.json({ error: 'Not found' }, { status: 404 })
    if (!isOrgAdmin(g.org_id, session.address)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await req.json() as Record<string, unknown>
    const updated = updateGrant(matchPatch[1], body, session.address)
    if (updated instanceof Response) return updated
    return Response.json(fmtGrant(updated as GrantRow))
  }

  return null
}
