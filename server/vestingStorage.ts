import type { Database } from 'bun:sqlite'

export type VestingEventType = 'created' | 'claimed' | 'revoked'
export type IndexCoverage = 'complete' | 'partial' | 'unavailable'

export interface VestingHistoryRecord {
  chainId: number
  vaultAddress: string
  vaultOwner?: string
  scheduleId: string
  type: VestingEventType
  beneficiary: string
  amount: string
  blockNumber: string
  blockHash?: string
  blockTimestamp?: number
  txHash: string
  logIndex: number
  status: 'confirmed'
}

export interface IndexerSourceRow {
  chainId: number
  sourceAddress: string
  sourceKind: 'core' | 'factory' | 'vault'
  startBlock: string
  nextBlock: string
  headBlock: string
  status: 'pending' | 'running' | 'complete' | 'partial' | 'unavailable'
  error: string | null
}

export interface VestingVaultRow {
  chainId: number
  vaultAddress: string
  ownerAddress: string
  createdBlock: string
  createdTxHash?: string
}

export interface ActivityQuery {
  chainId: number
  wallet?: string
  organization?: string
  vaultAddress?: string
  beneficiary?: string
  scheduleId?: string
  type?: VestingEventType
  page?: number
  limit?: number
}

export interface ActivityQueryResult {
  records: VestingHistoryRecord[]
  page: number
  limit: number
  hasMore: boolean
  coverage: IndexCoverage
  updatedAt: number | null
}

export function ensureVestingIndexSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS vesting_index_sources (
      chain_id       INTEGER NOT NULL,
      source_address TEXT NOT NULL,
      source_kind    TEXT NOT NULL CHECK (source_kind IN ('core','factory','vault')),
      start_block   TEXT NOT NULL,
      next_block    TEXT NOT NULL,
      head_block    TEXT NOT NULL DEFAULT '0',
      status        TEXT NOT NULL DEFAULT 'pending',
      error         TEXT,
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (chain_id, source_address, source_kind)
    );

    CREATE TABLE IF NOT EXISTS vesting_vaults (
      chain_id       INTEGER NOT NULL,
      vault_address  TEXT NOT NULL,
      owner_address  TEXT NOT NULL,
      created_block  TEXT NOT NULL,
      created_tx_hash TEXT,
      updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (chain_id, vault_address)
    );

    CREATE TABLE IF NOT EXISTS vesting_events (
      chain_id        INTEGER NOT NULL,
      vault_address   TEXT NOT NULL,
      vault_owner     TEXT,
      schedule_id     TEXT NOT NULL,
      event_type      TEXT NOT NULL CHECK (event_type IN ('created','claimed','revoked')),
      beneficiary     TEXT NOT NULL,
      amount          TEXT NOT NULL,
      block_number    TEXT NOT NULL,
      block_hash      TEXT,
      block_timestamp INTEGER,
      tx_hash         TEXT NOT NULL,
      log_index       INTEGER NOT NULL,
      status          TEXT NOT NULL DEFAULT 'confirmed',
      indexed_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (chain_id, vault_address, tx_hash, log_index)
    );

    CREATE INDEX IF NOT EXISTS idx_vesting_events_schedule
      ON vesting_events(chain_id, vault_address, schedule_id, block_number, log_index);
    CREATE INDEX IF NOT EXISTS idx_vesting_events_beneficiary
      ON vesting_events(chain_id, beneficiary, block_number, log_index);
    CREATE INDEX IF NOT EXISTS idx_vesting_events_block
      ON vesting_events(chain_id, vault_address, block_number);
  `)
}

function normalizeAddress(value: string): string {
  return value.toLowerCase()
}

export function saveIndexerSource(database: Database, source: IndexerSourceRow): void {
  database.prepare(`
    INSERT INTO vesting_index_sources
      (chain_id, source_address, source_kind, start_block, next_block, head_block, status, error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(chain_id, source_address, source_kind) DO UPDATE SET
      start_block = excluded.start_block,
      next_block = excluded.next_block,
      head_block = excluded.head_block,
      status = excluded.status,
      error = excluded.error,
      updated_at = unixepoch()
  `).run(
    source.chainId,
    normalizeAddress(source.sourceAddress),
    source.sourceKind,
    source.startBlock,
    source.nextBlock,
    source.headBlock,
    source.status,
    source.error,
  )
}

export function readIndexerSources(database: Database): IndexerSourceRow[] {
  return database.prepare<IndexerSourceRow, []>(
    `SELECT chain_id as chainId, source_address as sourceAddress, source_kind as sourceKind,
            start_block as startBlock, next_block as nextBlock, head_block as headBlock,
            status, error FROM vesting_index_sources ORDER BY source_kind, source_address`,
  ).all()
}

export function saveVestingVault(database: Database, vault: VestingVaultRow): void {
  database.prepare(`
    INSERT INTO vesting_vaults
      (chain_id, vault_address, owner_address, created_block, created_tx_hash, updated_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(chain_id, vault_address) DO UPDATE SET
      owner_address = excluded.owner_address,
      created_block = CASE
        WHEN excluded.created_tx_hash IS NOT NULL OR vesting_vaults.created_block = '0' THEN excluded.created_block
        ELSE vesting_vaults.created_block
      END,
      created_tx_hash = COALESCE(vesting_vaults.created_tx_hash, excluded.created_tx_hash),
      updated_at = unixepoch()
  `).run(
    vault.chainId,
    normalizeAddress(vault.vaultAddress),
    normalizeAddress(vault.ownerAddress),
    vault.createdBlock,
    vault.createdTxHash ?? null,
  )
}

export function readVestingVaults(database: Database, chainId: number): VestingVaultRow[] {
  return database.prepare<VestingVaultRow, [number]>(`
    SELECT chain_id as chainId, vault_address as vaultAddress, owner_address as ownerAddress,
           created_block as createdBlock, created_tx_hash as createdTxHash
    FROM vesting_vaults
    WHERE chain_id = ?
    ORDER BY CAST(created_block AS INTEGER), vault_address
  `).all(chainId)
}

function eventParams(record: VestingHistoryRecord): (string | number | null)[] {
  return [
    record.chainId,
    normalizeAddress(record.vaultAddress),
    record.vaultOwner ? normalizeAddress(record.vaultOwner) : null,
    record.scheduleId,
    record.type,
    normalizeAddress(record.beneficiary),
    record.amount,
    record.blockNumber,
    record.blockHash ?? null,
    record.blockTimestamp ?? null,
    record.txHash.toLowerCase(),
    record.logIndex,
    record.status,
  ]
}

export function insertVestingEvents(database: Database, records: readonly VestingHistoryRecord[]): void {
  if (records.length === 0) return
  const transaction = database.transaction((rows: readonly VestingHistoryRecord[]) => {
    insertVestingEventsInternal(database, rows)
  })
  transaction(records)
}

function insertVestingEventsInternal(database: Database, records: readonly VestingHistoryRecord[]): void {
  if (records.length === 0) return
  const statement = database.prepare(`
    INSERT INTO vesting_events
      (chain_id, vault_address, vault_owner, schedule_id, event_type, beneficiary, amount,
       block_number, block_hash, block_timestamp, tx_hash, log_index, status, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(chain_id, vault_address, tx_hash, log_index) DO UPDATE SET
      vault_owner = excluded.vault_owner,
      schedule_id = excluded.schedule_id,
      event_type = excluded.event_type,
      beneficiary = excluded.beneficiary,
      amount = excluded.amount,
      block_number = excluded.block_number,
      block_hash = excluded.block_hash,
      block_timestamp = excluded.block_timestamp,
      status = excluded.status,
      indexed_at = unixepoch()
  `)
  for (const record of records) statement.run(...eventParams(record))
}

export function replaceReorgWindow(
  database: Database,
  chainId: number,
  vaultAddress: string,
  fromBlock: string,
  records: readonly VestingHistoryRecord[],
): void {
  const transaction = database.transaction(() => {
    database.prepare(`DELETE FROM vesting_events WHERE chain_id = ? AND vault_address = ? AND block_number >= ?`)
      .run(chainId, normalizeAddress(vaultAddress), fromBlock)
    insertVestingEventsInternal(database, records)
  })
  transaction()
}

function coverageFor(database: Database, chainId: number): IndexCoverage {
  const rows = database.prepare<{ status: string }, number>(
    `SELECT status FROM vesting_index_sources WHERE chain_id = ?`,
  ).all(chainId)
  if (rows.length === 0) return 'unavailable'
  if (rows.some(row => row.status === 'unavailable')) return rows.some(row => row.status === 'complete') ? 'partial' : 'unavailable'
  if (rows.some(row => row.status === 'partial' || row.status === 'running' || row.status === 'pending')) return 'partial'
  return 'complete'
}

export function queryVestingEvents(database: Database, query: ActivityQuery): ActivityQueryResult {
  const page = Math.max(1, Math.floor(query.page ?? 1))
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 50)))
  const where = ['chain_id = ?']
  const params: (string | number)[] = [query.chainId]
  if (query.wallet) {
    where.push('(beneficiary = ? OR vault_owner = ?)')
    params.push(normalizeAddress(query.wallet), normalizeAddress(query.wallet))
  }
  if (query.organization) { where.push('vault_owner = ?'); params.push(normalizeAddress(query.organization)) }
  if (query.vaultAddress) { where.push('vault_address = ?'); params.push(normalizeAddress(query.vaultAddress)) }
  if (query.beneficiary) { where.push('beneficiary = ?'); params.push(normalizeAddress(query.beneficiary)) }
  if (query.scheduleId) { where.push('schedule_id = ?'); params.push(query.scheduleId) }
  if (query.type) { where.push('event_type = ?'); params.push(query.type) }
  const rows = database.prepare<Record<string, unknown>, (string | number)[]>(`
    SELECT chain_id as chainId, vault_address as vaultAddress, vault_owner as vaultOwner,
      schedule_id as scheduleId, event_type as type, beneficiary, amount,
      block_number as blockNumber, block_hash as blockHash, block_timestamp as blockTimestamp,
      tx_hash as txHash, log_index as logIndex, status
    FROM vesting_events WHERE ${where.join(' AND ')}
    ORDER BY CAST(block_number AS INTEGER) DESC, log_index DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit + 1, (page - 1) * limit)
  const records = rows.slice(0, limit).map(row => ({
    chainId: Number(row.chainId),
    vaultAddress: String(row.vaultAddress),
    vaultOwner: row.vaultOwner == null ? undefined : String(row.vaultOwner),
    scheduleId: String(row.scheduleId),
    type: String(row.type) as VestingEventType,
    beneficiary: String(row.beneficiary),
    amount: String(row.amount),
    blockNumber: String(row.blockNumber),
    blockHash: row.blockHash == null ? undefined : String(row.blockHash),
    blockTimestamp: row.blockTimestamp == null ? undefined : Number(row.blockTimestamp),
    txHash: String(row.txHash),
    logIndex: Number(row.logIndex),
    status: 'confirmed' as const,
  }))
  const updated = database.prepare<{ updatedAt: number | null }, number>(
    `SELECT MAX(updated_at) as updatedAt FROM vesting_index_sources WHERE chain_id = ?`,
  ).get(query.chainId)
  return { records, page, limit, hasMore: rows.length > limit, coverage: coverageFor(database, query.chainId), updatedAt: updated?.updatedAt ?? null }
}
