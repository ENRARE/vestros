# Arc Mainnet Readiness

Status: **BLOCKED - postdeployment release gates remain**

This report covers the read-only hardening work performed in this workspace. It
does not constitute an independent security audit, deployment authorization, or
approval to broadcast a transaction.

## Current decision

The minimum intended Core release is the self-service `VestingFactory` plus
factory-created `SelfServiceVesting` vaults. Legacy `USDCVesting` remains an
optional compatibility component and is not required for the factory-only
release. The live factory-only Mainnet deployment is now configured for
read-only frontend use. The legacy USDCVesting Mainnet address remains blank
by design. Independent contract review, source verification, approved runtime
fingerprint registration, and a controlled postdeployment smoke test remain
outstanding.

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

## Live Mainnet factory evidence

The following evidence was reproduced with read-only calls against Arc
Mainnet (`5042`). No vault was created and no USDC transaction was submitted.

| Check | Result |
|---|---|
| Factory | `0xa9a60e3a9e46590CFcfa345c8F0e8b1E9039dc4d` |
| Deployment transaction | `0x6891201cecc547d173eda6cac3833c9be7feac77b83130e8cdb5bc4b88eae9f2` |
| Deployment block | `29044281` |
| Receipt status | `1` (success) |
| Transaction chain ID | `5042` |
| Constructor argument | canonical USDC `0x3600000000000000000000000000000000000000` |
| Factory `usdc()` | canonical USDC; PASS |
| Factory `vaultCount()` | `0`; PASS, no vault creation performed |
| Artifact compiler settings | Solidity `0.8.28`, EVM `paris`, optimizer `200`; PASS |
| Runtime comparison | exact byte-for-byte match after replacing the artifact immutable slot with canonical USDC; metadata retained; PASS |
| Observed runtime hash | `0x5218d09a75d9030f8fcca6ca9336a93a9bbcb8cad911a302644e3f59658934d7` |
| Approved fingerprint | NOT VERIFIED; the observed hash is not treated as independent approval |
| Explorer source verification | NOT VERIFIED; the Arc Explorer verification surface currently reports source submission unavailable, and no verification receipt exists |

The creation input also matches the compiled creation artifact prefix and ends
with the expected 32-byte USDC constructor argument. This is deployment
evidence, not an independent security audit.

## Explorer verification preparation

No redeployment is needed for source verification. The prepared verification
inputs are:

- Contract: `VestingFactory`
- Address: `0xa9a60e3a9e46590CFcfa345c8F0e8b1E9039dc4d`
- Compiler: `v0.8.28` (`0.8.28+commit.7893614a`)
- EVM: `paris`
- Optimizer: enabled, `200` runs
- Constructor argument: `0x3600000000000000000000000000000000000000`
- Source entrypoint: `contracts/VestingFactory.sol:VestingFactory`

The Arc Mainnet explorer contract page should be used to submit these exact
inputs if/when it exposes a Verify/Publish action. The current verification
surface reports that source submission is unavailable, and this audit did not
receive a verification receipt. Source verification therefore remains
`NOT VERIFIED`.

## Read-only preflight command

```bash
npm run ops:mainnet-preflight
```

With the current configuration this must report `NOT VERIFIED` because:

- the approved runtime hash for the selected factory component is blank.

The minimum-release operator scope is already set to
`MAINNET_RELEASE_COMPONENTS=factory`. Do not populate a legacy Core address
unless that compatibility component is separately approved.

After independent review, an operator may populate the public approved runtime
hash and rerun the command against an RPC that reports chain ID `5042`. No
private key belongs in the frontend or in these environment variables.

## Readiness matrix

| Area | Status | Evidence / blocker |
|---|---|---|
| Arc Mainnet chain isolation | PASS | Configuration selects `5042` independently; no Testnet fallback. |
| Canonical Mainnet USDC | PASS | Network facts and deployment guards require `0x3600000000000000000000000000000000000000`. |
| Mainnet Core deployment | NOT APPLICABLE for factory-only scope | Legacy `USDCVesting` is optional compatibility functionality and is not required by the self-service release. |
| Mainnet factory deployment | PASS | Receipt status `1`, factory `0xa9a60e3a9e46590CFcfa345c8F0e8b1E9039dc4d`, block `29044281`, tx `0x6891201cecc547d173eda6cac3833c9be7feac77b83130e8cdb5bc4b88eae9f2`. |
| Mainnet bytecode comparison | PASS | Live runtime exactly matches the compiled `VestingFactory` artifact after immutable substitution, including metadata. |
| Mainnet bytecode approval | NOT VERIFIED | Observed hash is recorded, but independent security/artifact approval has not been granted. |
| Mainnet ownership/configuration | PASS for factory reads | `factory.usdc()` matches canonical USDC and `vaultCount()` is `0`; vault-owner behavior still requires a separately approved postdeployment vault rehearsal. |
| Mainnet RPC | PASS | Chain ID `5042`; factory bytecode, `usdc()`, and `vaultCount()` read successfully. |
| Wallet/signing protections | PASS | Mainnet deployment scripts reject raw `PRIVATE_KEY` and default Foundry sender. |
| Core contract regression suite | PASS | `forge test`: 191 tests passed, 0 failed, including 256-run invariant suites. |
| Frontend Mainnet factory configuration | PASS with release gates | Factory address and deployment tx are configured; legacy Mainnet Core remains blank and the approved runtime hash remains blank. |
| Browser wallet QA | NOT VERIFIED | No browser session was used during this audit. |
| Local receipt history | NOT VERIFIED | Testnet lifecycle is covered by prior evidence; Mainnet has no receipts yet. |
| Treasury/Analytics completeness | BLOCKED | Owner-wide historical completeness still requires indexed coverage; no Mainnet history exists. |
| GrantHub Mainnet | BLOCKED | No deployment, financial flags disabled, independent review and operational rehearsal outstanding. |
| Independent security audit | BLOCKED | No third-party audit has been completed for the release candidate. |

The Mainnet RPC and factory checks pass. The release remains blocked because
the approved runtime hash is intentionally blank pending independent review,
source verification is not confirmed, and browser/postdeployment acceptance
has not been completed.

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
