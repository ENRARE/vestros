# Vestros Collective Signatures — Phase 1 Report

Date: 2026-11-03  
Scope: Arc Testnet prototype implementation only

## Result

Phase 1 contract implementation is complete locally. No contract was deployed,
no wallet transaction was broadcast, and no existing vesting or GrantHub
contract was modified.

The implementation adds a permissionless `CircleFactory`, one immutable-term
`CircleVault` per circle, and a permanently bound `CircleApprovalPolicy`.
`CircleVault` is the only contract in the module that can move USDC.

## Changed production paths

- `contracts/CircleFactory.sol`
- `contracts/CircleVault.sol`
- `contracts/CircleApprovalPolicy.sol`
- `contracts/ICircleFactory.sol`
- `contracts/ICircleVault.sol`
- `contracts/ICircleApprovalPolicy.sol`

## Changed test paths

- `contracts/test/CircleFactory.t.sol`
- `contracts/test/CircleVault.t.sol`
- `contracts/test/CircleApprovalPolicy.t.sol`
- `contracts/test/Circle.Invariants.t.sol`

The test files and interface/spec documents were created as the approved Phase
1 work. Existing vesting and GrantHub sources were left unchanged.

## Contract boundaries

`CircleFactory(address usdc)` accepts only canonical Arc USDC
`0x3600000000000000000000000000000000000000`. `createCircle(CircleConfig)`
requires `config.creator == msg.sender`, validates bounded unique members and
signers, strict-majority thresholds, exact round array lengths, safe deadlines,
and the zeroed-config terms commitment. Registration occurs before
`CircleCreated` is emitted. The factory has no owner, withdrawal function, or
post-deployment authority.

`CircleVault` exposes Draft membership and exact terms acceptance, immutable
round funding, automatic or protected payouts, proposal expiry, permissionless
R1 recovery, claimant-only refunds, and policy-controlled pause boundaries.
There is no arbitrary transfer, rescue, delegatecall, creator withdrawal, or
recipient substitution path.

`CircleApprovalPolicy` permanently binds to one vault. Payout approvals are
`msg.sender`-based only in Phase 1: no offchain signatures, EIP-1271, Safe
modules, arbitrary calls, or delegatecalls. Proposals commit to chain ID,
vault, policy, circle, round, recipient, amount, nonce, expiry, terms hash, and
signer-set version. Signer replacement uses unique current-signer quorum,
monotonic governance nonce/version, a fixed 24-hour delay, and bound
chain/terms/recovery snapshots.

## Recovery and accounting

R1 is permissionless and irreversible:

- underfunded current rounds recover strictly after `contributionDeadline`;
- fully funded unpaid rounds recover strictly after
  `payoutDeadline + 72 hours`;
- at exact equality, payout execution wins;
- recovery invalidates payout state, terminates the circle, blocks later rounds,
  and creates no transfer or refund accounting by itself;
- each contributor can indefinitely pull only their own unrefunded contribution;
- token transfer failures revert all accounting changes.

The invariant enforced by tests is:

```text
totalDeposited = totalEscrowed + totalPaid + totalRefunded
USDC.balanceOf(circleVault) >= totalEscrowed
```

Direct token donations are surplus and are not counted as member deposits.

## Verification

- `forge build`: passed (Solidity 0.8.28, Paris, optimizer 200).
- Focused `CircleApprovalPolicy.t.sol`: 8 passed, 0 failed.
- Focused `CircleVault.t.sol`: 23 passed, 0 failed.
- Focused `CircleFactory.t.sol`: 15 passed, 0 failed.
- `Circle.Invariants.t.sol`: 3 passed, 0 failed, 128,000 handler calls per
  invariant.
- Full captured Forge run: 14 suite summaries, 235 tests, every suite
  reported `ok`, 0 failures and 0 skips. On this Windows environment Forge
  did not return its process after printing the final summary; the orphaned
  test process was stopped after the results were captured. This cleanup
  anomaly is operational, not a reported test failure.

Build emitted expected Foundry lint warnings for block-timestamp comparisons
and bounded test casts; there were no compiler errors.

## Security status

### Covered

- creator cannot bypass signer authorization or move escrow;
- factory and vault are cross-circle isolated;
- signer sets are unique, bounded, and strict-majority;
- stale approvals are invalidated by signer-set snapshots and recovery epoch;
- payout and recovery are mutually exclusive at the specified boundaries;
- exact contribution/refund transfer failures roll back accounting;
- no double payout, double refund, arbitrary transfer, or cross-round borrowing;
- existing vesting and GrantHub regression suites remain green.

### Blocking before any Testnet financial activation

- independent contract security review of the new vault, policy, and recovery
  implementation;
- review of the fixed contribution model and maximum configuration bounds;
- review of token behavior assumptions and pause/unpause operational governance;
- deployment signer approval, bytecode verification, and an operator-approved
  nonfinancial/minimal-value rehearsal;
- frontend and deployment configuration work is intentionally not included in
  this Phase 1 authorization.

Phase 1 is therefore implementation/test complete, but not deployment-ready
or authorized for activation.

## Phase 1.5 security review

Review date: 2026-11-03  
Review type: internal, security-focused implementation review; this is not an
independent external audit.

### Scope and adversarial coverage

The review covered `CircleFactory`, `CircleVault`, `CircleApprovalPolicy`, all
three interfaces, the approved design/specification, unit tests, fuzz tests,
and the Circle invariant handler. Additional adversarial coverage was added
for:

- false-returning USDC during payout settlement, verifying that `paid`,
  `executed`, `totalPaid`, and `totalEscrowed` all roll back;
- a paused underfunded round, verifying permissionless recovery and member
  refunds remain available; and
- metadata changes, verifying the required audit event is emitted.

The payout rollback failure was isolated to the test harness: the temporary
false-returning token was still installed when the test called `balanceOf`.
The production revert and accounting rollback were correct. The test now
restores the token code before checking conservation and passes.

### Findings

#### Critical — none confirmed

No tested path lets the creator, a member, a signer, or the factory withdraw
another member's funds or bypass the protected payout policy. No arbitrary
ERC-20 transfer, delegatecall, Safe execution module, `tx.origin`, or
off-chain signature path exists.

#### High — none confirmed

Protected payouts, automatic payouts, recovery, refunds, and failed token
transfers preserve the tested accounting and exclusivity properties. The
available quorum-loss path is deterministic and fund-safe under the approved
R1 rule.

#### Medium — M-01: pause governance is not reachable

Affected functions: `CircleVault.pause()` and `CircleVault.unpause()`;
`CircleApprovalPolicy` has no external pause/unpause relay or governance
proposal.

The vault accepts these calls only from its bound policy, but the policy
exposes no function that calls them. The tests use Foundry impersonation of
the policy address to exercise paused-state recovery; that is not a reachable
production governance flow. The current deployed code therefore cannot
enter `Paused` through its public policy API, and the intended policy-governed
pause/unpause control is incomplete.

This is not a demonstrated fund-loss path: recovery and refunds are explicitly
allowed while paused. It is nevertheless a release blocker for a financial
Testnet activation because the emergency pause semantics and liveness
authority are not defined at the callable interface boundary.

Recommended fix: specify and implement a policy-mediated pause/unpause
state machine (including quorum, creator-inclusion behavior, expiry, and
events), then add authorization, liveness, and recovery tests. Do not add an
ad-hoc creator or guardian bypass.

Status: resolved in Phase 1.6 by the quorum-governed pause state machine
described below; independent external review remains a release blocker.

#### Low — L-01: recovery invalidates authorization, but not every stored record

Affected functions: `CircleVault.activateRoundRecovery()` and
`CircleApprovalPolicy.invalidateProposal()`.

The vault explicitly marks only `_latestProposalByRound` as cancelled during
recovery. Older proposal records for the same round remain uncancelled in
vault storage, but the policy's recovery epoch and live-proposal checks make
all of them unexecutable. This does not create a double-spend path, but it
can produce stale lifecycle records and makes the specification's phrase
“invalidates every proposal” less literal for indexers.

Recommended fix: either enforce one live proposal per round, or maintain an
enumerable per-round proposal set and emit invalidation for every record.
Resolve before frontend/history integration; not a demonstrated custody
vulnerability.

Status: resolved for effective authorization and consumer-visible status. The
vault still does not emit one event per historical proposal; consumers must
use the recovery epoch and effective-status view rather than infer state from
the stored `cancelled` bit alone.

#### Low — L-02: direct vault construction is less constrained than factory construction

Affected function: `CircleVault` constructor.

`CircleFactory` enforces the canonical Arc USDC address, but the public
`CircleVault` constructor accepts any nonzero token address. A caller can
therefore deploy a standalone vault with a different token. That does not
alter factory-created circles or existing Vestros contracts, but it creates a
deployment/configuration hazard if operators or the frontend accept arbitrary
vault addresses.

Recommended fix: keep factory-only production deployment, enforce chain ID
and canonical USDC in the Testnet deployment script, and have clients trust
only factory-registered circles. Do not silently change the constructor
without an approved interface decision.

Status: mitigated for official-circle discovery. `CircleFactory.isCircle`, the
vault's recorded `factory`, canonical-USDC factory validation, and the
Testnet-only deployment guard define the supported provenance boundary. Direct
vault construction remains intentionally possible for isolated tests, but
clients must reject unregistered vaults.

#### Informational — closed metadata audit gap

`setMetadataHash` now emits `MetadataHashUpdated(previousHash,newHash)` via
`ICircleVault`. The new event test passes and makes the permitted nonfinancial
creator update auditable.

#### Informational — intentionally deferred authorization surfaces

Phase 1 remains `msg.sender` based. EIP-1271/off-chain approvals, Safe module
execution, arbitrary calls, automatic signer recovery, and any emergency
withdrawal path remain explicitly out of scope. They must not be inferred
from the current signer-set or creator model.

### Verification evidence and exit status

All commands below were run after the Phase 1.5 changes using a TTY so the
process exit was observed:

| Command | Result |
|---|---|
| `forge fmt --check` on Circle sources/tests | PASS, exit 0 |
| `forge build` | PASS, exit 0; only expected timestamp/test-cast warnings |
| `forge test --no-match-test "^invariant_"` | PASS, 233 passed, 0 failed, 0 skipped, exit 0 |
| `forge test --match-path contracts/test/CircleApprovalPolicy.t.sol` | PASS, 8 passed, exit 0 |
| `forge test --match-path contracts/test/CircleFactory.t.sol` | PASS, 15 passed, exit 0 |
| `forge test --match-path contracts/test/CircleVault.t.sol` | PASS, 25 passed across both suites, exit 0 |
| `forge test --match-path contracts/test/Circle.Invariants.t.sol` | PASS, 3 properties × 128,000 calls, exit 0 |
| `forge test --match-path contracts/test/SelfServiceVesting.t.sol --match-test invariant_VaultBalanceMatchesHandlerAccounting` | PASS, 128,000 calls, exit 0 |
| `forge test --match-path contracts/test/GrantPool.Invariant.t.sol` | PASS, 3 properties × 128,000 calls, exit 0 |

The earlier aggregate Windows run printed green suite summaries, but the
Forge child remained CPU-active after the last suite and did not return a
clean aggregate exit. It was stopped. A later aggregate run excluding all
invariant functions returned cleanly; the individual Circle, SelfService,
and GrantPool invariant runs above also returned cleanly. The targeted
`USDCVestingInvariantTest` run exceeded five minutes without an exit and was
interrupted with Ctrl-C (exit 1); this is an existing Core test-tooling issue,
not evidence of a Circle contract failure. Accordingly, no claim of a clean
full-repository Forge run is made.

### Phase 1.5 Testnet readiness decision (historical)

**BLOCKED.** The implementation has no confirmed Critical or High custody
vulnerability in the reviewed paths, but it is not ready for Testnet
financial activation because:

1. pause/unpause governance is not a callable, specified policy flow;
2. the direct-vault token boundary and chain-specific deployment guard still
   require an operator-controlled deployment procedure;
3. L-01 should be resolved before history/frontend integration; and
4. an independent external contract review remains outstanding.

No deployment, broadcast, frontend integration, ownership change, or commit
was performed. The pre-existing `cache/` directory was left untouched.

## Phase 1.6 governance remediation

Review date: 2026-11-03  
Review type: internal security-focused hardening review; this is not an
independent external audit.

### Governance authorization model

`CircleApprovalPolicy.proposePause(bool)` is signer-only and creates a proposal
bound to the current policy and vault. Its identity commits the chain ID,
vault address, policy address, circle ID, exact pause/unpause action, a
monotonic governance nonce, signer-set version, recovery epoch, terms hash,
and expiry. Each proposal snapshots the signer-set hash and threshold.

`approvePause` accepts one approval per current signer. `executePause` is
permissionless to call, but succeeds only after the current quorum is present
and every snapshot remains current. It invokes only the fixed bound-vault
`pause()` or `unpause()` function. There is no target parameter, calldata,
delegatecall, token transfer, creator bypass, or threshold-changing path.
Governance actions are single-use and cannot execute after expiry, signer-set
replacement, terms changes, recovery, or a mismatched vault state.

Creator inclusion remains an opt-in quorum condition; it never grants the
creator unilateral authority. Signer replacement continues to require the
existing governance quorum and timelock, and cannot lower the configured
threshold through the pause path.

### Pause, payout, and recovery semantics

Pause is a temporary circuit breaker. It makes payout proposals effectively
`Ineligible` while the vault is paused, but does not invalidate them. A fresh
quorum-governed unpause can restore an otherwise-live proposal to `Approved`.
Permissionless recovery and individual contributor refunds remain available
while paused. Recovery increments `recoveryEpoch`, explicitly cancels the
latest stored payout proposal, and makes all older payout and pause proposals
effectively `Stale` through the epoch check without iterating historical
storage. `payoutProposalStatus` and `pauseProposalStatus` expose these
effective states for indexers and future clients.

The conservation and custody boundary is unchanged:

```text
totalDeposited = totalEscrowed + totalPaid + totalRefunded
USDC.balanceOf(circleVault) >= totalEscrowed
```

Pause cannot redirect or withdraw funds. Recovery and refunds remain exact,
non-reentrant, member-scoped, and permissionless after their documented
deadlines.

### Official-circle provenance and deployment controls

`CircleVault.factory` records the deploying factory address. The configured
`CircleFactory` marks each successful deployment in `isCircle`. The factory
continues to enforce canonical Arc USDC, bounded configuration, strict-majority
thresholds, unique members/signers, and deadline bounds. Clients and indexers
must treat only circles registered by the configured factory as official;
standalone vault construction remains an unsupported test/deployment path.

`DeployCircleFactory.s.sol` is Testnet-only, requires chain ID `5042002` and
canonical USDC `0x3600000000000000000000000000000000000000`, and rejects the
Foundry default sender. No broadcast was performed.

### Adversarial verification added

- unauthorized creator and outsider pause attempts;
- insufficient and fresh quorum pause/unpause flows;
- expired, replayed, stale signer-set, and recovered governance proposals;
- pause preserving permissionless recovery/refunds;
- pause suspending but not permanently invalidating a valid payout;
- older payout records becoming effectively `Stale` after recovery while the
  latest record is `Invalidated`, with no historical iteration;
- arbitrary target/token authority attempts; and
- official factory registration versus direct-vault provenance.

### Phase 1.6 verification evidence

| Command | Result |
|---|---|
| `forge fmt --check` on Phase 1.6 Circle files | PASS, exit 0 |
| `forge build` | PASS, exit 0; expected timestamp/test-cast warnings only |
| `forge test --match-path contracts/test/CircleApprovalPolicy.t.sol` | PASS, 18 passed, exit 0 |
| `forge test --match-path contracts/test/CircleFactory.t.sol` | PASS, 16 passed, exit 0 |
| `forge test --match-path contracts/test/CircleVault.t.sol` | PASS, 26 passed across both suites, exit 0 |
| `forge test --match-path contracts/test/DeploymentScriptGuards.t.sol` | PASS, 6 passed, exit 0 |
| `forge test --no-match-test "^invariant_"` | PASS, 246 passed, exit 0 |
| `forge test --match-path contracts/test/Circle.Invariants.t.sol` | PASS, 3 properties × 128,000 calls, exit 0 |
| `forge test --match-path contracts/test/SelfServiceVesting.t.sol --match-test invariant_` | PASS, 1 property × 128,000 calls, exit 0 |
| `forge test --match-path contracts/test/GrantPool.Invariant.t.sol` | PASS, 3 properties × 128,000 calls, exit 0 |

The aggregate Windows `forge test` runner remains a separate operational
issue. The prior aggregate run printed green suite summaries but did not
return a clean process exit and was stopped; a targeted legacy
`USDCVestingInvariantTest` run likewise exceeded five minutes and was
interrupted with exit 1. These are not reported as clean aggregate passes.
The current Phase 1.6 implementation is covered by clean focused, non-
invariant, and individual invariant runs above.

### Current readiness decision

**BLOCKED for Testnet financial activation.** The Phase 1.6 governance and
effective-status requirements are implemented and verified, with no confirmed
Critical or High custody issue in this internal review. Activation still
requires:

1. an independent external security review of `CircleVault`,
   `CircleApprovalPolicy`, recovery, and solvency assumptions;
2. operator approval of the dedicated Testnet signer and deployment procedure;
3. bytecode/source verification and a nonfinancial or minimal-value rehearsal;
4. explicit acceptance of the remaining operational caveat that direct vaults
   are not official unless registered by the configured factory; and
5. a separately investigated clean aggregate Forge process exit.

No deployment, broadcast, financial activation, frontend integration,
ownership change, commit, or push was performed.
