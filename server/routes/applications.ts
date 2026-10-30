/**
 * Applications — applicant profiles, submissions, review decisions.
 */
import { db, auditLog } from '../db'
import { requireAuth } from '../auth'
import { randomUUID } from 'crypto'

type AppRow = {
  id: string; grant_id: string; applicant_addr: string; project_name: string
  summary: string; problem: string; solution: string; requested_raw: number
  category: string; tech_approach: string; timeline: string; milestones: string
  repo_url: string; demo_url: string; status: string
  submitted_at: number | null; created_at: number; updated_at: number
}
type ProfileRow = {
  address: string; display_name: string; bio: string; github: string
  portfolio: string; skills: string; team: string; public_fields: string
  updated_at: number
}
type ReviewRow = {
  id: string; application_id: string; reviewer_addr: string; decision: string
  recommended_raw: number | null; notes: string; created_at: number
}

function isOrgMember(orgId: string, address: string, roles: string[]): boolean {
  const m = db.prepare<{ role: string }, string[]>(
    `SELECT role FROM org_members WHERE org_id = ? AND address = ?`,
  ).get(orgId, address.toLowerCase())
  return m != null && roles.includes(m.role)
}

function fmtApp(a: AppRow) {
  return { ...a, milestones: JSON.parse(a.milestones ?? '[]') as unknown[] }
}

export async function handleApplications(req: Request, url: URL): Promise<Response | null> {
  const p = url.pathname

  // ── Profiles ──────────────────────────────────────────────────────────────
  // GET /api/profiles/:address
  const matchProfile = p.match(/^\/api\/profiles\/([^/]+)$/)
  if (req.method === 'GET' && matchProfile) {
    const addr = matchProfile[1].toLowerCase()
    const row = db.prepare<ProfileRow, string>(`SELECT * FROM profiles WHERE address = ?`).get(addr)
    if (!row) return Response.json({ address: addr, display_name: '', bio: '', skills: [], github: '', portfolio: '' })
    const pub = JSON.parse(row.public_fields) as string[]
    const session = requireAuth(req)
    const isOwn = session?.address === addr
    const out: Record<string, unknown> = { address: row.address }
    for (const f of ['display_name','bio','github','portfolio','skills','team'] as const) {
      if (isOwn || pub.includes(f)) out[f] = f === 'skills' || f === 'team' ? JSON.parse(row[f]) : row[f]
    }
    return Response.json(out)
  }

  // PUT /api/profiles — upsert own profile
  if (req.method === 'PUT' && p === '/api/profiles') {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json() as Record<string, unknown>
    const addr = session.address
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`INSERT INTO profiles (address,display_name,bio,github,portfolio,skills,team,public_fields,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(address) DO UPDATE SET
        display_name=excluded.display_name, bio=excluded.bio, github=excluded.github,
        portfolio=excluded.portfolio, skills=excluded.skills, team=excluded.team,
        public_fields=excluded.public_fields, updated_at=excluded.updated_at`).run(
      addr,
      String(body.display_name ?? ''),
      String(body.bio ?? ''),
      String(body.github ?? ''),
      String(body.portfolio ?? ''),
      JSON.stringify(Array.isArray(body.skills) ? body.skills : []),
      JSON.stringify(Array.isArray(body.team) ? body.team : []),
      JSON.stringify(Array.isArray(body.public_fields) ? body.public_fields : ['display_name','bio','skills']),
      now,
    )
    return Response.json({ ok: true })
  }

  // ── Applications ──────────────────────────────────────────────────────────
  // GET /api/grants/:grantId/applications — org members only
  const matchGApp = p.match(/^\/api\/grants\/([^/]+)\/applications$/)
  if (req.method === 'GET' && matchGApp) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const grant = db.prepare<{ org_id: string }, string>(`SELECT org_id FROM grants WHERE id = ?`).get(matchGApp[1])
    if (!grant) return Response.json({ error: 'Not found' }, { status: 404 })
    if (!isOrgMember(grant.org_id, session.address, ['admin','reviewer'])) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const apps = db.prepare<AppRow, string>(`SELECT * FROM applications WHERE grant_id = ? ORDER BY submitted_at DESC`).all(matchGApp[1])
    return Response.json(apps.map(fmtApp))
  }

  // GET /api/applications/mine — own applications
  if (req.method === 'GET' && p === '/api/applications/mine') {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const apps = db.prepare<AppRow, string>(`
      SELECT a.*, g.title as grant_title, g.org_id, o.name as org_name
      FROM applications a
      LEFT JOIN grants g ON g.id = a.grant_id
      LEFT JOIN orgs o ON o.id = g.org_id
      WHERE a.applicant_addr = ? ORDER BY a.created_at DESC`).all(session.address)
    return Response.json(apps.map(fmtApp))
  }

  // GET /api/applications/:id
  const matchAppId = p.match(/^\/api\/applications\/([^/]+)$/)
  if (req.method === 'GET' && matchAppId) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const app = db.prepare<AppRow, string>(`SELECT * FROM applications WHERE id = ?`).get(matchAppId[1])
    if (!app) return Response.json({ error: 'Not found' }, { status: 404 })
    const grant = db.prepare<{ org_id: string }, string>(`SELECT org_id FROM grants WHERE id = ?`).get(app.grant_id)!
    const isApplicant = app.applicant_addr === session.address
    const isReviewer = isOrgMember(grant.org_id, session.address, ['admin','reviewer'])
    if (!isApplicant && !isReviewer) return Response.json({ error: 'Forbidden' }, { status: 403 })
    return Response.json(fmtApp(app))
  }

  // POST /api/grants/:grantId/applications — submit
  const matchSubmit = p.match(/^\/api\/grants\/([^/]+)\/applications$/)
  if (req.method === 'POST' && matchSubmit) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json() as Record<string, unknown>
    const grant = db.prepare<{ status: string }, string>(`SELECT status FROM grants WHERE id = ?`).get(matchSubmit[1])
    if (!grant) return Response.json({ error: 'Grant not found' }, { status: 404 })
    if (!['open','reviewing'].includes(grant.status)) {
      return Response.json({ error: 'Grant is not accepting applications' }, { status: 409 })
    }
    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const isSubmit = body.submit === true
    // Note: applications schema only has the core columns; extra fields stored in milestones JSON
    db.prepare(`INSERT INTO applications
      (id,grant_id,applicant_addr,project_name,summary,problem,solution,requested_raw,
       milestones,status,submitted_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, matchSubmit[1], session.address,
      String(body.project_name ?? ''), String(body.summary ?? ''),
      String(body.problem ?? ''), String(body.solution ?? ''),
      Number(body.requested_raw ?? 0),
      JSON.stringify(Array.isArray(body.milestones) ? body.milestones : [
        { label: 'tech_approach', value: String(body.tech_approach ?? '') },
        { label: 'timeline',      value: String(body.timeline ?? '') },
        { label: 'repo_url',      value: String(body.repo_url ?? '') },
        { label: 'demo_url',      value: String(body.demo_url ?? '') },
      ]),
      isSubmit ? 'submitted' : 'draft',
      isSubmit ? now : null, now, now,
    )
    auditLog(session.address, isSubmit ? 'submit' : 'draft', 'application', id)
    return Response.json(fmtApp(db.prepare<AppRow, string>(`SELECT * FROM applications WHERE id = ?`).get(id)!), { status: 201 })
  }

  // PATCH /api/applications/:id — edit draft or save
  const matchPatch = p.match(/^\/api\/applications\/([^/]+)$/)
  if (req.method === 'PATCH' && matchPatch) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const app = db.prepare<AppRow, string>(`SELECT * FROM applications WHERE id = ?`).get(matchPatch[1])
    if (!app) return Response.json({ error: 'Not found' }, { status: 404 })
    if (app.applicant_addr !== session.address) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (!['draft'].includes(app.status)) return Response.json({ error: 'Cannot edit submitted application' }, { status: 409 })
    const body = await req.json() as Record<string, unknown>
    const fields = ['project_name','summary','problem','solution','requested_raw','milestones']
    const sets: string[] = []; const vals: (string | number | null)[] = []
    for (const [k, v] of Object.entries(body)) {
      if (!fields.includes(k)) continue
      sets.push(`${k} = ?`)
      vals.push(k === 'milestones' ? JSON.stringify(Array.isArray(v) ? v : []) : k === 'requested_raw' ? Number(v) : String(v ?? ''))
    }
    if (body.submit === true) { sets.push('status = ?', 'submitted_at = ?'); vals.push('submitted', Math.floor(Date.now() / 1000)) }
    if (!sets.length) return Response.json({ error: 'Nothing to update' }, { status: 400 })
    sets.push('updated_at = ?'); vals.push(Math.floor(Date.now() / 1000)); vals.push(matchPatch[1])
    db.prepare(`UPDATE applications SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    return Response.json(fmtApp(db.prepare<AppRow, string>(`SELECT * FROM applications WHERE id = ?`).get(matchPatch[1])!))
  }

  // ── Review decisions ───────────────────────────────────────────────────────
  // POST /api/applications/:id/reviews
  const matchReview = p.match(/^\/api\/applications\/([^/]+)\/reviews$/)
  if (req.method === 'POST' && matchReview) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const app = db.prepare<AppRow, string>(`SELECT * FROM applications WHERE id = ?`).get(matchReview[1])
    if (!app) return Response.json({ error: 'Not found' }, { status: 404 })
    const grant = db.prepare<{ org_id: string }, string>(`SELECT org_id FROM grants WHERE id = ?`).get(app.grant_id)!
    if (!isOrgMember(grant.org_id, session.address, ['admin','reviewer'])) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await req.json() as Record<string, unknown>
    const decision = String(body.decision ?? '')
    if (!['shortlist','approve','reject','note'].includes(decision)) {
      return Response.json({ error: 'Invalid decision' }, { status: 400 })
    }
    const id = randomUUID()
    const revNow = Math.floor(Date.now() / 1000)
    db.prepare(`INSERT INTO reviews (id,application_id,reviewer_addr,score,comment,decision,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(application_id, reviewer_addr) DO UPDATE SET
        score=excluded.score, comment=excluded.comment, decision=excluded.decision, updated_at=excluded.updated_at`).run(
      id, matchReview[1], session.address,
      body.score != null ? Number(body.score) : null,
      String(body.notes ?? body.comment ?? ''),
      decision, revNow, revNow,
    )
    // Update application status
    const statusMap: Record<string, string> = { shortlist: 'shortlisted', approve: 'approved', reject: 'rejected' }
    if (statusMap[decision]) {
      db.prepare(`UPDATE applications SET status = ?, updated_at = ? WHERE id = ?`).run(
        statusMap[decision], Math.floor(Date.now() / 1000), matchReview[1],
      )
    }
    auditLog(session.address, `review:${decision}`, 'application', matchReview[1])
    return Response.json({ id, decision }, { status: 201 })
  }

  // GET /api/applications/:id/reviews — reviewer or admin
  const matchGetReviews = p.match(/^\/api\/applications\/([^/]+)\/reviews$/)
  if (req.method === 'GET' && matchGetReviews) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const app = db.prepare<AppRow, string>(`SELECT * FROM applications WHERE id = ?`).get(matchGetReviews[1])
    if (!app) return Response.json({ error: 'Not found' }, { status: 404 })
    const grant = db.prepare<{ org_id: string }, string>(`SELECT org_id FROM grants WHERE id = ?`).get(app.grant_id)!
    if (!isOrgMember(grant.org_id, session.address, ['admin','reviewer'])) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const reviews = db.prepare<ReviewRow, string>(`SELECT * FROM reviews WHERE application_id = ? ORDER BY created_at DESC`).all(matchGetReviews[1])
    return Response.json(reviews)
  }

  return null
}
