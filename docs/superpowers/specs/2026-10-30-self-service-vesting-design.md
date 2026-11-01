# Vestros Self-Service Vesting Design

## Intent

Allow every connected wallet to manage one independently owned USDC vesting
vault without changing the deployed Core `USDCVesting` contract or GrantHub
contracts. A vault owner funds schedules from that wallet, beneficiaries claim
their own schedules, and no factory or other wallet retains administrative
control after creation.

## Goals

- Preserve the deployed Core Vesting contract and its current ownership.
- Add a permissionless, network-configured `VestingFactory`.
- Create exactly one registered vault per creator wallet.
- Keep schedule creation, revocation, pause, rescue, and ownership checks
  enforced onchain by the vault.
- Support self-service Create Vesting, Bulk Vesting, Team Management,
  My Vesting, Timeline, Treasury, and Analytics.
- Discover schedules across the legacy Core contract and factory-created
  vaults without trusting frontend state.
- Keep GrantHub financial flags and all Mainnet addresses unchanged.

## Non-goals

- No migration of schedules or funds from the deployed Core contract.
- No automatic ownership transfer, deployment, or USDC movement.
- No changes to GrantPool, GrantVesting, or GrantHub authorization.
- No atomic bulk transaction claim unless the contract provides one.

## Approaches considered

1. Deploy the existing `USDCVesting` once per wallet. This is the smallest
   Testnet change, but the contract hardcodes the Testnet USDC address and
   cannot safely support a separate Mainnet token configuration.
2. Deploy a configurable `SelfServiceVesting` vault once per wallet through a
   permissionless factory. This preserves the deployed Core contract, keeps
   network token addresses explicit, and confines each owner's funds and
   schedules to one vault. It duplicates the existing vesting implementation
   surface, so the logic will be regression-tested against the Core behavior.
3. Use a shared permissionless contract with an owner per schedule. This would
   reduce deployment overhead but would require rewriting authorization,
   escrow accounting, and revocation semantics in the audited design.

## Selected approach

Use approach 2. The factory will deploy a `SelfServiceVesting` instance with
the configured network USDC address and `msg.sender` as the initial owner.

### Contract design

`SelfServiceVesting` will mirror the existing Core behavior:

- immutable `usdc` address supplied by the factory;
- `Ownable2Step`, `Pausable`, and `ReentrancyGuard`;
- owner-only schedule creation, revocation, pause, and stuck-funds rescue;
- beneficiary-only claims;
- safe ERC-20 transfers and exact escrow accounting;
- the same cliff, linear vesting, revoke-time cap, and event semantics.

The constructor assigns the creator directly as owner. The factory is never
the owner and has no vault withdrawal or schedule-management function. The
normal two-step ownership path remains available for a creator who later
wants to transfer the vault to a multisig: `transferOwnership()` followed by
`acceptOwnership()` from the pending owner. The factory cannot accept or
intercept that transfer.

`VestingFactory` will:

- accept a nonzero network USDC address at deployment;
- expose `vaultOf(address)`, `vaultCount()`, and `vaultAt(uint256)`;
- reject a second vault for the same creator;
- deploy `SelfServiceVesting(usdc, msg.sender)`;
- record the vault and emit `VaultCreated(creator, vault)`;
- have no owner or privileged administrative path.

The deployment script will require explicit Testnet/Mainnet addresses and will
refuse to reuse a Testnet factory or USDC address for Mainnet.

### Frontend and indexing

- Add network-specific factory configuration and ABI.
- Add a vault hook that reads `vaultOf(connectedAddress)` and exposes setup,
  creation, and confirmed-vault states.
- Create and Bulk pages first guide a user through vault creation, then USDC
  approval, then schedule creation. Existing failed-row and sequential
  progress behavior remains explicit.
- Replace global Core-owner checks with the connected wallet's vault owner
  check. The existing Core contract remains available as a legacy read/claim
  source.
- Team, Treasury, and Analytics default to the connected wallet's managed
  vault. Beneficiary views may include schedules discovered from all supported
  vaults, but every claim still uses the vault's onchain beneficiary check.
- Extend the event indexer to discover `VaultCreated` events from the factory,
  then index schedule events from the legacy Core address and each discovered
  vault. Cache keys will be versioned and include network/factory identity.
- Wallet changes clear or recompute vault-specific state so one account cannot
  inherit another account's controls or cached totals.

### Security and failure handling

- A vault owner can only operate its own vault; cross-vault writes must revert.
- Schedule state is written before funding only within one reverting transaction;
  failed `safeTransferFrom` calls roll back the complete schedule creation.
- Bulk operations remain sequential and display confirmed, failed, and
  unattempted rows. The UI never reports an incomplete row as funded.
- All claims, revocations, and funding totals are reconciled from receipts and
  onchain reads, not optimistic frontend state.
- The factory and vault contracts will include tests for two creators,
  multiple beneficiaries, duplicate vault creation, unauthorized writes,
  failed funding, claims, revocations, pause behavior, ownership transfer,
  and token/decimal configuration.

## Acceptance criteria

- Two independent owners can create separate vaults and schedules.
- Owner A cannot create, revoke, pause, rescue, or withdraw from Owner B's
  vault.
- Beneficiaries can discover and claim eligible amounts from either vault.
- Existing Core Vesting and GrantHub tests and routes remain functional.
- Forge, frontend, backend, TypeScript, lint, and production-build checks pass.
- No deployment, broadcast, ownership transfer, fund movement, or financial
  flag change occurs during implementation.
