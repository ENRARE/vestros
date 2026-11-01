# Persistent Vesting Activity Indexing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace frontend block scanning with a persistent Bun + SQLite vesting activity indexer and API while preserving direct contract reads and existing GrantHub data.

**Architecture:** The Bun server indexes configured Arc Testnet vesting sources in bounded incremental batches, persists normalized events/checkpoints, and serves filtered pages through `/api/vesting/activity`. Frontend history and derived event consumers read that API; live balances and schedule details continue using direct contract reads.

**Tech Stack:** Bun, SQLite WAL, TypeScript, viem, React 18, wagmi, existing RPC proxy and reliability helpers.

**Spec:** `docs/superpowers/specs/2026-11-01-activity-indexing-design.md`

## Global Constraints

- Preserve chain ID `5042002`, never fall back to Mainnet.
- Do not modify contracts, broadcast transactions, change ownership, alter GrantHub financial settings, commit, or push.
- Preserve existing SQLite GrantHub tables and WAL/SHM state through additive migrations.
- Never scan from genesis or expose browser block-scanning progress.
- Keep authenticated RPC credentials server-side and cap log ranges at 10 blocks for the configured fallback.
- Use `(chainId,vaultAddress,scheduleId)` schedule identity and `(chainId,vaultAddress,txHash,logIndex)` event identity.

## Review Focus

- Migration restart safety: v6 must preserve existing rows and be idempotent.
- Checkpoint correctness: a batch checkpoint advances only after event persistence succeeds.
- Reorg safety: overlapping scans replace stale block events without duplicating records.
- Coverage semantics: partial/unavailable history must not render as empty complete history.
- Wallet isolation: API and React query keys must not leak one wallet’s records into another wallet’s view.

### Task 1: Add persistent event storage and indexer primitives

**Files:**
- Modify: `server/db.ts`
- Create: `server/vestingIndexer.ts`
- Create: `server/vestingIndexer.test.ts`
- Modify: `.env.example`

**Interfaces:**
- `type IndexCoverage = 'complete' | 'partial' | 'unavailable'`
- `type VestingHistoryRecord = { chainId: number; vaultAddress: string; vaultOwner?: string; scheduleId: string; type: 'created' | 'claimed' | 'revoked'; beneficiary: string; amount: string; blockNumber: string; blockTimestamp?: number; txHash: string; logIndex: number; status: 'confirmed' }`
- `runVestingIndexerOnce(options?: { now?: number }): Promise<IndexerRunResult>`
- `readIndexerCoverage(chainId: number): IndexCoverage`

- [x] **Step 1: Write failing Bun tests for migration tables, checkpoint persistence, event deduplication, and composite schedule identity.**
- [x] **Step 2: Run the focused test and confirm it fails because v6/indexer modules do not exist.**
- [x] **Step 3: Add additive schema migration v6 and repository helpers for sources, vaults, events, and overlap replacement.**
- [x] **Step 4: Implement bounded viem RPC retrieval using server-only `ARC_TESTNET_RPC_SECONDARY` plus the existing primary, capped at 10 blocks with retry/backoff.**
- [x] **Step 5: Implement configured deployment receipt resolution, factory vault discovery, event decoding, timestamp enrichment, and transactional checkpoint advancement.**
- [x] **Step 6: Add restart, provider failure, and reorg tests; run the focused Bun suite green.**

### Task 2: Add the paginated Activity API and background worker

**Files:**
- Create: `server/routes/vestingActivity.ts`
- Modify: `server/index.ts`
- Create: `server/vestingActivity.test.ts`

**Interfaces:**
- `handleVestingActivity(req: Request, url: URL): Response | null`
- `GET /api/vesting/activity?page=1&limit=50&wallet=&vault=&beneficiary=&scheduleId=`
- Response `{ records, page, limit, hasMore, coverage, updatedAt }`

- [x] **Step 1: Write failing API tests for pagination, filters, composite identity, coverage states, and invalid limits.**
- [x] **Step 2: Run them and confirm failure before the route exists.**
- [x] **Step 3: Implement parameter validation, bounded pagination, lowercase address filtering, and coverage metadata without exposing RPC credentials.**
- [x] **Step 4: Register the route and start a non-blocking bounded indexer loop with single-flight protection and retry delay.**
- [x] **Step 5: Run server API/indexer tests and confirm GrantHub route tests still pass.**

### Task 3: Replace frontend historical scans with the API adapter

**Files:**
- Modify: `src/hooks/useVestingEvents.ts`
- Create: `src/hooks/useVestingActivity.ts`
- Modify: `src/features/workspace/ActivityPage.tsx`
- Modify: `src/components/ui/Primitives.tsx`
- Modify: `src/hooks/indexerDisplay.ts` and tests as needed
- Create: `src/hooks/useVestingActivity.test.ts`

**Interfaces:**
- `useVestingActivity(filters?: ActivityFilters): { records: EventLog[]; coverage: 'complete'|'partial'|'unavailable'; loading: boolean; error: string|null; refresh: () => void }`
- `useVestingEvents()` remains a compatibility-derived index over API records and never calls `eth_getLogs`.

- [x] **Step 1: Write failing frontend tests proving no browser `eth_getLogs`, API coverage mapping, wallet-switch reset, and empty-state semantics.**
- [x] **Step 2: Run the focused tests and confirm failure against the current browser scanner.**
- [x] **Step 3: Implement the API hook with wallet-scoped query keys and retry that does not initiate raw chain scans.**
- [x] **Step 4: Adapt `useVestingEvents` to API records and remove progress/remaining-block state from user-facing pages.**
- [x] **Step 5: Update Activity, Overview, Treasury, Analytics, Timeline, and Team consumers to show ready/partial/unavailable states while direct reads remain independent.**
- [x] **Step 6: Run focused frontend tests and confirm no production source imports `getLogs` for vesting history.**

### Task 4: Integrate schedule transaction history and verify the known fixture

**Files:**
- Modify: `src/hooks/useScheduleTransactionHistory.ts`
- Modify: `src/features/vesting/scheduleHistory.ts`
- Modify: `src/App.tsx`
- Modify: `src/features/workspace/ActivityPage.tsx`
- Create: `src/features/vesting/activityHistory.test.ts`

**Interfaces:**
- Schedule history selects API records using `(chainId,vaultAddress,scheduleId)` and preserves newest-first ordering.

- [x] **Step 1: Add fixture tests for the verified creation and claim records, duplicate schedule IDs across vaults, unavailable history, and no fabricated funding events.**
- [x] **Step 2: Run focused tests red before the API-backed history adapter exists.**
- [x] **Step 3: Remove client-side receipt scanning from schedule history and render server-provided timestamps/status/hash links.**
- [x] **Step 4: Verify the known transactions through read-only RPC/indexer tests and ensure production storage is populated by decoded logs rather than hardcoded hashes.**
- [x] **Step 5: Run the full frontend/server/database test suites, typecheck, lint, and production build.**

### Task 5: Operational verification and handoff

**Files:**
- Modify: `.env.example` with server-only indexer configuration comments
- Create: `docs/vesting-activity-indexer-operations.md`

- [x] **Step 1: Document configured deployment transaction inputs, bounded range behavior, checkpoint/reorg recovery, and coverage meanings.**
- [x] **Step 2: Run database migration tests without deleting or rewriting SQLite/WAL/SHM files.**
- [x] **Step 3: Run backend/frontend tests, TypeScript, type-aware/full lint, and production build.**
- [x] **Step 4: Perform read-only verification of the known Arc Testnet schedule and report browser evidence separately if no browser runtime is available.**
