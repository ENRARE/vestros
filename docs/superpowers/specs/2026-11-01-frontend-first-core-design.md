# Frontend-First Vestros Core Design

## Intent

Allow Vestros Core to run as a browser-only application on Arc Testnet and
Arc Mainnet. Direct wallet interactions and live contract reads remain the
source of truth. The existing Bun + SQLite indexer remains available as an
optional history enhancement and is not required for Core pages to load.

## Goals

- Preserve deployed Core and SelfServiceVesting contracts, permissions, and
  network-specific addresses.
- Keep vault discovery, beneficiary schedule reads, funding, claims,
  revocation, pause controls, balances, and vesting calculations on wagmi/viem.
- Record only successful vesting events decoded from confirmed transaction
  receipts observed by the current browser.
- Scope local records by chain, initiating wallet, vault, schedule, tx hash,
  and log index; deduplicate on that composite identity.
- Use the Bun Activity API only when reachable, merging verified server
  records with local records without making the API a Core prerequisite.
- Keep partial, local-only, and unavailable history visibly distinct.
- Keep GrantHub API/auth/database features intact and clearly backend-dependent.
- Keep Testnet and Mainnet RPC and contract configuration separate, with no
  authenticated provider credentials in browser configuration.

## Non-goals and limitations

- No contract changes, deployments, financial transactions, ownership changes,
  or GrantHub financial activation.
- No browser-side historical `eth_getLogs` scans or block-range indexing.
- A fresh browser cannot enumerate every owner schedule because the deployed
  contracts expose beneficiary schedule IDs but no owner-wide schedule list.
  Owner Treasury, Analytics, and historical Activity therefore remain partial
  without the optional indexer or a future managed index.
- Local receipt history is device/browser scoped and cannot prove transactions
  performed elsewhere.

## Architecture

### Direct Core path

The current wagmi contract configuration remains responsible for all reads and
writes. The browser uses only public Arc RPC URLs. Optional public fallback URLs
are accepted only from network-specific `VITE_*` variables with no URL
credentials, query strings, or cross-network reuse. The server RPC proxy is no
longer part of the Core browser transport.

### Local confirmed-receipt journal

After `useWaitForTransactionReceipt` reports a successful receipt, the frontend
decodes only vesting lifecycle events emitted by the target vault. It validates
chain ID, vault address, receipt success, transaction hash, block identity, and
event arguments before persisting a record. Approval and unrelated token
transfers are not treated as vesting history.

The journal is stored in localStorage under a versioned key containing chain and
wallet scope. Each record carries the originating vault and schedule ID. A
wallet switch changes the journal scope and clears stale derived state.

### Optional history enhancement

The Activity hook loads local records immediately, then attempts the existing
same-origin Activity API with a bounded timeout. Successful API records are
merged by `(chainId, vaultAddress, txHash, logIndex)`. If the API is absent or
fails, direct contract reads and local records remain usable and the UI shows a
nonblocking partial-history message.

### GrantHub boundary

GrantHub continues using its existing backend authentication and REST routes.
Without Bun/API availability, GrantHub pages show their existing signed-out or
backend-unavailable states; no fake records are created. A separate design
document describes a future managed-index/storage architecture for backendless
GrantHub operation.

## Acceptance criteria

- Core pages render and contract reads/writes remain usable with the Bun server
  stopped.
- Successful create, claim, and revoke receipts appear as confirmed local
  records with explorer links and composite identity.
- Failed or pending receipts never appear as confirmed history.
- Backend history enhances, but cannot block, Core schedule data.
- Wallet switching does not reuse another wallet's journal or vault state.
- No browser bundle contains `ARC_TESTNET_RPC_SECONDARY` or any authenticated
  provider credential.
- Existing server/indexer tests and GrantHub behavior remain intact.
