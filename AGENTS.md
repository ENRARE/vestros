# Vestros

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Vestros — USDC token vesting contract with cliff + linear unlock on Arc Testnet and planned Arc Mainnet support. Multiple beneficiaries, owner-only schedule creation and revocation (unvested returns to owner), emergency pause, and an emergency rescue function for blocklisted beneficiaries. Phase 2 added: Bulk Vesting, Vesting Timeline & Forecast, Treasury Dashboard.

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

### GrantHub Testnet deployment

- GrantPoolFactory: `0x0d12537B482Ad44BA4e03DA2444a97B903AA997B`
- Deploy tx: `0xa0c6d7401e01f263aa10dd51a92ce7ef0af0df561df263deadc34150a36e6e1e`
- Network: Arc Testnet, chain ID `5042002`
- Block: `69850736`
- Receipt: status `1` (success)
- Deployer: `0x0a2E28a5Db0813AF4Ea9FE5792032328E6D26FD6`
- Gas paid: `0.0330941545` USDC
- Explorer: https://explorer.testnet.arc.io/address/0x0d12537B482Ad44BA4e03DA2444a97B903AA997B

**Verified first organization GrantHub deployment:**
- Organization: `arc-ecosystem-test-0b83a9`
- Organization owner/admin: `0x0B83a98a46310C47Ac6c87C67904b98D6febd392`
- Treasury: `0xFD6EC7a1d8839BD56e8Ab19af80912ff0682cec4`
- GrantPool: `0x5C94F126AdFB09286524008CD1d74A03D29Fd5aD`
- GrantVesting: `0x4d3B037Cb34359b0d6478d97c24fAbf414600c64`
- Deployment txs: `0xd63239da52da3e01d4234973dae084c0ca03bf1000f2c049d7a2e22fb158b5f3`, `0xeb304a8be645fe5227491bb3e481f3213ae4eac5c4b84f8fab25e68f36ab3a24`, `0x1c1ba167ee1043642c64bf882fa48c6e34b51e6dbb011378e87f2e632747fc49`
- Blocks: `69862219`, `69862223`, `69862228`; all receipts succeeded.
- Total gas paid: `0.06375088125` native USDC.
- Explorer: https://explorer.testnet.arc.io/address/0x5C94F126AdFB09286524008CD1d74A03D29Fd5aD
- GrantVesting remains owned by GrantPool. GrantPool ownership remains with the deployer until separately authorized.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (5042002) or Arc Mainnet (5042), selected by `VITE_CHAIN_ENV`
- Token: ERC-20 USDC (6 decimals) at `0x3600000000000000000000000000000000000000` on both Arc networks; native gas USDC uses 18 decimals
- Toasts: Sonner

## Key Files

- `src/App.tsx` — 5-tab navigation (Schedules, Create, Bulk, Timeline, Treasury)
- `src/types.ts` — shared TS interfaces (VestingSchedule, BulkEntry, etc.)
- `src/vestingMath.ts` — pure vesting math (mirrors contract vestedAmount() exactly)
- `src/formatters.ts` — display helpers (fmtUsdc, fmtDate, etc.)
- `src/contractConfig.ts` — single source for contract address, ABI, chain ID
- `src/hooks/useVestingEvents.ts` — local-confirmed receipt and optional Activity API adapter; Core does not scan browser history
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

## Phase 3 — GrantHub (Testnet deployment verified; rehearsal pending)

GrantHub extends Vestros with a full grant-funding platform.

### New Solidity contracts

| Contract | Path | Status |
|---|---|---|
| `IVesting` | `contracts/IVesting.sol` | Written, audited, tested |
| `GrantPool` | `contracts/GrantPool.sol` | Written, audited, tested; Arc Testnet deployment verified |
| `GrantPoolFactory` | `contracts/GrantPoolFactory.sol` | Written, audited, tested; Arc Testnet deployment verified |
| `GrantVesting` | `contracts/GrantVesting.sol` | Written, audited, tested; Arc Testnet deployment verified |

**Audit findings (both resolved):**
- High (approve-then-call residual allowance): resolved with `forceApprove` and allowance cleanup on both the successful and reverted vesting call paths
- Critical (vesting-owner-mismatch): resolved by deploying `GrantVesting` with the `GrantPool` as owner and wiring it before activation. `activateAward` now atomically creates the GrantVesting schedule and reverts if the integration is not configured.

**Test results:** The latest local `forge test` run passed 178 tests with 0 failures, including GrantHub, Core USDCVesting, VestingFactory, SelfServiceVesting fuzzing, and 128,000-call invariant suites. Backend verifier regressions cover successful/reverted/wrong-chain/fake/mismatched deposit receipts and funded award activation. See `contracts/test/` and `docs/mainnet-readiness.md` for the bounded invariant note.

**Constructor arguments for `GrantPoolFactory` deploy:** none (permissionless factory).
**Constructor arguments for `GrantPool` deploy:** `(address usdc, address treasury, address initialOwner)`.

### New backend

- Bun HTTP server at `server/index.ts` (port 3001), proxied via Vite at `/api`
- SQLite database (`server/db.ts`), WAL mode, single file
- Auth: EIP-191 personal-sign wallet signatures with server-issued nonces
- Routes: `server/routes/auth.ts`, `grants.ts`, `orgs.ts`, `applications.ts`, `awards.ts`
- Financial writes are disabled by default. Deposits are bound to a grant's configured pool/chain and counted only after independent RPC verification; v4 migrations preserve existing rows while marking pre-v4 deposits unverified until rechecked.
- Start: `bun run server` (runs `server/index.ts`)

### Frontend-first Core boundary

Vestros Core does not require the Bun server, SQLite database, VPS, or custom
RPC proxy at runtime. wagmi/viem reads and writes use network-specific public
Arc RPC endpoints. Confirmed create, claim, and revoke receipts observed by
the current browser are stored locally under chain/wallet/vault/schedule
scope. The optional Activity API can add historical records, but owner-wide
history remains partial without indexed data because the deployed contracts do
not enumerate every owner schedule. GrantHub pages and database-backed
application/review/organization features still require the optional backend.

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

### Self-service vesting (implemented locally; not deployed)

- `contracts/VestingFactory.sol` is permissionless and records one
  `SelfServiceVesting` vault per creator wallet.
- `SelfServiceVesting` uses an immutable network-specific USDC address,
  direct creator ownership, Ownable2Step, pause/reentrancy controls, and the
  tested Core vesting math without modifying the deployed Core contract.
- `src/hooks/useUserVestingVault.ts` and `VestingVaultSetup.tsx` provide wallet
  onboarding. Create, Bulk, Team, My Vesting, Timeline, Treasury, Analytics,
  Activity, and Reports use the selected vault while retaining legacy Core
  owner/read/claim compatibility.
- `VITE_VESTING_FACTORY_TESTNET`, `VITE_VESTING_FACTORY_MAINNET`, and their
  deployment transaction variables remain blank until separately authorized
  deployments. See `docs/self-service-vesting-testnet-deployment.md`.

## To Run

```bash
bun install
bun run dev        # frontend (port 5173)
bun run server     # API server (port 3001)
```

GrantHub financial writes are disabled by default. Enable them only after the documented external-audit, multisig, and live testnet activation gates are complete. See `.env.example` and `docs/mainnet-readiness.md` for the separate testnet/mainnet configuration.
