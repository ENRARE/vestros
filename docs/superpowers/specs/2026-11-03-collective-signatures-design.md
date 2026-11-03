# Vestros Collective Signatures Design

## Intent

Add configurable, onchain multi-signature authorization for Vestros savings
circles while preserving every deployed Vestros vesting and GrantHub contract.
Circle creators remain responsible for setup and coordination, but they never
receive unilateral authority to withdraw or redirect member-contributed USDC.

The first implementation is Testnet-only. It uses explicit onchain signer
approvals so the financial authorization path is visible, deterministic, and
independent of a Safe transaction service or a relayer. Safe accounts may act
as authorized signers by submitting the same approval transaction from the
Safe; optional EIP-1271/offchain signature support is deferred until the
onchain path is independently reviewed.

## Goals

- Create one independently governed `CircleVault` per circle.
- Support immutable financial terms after activation.
- Support automatic settlement under predeclared payout rules.
- Support protected settlement with configurable thresholds, including 3-of-5
  and 2-of-3 defaults.
- Enforce signer uniqueness, proposal nonces, expiration, round eligibility,
  exact USDC accounting, and replay protection onchain.
- Make creator, member, signer, proposer, and recovery powers explicit.
- Provide a complete approval and execution lifecycle in the UI.
- Preserve the existing Core vesting contracts, user-owned vesting vaults,
  legacy deployments, GrantHub contracts, and GrantHub financial flags.

## Non-goals

- Replacing or modifying `USDCVesting`, `SelfServiceVesting`,
  `VestingFactory`, `GrantPool`, `GrantPoolFactory`, or `GrantVesting`.
- Adding multisignature requirements to routine personal vesting vaults.
- Giving a circle administrator arbitrary ERC-20 transfer, delegatecall, or
  Safe-module execution authority.
- Deploying or configuring Mainnet contracts.
- Relying on a server, Safe Transaction Service, or private relayer for the
  initial Testnet authorization path.
- Treating a UI approval count as financial authorization without a matching
  onchain policy check.

## Constraints

- Solidity `0.8.28`, EVM `paris`, optimizer 200, and the repository's existing
  OpenZeppelin dependency.
- Arc Testnet (`5042002`) only for the prototype; canonical ERC-20 USDC is
  `0x3600000000000000000000000000000000000000` with 6 decimals.
- Phase-1 operational bounds are immutable implementation constants:
  `MAX_MEMBERS = 32`, `MAX_SIGNERS = 16`, `MAX_ROUNDS = 32`,
  `MAX_CIRCLE_DURATION = 365 days`, `MAX_PROPOSAL_LIFETIME = 7 days`, and
  `SIGNER_SET_CHANGE_DELAY = 24 hours`.
- Mainnet (`5042`) configuration remains separate and unchanged.
- No contract broadcast, USDC transfer, ownership change, GrantHub financial
  activation, commit, or push is part of the design phase.
- All financial actions must be initiated by a connected wallet and confirmed
  through the browser wallet.

## Approaches considered

### Dedicated policy-controlled vault

`CircleVault` holds USDC and a separate `CircleApprovalPolicy` validates
protected payouts. This gives Vestros precise control over round eligibility,
solvency, expiration, and allowed recipients, but introduces new contracts
that require independent review.

### Safe-first escrow

A Safe holds the circle funds and Safe transactions execute payouts. Safe
provides mature owner/threshold mechanics and typed signature support, but a
Safe transaction can target arbitrary calls and enabled modules can bypass the
normal owner-signature path. Circle-specific restrictions would therefore
require an additional audited Guard or Module, increasing integration and
operational dependency.

### Approved hybrid: constrained vault with optional Safe signers

`CircleVault` remains the only escrow and financial enforcement boundary.
`CircleApprovalPolicy` enforces Vestros-specific rules. An EOA or a Safe may be
an authorized signer, but the vault accepts only structured, eligible payout
execution. Safe is not granted arbitrary vault execution, and no Safe service
is required for the first prototype.

This is the selected approach because it preserves the product's exact circle
rules while allowing future Safe compatibility without making an external
multisig service a custody dependency.

## Contract architecture

### `CircleFactory`

Permissionless registry for circles, analogous to the existing
`VestingFactory`, but with no administrative ownership over created circles.

Proposed interface:

```solidity
constructor(address usdc_)
function usdc() external view returns (address)
function circleOf(address creator, uint256 circleNonce) external view returns (address)
function circleCount() external view returns (uint256)
function circleAt(uint256 index) external view returns (address)
function createCircle(CircleVault.CircleConfig calldata config) external returns (address circle)
event CircleCreated(uint256 indexed circleId, address indexed creator, address indexed circle)
```

The factory constructor requires the canonical Arc USDC address
`0x3600000000000000000000000000000000000000` and stores each created circle
for discovery. The deployment script independently enforces chain ID
`5042002`. The factory cannot pause, withdraw, change policy, or replace
signers in a circle.

### `CircleVault`

Owns the circle's USDC and enforces immutable financial terms. It has a
creator-admin role for nonfinancial setup and proposal initiation, but no
creator-only withdrawal path.

Proposed state:

```solidity
enum CircleStatus { Draft, Active, Paused, Completed, Cancelled, Terminated }
enum SettlementMode { Automatic, Protected }

struct CircleConfig {
    address creator;
    address[] members;
    address[] signers;
    uint16 threshold;
    SettlementMode settlementMode;
    uint128 contributionAmount;
    uint48[] roundContributionDeadlines;
    uint48[] roundPayoutDeadlines;
    uint32 roundCount;
    address[] roundRecipients;
    uint128[] roundPayouts;
    uint48 proposalLifetime;
    bytes32 termsHash;
}

// The supplied termsHash is verified as:
// keccak256(abi.encode(config with termsHash set to bytes32(0))).
// This avoids a self-referential hash while committing to every other field.

struct Round {
    uint128 requiredFunding;
    uint128 contributed;
    uint128 payout;
    address recipient;
    uint48 contributionDeadline;
    uint48 payoutDeadline;
    RoundStatus status;
    uint128 refunded;
    bool paid;
}

enum RoundStatus { Pending, Open, Paid, Recovery, Terminated }

struct PayoutProposal {
    uint256 proposalNonce;
    uint256 roundId;
    address recipient;
    uint128 amount;
    uint48 expiresAt;
    uint48 createdAt;
    bool executed;
    bool cancelled;
}
```

The exact production structs may use packed fields where safe, but no amount
or timestamp is converted through JavaScript numbers or an unsafe Solidity
cast. All USDC values remain raw 6-decimal integers.

Financial functions:

- `contribute(uint128 amount)` — member-only, exact `safeTransferFrom`.
- `activate(bytes32 memberAcceptanceRoot)` — creator may call only after all
  required members have accepted the exact terms hash.
- `openRound(uint256 roundId)` — permissionless when the immutable schedule
  permits it and required funding conditions are met.
- `proposePayout(uint256 roundId)` — authorized proposer only; parameters must
  equal the round's predeclared recipient and amount.
- `approvePayout(bytes32 proposalId)` — signer-only, one approval per signer.
- `executePayout(bytes32 proposalId)` — permissionless once the policy and
  vault checks pass.
- `cancelPayout(bytes32 proposalId)` — proposer or policy-governed cancel path
  before execution; never refunds already-paid funds.
- `expirePayout(bytes32 proposalId)` — permissionless after expiry.
- `activateRoundRecovery(uint256 roundId)` — permissionless after the immutable
  recovery condition is true; it irreversibly invalidates the round's pending
  payout state and terminates future circle progression.
- `refundContribution(uint256 roundId)` — claimant-initiated, exact, and
  repeat-safe recovery of the caller's unrefunded contribution.
- `cancelCircle(bytes32 reasonHash)` — creator-only in `Draft` before any
  financial liabilities exist; after activation, R1 recovery is the only
  active-circle termination path.
- `pause()` / `unpause()` — governed emergency controls; pause cannot redirect
  funds or rewrite terms.

There is no generic `transfer`, `call`, `delegatecall`, `rescue`, or
administrator withdrawal function. Any cancellation/refund path must name the
eligible member and amount from immutable accounting rules.

### `CircleApprovalPolicy`

Policy is deployed by `CircleVault` during construction and permanently bound
to that vault. It stores:

- unique signer addresses;
- threshold and signer count;
- whether the creator is included as a signer;
- per-proposal approval bitmap or signer approval mapping;
- policy version and terms hash;
- signer replacement and recovery proposals;
- cancellation and expiry state.

The initial Testnet path uses `approvePayout(proposalId)` transactions. The
policy rejects duplicate approvals, non-signers, inactive proposals,
wrong-policy versions, expired proposals, and approvals after execution.

Signer replacement is itself a protected governance proposal with the fixed
`SIGNER_SET_CHANGE_DELAY = 24 hours` timelock. The creator cannot replace a
signer alone after activation.

An optional later interface may add:

```solidity
function approveBySig(PayoutApproval calldata approval, bytes calldata signature) external
```

It must use EIP-712 domain separation containing chain ID, policy address, and
policy version, and support EIP-1271 for Safe signer addresses. It is not part
of the first financial prototype.

## Activation and immutability

### Draft

The creator configures members, signers, threshold, payout order, amounts,
intervals, expiration rules, and disclosure text. Members may be invited and
must accept the exact `termsHash` from their own wallets.

### Activation

Activation requires:

- unique nonzero members and signers;
- no more than `MAX_MEMBERS`, `MAX_SIGNERS`, or `MAX_ROUNDS` entries;
- threshold between 1 and signer count;
- `3-of-5` for the protected default or explicitly disclosed custom policy;
- `2-of-3` for the protected three-member default;
- creator-included signer status explicitly recorded;
- every required member's acceptance of the exact terms hash;
- round recipients and amounts matching the declared circle rules;
- contribution deadlines strictly before payout deadlines, all deadlines within
  `MAX_CIRCLE_DURATION`, and `proposalLifetime` in `(0,
  MAX_PROPOSAL_LIFETIME]`;
- contribution and payout totals fitting checked integer bounds.

### Active

After activation, the following cannot change:

- contribution amount and schedule;
- round count and payout order;
- recipients and payout amounts;
- settlement mode;
- initial terms hash;
- circle USDC token;
- the requirement that payouts pass the vault and policy checks.

Nonfinancial metadata may change only through the creator's limited admin
functions and must emit events. Signer replacement and threshold changes
require the governed policy process. R1 recovery deadlines and the 72-hour
grace period are fixed financial rules, not creator-configurable recovery
authority.

## Proposal state machine

```text
Draft
  -> Active
  -> Proposed
  -> Approved       (threshold reached, not yet executed)
  -> Executed       (single successful payout)

Proposed -> Cancelled
Proposed -> Expired
Active   -> Paused -> Active
Draft    -> Cancelled       (creator-only, before activation, no liabilities)
Active   -> Completed
Active   -> Recovery -> Terminated
```

Every proposal is identified by a domain-separated digest over:

```text
chainId, circleVault, policy, circleId, roundId, recipient, amount,
  proposalNonce, expiresAt, termsHash, signerSetVersion
```

The phase-1 type string is exactly:

```text
PayoutProposal(uint256 chainId,address circleVault,address policy,uint256 circleId,uint256 roundId,address recipient,uint128 amount,uint256 proposalNonce,uint48 expiresAt,bytes32 termsHash,uint64 signerSetVersion)
```

The nonce is consumed exactly once. Execution rechecks the round, recipient,
amount, funding, vault status, expiry, and `paid` flag immediately before the
USDC transfer. State is updated before the external transfer and protected by
`nonReentrant`; a failed transfer reverts the entire state transition.

## Recovery Rule R1: deterministic contributor refunds

Recovery is a permissionless, irreversible state transition. It is not an
administrator withdrawal path, does not replace signers, and does not weaken
the approval threshold.

- Every round stores immutable `contributionDeadline` and `payoutDeadline`.
- The phase-1 grace period is the fixed constant
  `RECOVERY_GRACE_PERIOD = 72 hours`. Deadlines must be ordered, bounded, and
  fit `uint48`; the factory rejects deadlines that exceed the configured maximum
  lock window.
- While `block.timestamp <= contributionDeadline`, eligible members may make
  their exact declared contribution. At `block.timestamp >
  contributionDeadline`, an underfunded round may enter recovery.
- A fully funded round may pay while `block.timestamp <= payoutDeadline +
  RECOVERY_GRACE_PERIOD`, subject to all payout and proposal checks. At the
  exact boundary, payout execution wins; recovery is valid only when
  `block.timestamp > payoutDeadline + RECOVERY_GRACE_PERIOD`.
- A fully funded round that has not paid becomes recovery-eligible strictly
  after that grace period. A paid round is never recovery-eligible.
- `activateRoundRecovery(roundId)` is permissionless once the condition is
  satisfied. It changes the round to `Recovery`, prevents new contributions and
  all payout approvals/execution, prevents subsequent rounds from opening, and
  marks the circle `Terminated`. It cannot be reopened.
- The current pending proposal is invalidated by the recovery transition, and
  all other proposals for that round are logically invalid because execution
  checks the terminal round status and recovery epoch. No stale proposal can
  reserve or move funds.
- `refundContribution(roundId)` may be called only by a verified contributor.
  The refundable amount is `contributedByMember[roundId][msg.sender]` minus
  that member's prior refunds. Each successful refund decrements
  `totalEscrowed`, increments `totalRefunded`, and emits
  `ContributionRefunded`. Unclaimed refunds remain withdrawable indefinitely;
  no administrator may confiscate them.
- Recovery creates entitlements but does not itself transfer funds or increment
  `totalRefunded`. A successful payout makes the round permanently ineligible
  for recovery refunds, and a failed token transfer rolls back all state.
- Recovery and payout are mutually exclusive at the timestamp boundaries above.
  Checks-effects-interactions and `nonReentrant` protect both payout and refund.
- Recovery of one round terminates the circle for phase 1, so no later round
  can receive contributions or create a second liability domain.

### R1 accounting

The vault stores `totalDeposited`, `totalEscrowed`, `totalPaid`, and
`totalRefunded`. With no protocol fees and no permitted outflows other than a
declared payout or contributor refund, every successful state transition must
preserve:

```text
totalDeposited = totalEscrowed + totalPaid + totalRefunded
```

Contributions increase `totalDeposited` and `totalEscrowed`. Successful payouts
decrease `totalEscrowed` and increase `totalPaid`. Successful refunds decrease
`totalEscrowed` and increase `totalRefunded`. Entering recovery changes neither
counter. Unexpected direct token transfers are not contributions and are
tracked only by the difference between the ERC-20 balance and authorized
liabilities.

The solvency invariant is `USDC.balanceOf(vault) >= totalEscrowed`; no round may
borrow from another round, and total paid plus total refunded can never exceed
successful deposits. Required lifecycle events are `RoundRecoveryEligible`,
`RoundRecoveryActivated`, `PayoutProposalInvalidated`, `ContributionRefunded`,
`RoundTerminated`, and `CircleTerminated`. Eligibility may be derived from
deadlines, but eligibility events are emitted only with a real transition.

Other failure rules remain unchanged: malicious proposal parameters are checked
against immutable round data; signers cannot authorize arbitrary calls; partial
funding never produces a short payout; and pause/unpause remains governed.
- Token failure or blocklist behavior: `SafeERC20` failure reverts atomically;
  the policy does not mark a payout executed until the transfer succeeds.

## UI architecture

New Core routes should be scoped under `/circles` and use the existing wallet,
network, dark design system, and direct wagmi/viem reads.

Required surfaces:

- Circle creation and terms disclosure.
- Member invitation and member terms acceptance.
- Security settings showing signer addresses, threshold, creator inclusion,
  policy version, recovery delay, and immutable terms.
- Pending approvals showing circle, round, recipient, raw/human USDC amount,
  required approvals, current count, expiry, and execution eligibility.
- Wallet-specific Approve, Execute, Cancel, Expire, and governed replacement
  actions.
- Transaction history keyed by `(chainId, circleVault, circleId, roundId,
  proposalId, txHash, logIndex)`.
- Execution receipt and state refresh after confirmation.

The UI must distinguish draft, active, paused, completed, cancelled, expired,
partial, and unavailable history states. It must never infer financial
authorization from a cached approval count.

## Safe integration boundary

Safe is optional in phase 1. A Safe may be listed as a signer only if it
submits the onchain approval transaction from the Safe address. No Safe module,
guard, delegatecall, or arbitrary execution hook is enabled by CircleVault.

Later EIP-1271 support may allow a Safe signer to approve typed proposals
offchain, but the policy must verify the Safe's current owner/threshold state
at execution time or bind the approval to a versioned signer configuration.
Safe Transaction Service availability on Arc must be verified independently;
the first implementation must not depend on it.

## Other Vestros modules

The same policy primitive may later authorize:

- cooperative treasury spending with an allowlisted recipient and cap;
- large business disbursements;
- bulk vesting allocation batches;
- organization treasury administration;
- emergency operations with explicit circuit-breaker rules.

These integrations are separate adapters. They must not silently change the
access control of personal vesting vaults or existing GrantHub contracts.

## Testing strategy

Foundry tests must be added before implementation code:

- constructor and factory registration;
- signer uniqueness, threshold bounds, creator inclusion, and policy binding;
- member terms acceptance and activation immutability;
- automatic and protected settlement;
- 3-of-5 and 2-of-3 approvals;
- duplicate signer approvals and wrong-signer rejection;
- proposal nonce replay, wrong chain/domain, expiry, cancellation, and
  execution-after-expiry rejection;
- recipient/amount/round substitution rejection;
- underfunded and partially funded rounds;
- failed/reverting/false-return USDC rollback;
- reentrancy and double execution;
- signer replacement timelock and recovery threshold;
- Safe-style contract signer boundary tests if EIP-1271 is enabled;
- fuzzed amounts, timestamps, member sets, signer sets, thresholds, and
  proposal lifetimes.

Core invariants:

- vault USDC balance is never less than outstanding obligations;
- each round pays at most once;
- executed payout equals the immutable round amount and recipient;
- `totalDeposited = totalEscrowed + totalPaid + totalRefunded` after every
  successful financial transition;
- total paid plus remaining obligations never exceeds accepted contributions;
- terms hash and financial configuration never change after activation;
- creator cannot withdraw or bypass policy;
- approval count never exceeds unique active signers;
- an expired, cancelled, or executed proposal can never execute.
- a recovered round cannot accept new contributions, open later rounds, or
  execute any proposal; each member's unrefunded entitlement remains stable.

## Deployment and rollout boundary

Phase 1 is a local/Testnet prototype only:

1. Add contracts, tests, ABIs, and Testnet-only configuration with Mainnet
   fields blank.
2. Run the complete Forge, frontend, server, TypeScript, lint, and build suites.
3. Perform read-only deployment simulations with canonical Arc Testnet USDC.
4. Obtain independent contract review of the vault, policy, and recovery logic.
5. Deploy only after separate authorization, then create a test circle with
   nonfinancial or minimal-value rehearsal parameters.
6. Verify deployment bytecode, policy binding, signers, threshold, terms hash,
   events, approval lifecycle, settlement, and rollback behavior.

No Mainnet deployment, public funding, ownership change, or GrantHub financial
activation is included.

## Implementation defaults

The following defaults are proposed for the implementation plan:

- onchain approval transactions for the first Testnet release;
- automatic settlement and protected settlement as separate immutable modes;
- all invited members must accept the terms hash before activation;
- `3-of-5` protected default, `2-of-3` protected default for three members;
- creator inclusion is opt-in and displayed prominently;
- signer replacement uses the active threshold plus a timelock;
- no arbitrary token transfer, delegatecall, or creator rescue path;
- Safe compatibility starts with onchain Safe-submitted approvals, not an
  offchain Safe service dependency.

## Resolved security decisions

### 1. Creator authority versus financial authorization

`creator` is an immutable administrator identity, not a fund controller.

The creator may invite members while the circle is in `Draft`, update
nonfinancial metadata, activate the circle after all required acceptances, and
propose eligible payouts. The creator may approve or execute a payout only if
the creator is independently present in the signer set and uses the same
approval path as every other signer.

The creator cannot change terms after activation, change the USDC token,
withdraw, transfer, rescue, bypass the policy, unilaterally pause, unpause,
cancel, refund another member, or replace signers. Pause, unpause, circle
cancellation, signer replacement, and threshold changes are policy-governed.

### 2. Signer replacement, snapshots, and stale approvals

`CircleApprovalPolicy.signerSetVersion()` is a monotonically increasing
`uint64`. Every signer or threshold change increments it. Each payout proposal
stores the version, signer-set hash, and threshold snapshot used at creation.

The proposal identity is:

```solidity
keccak256(abi.encode(
    PAYOUT_PROPOSAL_TYPEHASH,
    block.chainid,
    address(circleVault),
    address(policy),
    circleId,
    roundId,
    recipient,
    amount,
    proposalNonce,
    expiresAt,
    termsHash,
    signerSetVersion
))
```

`proposalNonce` is incremented on every proposal and never reused. A signer
set or threshold change makes all earlier pending proposals stale. A stale
proposal cannot execute or receive approvals; anyone may call
`invalidateProposal` to release its pending round slot. The payout may then be
re-proposed under the current signer-set version.

Signer replacement itself uses a governed proposal with a snapshot of the
current signer set, a majority threshold, a minimum delay, and a separate
governance nonce. The executing transaction must satisfy the old quorum before
the new set is installed.

### 3. Deadlocks, expiry, recovery, and refunds

Payout proposals expire at `expiresAt`. `expireProposal` is permissionless and
does not move USDC. An expired or invalidated proposal leaves the round unpaid
until it either executes before the R1 recovery boundary or enters recovery.

R1 uses a fixed `72 hours` recovery grace period after each immutable payout
deadline. An underfunded round becomes recoverable strictly after its
contribution deadline. A fully funded but unpaid round becomes recoverable
strictly after `payoutDeadline + 72 hours`. Recovery is permissionless and
irreversible; it invalidates every proposal for the round, blocks contributions
and all later rounds, and terminates the circle for Phase 1.

Members can pull back only their own current-round contributions through
`refundContribution`. The entitlement is the recorded contribution minus that
member's prior refunds, remains withdrawable indefinitely, and cannot touch a
paid round, another member's contribution, or a future round. Recovery itself
does not transfer funds or increment refund accounting.

The prototype has no hidden guardian, creator override, automatic signer
replacement, or emergency arbitrary withdrawal. R1 provides deterministic
fund-safe recovery without weakening the approval threshold.

### 4. Missed contributions and post-payout defaults

Contributions are round-scoped. A member contributes the exact declared amount
for the open round. The contract records `contributedByMember[roundId][member]`
and `roundEscrowed[roundId]`.

An underfunded round cannot pay. When its contribution deadline passes, it may
enter R1 recovery and current-round contributions become refundable. There is
no automatic slashing, borrowing, payout reduction, recipient substitution,
or round skipping in the prototype. A recovery transition terminates the
circle, so no post-payout default can open a new funding window or create a
later liability domain.

### 5. Solvency, reserved liabilities, and payout isolation

The vault tracks `totalDeposited`, `totalEscrowed`, `totalPaid`, and
`totalRefunded`. Every successful contribution increases `totalDeposited` and
`totalEscrowed`; every successful payout or member refund decreases
`totalEscrowed` before the token transfer. With no fees or other permitted
outflows, the accounting equation is:

```text
totalDeposited = totalEscrowed + totalPaid + totalRefunded
```

The primary solvency invariant is:

```text
USDC.balanceOf(circleVault) >= totalEscrowed
```

The inequality allows unsolicited token donations without counting them as
member liabilities. A payout can transfer only the exact `round.payout` to the
immutable `round.recipient` after that round's escrow equals its required
amount and before the R1 recovery boundary. A refund can transfer only the
caller's recorded current-round contribution after recovery. No balance from
one round may be used to satisfy another round's payout. Direct token
transfers are tracked only as surplus and never as authorized contributions.

### 6. Safe and ERC-1271 authorization semantics

Phase 1 authorization is `msg.sender` based. A signer is an EOA or a Safe
address stored in the signer set. An EOA submits `approvePayout` directly; a
Safe signer submits the same call through its Safe, so the Safe's own owner
threshold authorizes that single signer slot. This does not require a Safe API
or offchain service.

No arbitrary Safe execution is accepted by `CircleVault`.

If EIP-712 signatures are added later, `approveBySig` must use OpenZeppelin's
`SignatureChecker.isValidSignatureNow`, which supports ECDSA EOAs and
EIP-1271 contract signers. The digest must include chain ID, vault, policy,
terms hash, proposal nonce, proposal signer-set version, recipient, amount,
round, and expiry. The signature only records one approval for that exact
proposal; it cannot execute a call, alter policy, or authorize a different
recipient. A signer-set version change invalidates all unsigned and signed
approvals from the previous version.

## Exact phase-1 interfaces

The following interfaces are the implementation boundary. Names may be
namespaced during coding, but behavior and argument meaning must remain fixed.

```solidity
interface ICircleFactory {
    function usdc() external view returns (address);
    function circleOf(address creator, uint256 nonce) external view returns (address);
    function circleCount() external view returns (uint256);
    function circleAt(uint256 index) external view returns (address);
    function createCircle(CircleVault.CircleConfig calldata config)
        external returns (address circle);
    event CircleCreated(uint256 indexed circleId, address indexed creator, address indexed circle);
}

interface ICircleApprovalPolicy {
    function circleVault() external view returns (address);
    function signerSetVersion() external view returns (uint64);
    function signerSetHash() external view returns (bytes32);
    function threshold() external view returns (uint16);
    function signerCount() external view returns (uint16);
    function isSigner(address account) external view returns (bool);
    function approvalCount(bytes32 proposalId) external view returns (uint16);
    function isPayoutApproved(bytes32 proposalId) external view returns (bool);
    function approvePayout(bytes32 proposalId) external;
    function invalidateProposal(bytes32 proposalId) external;
    function proposeSignerSet(address[] calldata newSigners, uint16 newThreshold)
        external returns (bytes32 changeId);
    function approveSignerSet(bytes32 changeId) external;
    function executeSignerSet(bytes32 changeId) external;
}

interface ICircleVault {
    function creator() external view returns (address);
    function policy() external view returns (address);
    function circleId() external view returns (uint256);
    function status() external view returns (CircleStatus);
    function termsHash() external view returns (bytes32);
    function inviteMember(address member) external;
    function acceptTerms(bytes32 termsHash_) external;
    function activate() external;
    function contribute(uint256 roundId, uint128 amount) external;
    function proposePayout(uint256 roundId) external returns (bytes32 proposalId);
    function executeAutomaticPayout(uint256 roundId) external;
    function executePayout(bytes32 proposalId) external;
    function expireProposal(bytes32 proposalId) external;
    function activateRoundRecovery(uint256 roundId) external;
    function cancelCircle(bytes32 reasonHash) external;
    function refundContribution(uint256 roundId) external;
    function pause() external;
    function unpause() external;
    function totalDeposited() external view returns (uint256);
    function totalEscrowed() external view returns (uint256);
    function totalPaid() external view returns (uint256);
    function totalRefunded() external view returns (uint256);
    function round(uint256 roundId) external view returns (Round memory);
    function proposal(bytes32 proposalId) external view returns (PayoutProposal memory);
}
```

`CircleVault` constructs and permanently binds its `CircleApprovalPolicy`, so
the factory has no post-deployment administration path. `CircleFactory` must
require `config.creator == msg.sender`, canonical nonzero USDC, unique members
and signers, bounded arrays, and valid majority thresholds before deployment.

## References

- [Safe smart-account concepts](https://docs.safe.global/advanced/smart-account-concepts)
- [Safe smart-account modules](https://docs.safe.global/advanced/smart-account-modules)
- [Safe supported networks](https://docs.safe.global/advanced/smart-account-supported-networks)
- [Safe deployment registry](https://github.com/safe-global/safe-deployments)

## Phase 1.6 governance addendum

This addendum is normative for the Phase 1.6 implementation and supersedes
the earlier proposal-level wording where it is more specific. It remains a
Testnet-only prototype specification; it does not authorize deployment or
financial activation.

### Fixed governance interface

`CircleApprovalPolicy` exposes the following policy-only pause lifecycle:

```solidity
enum ProposalStatus {
    Unknown, Pending, Approved, Executed, Expired, Invalidated, Stale, Ineligible
}

function proposePause(bool pause_) external returns (bytes32 proposalId);
function approvePause(bytes32 proposalId) external;
function executePause(bytes32 proposalId) external;
function invalidatePauseProposal(bytes32 proposalId) external;
function pauseApprovalCount(bytes32 proposalId) external view returns (uint16);
function isPauseApproved(bytes32 proposalId) external view returns (bool);
function pauseProposal(bytes32 proposalId) external view returns (GovernanceProposal memory);
function pauseProposalStatus(bytes32 proposalId) external view returns (ProposalStatus);
function payoutProposalStatus(bytes32 proposalId) external view returns (ProposalStatus);
```

`GovernanceProposal` contains `governanceNonce`, the exact `pause` action,
`expiresAt`, `createdAt`, `executed`, `cancelled`, `termsHash`,
`signerSetVersion`, `signerSetHash`, `threshold`, and `recoveryEpoch`.

The pause proposal identity is:

```solidity
keccak256(abi.encode(
    PAUSE_GOVERNANCE_TYPEHASH,
    block.chainid,
    address(circleVault),
    address(policy),
    circleId,
    pause,
    governanceNonce,
    signerSetVersion,
    recoveryEpoch,
    termsHash,
    expiresAt
))
```

The caller of `executePause` need not be a signer, but the proposal must have
the current configured quorum and every signer approval is unique. The creator
has no separate execution authority. The policy calls only the already-bound
vault's `pause()` or `unpause()` function; arbitrary targets, calldata,
delegatecall, ERC-20 transfers, and threshold changes are impossible through
this path.

### Pause and recovery state machine

- `Active -> Paused` requires a live quorum-approved `pause=true` proposal.
- `Paused -> Active` requires a fresh live quorum-approved `pause=false`
  proposal.
- Pause makes payout authorization effectively `Ineligible`; it does not
  invalidate a still-valid payout proposal.
- A valid unpause can restore that proposal to `Approved` if its expiry,
  signer-set snapshot, terms hash, round, and recovery epoch remain current.
- Recovery and individual contributor refunds remain permissionless while
  paused.
- Recovery increments `recoveryEpoch`, explicitly cancels the latest payout
  record, and makes all older payout and pause records effectively `Stale`
  without iterating historical storage.
- `payoutProposalStatus` and `pauseProposalStatus` are the authoritative
  consumer-facing effective-status views. Stored approval counts or a stored
  `cancelled` bit alone are never sufficient execution evidence.

### Provenance and canonical deployment

`CircleVault.factory` records the deploying factory. `CircleFactory.isCircle`
records every vault deployed by that factory. The supported client/indexer
trust boundary is the configured factory address plus `isCircle(circle)` and
the vault's canonical `usdc()` value. Standalone `CircleVault` construction
remains possible for isolated tests but is not an official circle source.

The Testnet deployment entrypoint is `DeployCircleFactory.s.sol`. It accepts
only canonical Arc USDC
`0x3600000000000000000000000000000000000000` and chain ID `5042002`, rejects
the Foundry default sender, and has no Mainnet deployment branch. No
deployment, broadcast, or frontend integration is part of Phase 1.6.

### Phase 1.6 acceptance tests

The implementation must cover unauthorized creator/outsider pause attempts,
quorum-approved pause and unpause, expiry and replay, old signer-set
approvals, recovery invalidation, paused recovery/refunds, payout preservation
across a temporary pause, arbitrary-authority rejection, factory provenance,
and an older payout becoming effectively `Stale` after recovery while the
latest stored proposal is `Invalidated`.
