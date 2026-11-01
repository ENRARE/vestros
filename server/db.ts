/**
 * GrantHub database — single SQLite instance, WAL mode.
 * Exports `db` (ready-to-use Database) and `auditLog`.
 * Schema version is tracked in schema_version; migrations are additive only.
 */
import { Database } from 'bun:sqlite'
import path from 'path'
import { randomUUID } from 'crypto'
import { ensureVestingIndexSchema } from './vestingStorage'

const DB_PATH = process.env.GRANTHUB_DB_PATH ?? path.join(import.meta.dir, '../.granthub.db')

// ── Singleton ──────────────────────────────────────────────────────────────────
export const db: Database = new Database(DB_PATH, { create: true })
db.exec(`PRAGMA journal_mode=WAL`)
db.exec(`PRAGMA synchronous=FULL`)
db.exec(`PRAGMA busy_timeout=5000`)
db.exec(`PRAGMA foreign_keys=ON`)

// ── Schema migration ───────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL DEFAULT 0);
  INSERT OR IGNORE INTO schema_version (version) VALUES (0);
`)

function currentVersion(): number {
  return (db.prepare(`SELECT version FROM schema_version`).get() as { version: number }).version
}

function bumpVersion(v: number) {
  db.prepare(`UPDATE schema_version SET version = ?`).run(v)
}

// ── v1: auth tables ────────────────────────────────────────────────────────────
if (currentVersion() < 1) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_nonces (
      nonce      TEXT PRIMARY KEY,
      address    TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_tokens (
      token      TEXT PRIMARY KEY,
      address    TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `)
  bumpVersion(1)
}

// ── v2: orgs + grants + applications + reviews + awards + deposits ─────────────
if (currentVersion() < 2) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orgs (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      description      TEXT NOT NULL DEFAULT '',
      website          TEXT NOT NULL DEFAULT '',
      logo_url         TEXT NOT NULL DEFAULT '',
      twitter          TEXT NOT NULL DEFAULT '',
      github           TEXT NOT NULL DEFAULT '',
      treasury_address TEXT NOT NULL DEFAULT '',
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS org_members (
      org_id  TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      address TEXT NOT NULL,
      role    TEXT NOT NULL DEFAULT 'reviewer',
      PRIMARY KEY (org_id, address)
    );

    CREATE TABLE IF NOT EXISTS grants (
      id                  TEXT PRIMARY KEY,
      org_id              TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      title               TEXT NOT NULL,
      description         TEXT NOT NULL DEFAULT '',
      goals               TEXT NOT NULL DEFAULT '',
      eligibility         TEXT NOT NULL DEFAULT '',
      requirements        TEXT NOT NULL DEFAULT '',
      category            TEXT NOT NULL DEFAULT 'general',
      status              TEXT NOT NULL DEFAULT 'draft',
      declared_budget     REAL NOT NULL DEFAULT 0,
      min_award           REAL NOT NULL DEFAULT 0,
      max_award           REAL NOT NULL DEFAULT 0,
      deadline            INTEGER,
      start_date          INTEGER,
      end_date            INTEGER,
      vesting_cliff_days  INTEGER NOT NULL DEFAULT 0,
      vesting_total_days  INTEGER NOT NULL DEFAULT 365,
      revocable           INTEGER NOT NULL DEFAULT 1,
      faqs                TEXT NOT NULL DEFAULT '[]',
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applications (
      id              TEXT PRIMARY KEY,
      grant_id        TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
      applicant_addr  TEXT NOT NULL,
      project_name    TEXT NOT NULL DEFAULT '',
      summary         TEXT NOT NULL DEFAULT '',
      problem         TEXT NOT NULL DEFAULT '',
      solution        TEXT NOT NULL DEFAULT '',
      milestones      TEXT NOT NULL DEFAULT '[]',
      requested_raw   INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'draft',
      submitted_at    INTEGER,        -- nullable: NULL until explicitly submitted
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id              TEXT PRIMARY KEY,
      application_id  TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      reviewer_addr   TEXT NOT NULL,
      score           INTEGER,
      comment         TEXT NOT NULL DEFAULT '',
      decision        TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      UNIQUE(application_id, reviewer_addr)
    );

    CREATE TABLE IF NOT EXISTS awards (
      id                   TEXT PRIMARY KEY,
      application_id       TEXT NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
      grant_id             TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
      org_id               TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      beneficiary_addr     TEXT NOT NULL,
      amount_raw           INTEGER NOT NULL,
      vesting_start        INTEGER,
      vesting_cliff_days   INTEGER NOT NULL DEFAULT 0,
      vesting_total_days   INTEGER NOT NULL DEFAULT 365,
      revocable            INTEGER NOT NULL DEFAULT 1,
      contract_address     TEXT,
      chain_id             INTEGER,
      schedule_id          TEXT,
      tx_hash              TEXT,
      status               TEXT NOT NULL DEFAULT 'pending',
      authorized_by        TEXT,
      authorized_at        INTEGER,
      activated_at         INTEGER,
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deposits (
      id           TEXT PRIMARY KEY,
      grant_id     TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
      sponsor_addr TEXT NOT NULL,
      amount_raw   INTEGER NOT NULL,
      tx_hash      TEXT UNIQUE,
      block_number INTEGER,
      confirmed    INTEGER NOT NULL DEFAULT 0,
      deposited_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id         TEXT PRIMARY KEY,
      actor_addr TEXT NOT NULL,
      action     TEXT NOT NULL,
      entity     TEXT NOT NULL,
      entity_id  TEXT,
      note       TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_grants_org      ON grants(org_id);
    CREATE INDEX IF NOT EXISTS idx_grants_status   ON grants(status);
    CREATE INDEX IF NOT EXISTS idx_apps_grant      ON applications(grant_id);
    CREATE INDEX IF NOT EXISTS idx_apps_applicant  ON applications(applicant_addr);
    CREATE INDEX IF NOT EXISTS idx_reviews_app     ON reviews(application_id);
    CREATE INDEX IF NOT EXISTS idx_awards_grant    ON awards(grant_id);
    CREATE INDEX IF NOT EXISTS idx_awards_benef    ON awards(beneficiary_addr);
    CREATE INDEX IF NOT EXISTS idx_deposits_grant  ON deposits(grant_id);

    CREATE TABLE IF NOT EXISTS profiles (
      address       TEXT PRIMARY KEY,
      display_name  TEXT NOT NULL DEFAULT '',
      bio           TEXT NOT NULL DEFAULT '',
      github        TEXT NOT NULL DEFAULT '',
      portfolio     TEXT NOT NULL DEFAULT '',
      skills        TEXT NOT NULL DEFAULT '[]',
      team          TEXT NOT NULL DEFAULT '[]',
      public_fields TEXT NOT NULL DEFAULT '["display_name","bio","skills"]',
      updated_at    INTEGER NOT NULL
    );
  `)
  bumpVersion(2)
}

// ── v3: fix applications schema — add created_at; make submitted_at nullable ───
// SQLite cannot drop a NOT NULL constraint in-place. We use the recommended
// table-rename + recreate approach, preserving all existing rows.
// This migration is idempotent: IF NOT EXISTS guards prevent re-runs from
// failing on a fresh database where v2 already used the corrected schema.
if (currentVersion() < 3) {
  // Only ADD COLUMN if created_at doesn't already exist (SQLite < 3.37 has no ADD IF NOT EXISTS).
  // The v2 schema in this checkout is already corrected; skip the table rebuild in
  // that case so upgrading a live database does not touch existing application rows.
  type ColInfo = { name: string; not_null: number }
  const columns = db.prepare<ColInfo, string>(
    `SELECT name, "notnull" AS not_null FROM pragma_table_info('applications')`,
  ).all()
  const hasCreatedAt = columns.some(col => col.name === 'created_at')
  const submittedAt = columns.find(col => col.name === 'submitted_at')
  if (!hasCreatedAt) {
    db.exec(`ALTER TABLE applications ADD COLUMN created_at INTEGER`)
  }
  const needsRebuild = !hasCreatedAt || submittedAt?.not_null !== 0
  if (needsRebuild) {
    // SQLite cannot drop a NOT NULL constraint in-place. Foreign keys are
    // temporarily disabled only for this table swap; they are restored even
    // when the migration throws, and the referenced rows are copied verbatim.
    db.exec(`PRAGMA foreign_keys=OFF`)
    try {
      db.exec(`
        UPDATE applications SET created_at = updated_at WHERE created_at IS NULL;

        DROP TABLE IF EXISTS applications_v3;
        CREATE TABLE applications_v3 (
          id              TEXT PRIMARY KEY,
          grant_id        TEXT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
          applicant_addr  TEXT NOT NULL,
          project_name    TEXT NOT NULL DEFAULT '',
          summary         TEXT NOT NULL DEFAULT '',
          problem         TEXT NOT NULL DEFAULT '',
          solution        TEXT NOT NULL DEFAULT '',
          milestones      TEXT NOT NULL DEFAULT '[]',
          requested_raw   INTEGER NOT NULL DEFAULT 0,
          status          TEXT NOT NULL DEFAULT 'draft',
          submitted_at    INTEGER,
          created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at      INTEGER NOT NULL
        );
        INSERT INTO applications_v3
          SELECT id, grant_id, applicant_addr, project_name, summary, problem,
                 solution, milestones, requested_raw, status,
                 CASE WHEN submitted_at = 0 THEN NULL ELSE submitted_at END,
                 COALESCE(created_at, updated_at),
                 updated_at
          FROM applications;
        DROP TABLE applications;
        ALTER TABLE applications_v3 RENAME TO applications;

        CREATE INDEX IF NOT EXISTS idx_apps_grant     ON applications(grant_id);
        CREATE INDEX IF NOT EXISTS idx_apps_applicant ON applications(applicant_addr);
      `)
    } finally {
      db.exec(`PRAGMA foreign_keys=ON`)
    }
  }
  bumpVersion(3)
}

// ── Helpers ────────────────────────────────────────────────────────────────────
// v4: bind grants to deployed pools and record independently verified deposits.
if (currentVersion() < 4) {
  type ColumnInfo = { name: string }
  const grantColumns = db.prepare<ColumnInfo, string>(
    `SELECT name FROM pragma_table_info('grants')`,
  ).all()
  const depositColumns = db.prepare<ColumnInfo, string>(
    `SELECT name FROM pragma_table_info('deposits')`,
  ).all()
  const hasGrantColumn = (name: string) => grantColumns.some(col => col.name === name)
  const hasDepositColumn = (name: string) => depositColumns.some(col => col.name === name)

  if (!hasGrantColumn('pool_contract_address')) {
    db.exec(`ALTER TABLE grants ADD COLUMN pool_contract_address TEXT`)
  }
  if (!hasGrantColumn('pool_chain_id')) {
    db.exec(`ALTER TABLE grants ADD COLUMN pool_chain_id INTEGER`)
  }
  if (!hasDepositColumn('verified')) {
    db.exec(`ALTER TABLE deposits ADD COLUMN verified INTEGER NOT NULL DEFAULT 0`)
  }
  if (!hasDepositColumn('verified_chain_id')) {
    db.exec(`ALTER TABLE deposits ADD COLUMN verified_chain_id INTEGER`)
  }
  if (!hasDepositColumn('verified_pool_contract_address')) {
    db.exec(`ALTER TABLE deposits ADD COLUMN verified_pool_contract_address TEXT`)
  }
  if (!hasDepositColumn('verified_token_address')) {
    db.exec(`ALTER TABLE deposits ADD COLUMN verified_token_address TEXT`)
  }
  if (!hasDepositColumn('verified_at')) {
    db.exec(`ALTER TABLE deposits ADD COLUMN verified_at INTEGER`)
  }
  const duplicateAwardTx = db.prepare<{ tx_hash: string; count: number }, []>(
    `SELECT tx_hash, COUNT(*) as count FROM awards
     WHERE tx_hash IS NOT NULL GROUP BY tx_hash HAVING COUNT(*) > 1`,
  ).all()
  if (duplicateAwardTx.length > 0) {
    throw new Error('Cannot apply v4: duplicate award transaction hashes require manual reconciliation')
  }
  const duplicateGrantPools = db.prepare<{ pool_contract_address: string; count: number }, []>(
    `SELECT lower(pool_contract_address) as pool_contract_address, COUNT(*) as count
     FROM grants WHERE pool_contract_address IS NOT NULL
     GROUP BY lower(pool_contract_address) HAVING COUNT(*) > 1`,
  ).all()
  if (duplicateGrantPools.length > 0) {
    throw new Error('Cannot apply v4: a GrantPool address is configured for multiple grants')
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_awards_tx_hash_unique ON awards(tx_hash) WHERE tx_hash IS NOT NULL`)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_grants_pool_address_unique
    ON grants(lower(pool_contract_address)) WHERE pool_contract_address IS NOT NULL`)
  bumpVersion(4)
}

// v5: complete GrantHub application records and persisted notifications.
// All changes are additive so existing organizations, grants, applications,
// reviews, awards, and deposits remain intact.
if (currentVersion() < 5) {
  type ColumnInfo = { name: string }
  const hasColumn = (table: string, name: string) => db.prepare<ColumnInfo, string>(
    `SELECT name FROM pragma_table_info(?) WHERE name = ?`,
  ).get(table, name) != null
  const addColumn = (table: string, name: string, definition: string) => {
    if (!hasColumn(table, name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
  }

  addColumn('grants', 'funding_terms', `TEXT NOT NULL DEFAULT ''`)
  addColumn('grants', 'deliverables', `TEXT NOT NULL DEFAULT ''`)
  addColumn('grants', 'custom_questions', `TEXT NOT NULL DEFAULT '[]'`)
  addColumn('grants', 'allow_multiple_applications', `INTEGER NOT NULL DEFAULT 0`)

  addColumn('applications', 'applicant_name', `TEXT NOT NULL DEFAULT ''`)
  addColumn('applications', 'email', `TEXT NOT NULL DEFAULT ''`)
  addColumn('applications', 'country', `TEXT NOT NULL DEFAULT ''`)
  addColumn('applications', 'applicant_type', `TEXT NOT NULL DEFAULT 'individual'`)
  addColumn('applications', 'github_url', `TEXT NOT NULL DEFAULT ''`)
  addColumn('applications', 'portfolio_url', `TEXT NOT NULL DEFAULT ''`)
  addColumn('applications', 'project_category', `TEXT NOT NULL DEFAULT ''`)
  addColumn('applications', 'development_stage', `TEXT NOT NULL DEFAULT ''`)
  addColumn('applications', 'tech_stack', `TEXT NOT NULL DEFAULT ''`)
  addColumn('applications', 'ecosystem_benefit', `TEXT NOT NULL DEFAULT ''`)
  addColumn('applications', 'use_of_funds', `TEXT NOT NULL DEFAULT ''`)
  addColumn('applications', 'budget_breakdown', `TEXT NOT NULL DEFAULT ''`)
  addColumn('applications', 'completion_date', `INTEGER`)
  addColumn('applications', 'previous_experience', `TEXT NOT NULL DEFAULT ''`)
  addColumn('applications', 'custom_answers', `TEXT NOT NULL DEFAULT '{}'`)
  addColumn('applications', 'attachments', `TEXT NOT NULL DEFAULT '[]'`)

  addColumn('reviews', 'criteria_scores', `TEXT NOT NULL DEFAULT '{}'`)
  addColumn('reviews', 'eligibility_checks', `TEXT NOT NULL DEFAULT '[]'`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id             TEXT PRIMARY KEY,
      recipient_addr TEXT NOT NULL,
      type           TEXT NOT NULL,
      entity_id      TEXT,
      message        TEXT NOT NULL,
      read           INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_recipient
      ON notifications(recipient_addr, read, created_at);
  `)
  bumpVersion(5)
}

// v6: persistent Vestros vesting-event index. This migration is additive and
// intentionally leaves all GrantHub tables and existing WAL/SHM state intact.
if (currentVersion() < 6) {
  ensureVestingIndexSchema(db)
  bumpVersion(6)
}

export function auditLog(
  actorAddr: string,
  action: string,
  entity: string,
  entityId?: string,
  note?: string,
) {
  db.prepare(
    `INSERT INTO audit_log (id,actor_addr,action,entity,entity_id,note,created_at)
     VALUES (?,?,?,?,?,?,unixepoch())`,
  ).run(randomUUID(), actorAddr.toLowerCase(), action, entity, entityId ?? null, note ?? null)
}

export function notify(
  recipientAddr: string,
  type: string,
  entityId: string | undefined,
  message: string,
) {
  db.prepare(
    `INSERT INTO notifications (id,recipient_addr,type,entity_id,message,created_at)
     VALUES (?,?,?,?,?,unixepoch())`,
  ).run(randomUUID(), recipientAddr.toLowerCase(), type, entityId ?? null, message)
}

// Legacy shim: some callers import getDb() — keep it working
export function getDb(): Database { return db }
