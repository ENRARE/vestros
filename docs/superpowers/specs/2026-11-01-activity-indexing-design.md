# Persistent Vesting Activity Indexing Design

## Goal

Move historical vesting-event indexing from the browser into the existing Bun + SQLite backend so Activity and schedule history load persisted, verified records without exposing RPC scanning progress or authenticated provider credentials.

## Chosen architecture

The server owns a bounded, incremental indexer for Arc Testnet (`5042002`). It stores normalized vesting events, discovered vaults, and per-source checkpoints in the existing SQLite database using additive migrations. It starts from configured verified deployment transaction receipts, discovers factory vaults from the factory event stream, and resumes from checkpoints rather than scanning from genesis.

The frontend consumes a paginated same-origin Activity API. Direct contract reads remain the source of truth for live schedules, balances, claimability, and ownership. Historical API coverage is explicitly `complete`, `partial`, or `unavailable`; the UI never presents an incomplete response as an empty history.

## Scope

- Core `USDCVesting` and factory-created `SelfServiceVesting` events: `ScheduleCreated`, `Claimed`, and `ScheduleRevoked`.
- Factory `VaultCreated` discovery.
- Composite schedule identity: `(chainId, vaultAddress, scheduleId)`.
- Event identity: `(chainId, vaultAddress, transactionHash, logIndex)`.
- Block timestamp enrichment stored with each event.
- Incremental checkpoints with overlap for reorg detection.
- Bounded adaptive log ranges, server-side retries, and single-worker concurrency.
- Paginated, filtered API access for wallet, vault, beneficiary, and schedule views.

## Non-goals

- No contract changes, deployment, ownership changes, or financial transactions.
- No frontend historical `eth_getLogs` calls.
- No genesis or unbounded full-chain scan.
- No Mainnet fallback from Testnet configuration.
- No hardcoded production event records; known transactions are verification fixtures only.

## Storage

Migration v6 adds:

- `vesting_index_sources`: one row per `(chain_id, source_address, source_kind)` with start, next, head, status, and error.
- `vesting_vaults`: discovered/configured vaults with owner, creation block, and active status.
- `vesting_events`: normalized events with unique `(chain_id, vault_address, tx_hash, log_index)` and indexed schedule/beneficiary fields.

The migration is additive and leaves all GrantHub tables and WAL/SHM state intact.

## Indexer behavior

1. Resolve configured deployment transaction receipts and use their block numbers as start points.
2. Seed configured known vaults and discover factory vaults from `VaultCreated` logs.
3. Read logs in bounded ranges. The initial Testnet range is at most 10 blocks so the configured Alchemy fallback remains compatible; range growth is capped at 10.
4. Save each batch transactionally, enrich timestamps from block reads, and advance the checkpoint only after persistence succeeds.
5. Re-scan a small overlap on restart and remove/rewrite events in the overlap when a reorg changes the block hash.
6. Retry 429, range, timeout, and provider errors with exponential backoff. A failed source remains `partial` or `unavailable` and does not block direct reads.

## API

`GET /api/vesting/activity` accepts:

- `page` and `limit` (bounded to 100)
- `wallet`
- `vault`
- `beneficiary`
- `scheduleId`
- `status` / `coverage`

It returns `{ records, page, limit, hasMore, coverage, updatedAt }`, where records include chain ID, vault, optional vault owner, schedule ID, event type, beneficiary, amount, block number, block timestamp, transaction hash, log index, and confirmed status.

## Frontend contract

`useVestingEvents` becomes a compatibility adapter over the Activity API for derived analytics and legacy consumers. It no longer creates a public client or calls `eth_getLogs`. It exposes records and coverage state while retaining direct-read consumers unchanged. The user-facing progress percentage and remaining-block display are removed.

Schedule transaction history uses the same API records filtered by `(vaultAddress, scheduleId)`. Wallet changes invalidate the query key and never reuse records from the previous wallet.

## Failure semantics

- `complete`: the server has covered the configured source ranges through its current head.
- `partial`: records are available but one or more sources lag or failed.
- `unavailable`: no trustworthy historical response is available.
- Empty records are shown as “No verified activity” only for `complete` coverage.

