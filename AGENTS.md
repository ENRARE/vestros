# Vestros

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Vestros — USDC token vesting contract with cliff + linear unlock on Arc Testnet. Multiple beneficiaries, owner-only schedule creation and revocation (unvested returns to owner), emergency pause, and an emergency rescue function for blocklisted beneficiaries. Phase 2 added: Bulk Vesting, Vesting Timeline & Forecast, Treasury Dashboard.

## Deployed Contracts

| Contract | Network | Address | Explorer |
|---|---|---|---|
| USDCVesting (old, platform-owned) | Arc Testnet | 0x74b9867dbba25cc05088e42229294ecfc69664d9 | https://explorer.testnet.arc.io/address/0x74b9867dbba25cc05088e42229294ecfc69664d9 |
| USDCVesting (active, user-owned) | Arc Testnet | 0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693 | https://explorer.testnet.arc.io/address/0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693 |

**Active contract:**
- Deploy tx: `0x35bcde1c1d3fed9008db8267f0754dbc36f735f5e637c39b07a9c75e1e96741f`
- Circle contract ID: `01a115c4-7db1-75f3-a8ad-05ce8112018c`
- Owner: `0x2eaec62dd422bdb6f1134a8b22503e62018a34f6`
- USDC address (hardcoded immutable): `0x3600000000000000000000000000000000000000`

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` — 5-tab navigation (Schedules, Create, Bulk, Timeline, Treasury)
- `src/types.ts` — shared TS interfaces (VestingSchedule, BulkEntry, etc.)
- `src/vestingMath.ts` — pure vesting math (mirrors contract vestedAmount() exactly)
- `src/formatters.ts` — display helpers (fmtUsdc, fmtDate, etc.)
- `src/contractConfig.ts` — single source for contract address, ABI, chain ID
- `src/hooks/useVestingEvents.ts` — paginated event indexer (2,000-block batches)
- `src/components/BulkVesting.tsx` — bulk schedule creation with CSV import
- `src/components/TimelineForecast.tsx` — SVG vesting curve + milestone table
- `src/components/TreasuryDashboard.tsx` — org-wide metrics, beneficiary breakdown, CSV export
- `src/components/ui/Primitives.tsx` — shared UI components

## Phase 2 Audit (completed)

A comprehensive post-implementation audit of Phase 2 was completed. See `docs/audit-phase2.md` for the full report.

**Fixed bugs:**
- FIX-01 (Critical): Stale cursor in BulkVesting handleDone — cursor now read from ref, not closed-over state
- FIX-02 (Critical): Double-fire bug in BulkVesting — kick guard ref prevents re-running a row
- FIX-03/12 (Medium): isOwner in BulkVesting was `!!address` (any connected wallet) — now reads contract `owner()`
- FIX-05 (Medium): Event indexer used single large getLogs call — now paginated in 2,000-block batches
- FIX-06 (Medium): Derived event indexes rebuilt on every render — now memoized with useMemo
- FIX-08 (Low): VestingChart useMemo deps included redundant individual fields — simplified to `[schedule]`
- FIX-09 (Low): getNow() called in render body of useAllSchedules — now captured via useState lazy init
- FIX-10 (Low): AllocationBar used Number(bigint) for percentages — now uses bigint arithmetic
- FIX-11 (Low): claimable amount could underflow — now guarded

**Verified correct (no fix needed):**
- Contract math: frontend vestedAmount exactly mirrors Solidity (confirmed by forge test suite: 68/68)
- ABI: getSchedule, getScheduleIds, claimableAmount, vestedAmount all match
- Owner/permission gates: owner() read from chain for both Create and Bulk tabs
- Revoke modal: amounts calculated correctly; beneficiary-keeps = claimedAmount + claimableAtRevoke
- Chain switching: all write paths guard with `chainId !== CHAIN_ID` check
- USDC decimals: 6, read from `usdcDecimalsFor(CHAIN_ID)` in contractConfig (never hardcoded)

**Known limitations (by design, documented here for the next engineer):**
- Event indexer has no persistence: re-fetches all events on every mount and refresh
- Event indexer KNOWN_DEPLOY_BLOCK is 0 (unknown); uses head-600k fallback — update to real deploy block for production
- Bulk vesting stops on first failure — no retry or skip-row path; already-completed rows are irreversible
- Arc Testnet block timestamps are far in the future relative to wall-clock time; start/cliff/end dates on live schedules will show future dates
- CIRCLE_ENTITY_SECRET not in .env; .circle/ recovery file does not exist in sandbox

## Phase 3 — GrantHub (completed, no deploy)

GrantHub extends Vestros with a full grant-funding platform.

### New Solidity contracts (not yet deployed — awaiting explicit approval)

| Contract | Path | Status |
|---|---|---|
| `IVesting` | `contracts/IVesting.sol` | Written, audited, tested |
| `GrantPool` | `contracts/GrantPool.sol` | Written, audited, tested |
| `GrantPoolFactory` | `contracts/GrantPoolFactory.sol` | Written, audited, tested |

**Audit findings (both resolved):**
- High (approve-then-call residual allowance): resolved by removing the vesting-contract call entirely
- Critical (vesting-owner-mismatch): `createSchedule` is `onlyOwner` on USDCVesting, so factory-deployed pools cannot call it. Resolved: `activateAward` now transfers USDC directly to the beneficiary instead. The org owner (the vesting contract owner) can then create a vesting schedule via the Vestros UI for the beneficiary. This keeps the immutable vesting contract unchanged.

**Test results:** 89/89 forge tests pass (71 GrantPool + 18 GrantPoolFactory). See `contracts/test/`.

**Constructor arguments for `GrantPoolFactory` deploy:** none (permissionless factory).
**Constructor arguments for `GrantPool` deploy:** `(address usdc, address treasury, address initialOwner)`.

### New backend

- Bun HTTP server at `server/index.ts` (port 3001), proxied via Vite at `/api`
- SQLite database (`server/db.ts`), WAL mode, single file
- Auth: EIP-191 personal-sign wallet signatures with server-issued nonces
- Routes: `server/routes/auth.ts`, `grants.ts`, `orgs.ts`, `applications.ts`, `awards.ts`
- Start: `bun run server` (runs `server/index.ts`)

### New frontend

- `react-router-dom` v7 added for SPA routing
- Section nav in App.tsx: "Vestros" (existing tabs, `/`) vs "GrantHub" (`/granthub/*`)
- `src/granthub/` — all GrantHub frontend code
  - `types.ts` — GrantProgram, Organization, GrantApplication, GrantAward, ReviewDecision
  - `api.ts` — REST client for all backend routes
  - `useAuth.ts` — wallet-signature session hook
  - `components/AuthBanner.tsx` — sign-in prompt for unauthenticated actions
  - `components/Chips.tsx` — StatusChip, AppStatusChip, AwardStatusChip
  - `components/GrantCard.tsx` — grant card for explorer grid
  - `pages/GrantExplorer.tsx` — public grant discovery
  - `pages/GrantDetail.tsx` — grant page with applications and awards
  - `pages/OrgProfile.tsx` — organization public profile
  - `pages/ApplyPage.tsx` — grant application form
  - `pages/CreateGrant.tsx` — org owner: create/publish a grant
  - `pages/CreateOrg.tsx` — create an organization
  - `pages/OrgDashboard.tsx` — org owner dashboard (grants, applications, awards, members)
  - `pages/ReviewWorkspace.tsx` — reviewer workspace per application
  - `pages/MyGrants.tsx` — applicant view of own applications and awards

## To Run

```bash
bun install
bun run dev        # frontend (port 5173)
bun run server     # API server (port 3001)
```
