# Avatar, Settings, and Documentation Design

## Intent

Make the account experience feel like a first-class part of Vestros: replace the address-character badge with a restrained selectable avatar, give Settings a clear workspace structure, and turn Help & Documentation into a useful mainnet-readiness hub.

## Approved approach

Use a shared React profile-preferences context backed by wallet-scoped `localStorage`. The context owns the selected avatar ID and exposes it to the topbar, sidebar, account dropdown, and Settings. Avatars are code-native SVG variants, so no external assets or dependencies are required.

Settings will show local avatar/wallet controls even when a GrantHub session is absent. Existing server-backed public profile fields remain protected by the existing `AuthBanner` and `useAuth` session. Help content will be organized into overview, built features, readiness, vesting, GrantHub, financial restrictions, and quick links using verified repository documents.

## Alternatives considered

- **Independent component state:** rejected because Settings changes would not update the topbar/sidebar without navigation and could drift between wallet surfaces.
- **Remote avatar/profile storage:** rejected because the requirement is local persistence for now and this would expand backend/auth scope.
- **External image avatars:** rejected because they add asset loading and a less controlled visual style; code-native SVG keeps the premium system consistent.

## Scope and constraints

- Provide at least five distinct, restrained avatar presets with different color and geometric/profile treatments.
- Key local avatar storage by normalized wallet address so account switching does not reuse another wallet's preference.
- Preserve shortened wallet addresses, ConnectKit, wagmi, GrantHub auth, existing profile APIs, and sidebar navigation.
- Do not change contracts, financial calculations, server permissions, or deployment behavior.
- Use existing Arc/Testnet/Mainnet facts and readiness documents; do not invent launch claims.

## Success criteria

- The topbar, account dropdown, sidebar account area, and Settings render the same selected avatar.
- Avatar selection persists across refreshes for the same wallet and isolates different wallets.
- Settings remains usable for local wallet controls without forcing a GrantHub signature; public profile editing still requires the existing session.
- Help presents the requested documentation sections with clear readiness and financial-restriction callouts.
- TypeScript, lint, relevant tests, and production build pass.
