# Vestros Circles Phase 1.7 Audit-Readiness Package

Status: frozen for independent review preparation only. This document does not
authorize deployment, Testnet financial activation, frontend integration,
commit, or push.

## Review candidate and reproducibility

- Branch: `feat/collective-signatures-phase1`
- Expected base Git revision: `8fa4ed39e15d139d5262843a306dd17fcac048c4`
- Candidate form: a descendant of that base revision plus the frozen Circle
  source hashes. The current checkout still contains the candidate as
  uncommitted files.
- Existing `cache/` is unrelated and must be preserved.
- No deployed Vestros Mainnet contract is modified by this candidate.

Run from the repository root:

```powershell
node scripts/verify-circles-audit-baseline.mjs
forge fmt --check contracts/CircleApprovalPolicy.sol contracts/CircleFactory.sol contracts/CircleVault.sol contracts/ICircleApprovalPolicy.sol contracts/ICircleFactory.sol contracts/ICircleVault.sol contracts/script/DeployCircleFactory.s.sol contracts/test/CircleApprovalPolicy.t.sol contracts/test/CircleFactory.t.sol contracts/test/CircleVault.t.sol contracts/test/Circle.Invariants.t.sol contracts/test/DeploymentScriptGuards.t.sol
forge build
forge test --threads 1 --no-match-test "^invariant_"
forge test --match-path contracts/test/CircleApprovalPolicy.t.sol
forge test --match-path contracts/test/CircleFactory.t.sol
forge test --match-path contracts/test/CircleVault.t.sol
forge test --match-path contracts/test/DeploymentScriptGuards.t.sol
forge test --match-path contracts/test/Circle.Invariants.t.sol
forge test --match-path contracts/test/SelfServiceVesting.t.sol --match-test invariant_
forge test --match-path contracts/test/GrantPool.Invariant.t.sol
forge test --threads 1
forge test
```

The baseline verifier checks that the expected base revision is an ancestor of
the current checkout and compares SHA-256 hashes against twelve frozen Circle
source/test/deployment entries. It never regenerates expected hashes. It must
pass before an external reviewer begins. A reviewer should preserve the
uncommitted files or place them in a proposed snapshot commit without changing
their contents.

## Toolchain and dependencies

| Component | Required baseline |
|---|---|
| Forge | `1.7.1`, commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8` |
| Solidity | `0.8.28` |
| EVM | Paris |
| Optimizer | enabled, 200 runs |
| Forge standard library | `forge-std` package `1.16.2` |
| OpenZeppelin | npm package `@openzeppelin/contracts` `5.1.0` |
| Remappings | `forge-std/=lib/forge-std/src/`; `@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/` |
| Arc Testnet | chain ID `5042002` |
| Canonical USDC | `0x3600000000000000000000000000000000000000` |

The repository now contains
`.github/workflows/circles-audit.yml`, which provisions Ubuntu 24.04, checks
out the full repository with recursive submodules, installs Foundry 1.7.1,
runs the frozen baseline and all individual/aggregate test commands, and
uploads per-command logs. The workflow has been prepared but cannot be
executed from this local checkout without a GitHub Actions run, so Linux
results remain **not verified** until the workflow is run.

## Contract scope and trust boundaries

`CircleFactory` is a permissionless registry with no owner or post-deployment
administrative path. It accepts only canonical Arc USDC, requires the creator
to equal `msg.sender`, validates bounded members/signers/deadlines and a
strict-majority threshold, deploys a `CircleVault`, registers it, and emits
`CircleCreated`.

`CircleVault` is the only Circle contract with USDC custody. It permanently
binds one `CircleApprovalPolicy`, stores immutable financial terms after
activation, enforces member contribution and recipient/amount/round matching,
and exposes no generic transfer, rescue, delegatecall, or Safe-execution path.

`CircleApprovalPolicy` stores signer approvals and can authorize only the
bound vault's constrained payout, pause, unpause, and signer-set entrypoints.
It cannot transfer USDC or call arbitrary targets.

Official-circle authenticity must not rely on `CircleVault.factory()` alone.
Consumers must configure a trusted factory address and verify all of:

1. `trustedFactory.isCircle(vault) == true`;
2. `vault.factory() == trustedFactory`;
3. `vault.usdc() == trustedFactory.usdc() == canonical Arc USDC`;
4. `vault.policy()` is nonzero and `policy.circleVault() == vault`; and
5. deployed runtime bytecode and constructor/deployment evidence match the
   approved artifacts.

A standalone vault can still be constructed with a nonzero noncanonical token
for isolated testing. It is not an official Vestros circle and must be
rejected by clients and indexers.

## Role and permission matrix

| Actor | Allowed | Not allowed |
|---|---|---|
| Creator | Draft invitations, metadata, terms activation, eligible payout proposal, Draft cancellation without liabilities | Unilateral payout approval, pause/unpause, withdrawal, rescue, refunds for others, post-activation term changes |
| Member | Accept exact terms, contribute exact round amount, refund own recorded contribution after recovery | Other members' refunds, changing terms, payout execution authority by membership alone |
| Authorized signer | Approve exact payout/governance/signer-set proposal from own wallet | Arbitrary calls, redirecting recipient/amount, unilateral execution, bypassing signer snapshots |
| Policy quorum | Approve constrained payouts, pause/unpause, signer replacement under the existing delay | USDC custody, arbitrary calls, threshold reduction through pause governance |
| Factory | Register factory-created circles and expose canonical configuration | Ownership, pause, withdrawal, signer replacement, vault administration |
| Outsider | Call permissionless execution, expiry, recovery, and eligible refunds for self where applicable | Approve, contribute as nonmember, withdraw, alter configuration, bypass policy |

## Interface inventory

### CircleFactory

`usdc()`, `circleOf(creator, nonce)`, `circleCount()`, `circleAt(index)`,
`isCircle(circle)`, and `createCircle(CircleConfig)`.

### CircleVault

Deployment/provenance: `factory()`, `usdc()`, `creator()`, `circleId()`,
`policy()`, and `status()`.

Lifecycle: `inviteMember`, `acceptTerms`, `activate`, `cancelCircle`,
`pause`, `unpause`, and `activateRoundRecovery`.

Financial: `contribute`, `proposePayout`, `executeAutomaticPayout`,
`executePayout`, `expireProposal`, and `refundContribution`.

Views: `termsHash`, `proposalLifetime`, `currentRoundId`, `round`,
`proposal`, `roundEscrowed`, `totalDeposited`, `totalEscrowed`, `totalPaid`,
and `totalRefunded`.

### CircleApprovalPolicy

Payout: `approvePayout`, `approvalCount`, `isPayoutApproved`,
`payoutProposalStatus`, and `invalidateProposal`.

Pause governance: `proposePause`, `approvePause`, `executePause`,
`invalidatePauseProposal`, `pauseApprovalCount`, `isPauseApproved`,
`pauseProposal`, and `pauseProposalStatus`.

Signer governance: `proposeSignerSet`, `approveSignerSet`,
`executeSignerSet`, and `signerSetChange`.

## Financial state machine

```text
Draft
  | all members accept exact terms
  v
Active --quorum pause--> Paused --quorum unpause--> Active
  |                         |                         |
  |                         +--permissionless recovery-+
  |                                                   |
  +--automatic payout / quorum payout-----------------+--> next round
  |
  +--missed contribution deadline---------------------> Terminated/Recovery
  |
  +--fully funded but unpaid after payout deadline + 72h -> Recovery

Recovery -> individual member refunds only -> Terminated
Active final paid round -> Completed
Draft with zero liabilities -> Cancelled
```

Pause does not extend contribution deadlines, payout deadlines, proposal
expiry, or the fixed 72-hour recovery grace period. It temporarily makes a
payout `Ineligible`; a fresh quorum unpause can restore an otherwise-live
proposal. Recovery and individual refunds remain permissionless while paused.

## Governance and recovery specification

Every payout proposal binds chain ID, vault, policy, circle ID, round,
recipient, amount, proposal nonce, expiry, terms hash, signer-set version,
signer-set hash, threshold, and recovery epoch. Every pause proposal binds the
same circle/policy identity plus the exact boolean action and a separate
monotonic governance nonce.

Signer replacement requires the current governance quorum and timelock. A
signer-set version or terms/recovery epoch change makes old approvals stale.
Governance actions are single-use and expired proposals cannot execute.

Recovery is permissionless and irreversible. An underfunded round recovers
strictly after its contribution deadline. A fully funded unpaid round recovers
strictly after `payoutDeadline + 72 hours`. Recovery increments the epoch,
explicitly cancels the latest stored payout proposal, and makes older payout
and pause proposals effectively `Stale` through view checks without iterating
historical storage.

## Accounting invariants

The external reviewer should assert after every successful and reverted state
transition:

```text
totalDeposited = totalEscrowed + totalPaid + totalRefunded
USDC.balanceOf(vault) >= totalEscrowed
```

Additional invariants:

- A payout transfers only the immutable round recipient and exact payout.
- A refund transfers only the caller's own unreimbursed contribution.
- Payout and refund paths are mutually exclusive for a round.
- Failed USDC transfers revert all accounting mutations.
- Unsolicited USDC is surplus and never creates member entitlement.
- A paid, recovered, expired, stale, or cancelled proposal cannot execute.
- No later round can borrow or consume an earlier round's escrow.
- Creator, factory, policy, and outsider paths cannot withdraw arbitrary USDC.

## Censorship and governance-griefing assessment

The protected payout mode has an unavoidable liveness risk: a quorum can
refuse to approve, collude to withhold approval, or pause and refuse to
unpause. This can deny the recipient the expected payout. The protocol does
not provide a creator override, guardian override, automatic signer
replacement, payout reduction, recipient substitution, or arbitrary emergency
withdrawal, because each would expand financial authority.

The fund-safe consequence is deterministic recovery: once the immutable
deadline conditions pass, anyone can activate recovery, and contributors can
pull their own recorded contributions back indefinitely. The recipient is not
compensated for a censored payout. This is an accepted economic risk, not a
custody bypass.

Strategic pause cannot extend any deadline or prevent recovery. Repeated payout
proposals consume fresh nonces but cannot change the round's recipient, amount,
contribution deadline, payout deadline, or recovery boundary. A pause proposal
itself expires and cannot be replayed after signer-set or recovery changes.

Mitigation options such as signer rotation, quorum-loss recovery, recipient
protection, or an independent guardian require a separately approved design
and external review; none are included in Phase 1.7.

## Threat model

Reviewers should model a malicious creator, colluding or compromised signers,
lost signer quorum, stale approvals, malicious token return values, direct
token donations, arbitrary transaction ordering, deadline-boundary miners,
cross-circle confusion, fake/unregistered vaults, and a compromised frontend.

The security boundary is onchain: frontend/indexer data is advisory, the
vault rechecks round and accounting conditions, the policy rechecks snapshots
and epochs, and token transfer failures revert state. No backend, relayer, Safe
service, EIP-1271 signature, or off-chain approval is trusted in Phase 1.

## Reproducibility and Forge investigation

Observed clean results on Windows:

- `forge fmt --check`: exit 0.
- `forge build`: exit 0; only timestamp and test-cast warnings.
- `forge test --threads 1 --no-match-test "^invariant_"`: 246 passed, exit 0,
  approximately 3.35 seconds wall time.
- Circle policy: 18 passed, exit 0.
- Circle factory: 16 passed, exit 0.
- Circle vault: 26 passed, exit 0.
- Deployment guards: 6 passed, exit 0.
- Circle invariants: 3 properties × 128,000 calls, exit 0.
- SelfService invariants: 1 property × 128,000 calls, exit 0.
- GrantPool invariants: 3 properties × 128,000 calls, exit 0.

Aggregate investigation:

- `forge test` completed ordinary suites and remained CPU-active during
  invariant execution; it was stopped with Ctrl-C, exit 1, without an
  aggregate summary.
- `forge test --threads 1` is supported by Forge 1.7.1. It completed Circle
  and GrantPool invariant suites with zero failures, then remained active
  without a final aggregate exit; it was stopped with Ctrl-C, exit 1.
- At the time of inspection the active Forge process was responsive, about
  73.8 MB working set and 169 CPU seconds in the single-worker run. After
  interruption no `forge` or `anvil` process remained.
- Cross-platform runner behavior was not previously verified locally. The
  Phase 1.8 workflow now provides the Linux comparison; its first run is still
  pending.

This points to a test-run lifecycle/performance issue rather than an assertion
failure. The current evidence does not identify whether the final delay is
Forge teardown, Windows process handling, or the remaining expensive invariant
suite. The invariant depth must not be reduced to make the aggregate command
return.

## Source hashes

The machine-checkable source manifest is
`scripts/verify-circles-audit-baseline.mjs`. SHA-256 values for the review
candidate are:

| File | SHA-256 |
|---|---|
| `contracts/CircleApprovalPolicy.sol` | `bd0f765beb903158bd034ca05f227b7caa4709babfd07989461f145b2db2011e` |
| `contracts/CircleFactory.sol` | `04a643cf26d9b7aa3b476cdb1edeec97aaca3c8c797e984403dd84b4988d2837` |
| `contracts/CircleVault.sol` | `f3791d44a739a87c8b7de7bd9fcfb9f4815648238c0870a764e74ab56238a564` |
| `contracts/ICircleApprovalPolicy.sol` | `dad0c33b50dc4a72c2d3daa298f4b920751bf873740521b2a9fbc7ecb059e13e` |
| `contracts/ICircleFactory.sol` | `bb73efa5522a339767d5f3f4397b60c08bf279896a37fd293757586e536124be` |
| `contracts/ICircleVault.sol` | `e4eeb30f2c7b1cf98bef4da57f0187247d472dc76d42dc06b8377b473e6e3c97` |
| `contracts/script/DeployCircleFactory.s.sol` | `087e6d12456efaba5e906484277b82a5da3026ef38920bc80acc1d462a772fef` |
| `contracts/test/Circle.Invariants.t.sol` | `63634ad09c826b30d0921595c5dfc437ea3b60b465240daf18aa3a8ce8b0dd5c` |
| `contracts/test/CircleApprovalPolicy.t.sol` | `7e78ff3ee14270c879ee4d25f564a4248ce8aa62a0615786c1588435aca8ff0c` |
| `contracts/test/CircleFactory.t.sol` | `012408970b3191a701cb73cefdd38d9346a1842a47223d4ba9f85aee928f4cde` |
| `contracts/test/CircleVault.t.sol` | `d371ae02af15f5e84d2e4efa762356e21d6bed1f9ec4280fa2bb5870aea6a89a` |
| `contracts/test/DeploymentScriptGuards.t.sol` | `78e668c0b41fee49da78ea9077421f67766074d85233f4b51f6929afc5480a6c` |

Supporting handoff artifacts at this revision:

- `scripts/verify-circles-audit-baseline.mjs` — `420988230b38c0fac6804b9029a08e55480f0a8023f23974cfec754e39cb3a4d`
- `.github/workflows/circles-audit.yml` — `b418697a34fae62f19f23d2c799cdd2fcc4f55652005eca912cd34137bf91eb3`

## Proposed audit snapshot commit

No commit is being created automatically. The proposed snapshot should be a
single commit descended from `8fa4ed39e15d139d5262843a306dd17fcac048c4` with a
message such as:

```text
circles: freeze phase 1 audit candidate and Linux CI
```

It should contain only:

- the Circle contracts and interfaces;
- Circle unit, fuzz, and invariant tests;
- `contracts/script/DeployCircleFactory.s.sol`;
- the Circle deployment guard additions;
- `foundry.toml` and dependency metadata required to reproduce the build;
- `scripts/verify-circles-audit-baseline.mjs`;
- `.github/workflows/circles-audit.yml`; and
- the Phase 1/1.6/1.7 design, plan, report, and audit-package documents.

It must exclude `.env` files, credentials, private keys, `cache/`, build
outputs, broadcast artifacts, local logs, node_modules, and unrelated
application changes. The baseline verifier should pass in that snapshot
because the snapshot commit is a descendant of the expected base revision and
the audited source hashes remain unchanged.

## Deployment and verification checklist

Deployment is **not ready**. When separately authorized, the operator must:

1. Use a dedicated Testnet signer or Ledger/keystore; never use the Foundry
   default sender.
2. Run `DeployCircleFactory.s.sol` with chain ID `5042002` and canonical USDC.
3. Record factory address, receipt, block, deployer, constructor argument,
   runtime bytecode, and source/compiler metadata.
4. Verify the factory's `usdc()` and `circleCount()` before creating anything.
5. For each circle, verify `isCircle`, `factory`, `usdc`, policy binding,
   signer set, threshold, terms hash, zero liabilities, and event provenance.
6. Perform only the separately approved nonfinancial or minimal-value
   rehearsal, independently verifying every receipt and accounting transition.
7. Do not configure Mainnet, alter existing Vestros contracts, or activate
   GrantHub financial settings as part of this prototype.

## Release assessment

### Resolved internally

- No confirmed creator withdrawal or arbitrary execution path.
- Quorum-governed pause/unpause with exact action binding.
- Epoch-based stale proposal invalidation and effective-status views.
- Permissionless recovery/refunds while paused.
- Factory registration and canonical Testnet deployment guards.
- Solvency, rollback, payout/refund exclusivity, and cross-circle invariant
  coverage in the listed clean individual runs.

### Open or blocked

- Independent external security audit has not occurred.
- Quorum censorship and recipient payout denial remain accepted economic risks.
- Direct vault construction is not canonical; official clients must enforce
  trusted factory registration and canonical token checks.
- EIP-1271/off-chain signatures and Safe modules are intentionally deferred.
- Aggregate Windows Forge process exit is not clean, including with one worker.
- Linux CI workflow is prepared but its first GitHub Actions execution and
  artifact review are still pending.

Final decision: **GO for independent external-audit handoff, HOLD for Testnet
financial activation**. The handoff is reproducible from the frozen manifest,
but activation remains blocked until the external review, signer/deployment
approval, deployment verification, minimal rehearsal, clean Linux comparison,
and aggregate test-run investigation are independently accepted. This package
is not an audit certificate.
