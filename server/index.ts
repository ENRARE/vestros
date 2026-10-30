/**
 * GrantHub API server — Bun HTTP on port 3001.
 * Proxied from Vite at /api via vite.config.ts.
 */
import { handleAuth } from './routes/auth'
import { handleGrants } from './routes/grants'
import { handleOrgs } from './routes/orgs'
import { handleApplications } from './routes/applications'
import { handleAwards } from './routes/awards'

const PORT = 3001

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Credentials': 'true',
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })

    const url = new URL(req.url)
    let res: Response | null = null

    try {
      res = await handleAuth(req, url)
        ?? await handleGrants(req, url)
        ?? await handleOrgs(req, url)
        ?? await handleApplications(req, url)
        ?? await handleAwards(req, url)
    } catch (err) {
      console.error('[API error]', err)
      res = Response.json({ error: 'Internal server error' }, { status: 500 })
    }

    if (!res) res = Response.json({ error: 'Not found' }, { status: 404 })

    // Add CORS headers to every response
    const out = new Response(res.body, { status: res.status, headers: new Headers(res.headers) })
    for (const [k, v] of Object.entries(CORS_HEADERS)) out.headers.set(k, v)
    return out
  },
})

console.log(`GrantHub API listening on port ${PORT}`)
