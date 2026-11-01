# GrantHub — Controlled Arc Testnet Rehearsal

This checklist is for an operator-controlled rehearsal only. It does not authorize deployment, USDC transfers, or enabling production financial writes. Keep both financial flags false until the preflight is complete.

## Current preflight status — 2026-10-30

This status was collected without broadcasting transactions or enabling financial endpoints.

- Arc Testnet RPC responded with chain ID `5042002` at block `69,842,330` during the check.
- Canonical Arc USDC is live at `0x3600000000000000000000000000000000000000`; `decimals()` returned `6`.
- Active `USDCVesting`: `0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693` — bytecode present; `owner()` returned `0x2eaec62dd422bdb6f1134a8b22503e62018a34f6`.
- Legacy `USDCVesting`: `0x74b9867dbba25cc05088e42229294ecfc69664d9` — bytecode present; owner differs from the active deployment and must not be used for the rehearsal.
- Verified first-organization GrantHub deployment: Factory `0x0d12537B482Ad44BA4e03DA2444a97B903AA997B`, GrantPool `0x5C94F126AdFB09286524008CD1d74A03D29Fd5aD`, and GrantVesting `0x4d3B037Cb34359b0d6478d97c24fAbf414600c64`.
- Deployment transactions: `0xd63239da52da3e01d4234973dae084c0ca03bf1000f2c049d7a2e22fb158b5f3`, `0xeb304a8be645fe5227491bb3e481f3213ae4eac5c4b84f8fab25e68f36ab3a24`, and `0x1c1ba167ee1043642c64bf882fa48c6e34b51e6dbb011378e87f2e632747fc49`; all receipts succeeded.
- GrantPool owner is still the deployer, GrantVesting owner is GrantPool, and no USDC has been deposited. The financial rehearsal remains **NO-GO** until ownership transfer, flag authorization, and operator approval are complete.
- The documented active vesting deployment transaction is recorded in the repository, but the configured RPC returned `null` for its historical transaction and receipt lookup. Reconfirm that transaction in the Arc explorer before using it as operator evidence.

### Current conclusion

- **Core Vestros:** conditional GO for non-financial testnet inspection; the active address and owner were confirmed by RPC. Live create/claim/revoke actions still require explicit wallet authorization.
- **GrantHub financial path:** NO-GO for funding and activation. Contracts are deployed and verified, but ownership transfer, funding, and the controlled rehearsal remain pending; both financial flags remain disabled.

## Preflight

- [ ] Use `VITE_CHAIN_ENV=testnet` and confirm chain ID `5042002`.
- [ ] Confirm the canonical Arc Testnet ERC-20 USDC address is `0x3600000000000000000000000000000000000000`.
- [x] Deploy and identify the approved Testnet `GrantPool` and `GrantVesting` addresses; do not use a mainnet address.
- [x] Confirm the pool's `usdc()` and the vesting contract's `usdc()` both return the canonical testnet USDC address.
- [x] Confirm the pool's `grantVesting()` is the intended vesting contract and `GrantVesting.owner()` is the pool.
- [ ] Transfer GrantPool ownership to the approved organization owner and verify `pool.owner()` onchain.
- [ ] Create a GrantHub grant with the exact pool address and `pool_chain_id=5042002`. Do not reuse this configuration in a mainnet grant.
- [ ] Verify the server environment still has `GRANTHUB_FINANCIAL_ENABLED=false` until the test operator is ready for the rehearsal.

## Authorization and wallet-signature checklist

Use three isolated test wallets and record only public addresses in the operator log. Never paste private keys into the repository, browser, server logs, or chat.

- [ ] **Owner wallet:** confirm it is the approved testnet owner for the contract under test. `USDCVesting.owner()` is currently the address above; a GrantPool owner cannot be assumed until the pool is deployed.
- [ ] **Applicant/beneficiary wallet:** use a different address from the owner and sponsor. This wallet signs authentication and later claims eligible vesting.
- [ ] **Sponsor wallet:** use a third address. This wallet authorizes USDC allowance and the `GrantPool.deposit` transaction only after explicit rehearsal approval.
- [ ] Organization creation, grant publication, application submission, review, and approval require wallet authentication signatures but no USDC transfer.
- [ ] Core schedule creation requires the vesting owner to authorize USDC allowance and `createSchedule`; claiming requires the beneficiary signature; revocation requires the vesting owner signature.
- [ ] GrantPool award creation and activation require the configured pool owner. GrantVesting schedule creation is performed atomically by the pool during activation.
- [ ] Enabling `GRANTHUB_FINANCIAL_ENABLED=true` and `VITE_GRANTHUB_FINANCIAL=true` requires explicit operator authorization, a temporary isolated server/frontend environment, and a restart. Restore both values to `false` immediately after the rehearsal.
- [ ] Do not authorize any action if the chain, token, pool, vesting contract, recipient, amount, or event data differs from the rehearsal record.

## Off-chain workflow

- [ ] Connect wallet and sign in to GrantHub.
- [ ] Create an organization and confirm the creator is the admin.
- [ ] Create a draft grant, verify its fields, then publish it and confirm it appears in the public explorer.
- [ ] Submit an application as a separate beneficiary wallet.
- [ ] Review the application as an organization reviewer/admin and approve it.
- [ ] Create an award and confirm it is `pending`, with exact raw USDC amount and vesting parameters.

## Deposit verification checks

When the operator authorizes the test, enable the server flag for the rehearsal only and restart the server. The client should submit the transaction hash; the server must derive the amount, sender, and block from RPC.

- [ ] Submit a real testnet `GrantPool.deposit` transaction from the sponsor wallet.
- [ ] Record the transaction using the configured grant. Confirm the backend verifies RPC chain ID, transaction sender, transaction target, receipt success, canonical USDC, pool `usdc()`, matching USDC `Transfer`, and `GrantPool.Deposited` events.
- [ ] Confirm the stored deposit is `confirmed=1` and `verified=1`, and that the grant's confirmed funding total increases by the event amount.
- [ ] Submit the same transaction hash again. Confirm the response is idempotent and the funding total does not increase.
- [ ] Submit the same hash against a different grant or with a different sponsor. Confirm it is rejected.
- [ ] Try altered amount/block metadata. Confirm it is rejected or ignored and never changes the stored amount.
- [ ] Try a receipt from the wrong chain, wrong token, wrong pool, wrong sender, or without matching events. Confirm it is rejected.

## Award activation and claim checks

- [ ] Create the matching onchain award on the configured pool and note its award index.
- [ ] Call `activateAward` from the pool owner and wait for a mined successful transaction.
- [ ] Submit only the transaction hash and onchain award index to the backend. Confirm it verifies `AwardActivated`, `ScheduleCreated`, the pool-to-GrantVesting USDC transfer, and both contracts' USDC addresses.
- [ ] Confirm the database changes the award to `active` only after verification and stores the verified schedule ID, chain, transaction hash, block, and onchain vesting start time.
- [ ] Wait the operator-defined testnet confirmation depth before treating the verified row as operationally final; record the policy because the current API does not implement reorg/finality tracking.
- [ ] Retry the same activation transaction. Confirm it cannot activate a second award or increment any balance.
- [ ] As the beneficiary, wait for the cliff and claim on testnet. Confirm the beneficiary receives only the schedule's claimable amount and the database remains an onchain reference, not the source of truth.

## Abort conditions

Stop immediately if any receipt is pending/reverted, any token/pool/chain differs, any event amount differs from the database award, any duplicate hash changes a total, or any database status changes before verification. Reset the server financial flag to `false` and preserve the database for investigation; do not delete or reset it.

## Exit evidence

- [ ] Save transaction hashes, block numbers, contract addresses, RPC chain IDs, API responses, and database row snapshots in a private operator log.
- [ ] Run the repository Solidity tests, server tests, TypeScript check, lint, and production build after the rehearsal code/config changes.
- [ ] Keep the testnet and mainnet environment files, pool addresses, vesting addresses, and deployment transactions separate.
