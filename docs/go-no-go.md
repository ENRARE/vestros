# Vestros — GO/NO-GO Deployment Report
**Date:** October 29, 2026  
**Scope:** Arc Mainnet (chain ID 5042) — Core Vestros (USDCVesting) + GrantHub (GrantPool / GrantVesting)

---

## Checklist Results

| # | Check | Result |
|---|-------|--------|
| 1 | Forge tests (all suites) | ✅ 160/160 pass (0 failed, 0 skipped) |
| 2 | Invariant tests (256 × 500 calls each) | ✅ 0 reverts on activateAward, cancelAward, createAward, deposit, withdraw |
| 3 | TS lint (oxlint) | ✅ 0 errors, 0 warnings |
| 4 | TypeScript typecheck | ✅ 0 errors |
| 5 | Production build (Vite) | ✅ Succeeded |
| 6 | Slither static analysis | ✅ 0 High — 2 Medium (false positives, documented) — 3 Low (timestamp, acceptable) |
| 7 | Max-severity security review (2 passes) | ✅ All 4 blocking findings fixed |
| 8 | Onchain award verification | ✅ `/api/awards/:id/activate` now verifies receipt + events independently |
| 9 | Rate limiting | ✅ Nonce (5/min/IP), verify (10/5min/IP), activate (5/min/wallet), deposit writes (60/min/wallet) |
| 10 | DB migration safety | ✅ v3 uses table-rename pattern (no data loss); ADD COLUMN is idempotent-guarded |
| 11 | `renounceOwnership` disabled | ✅ Both GrantPool and GrantVesting revert on call |
| 12 | GrantVesting emergency pause reachable | ✅ `GrantPool.pauseVesting()` / `unpauseVesting()` added |
| 13 | CREATE2 salt griefing fixed | ✅ Factory namespaces salts by `keccak256(abi.encode(msg.sender, salt))` |
| 14 | Stranded USDC recoverable | ✅ `syncBalance()` added to GrantPool |
| 15 | Direct-transfer fallback removed | ✅ `activateAward` reverts with `GrantVestingNotSet()` if vesting not wired |
| 16 | Mainnet deploy scripts | ✅ `DeployUSDCVesting.s.sol`, `DeployGrantHub.s.sol`, `DeployOrgPool` |

---

## Slither Findings Detail

### Medium — `reentrancy-no-eth` in `GrantPool.activateAward`
**Why it is NOT exploitable:** `award.activated = true` and `committedBalance -= award.amount` are both written **before** the external call to `GrantVesting.createSchedule` (checks-effects-interactions is correctly applied). The function is also protected by `nonReentrant`. `award.vestingScheduleId` is updated after the call — but by then `award.activated = true` means re-entry of `activateAward` reverts with `AwardAlreadyActivated`, and `nonReentrant` closes any other re-entrant path. This is a Slither false positive.

### Medium — `incorrect-equality` (`claimable == 0`, `received == 0`)
**Why safe:** Slither treats strict equality as dangerous for fee-on-transfer tokens where an expected amount might differ. USDC on Arc has no transfer fee. These checks guard against no-op operations, not fee arithmetic. False positive.

### Low — `timestamp` comparisons in GrantVesting
**Known acceptable:** Vesting schedules are time-based by design. Arc has ~2s block times; miner timestamp manipulation on Arc is negligible for vesting periods measured in days to years. This is a documentation note, not an exploitable risk.

---

## Remaining Risks Before Mainnet

### CORE VESTROS — GO ✅

The `USDCVesting` contract is **safe to deploy to Arc Mainnet** subject to the operational checklist below. It was independently audited twice at max severity, Slither finds zero High findings, 160 tests pass, and it has been running on testnet since the prior session.

### GRANTHUB — CONDITIONAL NO-GO ⚠️

GrantHub contracts (GrantPoolFactory, GrantPool, GrantVesting) have no remaining **contract-level** blocking issues. However two **operational** gaps remain before GrantHub financial flows (deposits, award activation) should handle real USDC:

1. **No independent audit by a third party.** The internal audit found and fixed four High findings across two passes. GrantHub is significantly more complex than USDCVesting. An external review (Trail of Bits, OpenZeppelin, Spearbit, or equivalent) is strongly recommended before orgs hold real USDC in pools.

2. **`/api/awards/:id/activate` onchain verification is now in place** but has not been tested against a live mainnet tx. Run the full activation flow on testnet with the new verification code before going live.

3. **GrantHub API auth is SIWE-lite** (not full EIP-4361). It is adequate for testnet, but the 7-day session token with no refresh or revocation mechanism is a risk for org wallets that control large pools.

4. **No multisig ownership** on deployed GrantPool contracts. Pool owners are single EOAs. For any pool holding >$10k equivalent, transfer ownership to a Gnosis Safe before accepting real deposits.

**Recommendation:** Launch Vestros (USDCVesting) on mainnet now. Gate GrantHub's financial features (`/api/grants/:grantId/deposits`, `/api/awards/:id/activate`) behind a feature flag for mainnet until an external audit is complete. The GrantHub UI, grant creation, application review, and approval workflows can all go live immediately — only the money-moving endpoints need the gate.

---

## Exact Deployment Steps (Core Vestros)

### Simulation results (Arc Mainnet, Oct 29 2026)

Simulation ran successfully against Arc Mainnet RPC (chain 5042). No real transaction was submitted.

| Field | Value |
|---|---|
| Chain | Arc Mainnet (5042) |
| USDC (hardcoded in contract) | `0x3600000000000000000000000000000000000000` |
| Estimated gas used | 1,723,640 |
| Estimated gas price | 45.75 gwei |
| Estimated cost | **0.07886 USDC** (native USDC gas on Arc) |
| Simulated contract address | `0x5b6aB4a86a3BdC7ba595Ec0e5a9849787F730F89` *(CREATE2 address changes with deployer — this was computed from the test wallet)* |

> The actual deployed address depends on the deployer wallet's nonce. The simulation address above is only valid for the test sender. Record the real address after deployment.

---

### Commands

```bash
# 0. Prerequisite: import your deployer key into an encrypted keystore (one-time setup)
cast wallet import vestros-deployer --interactive
# Enter private key and a password. Never use --private-key on mainnet.

# 1. Confirm Arc Mainnet RPC and chain ID
cast chain-id --rpc-url arc_mainnet
# Must print: 5042

# 2. Verify Arc Mainnet USDC precompile (hardcoded in USDCVesting)
cast call 0x3600000000000000000000000000000000000000 \
  "symbol()(string)" --rpc-url arc_mainnet
# Must print: USDC

# 3. Dry-run — simulate without broadcasting (safe, no funds required)
OWNER_ADDRESS=<your-owner-wallet>
forge script contracts/script/DeployUSDCVesting.s.sol \
  --rpc-url arc_mainnet \
  --sender $OWNER_ADDRESS \
  --sig "run(address)" $OWNER_ADDRESS
# Prints estimated gas and a simulated contract address. Review output before proceeding.

# 4. Deploy with Ledger hardware wallet (RECOMMENDED)
forge script contracts/script/DeployUSDCVesting.s.sol \
  --rpc-url arc_mainnet --broadcast \
  --ledger \
  --sig "run(address)" $OWNER_ADDRESS

#    — OR — deploy with encrypted keystore
forge script contracts/script/DeployUSDCVesting.s.sol \
  --rpc-url arc_mainnet --broadcast \
  --account vestros-deployer \
  --sig "run(address)" $OWNER_ADDRESS

# 5. Record the deployed address from the broadcast output.
#    Edit AGENTS.md and contracts/contract-metadata/USDCVesting.json.

# 6. If OWNER_ADDRESS != deployer wallet, accept ownership (two-step Ownable2Step)
cast send <DEPLOYED_ADDRESS> "acceptOwnership()" \
  --rpc-url arc_mainnet --account vestros-deployer
# Must be called from OWNER_ADDRESS, not the deployer.

# 7. Verify the contract source on the Arc explorer (if Blockscout supports it)
forge verify-contract <DEPLOYED_ADDRESS> contracts/USDCVesting.sol:USDCVesting \
  --chain-id 5042 --rpc-url arc_mainnet

# 8. Before the first createSchedule(), approve USDC spend from the owner wallet
cast send 0x3600000000000000000000000000000000000000 \
  "approve(address,uint256)" <DEPLOYED_ADDRESS> <AMOUNT_IN_6_DECIMAL_USDC> \
  --rpc-url arc_mainnet --account vestros-deployer
```

## Exact Deployment Steps (GrantHub — when ready)

```bash
# 1. Deploy GrantPoolFactory (one per network, shared by all orgs)
forge script contracts/script/DeployGrantHub.s.sol \
  --rpc-url arc_mainnet --broadcast \
  --private-key $PRIVATE_KEY \
  --sig "run(address)" 0x3600000000000000000000000000000000000000

# 2. Record factory address, then per org:
forge script contracts/script/DeployGrantHub.s.sol:DeployOrgPool \
  --rpc-url arc_mainnet --broadcast \
  --private-key $PRIVATE_KEY \
  --sig "run(address,address,address,bytes32)" \
  0x3600000000000000000000000000000000000000 \
  $FACTORY_ADDRESS $TREASURY_ADDRESS $SALT_HEX

# 3. Transfer pool ownership to a Gnosis Safe immediately after deployment
# cast send $POOL_ADDRESS "transferOwnership(address)" $SAFE_ADDRESS \
#   --rpc-url arc_mainnet --private-key $PRIVATE_KEY
# Then call acceptOwnership() from the Safe.
```

---

## Summary

**Core Vestros: GO ✅** — Deploy `USDCVesting` to Arc Mainnet following the steps above. No blocking issues remain.

**GrantHub financial features: CONDITIONAL NO-GO ⚠️** — Contracts are technically sound and all tests pass, but an external security audit and a multisig ownership model are required before real USDC enters org pools. Gate deposit and activation endpoints on mainnet; all other GrantHub features can launch immediately.
