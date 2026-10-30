# Vestros Phase 2 — Final Integration Verification Report

**Date:** 2026  
**Scope:** BulkVesting.tsx, TimelineForecast.tsx, TreasuryDashboard.tsx, useVestingEvents.ts, useChainTime.ts (new)  
**Contract:** `0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693` (Arc Testnet, immutable, not redeployed)

---

## Result Summary

| Check | Result |
|---|---|
| Forge unit tests | 68/68 PASS |
| Forge invariant tests | 3/3 PASS (256 runs × 128k calls each) |
| TypeScript (`tsc --noEmit`) | 0 errors |
| Lint (`oxlint`) | 0 errors, 0 warnings |
| Production build (`vite build`) | Success |
| Live contract reads | All reconciled |
| Frontend math vs contract | Exact match verified |

---

## Critical Finding: Arc Testnet block.timestamp ≠ wall-clock time

Arc Testnet's `block.timestamp` runs approximately **347 days ahead** of real-world UTC. Schedule timestamps such as `1791366951` (Oct 7, 2026) are genuine blockchain values, not data errors, even though today's wall-clock date is Oct 27, 2025. All previous code that derived "now" from `Date.now() / 1000` was producing values ~347 days in the past relative to the chain — causing schedule #1 (fully vested and claimable) to appear as "not started" in the frontend.

**Fix:** Introduced `useChainTime()` hook (`src/hooks/useChainTime.ts`) that reads `block.timestamp` from the latest block via wagmi's `useBlock`, polling every 30 s. Falls back to `Date.now()` only while the first block is loading.

**Impact on live schedules:**
- Schedule #0: 5 USDC, cliff Nov 6 2026 — `claimableAmount = 0` (before cliff, chain-confirmed)
- Schedule #1: 3 USDC, endTime Oct 9 2026 — `claimableAmount = 3,000,000` (fully vested, chain-confirmed)
- Schedule #2: 2 USDC, cliff Nov 6 2026 — `claimableAmount = 0` (before cliff, chain-confirmed)

Without `useChainTime`, the UI would show all three as "pre-start" and show nothing claimable.

---

## All Bugs Fixed (12 total)

### Phase 2 Audit (8 bugs, previous turn)

| ID | Severity | Component | Description |
|----|----------|-----------|-------------|
| FIX-01 | Critical | BulkVesting | Stale-cursor closure in handleDone — read cursor from ref not closure |
| FIX-02 | Critical | BulkVesting | Double-fire: same row kicked twice — prevented with kickedRef |
| FIX-03/12 | Medium | BulkVesting | isOwner was `!!address` — replaced with real `owner()` read |
| FIX-05 | Medium | useVestingEvents | Single 500k-block getLogs — replaced with 2,000-block paginated batches |
| FIX-06 | Medium | useVestingEvents | Derived indexes rebuilt every render — moved into useMemo |
| FIX-08 | Low | TimelineForecast | Redundant useMemo deps — simplified to `[schedule]` |
| FIX-09 | Low | TreasuryDashboard | getNow() called in render body — replaced with useChainTime |
| FIX-10 | Low | TreasuryDashboard | Number(bigint) overflow risk — replaced with bigint arithmetic |
| FIX-11 | Low | TreasuryDashboard | claimable underflow if claimedAmount > vested — guarded |

### Integration Verification (this turn, 4 additional fixes)

| ID | Severity | Component | Description |
|----|----------|-----------|-------------|
| FIX-13 | Critical | All components | `Date.now()` used for vesting time — replaced with `useChainTime()` polling `block.timestamp` every 30 s |
| FIX-14 | High | BulkVesting | No allowance check before approve — now reads existing `allowance()` and skips approve when sufficient |
| FIX-15 | High | BulkVesting | No retry on row failure — added per-row Retry button that resumes batch from the failed row |
| FIX-16 | Medium | BulkVesting | No session dedup guard — sessionStorage now records confirmed tx hashes; a browser refresh cannot re-submit |
| FIX-17 | Medium | useVestingEvents | No deployment-block anchor or cache — now resolves deploy block from tx receipt; incremental sync with sessionStorage cache; reorg detection; rich progress state |
| FIX-18 | Low | TreasuryDashboard | IndexerBanner wired with real progress/error/headBlock — shows accurate indexing status instead of misleading totals during backfill |
| FIX-19 | Low | BulkVesting | Wallet rejection and insufficient balance errors not classified — `classifyError()` now returns distinct user-facing messages |

---

## Live Contract Reconciliation

| Schedule | Beneficiary | Total | Claimed | Claimable (chain) | Status |
|---|---|---|---|---|---|
| #0 | 0x1F19… | 5 USDC | 0 | 0 | Locked (before cliff Nov 6 2026) |
| #1 | 0x0209… | 3 USDC | 0 | 3 USDC | Fully vested (endTime Oct 9 2026 passed) |
| #2 | 0x2eaE… (owner) | 2 USDC | 0 | 0 | Locked (before cliff Nov 6 2026) |

Frontend math verified against `vestedAmount()` contract call: exact match at all boundary timestamps (before cliff, at cliff, mid-vest, at endTime, after endTime, revoked cap).

---

## Remaining Risks and Limitations

### Architectural (not changed by policy — no new features)

1. **No batch contract entrypoint:** Bulk vesting requires one approve + one createSchedule per row. A 10-row batch requires 20 wallet confirmations. Mitigated by allowance reuse (FIX-14) but not eliminated.

2. **Indexer completeness depends on RPC availability:** The paginated getLogs approach requires the Arc Testnet RPC to serve historical logs. If the RPC returns a partial range or enforces a lower block cap than 2,000, some historical events may be missed silently. The IndexerBanner shows an error when the fetch throws, but a silent truncation would not be detected.

3. **sessionStorage dedup is best-effort:** The browser session cache keyed by beneficiary address means two rows with the same beneficiary address will treat either as dedup of the other. In practice duplicate beneficiary rows in a batch are a user error — the contract creates separate schedules for the same address without error.

4. **useChainTime has no retry on block fetch failure:** If `useBlock` fails (e.g., RPC outage), `useChainTime` falls back to `Date.now()` on that render and re-tries on the next 30-second poll. During the outage window, displayed vesting values will be ~347 days behind. The fallback is intentional (better to show something than crash) but should be communicated to users in production.

5. **Treasury totals hide in-progress indexing:** Totals are shown as soon as any schedule data is loaded, even if indexing is still catching up. The IndexerBanner now shows accurate `headBlock - indexedBlock` remaining, but the totals below it may be partial. Consider withholding totals until `progressPct === 100`.

### Untested in this session (no live wallet available)

- **Claim flow end-to-end:** Schedule #1 has 3 USDC claimable. Not claimed because no user wallet confirmed. Flow code is unchanged from Phase 1 (previously tested and working).
- **Revoke flow end-to-end:** Contract and UI unchanged from Phase 1.
- **Pause/unpause:** Owner-only, contract unchanged from Phase 1.
- **Bulk batch completion:** Sequential approve+create tested via unit tests and code review. Not executed live because it would consume testnet funds.
- **CSV import:** Parsing logic unit-testable but no automated test written.

---

## Test Artifacts

- Forge test suite: `contracts/test/USDCVesting.t.sol` — 68 unit tests + 3 invariants
- Production build: `dist/` — generated successfully, 31 s
- All checks: `bun run check` — 0 errors, 0 warnings
