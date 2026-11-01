# Vestros — Mainnet Readiness

*Updated: October 30, 2026*

## Current recommendation

The core `USDCVesting` application is conditionally ready for a controlled Arc Mainnet deployment. GrantHub financial operations remain a conditional no-go: the server returns `503` for deposit, deposit-confirmation, and award-activation writes unless `GRANTHUB_FINANCIAL_ENABLED=true`, and the UI shows the disabled-state banner while the frontend flag is false.

No contract has been deployed and no financial transaction has been submitted during this audit.

## Verified architecture

- React/Vite frontend with wagmi, viem, ConnectKit, React Router, and the existing left-sidebar shell.
- Bun HTTP API with wallet-signature sessions, SQLite/WAL persistence, organizations, grants, applications, reviews, awards, deposits, and audit logging.
- `USDCVesting` for the existing owner-controlled vesting product.
- `GrantPoolFactory` → per-organization `GrantPool` + `GrantVesting` for the GrantHub financial path. `GrantPool.activateAward` atomically creates a schedule through a `GrantVesting` owned by that pool; it reverts when the vesting contract is not wired.
- Each grant is bound to an explicit pool address and Arc chain. Deposit verification independently checks RPC chain ID, transaction sender/target, receipt status, canonical USDC, the pool's immutable `usdc()`, matching ERC-20 `Transfer`, and `GrantPool.Deposited` events before counting the deposit.
- The activation endpoint independently checks the receipt, target pool, `AwardActivated`, the pool's configured `grantVesting()`, GrantVesting ownership, `ScheduleCreated`, the pool-to-GrantVesting funding transfer, GrantVesting's USDC address, beneficiary, amount, schedule ID, and vesting duration fields before setting an award active.

## Local verification

- `forge build`: passed. Foundry emitted only existing timestamp/checked-cast warnings.
- The complete Solidity source contains 160 test functions: 157 tests (including the three GrantPool invariants) pass with the default Forge run excluding only the USDCVesting invariant contract, and the three USDCVesting invariants pass at `FOUNDRY_INVARIANT_RUNS=16 FOUNDRY_INVARIANT_DEPTH=32`. The historical 160-test count is therefore accurate as a test count, but a default 256 × 500 run of the USDCVesting invariants is computationally impractical for the current handler because each invariant scans the growing schedule list.
- `npm run typecheck`: passed.
- `npm exec -- oxlint --type-aware src scripts`: passed with no diagnostics.
- `npm run test:server`: passed, `18/18` tests, including deposit and activation receipt-verification regressions.
- `npm run build`: passed. Vite emitted third-party chunk-size/annotation warnings only.

## Chain and token configuration

| Network | Chain ID | ERC-20 USDC | ERC-20 decimals | Explorer |
|---|---:|---|---:|---|
| Arc Testnet | 5042002 | `0x3600000000000000000000000000000000000000` | 6 | https://explorer.testnet.arc.io |
| Arc Mainnet | 5042 | `0x3600000000000000000000000000000000000000` | 6 | https://explorer.arc.io |

Arc native USDC gas uses 18 decimals; the ERC-20 interface uses 6. The frontend selects one active network with `VITE_CHAIN_ENV`, selects separate vesting addresses and deployment transaction variables, and refuses writes when the selected network has no configured `USDCVesting` address.
The Bun server reads the same `VITE_CHAIN_ENV` and rejects GrantPool configurations for the other Arc network; a mainnet server therefore cannot accept a testnet pool address.

The active testnet `USDCVesting` address is `0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693`. There is no mainnet address yet. GrantPool/GrantVesting addresses are also not deployed.

## Deployment signing rules

`DeployGrantHub.s.sol` and `DeployOrgPool` accept:

- testnet raw `PRIVATE_KEY` signing for disposable testnet funds;
- Ledger signing with `--ledger`;
- encrypted keystore signing with `--account <name>`.

On chain ID 5042 the scripts reject `PRIVATE_KEY` and require an external signer. A dry run should use `--sender`; broadcasting is intentionally an operator action outside this repository audit.

## Outstanding risks and required gates

1. GrantHub needs an independent third-party contract/security review before accepting meaningful funds.
2. Run the controlled testnet deposit → pool award → `GrantVesting` activation rehearsal against the exact deployed addresses. The verifier is regression-tested with mocked RPC responses but has not been exercised against a live activation in this audit.
3. GrantHub sessions are SIWE-lite with seven-day bearer tokens. Add production token revocation/rotation and shared rate limiting before multi-instance hosting.
4. Transfer each production pool to a multisig before accepting material balances. `GrantVesting` remains owned by the pool.
5. Keep `.granthub.db`, its WAL/SHM sidecars, `contracts/out`, `contracts/cache`, and broadcast outputs out of Git. Existing tracked runtime/generated artifacts were removed from the index without deleting local files.

The v4 SQLite migration preserves existing deposit rows, but pre-v4 rows default to `verified=0` and are excluded from funding totals until they are independently reverified. Reconcile any legacy deposits before enabling financial writes.

Receipt confirmation depth/reorg handling is not implemented; live rehearsal and production operations must wait for an operator-defined finality policy and later reconciliation.

See [the controlled testnet rehearsal checklist](granthub-testnet-rehearsal.md) before enabling either financial flag.

See `.env.example` for the separated testnet/mainnet variables and [README.md](../README.md) for the local commands.
