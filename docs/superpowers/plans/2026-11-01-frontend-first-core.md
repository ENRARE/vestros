# Frontend-First Vestros Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Vestros Core usable without Bun, SQLite, a VPS, or the custom RPC proxy while preserving optional historical enhancement and GrantHub boundaries.

**Architecture:** Direct wagmi/viem reads and writes remain authoritative. A browser-local journal stores only decoded events from successful receipts, and the existing Activity API is an optional bounded enhancement merged by composite transaction identity. Browser RPC configuration accepts only public, network-specific endpoints.

**Tech Stack:** React 18, TypeScript, wagmi v2, viem v2, ConnectKit, Vite, localStorage, existing Arc contracts and design system.

**Spec:** `docs/superpowers/specs/2026-11-01-frontend-first-core-design.md`

## Global Constraints

- Do not modify or redeploy smart contracts or broadcast transactions.
- Core reads and writes must remain direct wallet-to-contract interactions.
- Do not delete the Bun backend, SQLite files, migrations, Activity API, or GrantHub implementation.
- Do not scan historical blockchain logs in the browser.
- Testnet and Mainnet RPC and contract configuration must never fall back across networks.
- Do not expose authenticated provider credentials in frontend configuration or bundles.
- GrantHub remains explicitly backend-dependent until its separate design is implemented and reviewed.

## Review Focus

- Confirmed receipts from a different vault or chain must never enter the local journal.
- Failed, pending, malformed, and approval-only receipts must never appear as confirmed vesting events.
- Wallet switching must isolate local history, direct schedule state, and vault ownership checks.
- Backend timeout or outage must leave direct schedules and financial calculations usable.
- Owner-wide treasury history must state its incomplete coverage because deployed contracts do not enumerate all owner schedules.

### Task 1: Browser-safe Arc transport

**Files:** `src/arcRpcConfig.ts`, `src/arcRpcConfig.test.ts`, `src/arcChains.ts`, `.env.example`, `src/config.ts`

- [x] Add failing tests for public-only URL validation, network separation, and no proxy requirement.
- [x] Verify the tests fail against proxy-dependent behavior.
- [x] Implement network-specific public RPC fallback configuration and remove the custom proxy from the Core browser transport.
- [x] Run transport tests and TypeScript.

### Task 2: Confirmed receipt journal

**Files:** Create `src/features/vesting/transactionJournal.ts`, `src/features/vesting/transactionJournal.test.ts`

- [x] Add failing tests for decoding ScheduleCreated, Claimed, and ScheduleRevoked from successful receipts, composite deduplication, wallet/chain/vault scoping, and rejection of failed/unrelated receipts.
- [x] Implement pure receipt validation, event decoding, localStorage serialization, and merge helpers.
- [x] Run journal tests.

### Task 3: Record Core write receipts

**Files:** `src/App.tsx`, `src/components/BulkVesting.tsx`, `src/features/vesting/TeamManagementPage.tsx` only where needed

- [x] Add failing tests for create, bulk create, claim, and revoke receipt recording.
- [x] Record only successful vault receipts after confirmation, using the connected signer, originating vault, chain, and receipt block data.
- [x] Keep approvals and unrelated transfers out of vesting history.
- [x] Run focused workflow and journal tests.

### Task 4: Optional Activity API enhancement

**Files:** `src/hooks/useVestingActivity.ts`, `src/hooks/useVestingEvents.ts`, `src/hooks/useScheduleTransactionHistory.ts`, related UI tests

- [x] Add failing tests for local-first loading, API merge, API timeout/failure, partial-history copy, and wallet-switch reset.
- [x] Load local records immediately, attempt the existing API without blocking, and merge by composite receipt identity.
- [x] Preserve direct schedule reads and remove any progress/indexing dependency from Core page readiness.
- [x] Run all frontend tests and TypeScript.

### Task 5: Core UI limitations and GrantHub boundary

**Files:** `src/components/ui/Primitives.tsx`, `src/components/TreasuryDashboard.tsx`, `src/features/workspace/ActivityPage.tsx`, `src/features/workspace/AnalyticsPage.tsx`, `src/features/workspace/ReportsPage.tsx`, docs

- [x] Add failing UI-state tests for local-only history, unavailable history, empty known history, and owner-wide incomplete discovery.
- [x] Show nonblocking partial-history states and keep direct financial values visible.
- [x] Keep GrantHub API/auth pages intact and clearly unavailable when the backend is absent.
- [x] Run regression tests, lint, and production build.

### Task 6: Server-stopped verification

**Files:** no production changes; verification artifacts only

- [x] Preserve SQLite files and do not alter the optional backend process.
- [x] Run frontend tests, TypeScript, lint, and production build without requiring the server.
- [x] Verify no authenticated RPC variable is included in the built bundle.
- [x] Leave the optional development process boundary unchanged; do not deploy, commit, or push.
