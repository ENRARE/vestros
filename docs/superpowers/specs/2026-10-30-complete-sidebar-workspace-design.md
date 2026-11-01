# Complete Sidebar & Functional Workspace Design

## Intent

Complete the existing Vestros sidebar so every requested item opens a useful,
data-backed screen without redesigning the application or enabling financial
operations. The goal is a coherent workspace for wallet holders, beneficiaries,
grant applicants, organization members, and contract owners.

## Goals

- Keep the existing fixed, collapsible, responsive sidebar and dark visual system.
- Give every requested navigation item a real route and a meaningful empty,
  loading, error, and permission state.
- Use current onchain event data and existing GrantHub APIs for activity,
  analytics, reports, organizations, applications, awards, and profiles.
- Keep deposits, award activation, and other financial writes disabled by the
  existing server/frontend feature gate.
- Preserve wallet/network checks and do not introduce a new state-management
  layer.

## Non-goals

- No contract deployment, USDC transfer, award activation, or other financial
  transaction.
- No database reset, destructive migration, or replacement of the existing UI.
- No new analytics provider or persistent event-indexing service.
- No assumption that a connected wallet is an organization administrator or
  reviewer; server authorization remains authoritative.

## Approaches

1. **Route completion around existing components (chosen):** add focused pages
   for missing utilities, map organization links to dashboard views, and reuse
   the current event indexer, Treasury dashboard, GrantHub APIs, and design
   primitives. This is the smallest safe change and preserves current behavior.
2. **Rebuild the dashboard around a new workspace store:** centralize every
   query and navigation state. This could improve long-term consistency, but it
   would duplicate current hooks and increase regression risk during testnet
   preparation.
3. **Add placeholder pages for every link:** fast but does not meet the request
   for working data, actions, permissions, and exports; rejected.

## Design

- `Activity` combines wallet-filtered vesting events with signed-in GrantHub
  applications and awards, and links onchain events to the configured explorer.
- `Analytics` derives event counts and USDC amounts from the existing event
  indexer. Treasury remains the source for current allocation/claimable
  balances.
- `Reports` provides real filters and CSV downloads for vesting events and the
  signed-in user’s GrantHub records.
- `Settings` uses the already implemented profile API and exposes public-field
  controls plus GrantHub sign-out. It never changes wallet or financial state.
- `Help & Documentation` gives current network, contract-configuration, route,
  claim, and GrantHub workflow guidance with links into the app.
- Organization navigation uses query-selected dashboard tabs for overview,
  programs, applications, review queue, and award management. A separate
  funding page shows configured grants and verified deposits read-only; the
  financial banner remains visible when writes are disabled.
- Vesting `Team Management` reuses the existing onchain Treasury beneficiary
  view with owner gating, since the vesting contract has no separate mutable
  team directory.
- Sidebar role labels are treated as navigation hints only. The page and server
  continue to enforce authorization; reviewer visibility is not inferred from
  wallet connection alone.

## Constraints

- React 18, TypeScript, React Router, wagmi, viem, and existing Lucide/design
  primitives only.
- No dependency installation is required.
- Financial feature flags remain default-off.
- Test and build claims must be backed by fresh command output.
