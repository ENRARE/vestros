# Arc Mainnet Readiness

Status: **BLOCKED — predeployment only**

This report covers the read-only hardening work performed in this workspace. It
does not constitute an independent security audit, deployment authorization, or
approval to broadcast a transaction.

## Current decision

The minimum intended Core release is the self-service `VestingFactory` plus
factory-created `SelfServiceVesting` vaults. Legacy `USDCVesting` remains an
optional compatibility component and is not required for the factory-only
release. The frontend correctly fails closed while the selected Mainnet
deployment addresses are blank. Independent contract review and a controlled
postdeployment smoke test are also outstanding.

GrantHub Mainnet is a separate **NO-GO**. Its financial flags remain disabled,
no Mainnet GrantHub deployment is configured, and backend-dependent GrantHub
features must not be represented as available without the backend.

## Hardening completed

- Added Mainnet preflight evaluation with explicit `ready`, `not-verified`, and
  `blocked` outcomes. Missing Mainnet addresses cannot inherit Testnet values.
- Added `scripts/mainnet-preflight.mjs`, which requires an explicit
  `MAINNET_RELEASE_COMPONENTS` scope (`factory`, `legacy`, or both), then
  performs read-only checks only for the selected components. It never loads
  `PRIVATE_KEY` and never broadcasts.
- Added public runtime-code-hash gates. A configured address is not considered
  approved until its observed runtime bytecode matches an independently
  recorded artifact hash.
- Added regression coverage for SafeERC20 false-return/revert rollback,
  `uint48` end-time overflow, start-time headroom, cross-user rescue,
  factory enumeration bounds, `VaultCreated` payloads, legacy/self-service
  math parity, GrantPool duration overflow, and deployment-script guards.
- Tightened deployment scripts to reject noncanonical Arc USDC and unsupported
  chains. No deployed contract bytecode was changed.
- Documented the existing block-timestamp and checked-cast decisions in the
  Solidity sources. The timestamp rule retains the existing 60-second wallet
  confirmation buffer; it is not a substitute for a finality policy.

## Read-only preflight command

```bash
npm run ops:mainnet-preflight
```

With the current configuration this must report `BLOCKED` because:

- `MAINNET_RELEASE_COMPONENTS` is not explicitly selected;
- the selected Mainnet component address is blank; and/or
- the approved runtime hash for the selected component is blank.

For the minimum release, set the operator-only preflight scope to
`MAINNET_RELEASE_COMPONENTS=factory`. Do not populate a legacy Core address
unless that compatibility component is separately approved.

After a separately authorized deployment, an operator must populate the
network-specific public addresses and reviewed runtime hashes, then rerun the
command against an RPC that reports chain ID `5042`. No private key belongs in
the frontend or in these environment variables.

## Readiness matrix

| Area | Status | Evidence / blocker |
|---|---|---|
| Arc Mainnet chain isolation | PASS | Configuration selects `5042` independently; no Testnet fallback. |
| Canonical Mainnet USDC | PASS | Network facts and deployment guards require `0x3600000000000000000000000000000000000000`. |
| Mainnet Core deployment | NOT APPLICABLE for factory-only scope | Legacy `USDCVesting` is optional compatibility functionality and is not required by the self-service release. |
| Mainnet factory deployment | BLOCKED | No Mainnet `VestingFactory` address is configured or deployed by this audit. |
| Mainnet bytecode approval | NOT VERIFIED | Requires observed postdeployment runtime hashes and independent artifact review. |
| Mainnet ownership/configuration | NOT VERIFIED | Factory `usdc()` and factory-created vault owner checks remain required; legacy `owner()` is required only when `legacy` is selected. |
| Mainnet RPC | PASS | `cast chain-id` returned `5042`; `cast block-number` returned `29021861`; canonical USDC code, `decimals() = 6`, and `symbol() = USDC` were read successfully. |
| Wallet/signing protections | PASS | Mainnet deployment scripts reject raw `PRIVATE_KEY` and default Foundry sender. |
| Core contract regression suite | PASS | `forge test`: 191 tests passed, 0 failed, including 256-run invariant suites. |
| Frontend Mainnet unavailable state | PASS | Blank Mainnet addresses disable Core writes and show configuration-unavailable UI. |
| Browser wallet QA | NOT VERIFIED | No browser session was used during this audit. |
| Local receipt history | NOT VERIFIED | Testnet lifecycle is covered by prior evidence; Mainnet has no receipts yet. |
| Treasury/Analytics completeness | BLOCKED | Owner-wide historical completeness still requires indexed coverage; no Mainnet history exists. |
| GrantHub Mainnet | BLOCKED | No deployment, financial flags disabled, independent review and operational rehearsal outstanding. |
| Independent security audit | BLOCKED | No third-party audit has been completed for the release candidate. |

The Mainnet RPC PASS is limited to network and canonical-token reads. Selected
application bytecode/configuration checks remain blocked until the approved
release scope, addresses, and runtime hashes are supplied.

## Contract review findings

The reviewed Core and self-service contracts preserve owner-only schedule
creation/revocation/rescue, beneficiary-only claims, pause boundaries,
SafeERC20 transfers, Ownable2Step ownership, and tested balance invariants.
The self-service factory has no administrative path over created vaults.

The Solidity compiler warnings were investigated. The duration casts in
`GrantPool` are preceded by explicit `uint48` bounds checks. The vesting math
casts are safe because the computed vested amount is bounded by the stored
`uint128 totalAmount`. The timestamp warnings describe validator-controlled
block time; the existing 60-second start buffer remains an operational
confirmation safeguard. These changes add lint explanations and tests; they
do not change deployed Core behavior.

Required independent review areas remain:

- adversarial ERC-20 behavior beyond the tested SafeERC20 failures, including
  nonstandard/fee-on-transfer tokens and the canonical Arc USDC behavior;
- full differential and invariant review across every lifecycle transition;
- deployment signer, ownership transfer, pause/recovery, and incident policy;
- reorg/finality policy for local receipt history and any future Mainnet indexer.

## Deployment gate checklist

Before any Mainnet broadcast, an authorized operator must independently:

1. Review the exact artifact hashes and source verification.
2. Confirm the RPC reports chain ID `5042` from at least one trusted endpoint.
3. Use a dedicated Ledger or encrypted keystore signer; never `PRIVATE_KEY`.
4. Run the dry-run scripts with `--sender` and inspect all parameters.
5. Broadcast only with explicit authorization and record receipts.
6. Verify deployed bytecode and factory `usdc()` for the selected scope;
   verify Core owner and Core `usdc()` only when `legacy` is selected.
7. Populate Mainnet config only after those checks pass.
8. Run a separately approved smoke test with the smallest acceptable amount,
   then apply the documented pause/incident procedure.

No step above was executed as a broadcast in this audit.
