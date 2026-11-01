import { db } from '../db'
import { requireAuth } from '../auth'

export function handleNotifications(req: Request, url: URL): Response | null {
  const isList = req.method === 'GET' && url.pathname === '/api/notifications'
  const match = url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/)
  if (!isList && !(req.method === 'PATCH' && match)) return null

  const session = requireAuth(req)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (isList) {
    const rows = db.prepare<{
      id: string; type: string; entity_id: string | null; message: string; read: number; created_at: number
    }, string>(`SELECT id,type,entity_id,message,read,created_at FROM notifications
      WHERE recipient_addr = ? ORDER BY created_at DESC LIMIT 50`).all(session.address)
    return Response.json(rows.map(row => ({ ...row, read: row.read === 1 })))
  }

  if (req.method === 'PATCH' && match) {
    db.prepare(`UPDATE notifications SET read = 1 WHERE id = ? AND recipient_addr = ?`).run(match[1], session.address)
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Not found' }, { status: 404 })
}
