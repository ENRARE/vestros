/**
 * GrantHub API server — Bun HTTP on port 3001.
 * Proxied from Vite at /api via vite.config.ts.
 */
import { handleAuth } from './routes/auth'
import { handleGrants } from './routes/grants'
import { handleOrgs } from './routes/orgs'
import { handleApplications } from './routes/applications'
import { handleAwards } from './routes/awards'
import { handleNotifications } from './routes/notifications'
import { handleVestingActivity } from './routes/vestingActivity'
import { handleArcRpc } from './arcRpcProxy'
import { runVestingIndexerOnce } from './vestingIndexer'

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
      res = await handleArcRpc(req, url)
        ?? handleVestingActivity(req, url)
        ?? await handleAuth(req, url)
        ?? await handleGrants(req, url)
        ?? await handleOrgs(req, url)
        ?? await handleApplications(req, url)
        ?? await handleAwards(req, url)
        ?? handleNotifications(req, url)
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

const indexerEnabled = process.env.VESTING_INDEXER_ENABLED !== 'false'
const indexerPollMs = Math.max(30_000, Number(process.env.VESTING_INDEXER_POLL_MS ?? 120_000))
if (indexerEnabled) {
  const runIndexer = () => {
    void runVestingIndexerOnce().then(result => {
      if (result.error) console.error('[vesting indexer]', result.error)
    })
  }
  runIndexer()
  setInterval(runIndexer, indexerPollMs)
}
