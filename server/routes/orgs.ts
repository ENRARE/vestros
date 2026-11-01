/**
 * Organizations CRUD.
 */
import { db, auditLog } from '../db'
import { requireAuth } from '../auth'

interface OrgRow {
  id: string; name: string; description: string; website: string; logo_url: string
  twitter: string; github: string; treasury_address: string
  created_at: number; updated_at: number
}
interface MemberRow { org_id: string; address: string; role: string; added_at?: number }

function isOrgAdmin(orgId: string, address: string): boolean {
  const m = db.prepare<MemberRow, [string, string]>(
    `SELECT role FROM org_members WHERE org_id = ? AND address = ?`,
  ).get(orgId, address.toLowerCase())
  return m?.role === 'admin'
}

function fmtOrg(o: OrgRow, members?: MemberRow[]) {
  const ms = members ?? db.prepare<MemberRow, string>(
    `SELECT * FROM org_members WHERE org_id = ?`,
  ).all(o.id)
  return { ...o, members: ms }
}

export async function handleOrgs(req: Request, url: URL): Promise<Response | null> {
  const p = url.pathname

  // GET /api/orgs/:id
  const matchGet = p.match(/^\/api\/orgs\/([^/]+)$/)
  if (req.method === 'GET' && matchGet && p !== '/api/orgs') {
    const o = db.prepare<OrgRow, string>(`SELECT * FROM orgs WHERE id = ?`).get(matchGet[1])
    if (!o) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json(fmtOrg(o))
  }

  // GET /api/orgs — my orgs for authed user
  if (req.method === 'GET' && p === '/api/orgs') {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const rows = db.prepare<OrgRow, string>(`
      SELECT o.* FROM orgs o
      JOIN org_members m ON m.org_id = o.id
      WHERE m.address = ?`).all(session.address)
    return Response.json(rows.map(o => fmtOrg(o)))
  }

  // POST /api/orgs — create org (creator becomes admin)
  if (req.method === 'POST' && p === '/api/orgs') {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json() as Record<string, unknown>
    const name = String(body.name ?? '').trim()
    if (!name) return Response.json({ error: 'name required' }, { status: 400 })

    // Derive stable slug/id from the requested slug (or name) + address fragment.
    const addrFrag = session.address.slice(2, 8)
    const slug = String(body.slug ?? name).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 36)
    if (!slug) return Response.json({ error: 'slug must contain letters or numbers' }, { status: 400 })
    const id = `${slug}-${addrFrag}`

    const exists = db.prepare<{ n: number }, string>(`SELECT COUNT(*) as n FROM orgs WHERE id = ?`).get(id)
    if ((exists?.n ?? 0) > 0) {
      // Return existing if this wallet already owns an org with this slug
      const existing = db.prepare<OrgRow, string>(`SELECT * FROM orgs WHERE id = ?`).get(id)!
      return Response.json(fmtOrg(existing))
    }

    const now = Math.floor(Date.now() / 1000)
    db.prepare(`INSERT INTO orgs (id,name,description,website,logo_url,twitter,github,treasury_address,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      id, name,
      String(body.description ?? ''),
      String(body.website ?? ''),
      String(body.logo_url ?? ''),
      String(body.twitter ?? ''),
      String(body.github ?? ''),
      String(body.treasury_address ?? ''),
      now, now,
    )
    db.prepare(`INSERT INTO org_members (org_id,address,role) VALUES (?,?,?)`)
      .run(id, session.address, 'admin')
    auditLog(session.address, 'create', 'org', id)
    const o = db.prepare<OrgRow, string>(`SELECT * FROM orgs WHERE id = ?`).get(id)!
    return Response.json(fmtOrg(o), { status: 201 })
  }

  // PATCH /api/orgs/:id
  const matchPatch = p.match(/^\/api\/orgs\/([^/]+)$/)
  if (req.method === 'PATCH' && matchPatch) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isOrgAdmin(matchPatch[1], session.address)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await req.json() as Record<string, unknown>
    const allows = ['name','description','website','logo_url','twitter','github','treasury_address']
    const sets: string[] = []
    const vals: (string | number)[] = []
    for (const [k, v] of Object.entries(body)) {
      if (!allows.includes(k)) continue
      sets.push(`${k} = ?`)
      vals.push(String(v ?? ''))
    }
    if (!sets.length) return Response.json({ error: 'Nothing to update' }, { status: 400 })
    sets.push('updated_at = ?')
    vals.push(Math.floor(Date.now() / 1000))
    vals.push(matchPatch[1])
    db.prepare(`UPDATE orgs SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    auditLog(session.address, 'update', 'org', matchPatch[1])
    const o = db.prepare<OrgRow, string>(`SELECT * FROM orgs WHERE id = ?`).get(matchPatch[1])!
    return Response.json(fmtOrg(o))
  }

  // POST /api/orgs/:id/members
  const matchMembers = p.match(/^\/api\/orgs\/([^/]+)\/members$/)
  if (req.method === 'POST' && matchMembers) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isOrgAdmin(matchMembers[1], session.address)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await req.json() as Record<string, unknown>
    const memberAddr = String(body.address ?? '').toLowerCase()
    const role       = String(body.role ?? 'member')
    if (!memberAddr.startsWith('0x')) return Response.json({ error: 'Invalid address' }, { status: 400 })
    if (!['admin','reviewer','member'].includes(role)) {
      return Response.json({ error: 'Invalid role' }, { status: 400 })
    }
    db.prepare(`INSERT OR REPLACE INTO org_members (org_id,address,role) VALUES (?,?,?)`)
      .run(matchMembers[1], memberAddr, role)
    auditLog(session.address, 'add_member', 'org', matchMembers[1], `${memberAddr}:${role}`)
    return Response.json({ ok: true })
  }

  // DELETE /api/orgs/:id/members/:address
  const matchDelMember = p.match(/^\/api\/orgs\/([^/]+)\/members\/([^/]+)$/)
  if (req.method === 'DELETE' && matchDelMember) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isOrgAdmin(matchDelMember[1], session.address)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    db.prepare(`DELETE FROM org_members WHERE org_id = ? AND address = ?`)
      .run(matchDelMember[1], matchDelMember[2].toLowerCase())
    return Response.json({ ok: true })
  }

  return null
}
