# Vestros — Mainnet Readiness Report
*Prepared: October 29, 2026*

---

## Summary

The core USDC vesting product (Vestros) is in good shape for a limited mainnet launch. GrantHub's on-chain layer is also sound after this session's work. The backend off-chain layer (GrantHub server) has the right architecture but has not been operated in production — it needs hardening before it controls real-money contract operations.

**Recommendation: launch Vestros core vesting on Arc Mainnet. Hold GrantHub financial activation (award activation / vesting creation) behind an additional off-chain operations review before enabling it for real funds.**

---

## Blocking Risks

### Contracts (resolved this session)
| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | Direct-transfer fallback in `activateAward` — awards could bypass vesting | Critical | **Fixed** — fallback removed; reverts with `GrantVestingNotSet` |
| 2 | `renounceOwnership` not disabled — paused contract could be bricked permanently | High | **Fixed** — overridden to revert in both `GrantPool` and `GrantVesting` |
| 3 | `GrantVesting.pause()` unreachable through pool — no forwarding functions | High | **Fixed** — `pauseVesting()` / `unpauseVesting()` added to `GrantPool` |
| 4 | CREATE2 salt griefing — anyone could front-run a deterministic pool address | High | **Fixed** — salts namespaced by `keccak256(abi.encode(msg.sender, salt))` |
| 5 | Direct token transfers bypass accounting — stranded USDC unrecoverable | Medium | **Fixed** — `syncBalance()` added to `GrantPool` |
| 6 | `uint48` duration overflow — silent truncation on large day values | High | **Fixed** (prior session) — bounds-checked before cast |
| 7 | `usdc` mutable storage — should be immutable | High | **Fixed** (prior session) — `immutable` in both contracts |

### Backend / Off-chain (partially resolved)
| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 8 | `server/db.ts` schema completely broken — all routes imported non-existent exports | Critical | **Fixed** (prior session) |
| 9 | `applications.submitted_at NOT NULL` — drafts would fail to insert | High | **Fixed** — additive v3 migration; existing data preserved |
| 10 | No server-side validation that `tx_hash` is real before marking award `active` | Medium | **Open** — backend trusts the frontend to report activation; needs on-chain confirmation in production |
| 11 | No rate-limiting or auth replay protection on SIWE nonce endpoints | Medium | **Open** — acceptable for testnet; needed before mainnet traffic |
| 12 | SQLite file is single-writer; no horizontal scaling | Low | **Accepted** — fine for limited launch; document before growth |

---

## Confirmed Functionality

### Contracts (160/160 tests pass)
- `GrantPool`: deposit, createAward, activateAward (atomic vesting), cancelAward, withdraw, setTreasury, setGrantVesting, pauseVesting/unpauseVesting, syncBalance, revokeVestingSchedule
- `GrantVesting`: createSchedule, claim (beneficiary-only), revoke (owner → pool, then pool → orgWallet via revokeVestingSchedule), pause/unpause, getSchedule, getScheduleIds, vestedAmount, claimableAmount
- `GrantPoolFactory`: permissionless pool creation, caller-namespaced CREATE2 salts
- `USDCVesting` (original, deployed): unchanged; passes all original tests
- All invariants hold: `committedBalance + confirmedBalance == pool USDC balance` across 256 runs × 500 calls; `vestedAmount ≤ totalAmount`; `claimedAmount ≤ vestedAmount`

### Frontend / App
- Lint: 0 errors, 0 warnings
- TypeScript: 0 errors
- Production build: succeeds (Vite, 26.9s)
- Arc Dark design system intact; collapsible sidebar; three-part shell
- GrantHub UI: org creation, grant publishing, application submission, MyGrants with vesting status

### Cross-chain isolation
- Each `GrantPool` is a separate Ownable instance deployed by `GrantPoolFactory`
- Org A's pool cannot touch Org B's pool: ownership is by separate EOA/wallet
- `GrantVesting` is owned by its pool contract; only the pool can call `createSchedule` or `revoke`

---

## Deployment Order

### Step 1 — Testnet validation (Arc Testnet, chain ID 5042002)

For each organization:
```bash
# Set env
export PRIVATE_KEY=<org-wallet-private-key>
export RPC_URL=https://rpc.testnet.arc.io
export USDC=0x3600000000000000000000000000000000000000

# Deploy factory (once per ecosystem, not per org)
forge script contracts/script/DeployGrantHub.s.sol \
  --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY \
  --sig "run(address)" $USDC

# Deploy per-org pool + vesting + wire them together
forge script contracts/script/DeployGrantHub.s.sol:DeployOrgPool \
  --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY \
  --sig "run(address,address,address,bytes32)" \
  $USDC <FACTORY_ADDRESS> <TREASURY_ADDRESS> <SALT_HEX>
```

### Step 2 — Mainnet deploy (Arc Mainnet, chain ID 5042)

```bash
export RPC_URL=https://rpc.mainnet.arc.io
export USDC=0x3600000000000000000000000000000000000000
# Same commands as above with mainnet RPC_URL
```

> **WARNING: Mainnet deploys involve real funds. Arc Studio does not deploy to mainnet on your behalf. All commands above must be run from your own environment with your own key. Review every address, parameter, and deployment script independently before broadcasting.**

### Step 3 — Post-deploy configuration

After deployment, for each org pool:
1. Call `pool.setGrantVesting(vestingAddress)` from the org wallet (already done by `DeployOrgPool` script)
2. Record `poolAddress` and `vestingAddress` in the GrantHub backend database against the org record
3. Confirm `pool.grantVesting()` returns the expected address via the Contracts panel or `read_contract`

### Step 4 — Transfer to multisig (recommended)

```solidity
// Transfer pool ownership to a multisig (e.g. Gnosis Safe) after setup:
pool.transferOwnership(multiSigAddress);
// GrantVesting ownership is held by the pool — transferring pool ownership is sufficient
```

---

## Contract Addresses Requiring Configuration

| Contract | Testnet Address | Mainnet Address | Config Required |
|----------|----------------|-----------------|-----------------|
| `USDCVesting` (original) | `0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693` | Not deployed | None — already live |
| `GrantPoolFactory` | Not deployed | Not deployed | Deploy with `DeployGrantHub.s.sol` |
| `GrantPool` (per org) | Not deployed | Not deployed | Deploy via factory; set as GrantVesting owner |
| `GrantVesting` (per org) | Not deployed | Not deployed | Deploy with pool as `initialOwner`; wire via `setGrantVesting` |
| USDC | `0x3600...0000` (both nets) | Same address | Pass to constructors — never hardcoded in contracts |

---

## Approval Steps Before Mainnet

1. **Independent security review** — automated tests are not a substitute for a paid third-party audit. Budget for one before enabling GrantHub award activation with real funds.
2. **Multisig ownership** — transfer `GrantPool` ownership to a 2-of-3 or 3-of-5 multisig before any significant pool balance. Single-key ownership is unacceptable for production USDC custody.
3. **On-chain confirmation in backend** — item #10 above: the `PATCH /api/awards/:id/activate` endpoint must verify the `tx_hash` onchain before setting status to `active`, not trust the frontend report.
4. **Rate-limiting** — item #11: add per-IP and per-address rate limits to `/api/auth/*` before mainnet traffic.
5. **Ops runbook** — document `syncBalance`, `pauseVesting`, emergency revoke, and treasury withdrawal procedures for the org wallet operators.

---

## GrantHub vs Core Vesting Isolation

If GrantHub is not ready, the core Vestros vesting product (the existing deployed `USDCVesting` contract at `0x8eae...8693`) can launch independently. GrantHub uses separate contracts (`GrantPool`, `GrantVesting`) that do not call the deployed `USDCVesting` — there is no dependency. Disabling GrantHub in the frontend is a one-line route guard in `App.tsx`.

---

## Audit Provenance

| Subagent | Dispatched | Files audited | Corpus rules cited |
|---|---|---|---|
| solidity-auditor | yes | 9 | pause-without-viable-unpause |
| functional-auditor | yes | 2 | — |
