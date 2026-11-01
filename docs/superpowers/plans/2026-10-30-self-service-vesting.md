# Self-Service Vesting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one independently owned, network-configured vesting vault per wallet while preserving the deployed Core `USDCVesting` contract and existing GrantHub deployments.

**Architecture:** Add a permissionless `VestingFactory` that deploys a configurable `SelfServiceVesting(usdc, creator)` vault and records one vault per creator. The vault mirrors the existing Core vesting logic but receives USDC explicitly so Testnet and Mainnet cannot share token assumptions. The frontend reads the connected wallet's vault, routes writes to that vault, and indexes legacy and factory-created contracts using `(vaultAddress, scheduleId)` identity.

**Tech Stack:** Solidity 0.8.28, Foundry/Forge, React 18, TypeScript, wagmi/viem, ConnectKit, Vite, existing Vestros design system.

**Spec:** `docs/superpowers/specs/2026-10-30-self-service-vesting-design.md`

## Global Constraints

- Preserve the deployed Core `USDCVesting` contract and all existing GrantHub deployments.
- Do not deploy contracts, broadcast transactions, transfer funds, change existing ownership, enable GrantHub financial flags, commit, or push.
- Use the correct Arc Testnet (`5042002`) and Arc Mainnet (`5042`) USDC addresses and decimals.
- Keep Testnet and Mainnet factory addresses separate; blank/unconfigured Mainnet must not fall back to Testnet.
- Preserve the existing premium UI, routes, wallet integration, and financial calculations.
- Bulk operations remain sequential and must report confirmed, failed, and unattempted rows accurately.

## Review Focus

- **Ownership initialization:** a newly created vault must have the creator as owner, zero pending owner, and no factory administrative path. Test in `VestingFactory.t.sol`.
- **Cross-vault authorization:** Owner A must not create, revoke, pause, rescue, or withdraw from Owner B's vault. Test unauthorized calls in `SelfServiceVesting.t.sol`.
- **Funding rollback:** an allowance or USDC transfer failure must leave no schedule or accounting residue; frontend progress must not mark the row funded. Test contract rollback and bulk row states.
- **Multi-vault identity and wallet switching:** identical schedule IDs from different vaults must remain distinct, and switching wallets must not reuse the previous vault's state. Test index keys and hook reset behavior.
- **Network/token separation:** each factory must expose the configured network USDC and reject zero token configuration; Mainnet configuration must never resolve to Testnet. Test config helpers and factory constructor behavior.

### Task 1: Add and verify self-service contracts

**Files:**
- Create: `contracts/SelfServiceVesting.sol`
- Create: `contracts/VestingFactory.sol`
- Create: `contracts/test/SelfServiceVesting.t.sol`
- Create: `contracts/test/VestingFactory.t.sol`
- Modify: `contracts/test/USDCVesting.t.sol` only if shared regression helpers are extracted without changing deployed Core behavior

**Interfaces:**
- `SelfServiceVesting(address usdc_, address initialOwner)` with the Core contract's schedule, claim, revoke, pause, rescue, and view interfaces.
- `VestingFactory(address usdc_)`.
- `VestingFactory.usdc() -> address`.
- `VestingFactory.vaultOf(address creator) -> address`.
- `VestingFactory.vaultCount() -> uint256`.
- `VestingFactory.vaultAt(uint256 index) -> address`.
- `VestingFactory.createVault() -> address` and `VaultCreated(address indexed creator, address indexed vault)`.

- [x] **Step 1: Write Forge tests for constructor ownership and factory registration.** Assert the vault owner is the caller, `pendingOwner()` is zero, the factory is not the owner, the factory records one vault, and a second `createVault()` by the same creator reverts.
- [x] **Step 2: Run the focused Forge tests and verify they fail because the new contracts do not exist.** Foundry's repeated `--match-path` form was corrected to two separate path runs.
- [x] **Step 3: Implement `SelfServiceVesting` by porting the tested Core behavior with explicit `usdc_`.** Preserve event fields, vesting math, `Ownable2Step`, `Pausable`, `ReentrancyGuard`, SafeERC20 transfers, and disabled renunciation; do not import or mutate the deployed Core address.
- [x] **Step 4: Implement `VestingFactory` with no owner or privileged admin path.** Reject zero USDC, deploy `SelfServiceVesting(usdc, msg.sender)`, register the vault before returning, emit `VaultCreated`, and prevent duplicate creators.
- [x] **Step 5: Add tests for two owners, multiple beneficiaries, claims, revocation, pause, failed funding rollback, and unauthorized cross-vault writes.** Included fuzz and invariant checks for bounds and vault balance reconciliation.
- [x] **Step 6: Run focused tests and then the complete Forge suite.** `forge test` passed 178 tests.

### Task 2: Add deployment-safe configuration and artifacts

**Files:**
- Create: `contracts/script/DeployVestingFactory.s.sol`
- Create: `src/vestingFactoryConfig.ts`
- Modify: `.env.example`
- Modify: `foundry.toml` only if the existing Arc endpoints require no new deployment assumptions

**Interfaces:**
- `VESTING_FACTORY_ADDRESS`, `VESTING_FACTORY_DEPLOYED`, `VESTING_FACTORY_CONFIG_ERROR` selected by `CHAIN_ENV`.
- `SELF_SERVICE_USDC_ADDRESS` and `SELF_SERVICE_USDC_DECIMALS` selected from existing network facts.
- Factory and vault ABIs exported for wagmi/viem.

- [x] **Step 1: Add config tests for Testnet/Mainnet selection and empty Mainnet behavior.**
- [x] **Step 2: Run `node --experimental-strip-types --test src/vestingFactoryConfig.test.ts`; 2 tests passed.**
- [x] **Step 3: Implement `vestingFactoryConfig.ts` with separate `VITE_VESTING_FACTORY_TESTNET` and `VITE_VESTING_FACTORY_MAINNET` values.** Both remain blank until authorized deployment.
- [x] **Step 4: Implement simulation-only `DeployVestingFactory.s.sol`.** It enforces Arc chain IDs, canonical USDC, and no raw `PRIVATE_KEY` on Mainnet.
- [x] **Step 5: Run `forge build` and dry-run Testnet/Mainnet simulations without `--broadcast`; both passed.**

### Task 3: Add the wallet-vault hook and self-service onboarding

**Files:**
- Create: `src/hooks/useUserVestingVault.ts`
- Create: `src/components/VestingVaultSetup.tsx`
- Modify: `src/App.tsx`
- Modify: `src/contractConfig.ts` or add a focused dynamic contract helper beside it

**Interfaces:**
- `useUserVestingVault(): { vaultAddress?: Address; isLoading: boolean; isCreating: boolean; createVault: () => void; refetch: () => void }`.
- `getVestingContract(address: Address): { address: Address; abi: Abi; chainId: number }`.

- [x] **Step 1: Add hook tests for disconnected, unconfigured, existing-vault, and wallet-switch states.** Pure state coverage asserts no write eligibility without a connected account or configured factory.
- [x] **Step 2: Run the hook tests and verify failure before implementation.** The initial missing-helper run failed as expected before implementation.
- [x] **Step 3: Implement the hook using `useAccount`, `useReadContract(vaultOf)`, and `useWriteContract`.** Refetch follows a confirmed factory receipt and write state resets on account/chain changes.
- [x] **Step 4: Implement compact onboarding that offers “Create your vault” only when no vault exists.** The setup component shows the pending hash/explorer link and waits for receipt confirmation.
- [x] **Step 5: Run focused frontend tests and TypeScript.** Focused tests and `npm.cmd run typecheck` passed.

### Task 4: Route core writes to the connected user's vault

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/BulkVesting.tsx`
- Modify: `src/features/vesting/TeamManagementPage.tsx`
- Modify: `src/components/layout/navConfig.ts` only if role hints still hide a core route
- Modify: relevant frontend tests under `src/`

**Interfaces:**
- Create and bulk components consume `vaultAddress` and a dynamic vesting contract config rather than the global `CONTRACT` address.
- Owner checks compare the connected wallet to `owner()` on its selected vault.

- [x] **Step 1: Add tests proving disconnected users see onboarding, connected users without a vault cannot submit schedules, and vault owners can reach creation controls.** Pure workflow tests cover disconnected, wrong-chain, and cross-wallet vault-owner rejection.
- [x] **Step 2: Run the tests and verify they fail against the current global-owner implementation.** The initial missing-helper run failed before implementation.
- [x] **Step 3: Replace global owner checks for self-service flows with the user's vault state and onchain `owner()` read.** Legacy Core reads/claims remain available.
- [x] **Step 4: Update approval/funding/create sequencing to target the user vault's address and network USDC.** Existing sequential bulk retry/dedup behavior is preserved and scoped to the active contract.
- [x] **Step 5: Add wallet-switch cleanup and route-refresh coverage.** Vault state keys and write state reset on account/chain changes.
- [x] **Step 6: Run focused frontend tests and the existing sidebar/workspace tests.** All focused, sidebar, workspace, typecheck, and lint checks passed.

### Task 5: Extend indexing and beneficiary discovery across vaults

**Files:**
- Modify: `src/hooks/useVestingEvents.ts`
- Modify: `src/types.ts` or create `src/features/vesting/vestingTypes.ts`
- Create/modify: focused indexer tests under `src/hooks/` or `src/features/vesting/`
- Modify: `.env.example` only for factory deploy transaction placeholders if needed

**Interfaces:**
- `EventLog` gains `vaultAddress: Address` and optional `vaultOwner: Address`.
- `ScheduleRef` is `{ vaultAddress: Address; scheduleId: bigint }` and replaces bare schedule IDs wherever multiple vaults are displayed.
- `useVestingEvents()` discovers factory vaults, includes the legacy Core address, deduplicates by `(vaultAddress, txHash, type, logIndex)`, and exposes per-vault derived indexes.

- [x] **Step 1: Write tests for factory discovery, duplicate schedule IDs in different vaults, reorg/cache invalidation, and wallet-specific filtering.** Added duplicate-vault identity, dedup, reorg, and wallet-filter regression coverage.
- [x] **Step 2: Run indexer tests and verify they fail because logs currently assume one contract address and bare schedule IDs.** The initial missing-helper run failed before implementation.
- [x] **Step 3: Implement factory event discovery from the configured deployment transaction, then fetch schedule events per discovered vault in bounded batches.** The legacy Core contract remains supported.
- [x] **Step 4: Version session-storage keys and include chain/factory identity.** Reorgs clear scoped logs and deploy-block caches; wallet-specific UI state resets on account changes.
- [x] **Step 5: Run indexer tests and verify multi-vault schedule references remain distinct.** Focused indexer tests passed.

### Task 6: Integrate My Vesting, Timeline, Treasury, Analytics, and Team views

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/TimelineForecast.tsx`
- Modify: `src/components/TreasuryDashboard.tsx`
- Modify: `src/features/workspace/AnalyticsPage.tsx`
- Modify: `src/features/workspace/ReportsPage.tsx` if the vesting export consumes schedule IDs
- Modify: `src/features/vesting/TeamManagementPage.tsx`

**Interfaces:**
- Detail reads accept `{ vaultAddress, scheduleId }`.
- Managed-vault views filter to the connected wallet's vault; beneficiary views may use discovered vaults and retain the originating vault address for claims.

- [x] **Step 1: Add tests for owner-scoped metrics, beneficiary discovery across two vaults, and claim/revoke target selection.** Workflow and multi-vault identity tests cover the security-critical target selection.
- [x] **Step 2: Run the view tests and verify failures caused by the current single-contract assumptions.** The initial pure workflow test failed before implementation.
- [x] **Step 3: Route all schedule detail reads and writes through the originating vault address.** My Vesting, Timeline, Treasury, claims, revocation, and bulk writes use the selected vault.
- [x] **Step 4: Scope Treasury, Analytics, Team, and Reports to managed vaults while preserving beneficiary discovery and empty/loading states.**
- [x] **Step 5: Verify CSV exports include vault address and schedule ID to prevent ambiguous records.** Treasury and Reports exports now include both fields.

### Task 7: End-to-end tests and deployment preparation

**Files:**
- Create/modify: `contracts/test/` integration coverage as needed
- Create: `src/features/vesting/self-service-workflow.test.ts`
- Modify: `docs/granthub-testnet-rehearsal.md` only if the new Core deployment checklist needs a separate section
- Create: `docs/self-service-vesting-testnet-deployment.md`

- [x] **Step 1: Add an integration test with Owner A, Owner B, and multiple beneficiaries.** Forge factory/self-service coverage includes two owners, multiple beneficiaries, funding rollback, claims, revocation, pause, and cross-user rejection.
- [x] **Step 2: Run Forge unit/fuzz/invariant tests, frontend tests, backend tests, and TypeScript.** Forge: 178 passed, 0 failed; server: 21 passed, 0 failed; focused frontend: 9 passed; sidebar: 6 passed; workspace: 3 passed; typecheck passed.
- [x] **Step 3: Run lint without auto-fixing unrelated files.** Both direct oxlint passes passed.
- [x] **Step 4: Run a production build to a clean temporary output directory if the existing `dist` is locked; do not delete or replace existing build output.** `dist-audit` build passed and the generated directory was removed afterward.
- [x] **Step 5: Add a Testnet deployment plan only; record required factory/vault addresses as pending and preserve Mainnet blanks.** Added `docs/self-service-vesting-testnet-deployment.md`.
- [x] **Step 6: Review `git diff`, generated artifacts, and secret patterns.** No keys/secrets were found in tracked paths; staged WAL/SHM deletions were left untouched and no commit/push occurred.

## Final verification commands

- `forge build`
- `forge test`
- `npm.cmd run test:sidebar`
- `npm.cmd run typecheck`
- `node_modules\\.bin\\oxlint.cmd --type-aware src scripts`
- `node_modules\\.bin\\oxlint.cmd .`
- `npm.cmd run test:server`
- `npm.cmd run build -- --outDir dist-audit --emptyOutDir false`

## Deployment boundary

Implementation and local simulations stop before any broadcast. A later
Testnet deployment requires separate authorization, verified dedicated signer,
network-specific USDC/factory parameters, bytecode verification, and an
operator-approved post-deployment rehearsal.
