# Vestros — Go / No-Go

*Updated: October 30, 2026*

## Evidence from this checkout

| Check | Result |
|---|---|
| Solidity build | Passed |
| Forge tests excluding USDCVesting invariants | `157/157` passed, including GrantPool invariants |
| USDCVesting invariants | `3/3` passed at 16 runs × 32 calls; default 256 × 500 is computationally impractical for the current handler |
| TypeScript | Passed |
| oxlint | Passed with no diagnostics |
| Server utility and onchain verifier tests | `18/18` passed |
| Vite production build | Passed, with third-party chunk warnings |
| Contract deployment | Not performed |
| Financial transactions | Not performed |

The source contains 160 test functions in total. This audit verified all 160 functions through the 157 default-run tests plus the three bounded USDCVesting invariant tests; it did not claim a completed default 256 × 500 USDCVesting invariant run.

## Core Vestros: conditional go

The `USDCVesting` source, existing testnet deployment configuration, Arc chain facts, and signing guardrails are internally consistent for a controlled mainnet deployment. Mainnet still requires an operator to deploy the contract, record its address and deployment transaction, verify the source, and set:

```text
VITE_CHAIN_ENV=mainnet
VITE_USDC_VESTING_CONTRACT_MAINNET=<verified address>
VITE_USDC_VESTING_DEPLOY_TX_MAINNET=<deployment tx>
```

Use Ledger or `--account` keystore signing. Do not set or pass `PRIVATE_KEY` on mainnet.

## GrantHub financial features: conditional no-go

GrantHub discovery, organization onboarding, grant creation, applications, review, and award-record creation are available as off-chain workflows. Deposit creation/confirmation and onchain award activation are disabled by default. Keep both flags false until:

- a third-party review is complete;
- pool owners are multisigs;
- a testnet activation rehearsal succeeds;
- the controlled rehearsal confirms receipt, chain, pool, token, sender, amount, and event verification against live RPC;
- production auth/session and shared-rate-limit controls are in place.

## Deployment reminders

```bash
# Mainnet dry run
forge script contracts/script/DeployGrantHub.s.sol \
  --rpc-url arc_mainnet --sender <operator-address> \
  --sig "run(address)" 0x3600000000000000000000000000000000000000

# Mainnet broadcast: external signer only
forge script contracts/script/DeployGrantHub.s.sol \
  --rpc-url arc_mainnet --broadcast --ledger \
  --sig "run(address)" 0x3600000000000000000000000000000000000000

# Or use an encrypted keystore
forge script contracts/script/DeployGrantHub.s.sol \
  --rpc-url arc_mainnet --broadcast --account vestros-deployer \
  --sig "run(address)" 0x3600000000000000000000000000000000000000
```

Do not run these commands as part of an automated audit or CI job with a live signer. Record deployed addresses only after independent operator verification.
