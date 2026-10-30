/**
 * Awards — funding authorization + vesting activation.
 * Financial admins (org admins) can authorize awards from the org pool.
 * Activation is flagged only AFTER confirmed onchain tx.
 */
import { db, auditLog } from '../db'
import { requireAuth } from '../auth'
import { randomUUID } from 'crypto'
import { verifyActivationTx } from '../onchain-verify'
import { limitActivate, limitWrite, tooManyRequests } from '../rate-limit'
import { GRANTHUB_FINANCIAL_ENABLED, financialDisabled } from '../feature-flags'

type AwardRow = {
  id: string; application_id: string; grant_id: string; org_id: string
  beneficiary_addr: string; amount_raw: number
  vesting_start: number; vesting_cliff_days: number; vesting_total_days: number
  revocable: number; contract_address: string | null; chain_id: number | null
  schedule_id: string | null; tx_hash: string | null; status: string
  authorized_by: string | null; authorized_at: number | null; activated_at: number | null
  created_at: number; updated_at: number
}
type DepositRow = { id: string; grant_id: string; sponsor_addr: string; amount_raw: number; tx_hash: string; block_number: number; confirmed: number }

function isOrgAdmin(orgId: string, address: string): boolean {
  const m = db.prepare<{ role: string }, string[]>(
    `SELECT role FROM org_members WHERE org_id = ? AND address = ?`
  ).get(orgId, address.toLowerCase())
  return m?.role === 'admin'
}

/** Total confirmed deposits for a grant */
function confirmedPool(grantId: string): number {
  return (db.prepare<{ t: number | null }, string>(
    `SELECT SUM(amount_raw) as t FROM deposits WHERE grant_id = ? AND confirmed = 1`
  ).get(grantId))?.t ?? 0
}

/** Total reserved by pending + active awards */
function reservedFromPool(grantId: string): number {
  return (db.prepare<{ t: number | null }, string>(
    `SELECT SUM(amount_raw) as t FROM awards WHERE grant_id = ? AND status IN ('pending','activating','active')`
  ).get(grantId))?.t ?? 0
}

export async function handleAwards(req: Request, url: URL): Promise<Response | null> {
  const p = url.pathname

  // ── Deposits (sponsor funding) ────────────────────────────────────────────
  // POST /api/grants/:grantId/deposits — record a deposit intent / confirm onchain
  const matchDeposit = p.match(/^\/api\/grants\/([^/]+)\/deposits$/)
  if (req.method === 'POST' && matchDeposit) {
    if (!GRANTHUB_FINANCIAL_ENABLED) return financialDisabled()
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const rlD = limitWrite(session.address)
    if (!rlD.allowed) return tooManyRequests(rlD.retryAfter)
    const body = await req.json() as Record<string, unknown>
    const { tx_hash, amount_raw, block_number, confirmed } = body
    if (!tx_hash || !amount_raw || !block_number) {
      return Response.json({ error: 'tx_hash, amount_raw, block_number required' }, { status: 400 })
    }
    // Idempotent by tx_hash
    const existing = db.prepare<{ id: string }, string>(`SELECT id FROM deposits WHERE tx_hash = ?`).get(String(tx_hash))
    if (existing) return Response.json({ id: existing.id, duplicate: true })
    const id = randomUUID()
    db.prepare(`INSERT INTO deposits (id,grant_id,sponsor_addr,amount_raw,tx_hash,block_number,confirmed)
      VALUES (?,?,?,?,?,?,?)`).run(id, matchDeposit[1], session.address, Number(amount_raw), String(tx_hash), Number(block_number), confirmed ? 1 : 0)
    auditLog(session.address, 'deposit', 'grant', matchDeposit[1], `${amount_raw} raw`)
    return Response.json({ id }, { status: 201 })
  }

  // PATCH /api/deposits/:id/confirm — mark deposit confirmed
  const matchConfirm = p.match(/^\/api\/deposits\/([^/]+)\/confirm$/)
  if (req.method === 'PATCH' && matchConfirm) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    db.prepare(`UPDATE deposits SET confirmed = 1 WHERE id = ?`).run(matchConfirm[1])
    return Response.json({ ok: true })
  }

  // GET /api/grants/:grantId/deposits
  const matchGetDeps = p.match(/^\/api\/grants\/([^/]+)\/deposits$/)
  if (req.method === 'GET' && matchGetDeps) {
    const rows = db.prepare<DepositRow, string>(`SELECT * FROM deposits WHERE grant_id = ? ORDER BY deposited_at DESC`).all(matchGetDeps[1])
    return Response.json({ deposits: rows, confirmed_total: confirmedPool(matchGetDeps[1]) })
  }

  // ── Awards ────────────────────────────────────────────────────────────────
  // POST /api/applications/:appId/award — create award (admin only, does NOT activate)
  const matchCreateAward = p.match(/^\/api\/applications\/([^/]+)\/award$/)
  if (req.method === 'POST' && matchCreateAward) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const app = db.prepare<{ grant_id: string; status: string; applicant_addr: string }, string>(
      `SELECT grant_id, status, applicant_addr FROM applications WHERE id = ?`
    ).get(matchCreateAward[1])
    if (!app) return Response.json({ error: 'Application not found' }, { status: 404 })
    const grant = db.prepare<{ org_id: string; vesting_cliff_days: number; vesting_total_days: number; revocable: number }, string>(
      `SELECT org_id, vesting_cliff_days, vesting_total_days, revocable FROM grants WHERE id = ?`
    ).get(app.grant_id)!
    if (!isOrgAdmin(grant.org_id, session.address)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (app.status !== 'approved') return Response.json({ error: 'Application must be approved first' }, { status: 409 })

    // Check for existing award
    const dupe = db.prepare<{ id: string }, string>(`SELECT id FROM awards WHERE application_id = ?`).get(matchCreateAward[1])
    if (dupe) return Response.json({ error: 'Award already exists', id: dupe.id }, { status: 409 })

    const body = await req.json() as Record<string, unknown>
    const amountRaw = Number(body.amount_raw ?? 0)
    if (!amountRaw) return Response.json({ error: 'amount_raw required' }, { status: 400 })

    // Check available pool
    const pool = confirmedPool(app.grant_id)
    const reserved = reservedFromPool(app.grant_id)
    const available = pool - reserved
    if (amountRaw > available) {
      return Response.json({
        error: 'Insufficient available pool',
        available, pool, reserved, requested: amountRaw,
      }, { status: 409 })
    }

    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`INSERT INTO awards
      (id,application_id,grant_id,org_id,beneficiary_addr,amount_raw,
       vesting_start,vesting_cliff_days,vesting_total_days,revocable,
       status,authorized_by,authorized_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, matchCreateAward[1], app.grant_id, grant.org_id,
      String(body.beneficiary_addr ?? app.applicant_addr).toLowerCase(),
      amountRaw,
      Number(body.vesting_start ?? now),
      Number(body.vesting_cliff_days ?? grant.vesting_cliff_days),
      Number(body.vesting_total_days ?? grant.vesting_total_days),
      body.revocable === false ? 0 : grant.revocable,
      'pending',
      session.address, now, now, now,
    )
    // Update application status to pending_funding
    db.prepare(`UPDATE applications SET status = 'pending_funding', updated_at = ? WHERE id = ?`).run(now, matchCreateAward[1])
    auditLog(session.address, 'create_award', 'application', matchCreateAward[1], `${amountRaw}`)

    return Response.json({ id, status: 'pending' }, { status: 201 })
  }

  // PATCH /api/awards/:id/activate — independently verifies onchain tx before marking active
  const matchActivate = p.match(/^\/api\/awards\/([^/]+)\/activate$/)
  if (req.method === 'PATCH' && matchActivate) {
    if (!GRANTHUB_FINANCIAL_ENABLED) return financialDisabled()
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    // Rate limit: 5 activation attempts per wallet per minute
    const rlA = limitActivate(session.address)
    if (!rlA.allowed) return tooManyRequests(rlA.retryAfter)

    const award = db.prepare<AwardRow, string>(`SELECT * FROM awards WHERE id = ?`).get(matchActivate[1])
    if (!award) return Response.json({ error: 'Not found' }, { status: 404 })
    if (!isOrgAdmin(award.org_id, session.address)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (award.status === 'active') return Response.json({ error: 'Already active' }, { status: 409 })
    if (!['pending','activating','failed'].includes(award.status)) {
      return Response.json({ error: `Cannot activate from status: ${award.status}` }, { status: 409 })
    }

    const body = await req.json() as Record<string, unknown>
    const { onchain_award_index, pool_contract_address, chain_id, tx_hash } = body

    // All four fields are required; schedule_id and vesting_contract come from verification
    if (!tx_hash)               return Response.json({ error: 'tx_hash required' }, { status: 400 })
    if (!pool_contract_address) return Response.json({ error: 'pool_contract_address required' }, { status: 400 })
    if (onchain_award_index == null) return Response.json({ error: 'onchain_award_index required' }, { status: 400 })
    if (!chain_id)              return Response.json({ error: 'chain_id required' }, { status: 400 })

    // Mark as 'activating' immediately so duplicate submissions are rejected
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`UPDATE awards SET status='activating', updated_at=? WHERE id=?`).run(now, matchActivate[1])

    // Independent onchain verification — do NOT trust caller-supplied schedule_id
    const result = await verifyActivationTx(String(tx_hash), {
      awardDbId:           matchActivate[1],
      onchainAwardIndex:   Number(onchain_award_index),
      poolContractAddress: String(pool_contract_address),
      beneficiaryAddr:     award.beneficiary_addr,
      amountRaw:           award.amount_raw,
      chainId:             Number(chain_id),
    })

    if (!result.ok) {
      // Revert to 'failed' so it can be retried with a correct tx
      db.prepare(`UPDATE awards SET status='failed', updated_at=? WHERE id=?`).run(now, matchActivate[1])
      auditLog(session.address, 'activate_award_failed', 'award', matchActivate[1], result.error)
      return Response.json({ error: `Onchain verification failed: ${result.error}` }, { status: 422 })
    }

    // Verification passed — write verified data from chain (NOT from request body)
    db.prepare(`UPDATE awards SET
      contract_address=?, chain_id=?, schedule_id=?, tx_hash=?,
      status='active', activated_at=?, updated_at=?
      WHERE id = ?`).run(
      result.vestingContract ?? '',
      Number(chain_id),
      result.scheduleId ?? '',
      String(tx_hash),
      now, now, matchActivate[1],
    )
    db.prepare(`UPDATE applications SET status='funded', updated_at=? WHERE id=?`).run(now, award.application_id)
    auditLog(
      session.address, 'activate_award', 'award', matchActivate[1],
      `schedule_id=${result.scheduleId ?? ''} block=${result.blockNumber ?? '?'}`,
    )
    return Response.json({
      ok: true,
      status: 'active',
      schedule_id: result.scheduleId,
      vesting_contract: result.vestingContract,
      block_number: result.blockNumber,
    })
  }

  // PATCH /api/awards/:id/fail — mark failed (tx reverted / timed out)
  const matchFail = p.match(/^\/api\/awards\/([^/]+)\/fail$/)
  if (req.method === 'PATCH' && matchFail) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const award = db.prepare<AwardRow, string>(`SELECT * FROM awards WHERE id = ?`).get(matchFail[1])
    if (!award) return Response.json({ error: 'Not found' }, { status: 404 })
    if (!isOrgAdmin(award.org_id, session.address)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`UPDATE awards SET status='failed', updated_at=? WHERE id=?`).run(now, matchFail[1])
    db.prepare(`UPDATE applications SET status='approved', updated_at=? WHERE id=?`).run(now, award.application_id)
    return Response.json({ ok: true, status: 'failed' })
  }

  // GET /api/grants/:grantId/awards — org members
  const matchGetAwards = p.match(/^\/api\/grants\/([^/]+)\/awards$/)
  if (req.method === 'GET' && matchGetAwards) {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const grant = db.prepare<{ org_id: string }, string>(`SELECT org_id FROM grants WHERE id = ?`).get(matchGetAwards[1])
    if (!grant) return Response.json({ error: 'Not found' }, { status: 404 })
    const m = db.prepare<{ role: string }, string[]>(`SELECT role FROM org_members WHERE org_id = ? AND address = ?`).get(grant.org_id, session.address)
    if (!m) return Response.json({ error: 'Forbidden' }, { status: 403 })
    const awards = db.prepare<AwardRow, string>(`SELECT * FROM awards WHERE grant_id = ? ORDER BY created_at DESC`).all(matchGetAwards[1])
    return Response.json(awards)
  }

  // GET /api/awards/mine — beneficiary's awards
  if (req.method === 'GET' && p === '/api/awards/mine') {
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const awards = db.prepare<AwardRow, string>(`
      SELECT a.*, g.title as grant_title, o.name as org_name
      FROM awards a
      LEFT JOIN grants g ON g.id = a.grant_id
      LEFT JOIN orgs o ON o.id = a.org_id
      WHERE a.beneficiary_addr = ? ORDER BY a.created_at DESC`).all(session.address)
    return Response.json(awards)
  }

  return null
}
