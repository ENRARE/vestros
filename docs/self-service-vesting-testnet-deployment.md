# Self-Service Vesting Testnet Deployment & Verification

The VestingFactory deployment is complete and independently verified. No user
vault has been created, no USDC has been transferred, and GrantHub financial
operations remain disabled.

## Network configuration

| Environment | Chain ID | USDC | Factory configuration |
|---|---:|---|---|
| Arc Testnet | `5042002` | `0x3600000000000000000000000000000000000000` | `0xd5E874489038D9FBA47F1669980EC885eBaE17BF` |
| Arc Mainnet | `5042` | `0x3600000000000000000000000000000000000000` | `0xa9a60e3a9e46590CFcfa345c8F0e8b1E9039dc4d` (deployed; approval gates remain) |

USDC uses 6 decimals on both configured Arc networks. The Mainnet factory
address above is public deployment evidence; its approved runtime fingerprint
and independent security review remain outstanding. The Testnet address must
never be copied into Mainnet configuration.

## Testnet deployment order

1. Deploy `VestingFactory(USDC)` with a dedicated signer.
2. Set `VITE_VESTING_FACTORY_TESTNET` only to the verified factory address.
3. Connect each user wallet and call `createVault()` once. The factory deploys
   `SelfServiceVesting(USDC, msg.sender)` and emits `VaultCreated`.
4. Verify the vault owner is the creator, `pendingOwner()` is zero, and the
   factory has no owner or administrative path.
5. Use the resulting vault for USDC approvals, schedule creation, claims,
   revocations, Team Management, Treasury, Analytics, and Reports.

The implementation does not require a GrantHub deployment or a GrantHub
financial feature flag. GrantHub financial endpoints remain disabled until a
separate security-approved rehearsal.

## Verified Testnet deployment

| Field | Value |
|---|---|
| Factory | `0xd5E874489038D9FBA47F1669980EC885eBaE17BF` |
| Transaction | [`0x4b0feffe14f493572d87b104f785affaff622c703fa43c6e639c29472efab45c`](https://explorer.testnet.arc.io/tx/0x4b0feffe14f493572d87b104f785affaff622c703fa43c6e639c29472efab45c) |
| Block | `69879559` |
| Chain ID | `5042002` |
| Deployer | `0x0a2E28a5Db0813AF4Ea9FE5792032328E6D26FD6` |
| Constructor | `VestingFactory(0x3600000000000000000000000000000000000000)` |
| Receipt | Success (`status = 1`) |
| Gas used | `1,532,118` |

The live runtime is `6,846` bytes and matches the compiled
`VestingFactory` runtime after replacing both compiler immutable-reference
slots with the canonical USDC address. `factory.usdc()` returns the canonical
USDC address, `vaultCount()` is `0`, and `vaultOf(deployer)` is the zero
address. The factory has no `owner()` function or privileged administration
path.

The local Vite configuration preserves the Testnet values and now selects the
live Mainnet factory only when `VITE_CHAIN_ENV=mainnet`. The legacy Mainnet
`USDCVesting` address remains blank.

## Simulation command

From PowerShell, with a verified external signer address and no broadcast:

```powershell
$usdc = "0x3600000000000000000000000000000000000000"
forge script contracts/script/DeployVestingFactory.s.sol:DeployVestingFactory `
  --rpc-url arc_testnet `
  --sender <DEDICATED_TESTNET_SIGNER> `
  --sig "run(address)" $usdc
```

The script rejects an unsupported chain, a zero/wrong USDC address, Foundry's
default sender, and raw `PRIVATE_KEY` use on Mainnet. A later operator-approved
broadcast must use a Ledger or encrypted Foundry keystore and must refresh the
chain ID, nonce, balance, bytecode, and gas estimate immediately beforehand.

## Verification checklist

- Receipt status is successful and the deployed address contains the expected
  `VestingFactory` runtime bytecode.
- `factory.usdc()` equals the network-specific canonical USDC address.
- `factory.vaultCount()` and `vaultOf(creator)` match each `VaultCreated` log.
- Each vault reports `owner() == creator`, `pendingOwner() == address(0)`, and
  the factory address is not the owner.
- A second `createVault()` from the same creator reverts.
- A different creator receives a different vault and cannot call the first
  vault's owner-only functions.
- Mainnet factory configuration is separate from Testnet and does not fall
  back across environments; the approved runtime hash remains blank until
  independent artifact/security review is complete.

## Security boundary

The Core deployed `USDCVesting` contract and all existing GrantHub contracts
are not modified by this feature. `SelfServiceVesting` duplicates the tested
vesting surface with an explicit immutable USDC address, so independent review
of that duplicated logic remains required before production use.
