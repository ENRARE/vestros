# GrantHub Arc Testnet Deployment Preparation

This document is an operator runbook. It does not authorize deployment, USDC transfers, or enabling financial endpoints.

## Current state

- Network: Arc Testnet, chain ID `5042002`.
- Canonical ERC-20 USDC: `0x3600000000000000000000000000000000000000` with 6 decimals.
- Existing core USDCVesting: `0x8eae0cf6a7f8f8b6961315006c05ded1da8d8693`.
- GrantPoolFactory: `0x0d12537B482Ad44BA4e03DA2444a97B903AA997B` (verified onchain).
- GrantPoolFactory deployment tx: `0xa0c6d7401e01f263aa10dd51a92ce7ef0af0df561df263deadc34150a36e6e1e`, block `69850736`, receipt status `1`.
- First organization: `arc-ecosystem-test-0b83a9`.
- Organization owner/admin: `0x0B83a98a46310C47Ac6c87C67904b98D6febd392`.
- Treasury: `0xFD6EC7a1d8839BD56e8Ab19af80912ff0682cec4`.
- GrantPool: `0x5C94F126AdFB09286524008CD1d74A03D29Fd5aD`.
- GrantVesting: `0x4d3B037Cb34359b0d6478d97c24fAbf414600c64`.
- Deployment txs: `0xd63239da52da3e01d4234973dae084c0ca03bf1000f2c049d7a2e22fb158b5f3`, `0xeb304a8be645fe5227491bb3e481f3213ae4eac5c4b84f8fab25e68f36ab3a24`, `0x1c1ba167ee1043642c64bf882fa48c6e34b51e6dbb011378e87f2e632747fc49`.
- Deployment blocks: `69862219`, `69862223`, `69862228`; all receipts succeeded.
- Total deployment gas paid: `0.06375088125` native USDC.
- GrantPool explorer: https://explorer.testnet.arc.io/address/0x5C94F126AdFB09286524008CD1d74A03D29Fd5aD
- GrantVesting explorer: https://explorer.testnet.arc.io/address/0x4d3B037Cb34359b0d6478d97c24fAbf414600c64
- `GRANTHUB_FINANCIAL_ENABLED` and `VITE_GRANTHUB_FINANCIAL` remain `false`.

## Deployment order

1. Deploy `GrantPoolFactory` once on Arc Testnet. **Complete:** `0x0d12537B482Ad44BA4e03DA2444a97B903AA997B`.
2. Record and explorer-verify the factory address. **Complete:** exact runtime bytecode match, 7,236 bytes.
3. For the first Testnet organization, deploy the `GrantPool` through the factory using the approved salt, treasury, and deployer as initial owner. **Complete and verified.**
4. Deploy `GrantVesting` with the deployed pool as `initialOwner`. **Complete and verified.**
5. Call `GrantPool.setGrantVesting(vesting)` while the deployer still owns the pool. **Complete and verified.**
6. Verify `pool.usdc()`, `pool.owner()`, `pool.treasury()`, `pool.grantVesting()`, `vesting.usdc()`, and `vesting.owner()`. **Complete and verified.**
7. Transfer pool ownership once to the approved organization multisig or testnet owner and verify `pool.owner()` onchain. `GrantPool` uses `Ownable`, so there is no `acceptOwnership()` step.
8. Configure the exact pool address and `pool_chain_id=5042002` on the corresponding GrantHub grant.
9. Keep financial flags disabled until the complete rehearsal is explicitly authorized.

`GrantVesting` must remain owned by the `GrantPool`. The pool is the only admin address permitted to create, pause, or revoke its schedules; beneficiaries claim their own schedules.

## Non-broadcast simulation commands

Set public values in the shell only; never put a private key in this document. The following values are the verified first-organization Testnet deployment inputs.

```bash
USDC=0x3600000000000000000000000000000000000000
DEPLOYER=0x0a2E28a5Db0813AF4Ea9FE5792032328E6D26FD6
FACTORY=0x0d12537B482Ad44BA4e03DA2444a97B903AA997B

# Per-organization simulation — no --broadcast
TREASURY=0xFD6EC7a1d8839BD56e8Ab19af80912ff0682cec4
SALT=0x856ae8c1afcb79afeb10d63b76a34942b7c7fb6275390bd76911e08d4b23ad88
forge script contracts/script/DeployGrantHub.s.sol:DeployOrgPool \
  --rpc-url arc_testnet \
  --sender "$DEPLOYER" \
  --sig "run(address,address,address,bytes32)" \
  "$USDC" "$FACTORY" "$TREASURY" "$SALT"
```

The Factory was deployed by the dedicated Vestros Testnet deployer on 2026-10-30. Receipt verification: block `69850736`, status `1`, gas paid `0.0330941545` USDC. The live runtime bytecode exactly matches `contracts/out/GrantPoolFactory.sol/GrantPoolFactory.json` at 7,236 bytes.

The first organization deployment was independently verified on 2026-10-30. Transactions used blocks `69862219`, `69862223`, and `69862228`, with total gas paid of `0.06375088125` native USDC. GrantPool and GrantVesting runtime bytecode match the compiled artifacts after substituting Solidity immutable constructor slots with their live values. Initial pool and vesting accounting are zero, both contracts are unpaused, and the factory registry returns the deployed pool.

The verified first-organization parameters are: owner/admin `0x0B83a98a46310C47Ac6c87C67904b98D6febd392`, treasury `0xFD6EC7a1d8839BD56e8Ab19af80912ff0682cec4`, and salt `0x856ae8c1afcb79afeb10d63b76a34942b7c7fb6275390bd76911e08d4b23ad88`. Do not reuse this salt for another deployer or organization.

The current `DeployOrgPool` script initially assigns the new pool to the deployer, wires `GrantVesting` with the pool as owner, and logs the required ownership transfer. It does not accept an organization-owner argument. `GrantPool` uses single-step OpenZeppelin `Ownable`; there is no `acceptOwnership()` call. The pool must not accept deposits until the one-step transfer is confirmed onchain and ownership is transferred to the approved organization owner or multisig.

### Required organization inputs

- Organization owner or multisig: `0x0B83a98a46310C47Ac6c87C67904b98D6febd392`; configured in GrantHub, but not yet transferred onchain.
- Treasury address: `0xFD6EC7a1d8839BD56e8Ab19af80912ff0682cec4`; encoded into the deployed GrantPool.
- Deployment salt: `0x856ae8c1afcb79afeb10d63b76a34942b7c7fb6275390bd76911e08d4b23ad88`; consumed by the verified deployment.
- Deployment signer: the dedicated Vestros Testnet deployer `0x0a2E28a5Db0813AF4Ea9FE5792032328E6D26FD6`.

## PowerShell organization-pool simulation

```powershell
$usdc = '0x3600000000000000000000000000000000000000'
$factory = '0x0d12537B482Ad44BA4e03DA2444a97B903AA997B'
$deployer = '0x0a2E28a5Db0813AF4Ea9FE5792032328E6D26FD6'
$keystore = 'C:\Users\RARE\Documents\Vestros\keys\arc-testnet\vestros-testnet-deployer'
$treasury = '0xFD6EC7a1d8839BD56e8Ab19af80912ff0682cec4'
$salt = '0x856ae8c1afcb79afeb10d63b76a34942b7c7fb6275390bd76911e08d4b23ad88'

forge script contracts/script/DeployGrantHub.s.sol:DeployOrgPool `
  --rpc-url https://rpc.testnet.arc.io `
  --keystore $keystore `
  --sender $deployer `
  --sig 'run(address,address,address,bytes32)' `
  $usdc $factory $treasury $salt
```

## Broadcast commands — authorization required

Do not run these until the deployment approval checklist is complete. Prefer Ledger or an encrypted keystore.

```bash
forge script contracts/script/DeployGrantHub.s.sol:DeployGrantHub \
  --rpc-url arc_testnet --broadcast --ledger --sender "$DEPLOYER" \
  --sig "run(address)" "$USDC"

forge script contracts/script/DeployGrantHub.s.sol:DeployOrgPool \
  --rpc-url arc_testnet --broadcast --ledger --sender "$DEPLOYER" \
  --sig "run(address,address,address,bytes32)" \
  "$USDC" "$FACTORY" "$TREASURY" "$SALT"
```

The scripts also support a testnet-only `PRIVATE_KEY` path, but raw keys must not be committed, logged, or used for mainnet.

## Required post-deployment checks

```bash
cast call "$POOL" "usdc()(address)" --rpc-url arc_testnet
cast call "$POOL" "owner()(address)" --rpc-url arc_testnet
cast call "$POOL" "grantVesting()(address)" --rpc-url arc_testnet
cast call "$VESTING" "usdc()(address)" --rpc-url arc_testnet
cast call "$VESTING" "owner()(address)" --rpc-url arc_testnet
cast code "$FACTORY" --rpc-url arc_testnet
cast code "$POOL" --rpc-url arc_testnet
cast code "$VESTING" --rpc-url arc_testnet
```

Record deployment transaction hashes, block numbers, addresses, owners, USDC values, event logs, explorer links, and API configuration in a private operator log.

## Security gates

- Use separate organization-owner, applicant/beneficiary, and sponsor wallets.
- Confirm the factory is permissionless but each pool is namespaced by caller and salt.
- Confirm the one-step `GrantPool.transferOwnership()` succeeded and `pool.owner()` is the approved organization owner or multisig before deposits.
- Confirm `GrantVesting.owner()` is the pool, never the deployer EOA.
- Confirm deposit verification sees the exact USDC `Transfer` and `GrantPool.Deposited` events.
- Confirm activation verifies `AwardActivated`, `ScheduleCreated`, and pool-to-vesting funding.
- Confirm revoked unvested funds restore `GrantPool.confirmedBalance`.
- Treat a committed receipt with status `1` as final on Arc; still reject pending transactions and status `0` receipts.
- Abort on any chain, token, recipient, amount, ownership, event, or balance mismatch.
