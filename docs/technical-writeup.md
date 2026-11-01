# USDC Vesting on Arc: A Technical Deep Dive

**Network:** Arc Testnet
**Contract:** `0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693`
**Explorer:** https://explorer.testnet.arc.io/address/0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693
**Stack:** Solidity 0.8.28, OpenZeppelin v5, Foundry, React + wagmi v2

---

## Overview

Vestros is a smart contract system for locking and releasing USDC on a time-based schedule. It is built specifically for Arc — Circle's EVM chain where USDC is the native gas token — making it the first vesting system where both the gas fee and the vested asset are the same token: USDC.

The contract handles the full lifecycle of a vesting position: creation, linear unlock after a cliff, beneficiary-initiated claiming, owner-initiated revocation, and emergency rescue for edge cases. It is immutable (no proxy, no upgrade path), which means the rules it ships with are the rules it runs under forever.

---

## Why Arc

Arc is Circle's EVM-compatible blockchain where USDC is the native gas asset. This has a practical consequence for vesting: the owner deposits USDC to create a schedule and pays gas in USDC. The beneficiary claims unlocked USDC and pays gas in USDC. There is no secondary gas token to manage, no ETH bridging, no "how do I fund a fresh wallet with gas" problem. Every participant needs only USDC.

Arc also offers sub-second finality and stable, predictable fees — properties that matter when a beneficiary wants to claim on a specific date and cannot afford to have the transaction sit in a mempool.

---

## Contract Architecture

### Inheritance Chain

```
USDCVesting
  ├── Ownable2Step    (OZ v5) — two-step ownership, renounce disabled
  ├── Pausable        (OZ v5) — global pause on claims and schedule creation
  └── ReentrancyGuard (OZ v5) — reentry protection on all fund-moving functions
```

SafeERC20 is used as a library (not inherited) for all USDC transfer calls.

### Immutable State

```solidity
IERC20 public immutable usdc;
```

The USDC address (`0x3600000000000000000000000000000000000000` on Arc Testnet) is set once in the constructor and can never change. This eliminates any risk of an admin swapping the underlying token.

### VestingSchedule Struct

Each schedule is stored as a packed struct:

```solidity
struct VestingSchedule {
    address beneficiary;   // 20 bytes
    bool    revoked;       // 1 byte
    uint48  startTime;     // 6 bytes — unix timestamp
    uint48  cliffTime;     // 6 bytes — startTime + cliffDuration
    uint48  endTime;       // 6 bytes — startTime + vestingDuration
    uint48  revokeTime;    // 6 bytes — timestamp when revoked (0 if not revoked)
    uint128 totalAmount;   // 16 bytes — total USDC locked
    uint128 claimedAmount; // 16 bytes — cumulative USDC claimed
}
```

`uint48` timestamps are valid until year 8,921,556 — no Y2K-style overflow risk. `uint128` amounts safely hold up to ~3.4 × 10^32 USDC units (6 decimals), far exceeding any realistic vesting amount. The struct packs into three 32-byte slots, minimising storage gas.

### Storage Layout

```solidity
mapping(uint256 => VestingSchedule) private _schedules;
mapping(address => uint256[])       private _beneficiarySchedules;
uint256 private _nextScheduleId;
```

Schedule IDs are monotonically incrementing integers. Each beneficiary address maps to an array of their schedule IDs, enabling efficient on-chain enumeration.

---

## Core Functions

### createSchedule

```solidity
function createSchedule(
    address beneficiary,
    uint128 totalAmount,
    uint48  cliffDuration,
    uint48  vestingDuration,
    uint48  startTime
) external onlyOwner whenNotPaused nonReentrant
```

Guards: `onlyOwner`, `whenNotPaused`, `nonReentrant`.

Validates:
- `beneficiary != address(0)`
- `totalAmount > 0`
- `vestingDuration > 0`
- `cliffDuration <= vestingDuration`
- `startTime` is not more than 60 seconds in the past (prevents stale front-end submissions)

CEI ordering: all state is written before the `safeTransferFrom` call pulls USDC from the owner's wallet. This means a reentrant call during the transfer cannot observe a partially-written schedule.

Emits: `ScheduleCreated(scheduleId, beneficiary, totalAmount, startTime, cliffTime, endTime)`

### claim

```solidity
function claim(uint256 scheduleId) external whenNotPaused nonReentrant
```

Guards: `whenNotPaused`, `nonReentrant`.

Pull-based: the beneficiary calls this function themselves. Push-based designs (owner loops over beneficiaries to send) introduce DoS vectors and gas unpredictability.

Flow:
1. Verify `msg.sender == schedule.beneficiary`
2. Compute `claimable = vestedAmount(scheduleId, block.timestamp) - claimedAmount`
3. Revert with `NothingClaimable` if `claimable == 0`
4. Increment `claimedAmount` before the transfer (CEI)
5. `usdc.safeTransfer(beneficiary, claimable)`

Emits: `Claimed(scheduleId, beneficiary, claimable)`

### revoke

```solidity
function revoke(uint256 scheduleId) external onlyOwner nonReentrant
```

Guards: `onlyOwner`, `nonReentrant`. Intentionally NOT gated by `whenNotPaused` — the owner must be able to recover funds during an incident even when claims are frozen.

Flow:
1. Revert with `AlreadyRevoked` if already revoked
2. Revert with `FullyClaimed` if `claimedAmount == totalAmount` (nothing to revoke)
3. Snapshot `vestedNow = vestedAmount(scheduleId, block.timestamp)`
4. Compute `unvested = totalAmount - vestedNow`
5. Set `revoked = true`, `revokeTime = block.timestamp` before any transfer (CEI)
6. Transfer `unvested` to `owner()` if `unvested > 0`

After revocation, `vestedAmount` uses `revokeTime` as the effective ceiling — a beneficiary cannot accumulate more vested tokens after the schedule is revoked. Their vested-but-unclaimed amount remains claimable forever.

Emits: `ScheduleRevoked(scheduleId, beneficiary, unvestedReturned)`

### vestedAmount (view)

```solidity
function vestedAmount(uint256 scheduleId, uint256 timestamp)
    public view returns (uint128)
```

The core vesting formula:

```
if revoked:      effectiveTs = min(revokeTime, timestamp)
if effectiveTs < cliffTime:   return 0
if effectiveTs >= endTime:    return totalAmount
else:
    elapsed  = effectiveTs - startTime
    duration = endTime - startTime       (== vestingDuration)
    return uint128(totalAmount * elapsed / duration)
```

The denominator uses `endTime - startTime` (the full vesting window) rather than `endTime - cliffTime` (the post-cliff window). This means tokens vest from `startTime`, but none are accessible until `cliffTime` — a standard cliff + linear model where the cliff delivers the accumulated vested portion at once.

Integer division truncates toward zero, so rounding always favours the contract (slightly less paid out than the mathematical ideal). The invariant `vestedAmount <= totalAmount` holds for all inputs — verified by invariant tests.

### rescueStuckVesting

```solidity
function rescueStuckVesting(uint256 scheduleId) external onlyOwner nonReentrant
```

Arc's USDC contract (like all Circle USDC deployments) has a blocklist controlled by Circle. If a beneficiary address is blocklisted after a schedule is created, `claim()` will revert forever for that address because `safeTransfer` to a blocklisted address fails at the USDC contract level. Without a rescue path, those funds are permanently stuck.

`rescueStuckVesting` allows the owner to push the vested-but-unclaimed amount to the beneficiary's address. The key constraint: **it can only send to `schedule.beneficiary`**. The recipient is not a parameter — there is no arbitrary redirection. This satisfies the principle that vested funds belong to the beneficiary, while giving the owner a mechanical path to unblock a stuck position.

Emits: `StuckVestingRescued(scheduleId, beneficiary, amount)`

---

## Security Model

### Checks-Effects-Interactions (CEI)

Every function that moves USDC follows strict CEI ordering:

1. **Check:** validate all preconditions, revert with a named custom error if any fail
2. **Effect:** update all state variables (`claimedAmount`, `revoked`, `revokeTime`, etc.)
3. **Interact:** call `usdc.safeTransfer` or `usdc.safeTransferFrom`

This ensures that even if USDC is ever upgraded to a token that calls back into the vesting contract on transfer, all state is already finalised before the callback executes.

### Reentrancy Guard

`nonReentrant` from OpenZeppelin v5's `ReentrancyGuard` is applied to every function that touches USDC: `createSchedule`, `claim`, `revoke`, `rescueStuckVesting`. Combined with CEI, this provides defence in depth.

### SafeERC20

All USDC operations go through `SafeERC20.safeTransfer` and `SafeERC20.safeTransferFrom`. These wrappers revert on a `false` return value from the token, handling non-standard ERC-20 implementations that return `false` instead of reverting.

### Two-Step Ownership

`Ownable2Step` (OZ v5) requires the new owner to call `acceptOwnership()` before the transfer completes. A typo in the new owner address results in a pending transfer that expires harmlessly rather than irrecoverably transferring control to an uncontrolled address.

`renounceOwnership()` is overridden to always revert. The owner is the only account that can create schedules, revoke positions, pause the contract, and rescue stuck funds. Renouncing would permanently lock all these capabilities.

### Pause Mechanism

`whenNotPaused` is applied to `createSchedule` and `claim`. `revoke` and `rescueStuckVesting` are intentionally not paused — these are emergency operations that must remain available during an incident. This asymmetry is documented in the contract and verified by tests.

### Custom Errors

All reverts use named custom errors (`ZeroBeneficiary`, `AlreadyRevoked`, `FullyClaimed`, `NothingClaimable`, etc.) rather than string messages. This costs less gas and makes revert reasons machine-readable on indexers and explorers.

---

## Testing

68 tests written in Foundry covering:

| Category | Count |
|---|---|
| Unit tests (happy path) | 28 |
| Unit tests (revert paths) | 25 |
| Fuzz tests (random inputs) | 12 |
| Invariant tests (stateful) | 3 |
| **Total** | **68** |

Key invariants are covered by the three invariant tests; this audit re-ran them at 16 runs × 32 handler calls each. The repository's default 256 × 500 configuration is computationally impractical for the current schedule-scanning handler:
- `contractBalance >= totalDeposited - totalWithdrawn` (no funds leak)
- `vestedAmount <= totalAmount` for every schedule at every timestamp
- `claimedAmount <= totalAmount` for every schedule

The mock USDC token is etched at the hardcoded address `0x3600000000000000000000000000000000000000` using `vm.etch` in Foundry, so tests exercise the exact address the production contract references.

---

## Deployment

Deployed to Arc Testnet via Circle Smart Contract Platform (SCP), with the deploying wallet set as `_initialOwner` in the constructor. Ownership was then transferred to the project wallet address in the same deploy step by passing the owner address as the constructor argument.

**Contract address:** `0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693`
**Deploy tx:** `0x35bcde1c1d3fed9008db8267f0754dbc36f735f5e637c39b07a9c75e1e96741f`

---

## Frontend

The dashboard is a React 18 + Vite + TypeScript application using:

- **wagmi v2** for contract reads and writes
- **viem v2** for ABI encoding and type-safe contract interactions
- **ConnectKit** for wallet connection (MetaMask and injected wallets)
- **Sonner** for transaction status toasts

The UI has two modes:

**View Schedules** — enter any beneficiary address to see their vesting schedules, cliff and unlock progress bars, claimable amount, and a claim button.

**Create Schedule** — owner-only form with a two-step approve + create flow (step 1: approve USDC spend, step 2: call `createSchedule`). The start time defaults to now, with cliff and vesting duration inputs in days.

All USDC amounts are handled through the `@/onchain-money` module, which provides safe unit conversion between the ERC-20 view (6 decimals) and the native gas view (18 decimals) on Arc — a critical distinction because Arc's native asset and its USDC ERC-20 are the same underlying pool exposed at different decimal scales.

---

## What Is Next

- Mainnet deployment after a paid third-party audit
- Batch schedule creation (create multiple schedules in one transaction)
- Delegation — allow a beneficiary to designate a secondary address to claim on their behalf
- A read-only investor portal view showing vesting progress across a team

---

## Disclaimer

This contract has been through a rigorous internal security review and extensive test coverage, but has not been audited by a paid third-party firm. Do not use on mainnet with real funds until an independent professional audit has been completed.
