# Vestros Collective Signatures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Testnet-only, policy-constrained CircleVault with configurable onchain signer approvals while preserving all deployed Vestros Core and GrantHub contracts.

**Architecture:** A permissionless CircleFactory deploys one CircleVault per circle. The vault owns member USDC and deploys a permanently bound CircleApprovalPolicy. The creator administers Draft setup and nonfinancial metadata; Draft cancellation is creator-only before liabilities exist, while protected payouts, pause, signer replacement, threshold changes, and active-circle recovery follow the documented policy or permissionless recovery rules. Safe accounts are optional onchain signers; EIP-1271/offchain signatures are deferred.

**Tech Stack:** Solidity 0.8.28, Foundry/Forge, OpenZeppelin Contracts 5.1.0, React 18, TypeScript, wagmi/viem, ConnectKit, Vite, existing Vestros design system.

**Spec:** `docs/superpowers/specs/2026-11-03-collective-signatures-design.md`

## Global Constraints

- Preserve `USDCVesting`, `SelfServiceVesting`, `VestingFactory`, all deployed Core addresses, and all GrantHub contracts.
- Prototype only on Arc Testnet (`5042002`) with canonical ERC-20 USDC `0x3600000000000000000000000000000000000000` and 6 decimals.
- Mainnet (`5042`) Circle configuration remains blank and must never fall back to Testnet.
- No upgradeable proxy, arbitrary `call`, arbitrary `delegatecall`, generic token rescue, creator withdrawal, or Safe-module execution path.
- Phase 1 approvals are onchain wallet transactions. Do not add an offchain relayer or Safe Transaction Service dependency.
- EIP-1271 support is deferred until a separate security-reviewed phase; Safe addresses may approve by submitting an onchain transaction from the Safe.
- Use the fixed Phase-1 operational bounds from the spec: max 32 members, 16
  signers, 32 rounds, 365-day maximum circle duration, 7-day maximum proposal
  lifetime, and 24-hour signer-set change delay.
- Financial terms and payout rules become immutable at activation.
- No deployment, broadcast, USDC movement, ownership change, GrantHub financial activation, commit, or push is part of this planning turn.

## Review Focus

- Creator authority must never authorize financial execution without the configured signer quorum; test every creator-only and signer-only boundary.
- A signer-set or threshold change must invalidate old payout approvals through `signerSetVersion`; test stale proposals, replay, and reproposal.
- Expiry, quorum loss, missed contributions, and cancellation must not redirect or strand funds silently; test deterministic refunds and frozen-quorum behavior.
- `totalEscrowed` must reconcile with round liabilities and vault USDC; test no cross-round borrowing, double payout, or undercollateralized execution.
- Safe addresses must be treated as one policy signer whose own Safe threshold is enforced by the Safe; do not infer EIP-1271 validity in phase 1.

---

### Task 1: Define contract interfaces and security-first Forge tests

**Files:**
- Create: `contracts/ICircleFactory.sol`
- Create: `contracts/ICircleVault.sol`
- Create: `contracts/ICircleApprovalPolicy.sol`
- Create: `contracts/test/CircleFactory.t.sol`
- Create: `contracts/test/CircleVault.t.sol`
- Create: `contracts/test/CircleApprovalPolicy.t.sol`
- Create: `contracts/test/Circle.Invariants.t.sol`
- Reuse: `contracts/test-helpers/MockERC20.sol` and `contracts/test-helpers/AdversarialERC20.sol`

**Interfaces:**
- `ICircleFactory` exposes `usdc()`, `circleOf(address,uint256)`, `circleCount()`, `circleAt(uint256)`, `createCircle(CircleVault.CircleConfig)`, and `CircleCreated(uint256,address,address)`.
- `ICircleApprovalPolicy` exposes `circleVault()`, `signerSetVersion()`, `signerSetHash()`, `threshold()`, `signerCount()`, `isSigner(address)`, `approvalCount(bytes32)`, `isPayoutApproved(bytes32)`, `approvePayout(bytes32)`, `invalidateProposal(bytes32)`, and signer-set governance methods.
- `ICircleVault` exposes Draft activation, member acceptance, round contribution, automatic/protected payout, expiry, cancellation, refunds, pause, and liability views defined in the spec.

- [ ] **Step 1: Write failing tests for factory and constructor boundaries.**

  Assert that zero USDC, zero creator, duplicate members, duplicate signers,
  invalid thresholds, oversized arrays, and `config.creator != msg.sender`
  revert. Assert the factory has no owner/admin withdrawal path and that the
  vault's policy is permanently bound to the vault.

- [ ] **Step 2: Write failing tests for creator and member lifecycle authority.**

  Cover Draft invitations, member terms acceptance, activation, terms-hash
  immutability, creator proposal rights, creator rejection as a signer unless
  explicitly configured, and rejection of creator-only payout execution,
  pause, active-circle cancellation, refund, or signer replacement. Cover
  creator-only Draft cancellation before any liabilities exist.

- [ ] **Step 3: Write failing tests for exact proposal identity and policy state.**

  Assert that proposal IDs include chain ID, vault, policy, circle ID, round ID,
  recipient, amount, nonce, expiry, terms hash, and signer-set version. Assert
  proposal nonces never repeat and signer approvals are unique.

- [ ] **Step 4: Run focused tests to confirm the expected preimplementation failure.**

  Run:

  ```powershell
  forge test --match-path contracts/test/CircleFactory.t.sol
  forge test --match-path contracts/test/CircleVault.t.sol
  forge test --match-path contracts/test/CircleApprovalPolicy.t.sol
  ```

  Expected result: failure because the Circle interfaces and implementations
  do not yet exist.

### Task 2: Implement `CircleApprovalPolicy`

**Files:**
- Create: `contracts/CircleApprovalPolicy.sol`
- Modify: `contracts/ICircleApprovalPolicy.sol`
- Modify: `contracts/test/CircleApprovalPolicy.t.sol`

**Interfaces:**
- Constructor: `CircleApprovalPolicy(address circleVault, address[] signers, uint16 threshold, bool creatorIncluded)`.
- `approvePayout(bytes32 proposalId)` records one approval from `msg.sender` after querying the bound vault's active proposal and matching signer-set version.
- `approvalCount(bytes32)` and `isPayoutApproved(bytes32)` expose threshold state without moving funds.
- `proposeSignerSet(address[] newSigners, uint16 newThreshold) returns (bytes32 changeId)` creates a governed, delayed signer-set change.
- `approveSignerSet(bytes32 changeId)` records one current-signer approval.
- `executeSignerSet(bytes32 changeId)` applies a threshold-approved change after the delay and increments `signerSetVersion`.
- `invalidateProposal(bytes32 proposalId)` marks a stale/expired proposal unavailable for execution.

- [ ] **Step 1: Implement signer-set validation and immutable vault binding.**

  Require nonzero unique signers, a protected majority threshold, and the fixed
  24-hour signer-set delay. Store a deterministic signer-set hash and reject all
  calls from addresses other than
  the bound vault where the vault-only boundary is required.

- [ ] **Step 2: Implement payout approvals and version checks.**

  Reject non-signers, duplicate approvals, nonexistent proposals, cancelled or
  executed proposals, expired proposals, and proposals whose snapshot version
  differs from the current version.

- [ ] **Step 3: Implement delayed signer replacement and threshold governance.**

  Require the current signer quorum, preserve the old version while the change
  is pending, apply the new set only after the timelock, increment the version,
  and emit events that identify old/new signer-set hashes and thresholds.

- [ ] **Step 4: Add policy tests and run them.**

  Cover 3-of-5, 2-of-3, creator-included and creator-excluded sets, duplicate
  approvals, stale approvals, signer replacement, threshold changes, timelock
  enforcement, and quorum loss. Expected result: focused policy tests pass.

### Task 3: Implement `CircleVault` custody, rounds, and recovery-safe refunds

**Files:**
- Create: `contracts/CircleVault.sol`
- Modify: `contracts/ICircleVault.sol`
- Modify: `contracts/test/CircleVault.t.sol`
- Modify: `contracts/test/Circle.Invariants.t.sol`

**Interfaces:**
- Constructor: `CircleVault(address usdc, uint256 circleId, CircleConfig calldata config)`; it creates and binds its `CircleApprovalPolicy`.
- Draft: `inviteMember(address)`, `acceptTerms(bytes32)`, `activate()`, and
  creator-only `cancelCircle(bytes32)` before activation and before any
  liabilities exist.
- Metadata: `setMetadataHash(bytes32)` before or after activation only for nonfinancial metadata.
- Funding: `contribute(uint256 roundId, uint128 amount)` and round/member contribution views.
- Protected settlement: `proposePayout(uint256)`, `executePayout(bytes32)`, `expireProposal(bytes32)`.
- Automatic settlement: `executeAutomaticPayout(uint256)` only when the immutable round is fully funded and eligible.
- Recovery: `activateRoundRecovery(uint256)` is permissionless after R1's
  immutable deadline condition; it invalidates the round's payout state,
  terminates future circle progression, and never transfers funds itself.
- Refunds: `refundContribution(uint256)` is claimant-initiated and limited to
  the caller's recorded, not-yet-refunded contribution.
- Governance: `pause()` and `unpause()` remain policy-controlled; recovery does
  not replace signers or weaken the payout threshold.
- Views: creator, policy, status, rounds, proposals, `totalDeposited`,
  `totalEscrowed`, `totalPaid`, and `totalRefunded`.

- [ ] **Step 1: Implement Draft membership and activation.**

  Verify `termsHash == keccak256(abi.encode(config with termsHash set to zero))`
  and store member acceptance against that exact commitment. Require all required
  members to accept before activation. Freeze token, members, contribution
  amounts, round recipients, payout amounts, settlement mode, deadlines, and
  terms hash at activation.

- [ ] **Step 2: Implement round-scoped contributions.**

  Require the exact declared contribution amount from an eligible member during
  the open funding window. Update `contributedByMember`, `roundEscrowed`, and
  `totalEscrowed` before `safeTransferFrom`; failed token calls must revert all
  accounting changes.

- [ ] **Step 3: Implement automatic and protected payouts.**

  Automatic execution is permissionless only after the round is fully funded
  and eligible. Protected execution requires the policy's current threshold,
  exact proposal snapshot, exact recipient/amount, unexpired status, and
  `roundEscrowed == payout`. Update state before `safeTransfer` and guard with
  `nonReentrant`.

- [ ] **Step 4: Implement Recovery Rule R1 and exact refunds.**

  Store immutable contribution and payout deadlines and use the fixed 72-hour
  recovery grace period. An underfunded round recovers strictly after its
  contribution deadline. A fully funded unpaid round recovers strictly after
  `payoutDeadline + 72 hours`; at the exact boundary payout execution wins.
  Recovery is permissionless and irreversible, invalidates all proposals for
  the round, prevents new contributions and later rounds, and terminates the
  circle. Each verified contributor may indefinitely pull only their recorded
  unrefunded contribution. No slashing, borrowing, payout reduction, recipient
  substitution, or future-round borrowing is permitted.

- [ ] **Step 5: Add solvency, authorization, and adversarial-token tests.**

  Assert `totalDeposited == totalEscrowed + totalPaid + totalRefunded`,
  `USDC.balanceOf(vault) >= totalEscrowed`, no cross-round borrowing, no
  arbitrary transfer, no double payout, no creator bypass, no refund after
  payout, and complete rollback for false-returning, reverting, and reentrant
  token behaviors.

- [ ] **Step 6: Add invariant handlers and run bounded fuzz/invariant tests.**

  Fuzz members, signers, thresholds, timestamps, contribution amounts,
  proposal expiry, exact deadline boundaries, recovery order, missed
  contributions, arbitrary refund ordering, and repeated execute/refund calls.
  The invariant suite must prove that paid plus refunded amounts never exceed
  successful deposits, recovery and payout are mutually exclusive, unclaimed
  refunds remain entitled, and each round pays at most once.

### Task 4: Implement `CircleFactory`

**Files:**
- Create: `contracts/CircleFactory.sol`
- Modify: `contracts/ICircleFactory.sol`
- Modify: `contracts/test/CircleFactory.t.sol`

**Interfaces:**
- Constructor: `CircleFactory(address usdc)`; require the canonical Arc USDC address, not merely a nonzero token.
- `createCircle(CircleVault.CircleConfig calldata config) returns (address)`;
  require `config.creator == msg.sender`, validate bounded arrays and majority
  thresholds, deploy the vault, register it, and emit `CircleCreated`.
- `circleOf(address creator, uint256 nonce)`, `circleCount()`, and
  `circleAt(uint256)` are read-only discovery methods.

- [ ] **Step 1: Implement permissionless creation and registration.**

  The factory must not inherit ownership, retain vault admin authority, or
  expose token withdrawal. Registration must occur before the creation event
  is emitted.

- [ ] **Step 2: Add multi-circle and isolation tests.**

  Assert independent creators and nonces receive independent vaults, identical
  round IDs remain scoped by vault address, and one circle's creator, signer,
  member, or policy cannot operate another circle.

- [ ] **Step 3: Run all Circle contract tests and the existing Forge suite.**

  Run `forge test`; the existing vesting and GrantHub suites must remain green.

### Task 5: Add Testnet-only deployment-safe configuration

**Files:**
- Create: `contracts/script/DeployCircleFactory.s.sol`
- Create: `src/circleConfig.ts`
- Create: `src/circleConfig.test.ts`
- Modify: `.env.example`
- Modify: `MAINNET-READINESS.md` only to document that Circles are not a Mainnet release component

**Interfaces:**
- `CIRCLE_FACTORY_ADDRESS`, `CIRCLE_FACTORY_DEPLOY_TX`,
  `CIRCLE_FACTORY_DEPLOYED`, and `CIRCLE_CONFIG_ERROR` selected only from
  `VITE_CHAIN_ENV=testnet` configuration.
- `CIRCLE_USDC_ADDRESS` and `CIRCLE_USDC_DECIMALS` from the existing Arc
  network facts.
- Mainnet Circle values must remain blank and must not fall back to Testnet.

- [ ] **Step 1: Add failing configuration tests.**

  Test Testnet selection, blank Mainnet behavior, invalid address rejection,
  canonical USDC selection, and no cross-network fallback.

- [ ] **Step 2: Implement the simulation-only deployment script.**

  Enforce chain ID `5042002`, canonical USDC, no raw Mainnet key path, and no
  broadcast behavior. The script must print constructor arguments and expected
  factory artifact information.

- [ ] **Step 3: Implement config and ABI exports.**

  Import Foundry artifacts for `CircleFactory`, `CircleVault`, and
  `CircleApprovalPolicy`. Keep the Mainnet address blank until separately
  authorized.

- [ ] **Step 4: Run config tests, `forge build`, and nonbroadcast Testnet simulation.**

  Expected result: configuration tests and build pass; no deployment transaction
  is submitted.

### Task 6: Add direct wagmi/viem Circle reads and wallet writes

**Files:**
- Create: `src/hooks/useCircleFactory.ts`
- Create: `src/hooks/useCircle.ts`
- Create: `src/features/circles/circleTerms.ts`
- Create: `src/features/circles/circleTerms.test.ts`
- Create: `src/features/circles/CircleCreatePage.tsx`
- Create: `src/features/circles/CircleDashboardPage.tsx`
- Create: `src/features/circles/CircleSecurityPage.tsx`
- Create: `src/features/circles/CircleProposalPage.tsx`
- Modify: `src/App.tsx`, `src/appRoutes.ts`, and `src/components/layout/navConfig.ts`

**Interfaces:**
- `useCircleFactory(): { factoryAddress?: Address; circles: Address[]; isLoading: boolean; isConfigured: boolean }`.
- `useCircle(circleAddress: Address): { status; terms; policy; rounds; proposals; isLoading; refetch }`.
- `circleTermsHash(input: CircleTermsInput): Hex` must use deterministic ABI encoding and the same field order as the contract.
- Write helpers must return explicit pending, rejected, confirmed, and failed states and reset on wallet/chain changes.

- [ ] **Step 1: Add pure terms-hash and policy-display tests.**

  Assert deterministic hashes, exact raw USDC conversion, majority thresholds,
  creator inclusion disclosure, round deadlines, and no JavaScript number
  conversion for financial values.

- [ ] **Step 2: Implement read hooks with Testnet-only network guards.**

  Read factory discovery, vault state, policy signer/version/threshold, round
  funding, proposal status, and liability totals directly through wagmi/viem.

- [ ] **Step 3: Implement Draft creation and member acceptance flows.**

  The UI must display the full financial terms and terms hash before activation.
  Each member accepts from their own wallet; activation is disabled until all
  required acceptances are confirmed onchain.

- [ ] **Step 4: Implement contribution and approval flows.**

  Contributions target the selected CircleVault. Approval targets the bound
  CircleApprovalPolicy. Execution targets the originating CircleVault and is
  available to any wallet only after direct reads prove eligibility.

- [ ] **Step 5: Implement security, pending approvals, expiry, refund, and recovery UI.**

  Display recipient, amount, circle, round, threshold, approval count,
  signer-set version, expiry, current funding, and exact reason when execution
  is unavailable. Never present creator status as financial authorization.

- [ ] **Step 6: Add wallet-switch and authorization tests.**

  Verify a creator cannot approve unless also a signer, a nonmember cannot
  contribute or accept, a non-signer cannot approve, and switching wallets does
  not reuse another circle's state or proposal approvals.

### Task 7: Add Circle activity and local receipt history

**Files:**
- Create: `src/features/circles/circleActivity.ts`
- Create: `src/features/circles/circleActivity.test.ts`
- Modify: `src/hooks/useVestingActivity.ts` only through a separate Circle event adapter if the existing activity model supports it
- Modify: `src/features/workspace/ActivityPage.tsx` only after composite identity review

**Interfaces:**
- `CircleActivityRecord` is keyed by `{ chainId, circleVault, circleId, roundId?, proposalId?, txHash, logIndex }`.
- Supported records include `CircleCreated`, `TermsAccepted`, `CircleActivated`, `ContributionReceived`, `PayoutProposed`, `PayoutApproved`, `PayoutExecuted`, `PayoutExpired`, `CircleCancelled`, `ContributionRefunded`, and signer-policy events.

- [ ] **Step 1: Add receipt-decoding and deduplication tests.**

  Decode only successful confirmed receipts from the originating CircleVault,
  policy, or factory; reject failed receipts, wrong contracts, wrong chain,
  duplicate logs, and unrelated USDC transfers.

- [ ] **Step 2: Implement wallet-scoped local history.**

  Reuse the existing confirmed-receipt journal conventions without browser
  historical scans. Scope records by chain, wallet, circle, proposal, and
  transaction identity. Keep unavailable history distinct from an empty history.

- [ ] **Step 3: Integrate activity after direct financial reads are stable.**

  Activity must never block balances, contribution status, approval status, or
  execution eligibility. Optional backend history can enhance records later.

### Task 8: Testnet deployment rehearsal and verification package

**Files:**
- Create: `docs/circles-testnet-deployment.md`
- Create: `docs/circles-security-review.md`
- Modify: `.env.example` only with public pending deployment placeholders
- Create/modify: `scripts/verify-circle-deployment.mjs` for read-only verification

**Interfaces:**
- The verifier accepts factory address, deployment transaction, chain ID,
  canonical USDC, and expected runtime hashes as explicit inputs.
- It verifies receipt status, chain ID, constructor token, runtime bytecode,
  factory registration, vault policy binding, signer set, threshold, terms hash,
  and initial zero liabilities.

- [ ] **Step 1: Prepare a no-broadcast Testnet rehearsal.**

  Run `forge build`, focused Circle tests, complete `forge test`, config tests,
  TypeScript, frontend tests, lint, and production build. Do not create a live
  circle or move USDC in this planning phase.

- [ ] **Step 2: Define the authorized operator deployment sequence.**

  Use a dedicated Testnet signer, canonical USDC, chain ID `5042002`, and the
  simulation-only deployment script. Record factory receipt, block, runtime
  bytecode, and constructor argument before configuring the frontend.

- [ ] **Step 3: Define the approved minimal-value Testnet rehearsal.**

  After separate authorization, create one circle, configure 3-of-5 or 2-of-3,
  collect terms acceptances, fund one round, approve, execute, expire one
  proposal, cancel one underfunded round, and refund only current-round member
  contributions. Each step requires independent receipt verification.

- [ ] **Step 4: Document release blockers.**

  No Mainnet release is permitted without independent review of custody,
  policy governance, solvency invariants, recovery/liveness, Safe signer
  semantics, and deployed artifact/source verification.

## Security Acceptance Criteria

- Creator cannot move, redirect, pause, cancel, refund, or authorize funds
  without the documented policy path.
- Every payout has one immutable recipient, amount, round, terms hash, nonce,
  expiry, and signer-set version.
- Signer replacement invalidates pending approvals and cannot be unilateral.
- Expired or stale proposals cannot execute or reserve funds indefinitely.
- Missed contributions cannot cause underfunded payouts or cross-round borrowing.
- R1 recovery is permissionless and irreversible after the exact deadline
  conditions; it invalidates proposals, terminates future progression, and
  preserves indefinite individual refund entitlements.
- Accounting preserves
  `totalDeposited == totalEscrowed + totalPaid + totalRefunded`; recovery
  activation itself changes none of these counters.
- `USDC.balanceOf(vault) >= totalEscrowed` holds after every successful call and
  after all adversarial-token rollback tests.
- Payouts and refunds are exact, isolated, nonreentrant, and single-use.
- Safe addresses are authorized only as explicit signer slots; no Safe module,
  arbitrary call, delegatecall, or creator withdrawal exists.
- Testnet and Mainnet configuration are strictly separated.
- Existing Core and GrantHub tests and behavior remain unchanged.

## Explicit Blockers

- No independent security review has been completed for CircleVault or
  CircleApprovalPolicy.
- R1 recovery must pass its deadline, timeout, refund-ordering, termination,
  and solvency tests before any Testnet deployment rehearsal. It does not
  provide signer replacement or an administrator override.
- EIP-1271/offchain signature support is not part of the first prototype.
- Safe Transaction Service and Safe Wallet availability on Arc must be verified
  before any future offchain-signature UX is enabled.
- No Mainnet Circle factory address, deployment, or financial activation is
  authorized.
- The implementation plan itself does not authorize contract code, deployment,
  transactions, or production configuration changes.
