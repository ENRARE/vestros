/**
 * Awards — funding authorization + vesting activation.
 * Financial admins (org admins) can authorize awards from the org pool.
 * Activation is flagged only AFTER confirmed onchain tx.
 */
import { db, auditLog, notify } from '../db'
import { requireAuth } from '../auth'
import { randomUUID } from 'crypto'
import { verifyActivationTx, verifyDepositTx } from '../onchain-verify'
import { limitActivate, limitWrite, tooManyRequests } from '../rate-limit'
import { GRANTHUB_FINANCIAL_ENABLED, financialDisabled } from '../feature-flags'
import { canMarkAwardFailed, formatUsdcRaw, parseRawUsdc } from '../granthub-utils'

type AwardRow = {
  id: string; application_id: string; grant_id: string; org_id: string
  beneficiary_addr: string; amount_raw: number
  vesting_start: number; vesting_cliff_days: number; vesting_total_days: number
  revocable: number; contract_address: string | null; chain_id: number | null
  schedule_id: string | null; tx_hash: string | null; status: string
  authorized_by: string | null; authorized_at: number | null; activated_at: number | null
  created_at: number; updated_at: number
}
type DepositRow = {
  id: string; grant_id: string; sponsor_addr: string; amount_raw: number; tx_hash: string
  block_number: number; confirmed: number; verified: number
  verified_chain_id: number | null; verified_pool_contract_address: string | null
  verified_token_address: string | null; verified_at: number | null
}

function fmtAward(a: AwardRow) {
  return {
    ...a,
    amount: formatUsdcRaw(a.amount_raw),
    revocable: a.revocable === 1,
    vesting_schedule_id: a.schedule_id,
    recipient_addr: a.beneficiary_addr,
  }
}

function isOrgAdmin(orgId: string, address: string): boolean {
  const m = db.prepare<{ role: string }, string[]>(
    `SELECT role FROM org_members WHERE org_id = ? AND address = ?`
  ).get(orgId, address.toLowerCase())
  return m?.role === 'admin'
}

/** Total confirmed deposits for a grant */
function confirmedPool(grantId: string): number {
  return (db.prepare<{ t: number | null }, string>(
    `SELECT SUM(amount_raw) as t FROM deposits WHERE grant_id = ? AND confirmed = 1 AND verified = 1`
  ).get(grantId))?.t ?? 0
}

function fmtDeposit(d: DepositRow) {
  return {
    ...d,
    amount: formatUsdcRaw(d.amount_raw),
    confirmed: d.confirmed === 1 && d.verified === 1,
    verified: d.verified === 1,
  }
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
  // POST /api/grants/:grantId/deposits — verify and record an onchain deposit
  const matchDeposit = p.match(/^\/api\/grants\/([^/]+)\/deposits$/)
  if (req.method === 'POST' && matchDeposit) {
    if (!GRANTHUB_FINANCIAL_ENABLED) return financialDisabled()
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const rlD = limitWrite(session.address)
    if (!rlD.allowed) return tooManyRequests(rlD.retryAfter)
    const body = await req.json() as Record<string, unknown>
    const txHash = String(body.tx_hash ?? '')
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return Response.json({ error: 'A valid tx_hash is required' }, { status: 400 })
    }
    const grant = db.prepare<{
      org_id: string; pool_contract_address: string | null; pool_chain_id: number | null
    }, string>(
      `SELECT org_id, pool_contract_address, pool_chain_id FROM grants WHERE id = ?`,
    ).get(matchDeposit[1])
    if (!grant) return Response.json({ error: 'Grant not found' }, { status: 404 })
    if (!grant.pool_contract_address || !grant.pool_chain_id) {
      return Response.json({ error: 'Grant has no configured GrantPool and chain' }, { status: 409 })
    }

    // A transaction hash is globally single-use. Repeating the exact request
    // is idempotent; reusing it for another grant is a replay attempt.
    const existing = db.prepare<DepositRow, string>(`SELECT * FROM deposits WHERE tx_hash = ?`).get(txHash)
    if (existing) {
      if (existing.grant_id !== matchDeposit[1] || existing.sponsor_addr.toLowerCase() !== session.address.toLowerCase()) {
        return Response.json({ error: 'Transaction hash has already been recorded' }, { status: 409 })
      }
      return Response.json({ id: existing.id, duplicate: true, verified: existing.verified === 1 })
    }

    const result = await verifyDepositTx(txHash, {
      chainId: grant.pool_chain_id,
      poolContractAddress: grant.pool_contract_address,
      expectedDepositor: session.address,
    })
    if (!result.ok || result.amountRaw == null || result.blockNumber == null || !result.depositor || !result.tokenAddress) {
      return Response.json({ error: `Onchain deposit verification failed: ${result.error ?? 'incomplete result'}` }, { status: 422 })
    }

    // Optional client metadata is checked for consistency, but never used as
    // the source of truth for the row written below.
    if (body.amount_raw != null) {
      try {
        if (parseRawUsdc(body.amount_raw) !== result.amountRaw) {
          return Response.json({ error: 'Submitted amount does not match the verified transfer' }, { status: 422 })
        }
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 400 })
      }
    }
    if (body.block_number != null && Number(body.block_number) !== result.blockNumber) {
      return Response.json({ error: 'Submitted block does not match the verified receipt' }, { status: 422 })
    }

    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    try {
      db.prepare(`INSERT INTO deposits
        (id,grant_id,sponsor_addr,amount_raw,tx_hash,block_number,confirmed,verified,
         verified_chain_id,verified_pool_contract_address,verified_token_address,verified_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, matchDeposit[1], result.depositor.toLowerCase(), result.amountRaw, txHash,
        result.blockNumber, 1, 1, grant.pool_chain_id, grant.pool_contract_address.toLowerCase(),
        result.tokenAddress.toLowerCase(), now,
      )
    } catch (error) {
      // A concurrent request may have inserted the same unique transaction.
      const raced = db.prepare<{ id: string }, string>(`SELECT id FROM deposits WHERE tx_hash = ?`).get(txHash)
      if (raced) return Response.json({ id: raced.id, duplicate: true, verified: true })
      throw error
    }
    auditLog(session.address, 'deposit_verified', 'grant', matchDeposit[1], `${result.amountRaw} raw block=${result.blockNumber}`)
    return Response.json({ id, amount_raw: result.amountRaw, block_number: result.blockNumber, confirmed: true, verified: true }, { status: 201 })
  }

  // PATCH /api/deposits/:id/confirm — mark deposit confirmed
  const matchConfirm = p.match(/^\/api\/deposits\/([^/]+)\/confirm$/)
  if (req.method === 'PATCH' && matchConfirm) {
    if (!GRANTHUB_FINANCIAL_ENABLED) return financialDisabled()
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const deposit = db.prepare<DepositRow, string>(
      `SELECT * FROM deposits WHERE id = ?`,
    ).get(matchConfirm[1])
    if (!deposit) return Response.json({ error: 'Deposit not found' }, { status: 404 })
    const grant = db.prepare<{ org_id: string }, string>(`SELECT org_id FROM grants WHERE id = ?`).get(deposit.grant_id)
    if (!grant) return Response.json({ error: 'Grant not found' }, { status: 404 })
    if (deposit.sponsor_addr !== session.address && !isOrgAdmin(grant.org_id, session.address)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (deposit.confirmed === 1 && deposit.verified === 1) {
      return Response.json({ ok: true, already_confirmed: true })
    }
    const grantConfig = db.prepare<{
      pool_contract_address: string | null; pool_chain_id: number | null
    }, string>(`SELECT pool_contract_address, pool_chain_id FROM grants WHERE id = ?`).get(deposit.grant_id)
    if (!grantConfig?.pool_contract_address || !grantConfig.pool_chain_id) {
      return Response.json({ error: 'Grant has no configured GrantPool and chain' }, { status: 409 })
    }
    const result = await verifyDepositTx(deposit.tx_hash, {
      chainId: grantConfig.pool_chain_id,
      poolContractAddress: grantConfig.pool_contract_address,
      expectedDepositor: deposit.sponsor_addr,
    })
    if (!result.ok || result.amountRaw == null || result.blockNumber == null || !result.depositor || !result.tokenAddress) {
      return Response.json({ error: `Onchain deposit verification failed: ${result.error ?? 'incomplete result'}` }, { status: 422 })
    }
    const now = Math.floor(Date.now() / 1000)
    db.prepare(`UPDATE deposits SET
      sponsor_addr=?, amount_raw=?, block_number=?, confirmed=1, verified=1,
      verified_chain_id=?, verified_pool_contract_address=?, verified_token_address=?, verified_at=?
      WHERE id = ?`).run(
      result.depositor.toLowerCase(), result.amountRaw, result.blockNumber,
      grantConfig.pool_chain_id, grantConfig.pool_contract_address.toLowerCase(),
      result.tokenAddress.toLowerCase(), now, matchConfirm[1],
    )
    auditLog(session.address, 'deposit_reverified', 'deposit', matchConfirm[1], `${result.amountRaw} raw block=${result.blockNumber}`)
    return Response.json({ ok: true, amount_raw: result.amountRaw, block_number: result.blockNumber, verified: true })
  }

  // GET /api/grants/:grantId/deposits
  const matchGetDeps = p.match(/^\/api\/grants\/([^/]+)\/deposits$/)
  if (req.method === 'GET' && matchGetDeps) {
    const rows = db.prepare<DepositRow, string>(`SELECT * FROM deposits WHERE grant_id = ? ORDER BY deposited_at DESC`).all(matchGetDeps[1])
    return Response.json({ deposits: rows.map(fmtDeposit), confirmed_total: confirmedPool(matchGetDeps[1]) })
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
    const grant = db.prepare<{ org_id: string; vesting_cliff_days: number; vesting_total_days: number; revocable: number; min_award: number; max_award: number; declared_budget: number }, string>(
      `SELECT org_id, vesting_cliff_days, vesting_total_days, revocable, min_award, max_award, declared_budget FROM grants WHERE id = ?`
    ).get(app.grant_id)!
    if (!isOrgAdmin(grant.org_id, session.address)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (app.status !== 'approved') return Response.json({ error: 'Application must be approved first' }, { status: 409 })

    // Check for existing award
    const dupe = db.prepare<{ id: string }, string>(`SELECT id FROM awards WHERE application_id = ?`).get(matchCreateAward[1])
    if (dupe) return Response.json({ error: 'Award already exists', id: dupe.id }, { status: 409 })

    const body = await req.json() as Record<string, unknown>
    let amountRaw: number
    try { amountRaw = parseRawUsdc(body.amount_raw) }
    catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }) }
    if (grant.min_award > 0 && amountRaw < grant.min_award * 1_000_000) return Response.json({ error: 'Award is below the grant minimum' }, { status: 400 })
    if (grant.max_award > 0 && amountRaw > grant.max_award * 1_000_000) return Response.json({ error: 'Award exceeds the grant maximum' }, { status: 400 })
    const beneficiary = String(body.beneficiary_addr ?? '').trim().toLowerCase()
    if (beneficiary && beneficiary !== (app.applicant_addr ?? '').toLowerCase()) {
      return Response.json({ error: 'Award beneficiary must match the approved applicant' }, { status: 422 })
    }
    const cliffDays = Number(body.vesting_cliff_days ?? grant.vesting_cliff_days)
    const vestingDays = Number(body.vesting_total_days ?? grant.vesting_total_days)
    if (!Number.isSafeInteger(cliffDays) || !Number.isSafeInteger(vestingDays) || cliffDays < 0 || vestingDays <= 0 || cliffDays > vestingDays) {
      return Response.json({ error: 'Invalid vesting duration' }, { status: 400 })
    }

    const id = randomUUID()
    const now = Math.floor(Date.now() / 1000)
    try {
      // Serialize the commitment check with the award insert. The application
      // UNIQUE constraint handles duplicate requests for one app.
      db.exec(`BEGIN IMMEDIATE`)
      const reserved = reservedFromPool(app.grant_id)
      if (GRANTHUB_FINANCIAL_ENABLED) {
        const pool = confirmedPool(app.grant_id)
        const available = pool - reserved
        if (amountRaw > available) {
          db.exec(`ROLLBACK`)
          return Response.json({ error: 'Insufficient available pool', available, pool, reserved, requested: amountRaw }, { status: 409 })
        }
      } else if (grant.declared_budget > 0) {
        const availableBudget = grant.declared_budget * 1_000_000 - reserved
        if (amountRaw > availableBudget) {
          db.exec(`ROLLBACK`)
          return Response.json({ error: 'Award exceeds the grant commitment budget', available: availableBudget, requested: amountRaw }, { status: 409 })
        }
      }

      db.prepare(`INSERT INTO awards
        (id,application_id,grant_id,org_id,beneficiary_addr,amount_raw,
         vesting_start,vesting_cliff_days,vesting_total_days,revocable,
         status,authorized_by,authorized_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, matchCreateAward[1], app.grant_id, grant.org_id,
        (beneficiary || app.applicant_addr).toLowerCase(),
        amountRaw,
        Number(body.vesting_start ?? now),
        cliffDays,
        vestingDays,
        body.revocable === false ? 0 : grant.revocable,
        'pending',
        session.address, now, now, now,
      )
      db.prepare(`UPDATE applications SET status = 'pending_funding', updated_at = ? WHERE id = ?`).run(now, matchCreateAward[1])
      db.exec(`COMMIT`)
    } catch (error) {
      try { db.exec(`ROLLBACK`) } catch {}
      const existingAward = db.prepare<{ id: string }, string>(`SELECT id FROM awards WHERE application_id = ?`).get(matchCreateAward[1])
      if (existingAward) return Response.json({ error: 'Award already exists', id: existingAward.id }, { status: 409 })
      throw error
    }
    auditLog(session.address, 'create_award', 'application', matchCreateAward[1], `${amountRaw}`)
    notify(app.applicant_addr, 'award_pending_funding', matchCreateAward[1], 'Your application was approved and an award is pending funding.')

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
    if (!['pending','failed'].includes(award.status)) {
      return Response.json({ error: `Cannot activate from status: ${award.status}` }, { status: 409 })
    }
    const grantConfig = db.prepare<{
      pool_contract_address: string | null; pool_chain_id: number | null
    }, string>(`SELECT pool_contract_address, pool_chain_id FROM grants WHERE id = ?`).get(award.grant_id)
    if (!grantConfig?.pool_contract_address || !grantConfig.pool_chain_id) {
      return Response.json({ error: 'Grant has no configured GrantPool and chain' }, { status: 409 })
    }

    const body = await req.json() as Record<string, unknown>
    const { onchain_award_index, pool_contract_address, chain_id, tx_hash } = body

    // Only the transaction hash and award index are caller inputs. Pool and
    // chain are bound to the grant configuration, not accepted from the UI.
    if (!tx_hash)               return Response.json({ error: 'tx_hash required' }, { status: 400 })
    if (onchain_award_index == null) return Response.json({ error: 'onchain_award_index required' }, { status: 400 })
    const onchainAwardIndex = Number(onchain_award_index)
    const chainId = grantConfig.pool_chain_id
    const poolContractAddress = grantConfig.pool_contract_address.toLowerCase()
    if (!Number.isSafeInteger(onchainAwardIndex) || onchainAwardIndex < 0) return Response.json({ error: 'onchain_award_index must be a safe integer' }, { status: 400 })
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(tx_hash))) return Response.json({ error: 'Invalid tx_hash' }, { status: 400 })
    if (pool_contract_address != null && String(pool_contract_address).toLowerCase() !== poolContractAddress) {
      return Response.json({ error: 'pool_contract_address does not match the grant configuration' }, { status: 422 })
    }
    if (chain_id != null && Number(chain_id) !== chainId) {
      return Response.json({ error: 'chain_id does not match the grant configuration' }, { status: 422 })
    }

    const txOwner = db.prepare<{ id: string }, string>(
      `SELECT id FROM awards WHERE tx_hash = ?`,
    ).get(String(tx_hash))
    if (txOwner && txOwner.id !== matchActivate[1]) {
      return Response.json({ error: 'Transaction hash has already activated another award' }, { status: 409 })
    }

    // Claim the transition atomically so concurrent requests cannot both verify
    // and persist the same onchain activation.
    const now = Math.floor(Date.now() / 1000)
    const claimed = db.prepare(
      `UPDATE awards SET status='activating', updated_at=?
       WHERE id=? AND status IN ('pending','failed')`,
    ).run(now, matchActivate[1])
    if (claimed.changes !== 1) {
      return Response.json({ error: 'Award activation is already being processed' }, { status: 409 })
    }

    // Independent onchain verification — do NOT trust caller-supplied schedule_id
    const result = await verifyActivationTx(String(tx_hash), {
      awardDbId:           matchActivate[1],
      onchainAwardIndex,
      poolContractAddress,
      beneficiaryAddr:     award.beneficiary_addr,
      amountRaw:           award.amount_raw,
      vestingCliffDays:    award.vesting_cliff_days,
      vestingDays:         award.vesting_total_days,
      chainId,
    })

    if (!result.ok) {
      // Revert to 'failed' so it can be retried with a correct tx
      db.prepare(`UPDATE awards SET status='failed', updated_at=? WHERE id=?`).run(now, matchActivate[1])
      auditLog(session.address, 'activate_award_failed', 'award', matchActivate[1], result.error)
      return Response.json({ error: `Onchain verification failed: ${result.error}` }, { status: 422 })
    }

    if (result.vestingStartTime == null || result.scheduleId == null || result.vestingContract == null) {
      db.prepare(`UPDATE awards SET status='failed', updated_at=? WHERE id=? AND status='activating'`).run(now, matchActivate[1])
      auditLog(session.address, 'activate_award_failed', 'award', matchActivate[1], 'Verifier returned incomplete schedule data')
      return Response.json({ error: 'Onchain verification returned incomplete schedule data' }, { status: 422 })
    }

    // Verification passed — write verified data from chain (NOT from request body)
    const finalized = db.prepare(`UPDATE awards SET
      vesting_start=?, contract_address=?, chain_id=?, schedule_id=?, tx_hash=?,
      status='active', activated_at=?, updated_at=?
      WHERE id = ? AND status = 'activating'`).run(
      result.vestingStartTime,
      result.vestingContract,
      chainId,
      result.scheduleId,
      String(tx_hash),
      now, now, matchActivate[1],
    )
    if (finalized.changes !== 1) {
      auditLog(session.address, 'activate_award_state_changed', 'award', matchActivate[1], 'verification succeeded but activation state was no longer activating')
      return Response.json({ error: 'Award activation state changed before finalization' }, { status: 409 })
    }
    db.prepare(`UPDATE applications SET status='funded', updated_at=? WHERE id=?`).run(now, award.application_id)
    notify(award.beneficiary_addr, 'award_funded', award.application_id, 'Your award has been funded and its vesting schedule is active.')
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
    if (!GRANTHUB_FINANCIAL_ENABLED) return financialDisabled()
    const session = requireAuth(req)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const award = db.prepare<AwardRow, string>(`SELECT * FROM awards WHERE id = ?`).get(matchFail[1])
    if (!award) return Response.json({ error: 'Not found' }, { status: 404 })
    if (!isOrgAdmin(award.org_id, session.address)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (!canMarkAwardFailed(award.status)) {
      return Response.json({ error: `Cannot fail award from status: ${award.status}` }, { status: 409 })
    }
    const now = Math.floor(Date.now() / 1000)
    const failed = db.prepare(`UPDATE awards SET status='failed', updated_at=? WHERE id=? AND status='activating'`).run(now, matchFail[1])
    if (failed.changes !== 1) return Response.json({ error: 'Award activation state changed; retry status lookup' }, { status: 409 })
    db.prepare(`UPDATE applications SET status='approved', updated_at=? WHERE id=?`).run(now, award.application_id)
    const application = db.prepare<{ applicant_addr: string }, string>(`SELECT applicant_addr FROM applications WHERE id = ?`).get(award.application_id)
    if (application) notify(application.applicant_addr, 'award_activation_failed', award.application_id, 'Award activation failed and is awaiting another authorized attempt.')
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
    return Response.json(awards.map(fmtAward))
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
    return Response.json(awards.map(fmtAward))
  }

  return null
}
