/**
 * Grants CRUD + public explorer routes.
 */
import { db, auditLog } from '../db'
import { requireAuth } from '../auth'
import { randomUUID } from 'crypto'

// ─── Types ─────────────────────────────────────────────────────────────────────
interface GrantRow {
  id: string; org_id: string; title: string; description: string; goals: string
  eligibility: string; requirements: string; category: string; status: string
  declared_budget: number; min_award: number; max_award: number
  deadline: number | null; start_date: number | null; end_date: number | null
  vesting_cliff_days: number; vesting_total_days: number; revocable: number
  faqs: string; created_at: number; updated_at: number
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

function confirmedFunding(grantId: string): number {
  const r = db.prepare<{ total: number | null }, string>(
    `SELECT SUM(amount_raw) as total FROM deposits WHERE grant_id = ? AND confirmed = 1`,
  ).get(grantId)
  return r?.total ?? 0
}

function fmtGrant(g: GrantRow) {
  return {
    ...g,
    total_budget: String(g.declared_budget),
    max_award: String(g.max_award),
    faqs: JSON.parse(g.faqs ?? '[]') as unknown[],
    confirmed_funded: String(confirmedFunding(g.id)),
    revocable: g.revocable === 1,
    cliff_days: g.vesting_cliff_days,
    vesting_days: g.vesting_total_days,
  }
}

// ─── Public explorer ──────────────────────────────────────────────────────────
function listGrants(url: URL) {
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

  const where: string[]              = [`g.status != 'draft'`]
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

function getGrant(id: string) {
  const g = db.prepare<GrantRow, string>(`
    SELECT g.*, o.name as org_name, o.logo_url as org_logo
    FROM grants g LEFT JOIN orgs o ON o.id = g.org_id
    WHERE g.id = ?`).get(id)
  if (!g) return Response.json({ error: 'Not found' }, { status: 404 })
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

  // status: accept 'open' to publish immediately; default 'draft'
  const status = body.status === 'open' ? 'open' : 'draft'

  db.prepare(`
    INSERT INTO grants
      (id,org_id,title,description,goals,eligibility,requirements,category,status,
       declared_budget,min_award,max_award,deadline,start_date,end_date,
       vesting_cliff_days,vesting_total_days,revocable,faqs,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
    JSON.stringify(Array.isArray(body.faqs) ? body.faqs : (Array.isArray(body.tags) ? body.tags : [])),
    now, now,
  )
  auditLog(actorAddr, 'create', 'grant', id)
  return db.prepare<GrantRow, string>(`
    SELECT g.*, o.name as org_name, o.logo_url as org_logo
    FROM grants g LEFT JOIN orgs o ON o.id = g.org_id
    WHERE g.id = ?`).get(id)!
}

function updateGrant(grantId: string, body: Record<string, unknown>, actorAddr: string) {
  const existing = db.prepare<GrantRow, string>(`SELECT * FROM grants WHERE id = ?`).get(grantId)
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

  const hasActiveAwards = (db.prepare<{ n: number }, string>(
    `SELECT COUNT(*) as n FROM awards WHERE grant_id = ? AND status IN ('active','activating')`,
  ).get(grantId))?.n ?? 0

  const protectedFields = ['declared_budget','min_award','max_award','vesting_cliff_days','vesting_total_days','revocable']
  if (hasActiveAwards > 0) {
    for (const f of protectedFields) {
      if (f in body) return Response.json({ error: `Cannot change ${f} after awards have been activated` }, { status: 409 })
    }
  }

  const allows = new Set([
    'title','description','goals','eligibility','requirements',
    'category','status','declared_budget','min_award','max_award',
    'deadline','start_date','end_date','vesting_cliff_days',
    'vesting_total_days','revocable','faqs',
  ])
  const sets: string[] = []
  const vals: (string | number | null)[] = []

  for (const [k, v] of Object.entries(body)) {
    if (!allows.has(k)) continue
    sets.push(`${k} = ?`)
    if (k === 'faqs')     vals.push(JSON.stringify(Array.isArray(v) ? v : []))
    else if (k === 'revocable') vals.push(v === false ? 0 : 1)
    else vals.push(v == null ? null : typeof v === 'number' ? v : String(v))
  }
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

  // Public: GET /api/grants
  if (req.method === 'GET' && p === '/api/grants') return listGrants(url)

  // Public: GET /api/grants/:id
  const matchId = p.match(/^\/api\/grants\/([^/]+)$/)
  if (req.method === 'GET' && matchId) return getGrant(matchId[1])

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
