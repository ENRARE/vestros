/**
 * GrantHub database — single SQLite instance, WAL mode.
 * Exports `db` (ready-to-use Database) and `auditLog`.
 * Schema version is tracked in schema_version; migrations are additive only.
 */
import { Database } from 'bun:sqlite'
import path from 'path'

const DB_PATH = path.join(import.meta.dir, '../.granthub.db')

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
  // Only ADD COLUMN if created_at doesn't already exist (SQLite < 3.37 has no ADD IF NOT EXISTS)
  type ColInfo = { name: string }
  const existingCols = db.prepare<ColInfo, string>(
    `SELECT name FROM pragma_table_info('applications') WHERE name = 'created_at'`
  ).get('created_at')
  if (!existingCols) {
    db.exec(`ALTER TABLE applications ADD COLUMN created_at INTEGER`)
  }
  db.exec(`
    -- Back-fill created_at from updated_at for any existing rows
    UPDATE applications SET created_at = updated_at WHERE created_at IS NULL;

    -- SQLite table-rebuild to drop the NOT NULL constraint on submitted_at.
    -- Steps: create new table, copy data, drop old, rename new.
    CREATE TABLE IF NOT EXISTS applications_v3 (
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
    INSERT OR IGNORE INTO applications_v3
      SELECT id, grant_id, applicant_addr, project_name, summary, problem,
             solution, milestones, requested_raw, status,
             CASE WHEN submitted_at = 0 THEN NULL ELSE submitted_at END,
             COALESCE(created_at, updated_at),
             updated_at
      FROM applications;
    DROP TABLE applications;
    ALTER TABLE applications_v3 RENAME TO applications;

    -- Re-create index (dropped with old table)
    CREATE INDEX IF NOT EXISTS idx_apps_grant     ON applications(grant_id);
    CREATE INDEX IF NOT EXISTS idx_apps_applicant ON applications(applicant_addr);
  `)
  bumpVersion(3)
}

// ── Helpers ────────────────────────────────────────────────────────────────────
import { randomUUID } from 'crypto'

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

// Legacy shim: some callers import getDb() — keep it working
export function getDb(): Database { return db }
