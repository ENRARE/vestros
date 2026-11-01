# Premium Sidebar Redesign

## Intent

Refine Vestros's existing left navigation into a compact, premium fintech/Web3 sidebar inspired by the supplied reference while preserving every current route, role gate, wallet connection, and page layout.

## Goals

- Provide a 256px expanded sidebar and a 68px collapsed sidebar with smooth transitions.
- Organize the existing centralized navigation into one-open-at-a-time accordion groups.
- Add searchable navigation, active-route expansion, collapsed group flyouts, tooltips, keyboard focus states, and a responsive mobile drawer.
- Add a fixed footer showing Arc network state, wallet identity, and an accessible account menu using the existing ConnectKit/wagmi integration.
- Keep the current Vestros logo treatment and dark design tokens; use Lucide icons already installed.

## Non-goals

- No contract, backend financial, route, or deployment changes.
- No new dependencies, visual redesign of application pages, or replacement branding.
- No authorization changes: navigation remains a presentation hint and existing page/server checks remain authoritative.

## Approach

The current `AppShell`, `Sidebar`, `Topbar`, and `navConfig` remain the integration points. `navConfig` gains group icons; small pure helpers own visible-item filtering, search matching, and active-group selection. `Sidebar` owns only presentational state (expanded group, query, collapsed flyout, account menu), while `AppShell` continues to own persistence and mobile drawer state. CSS additions stay in `index.css` and use existing tokens.

## Interaction decisions

- The last user-selected expanded/collapsed preference is persisted. If no preference exists, widths below the desktop breakpoint start collapsed; mobile uses the drawer.
- The group containing the current route is opened automatically. A user can open another group, which closes the previous one.
- Expanded search replaces the group list with visible matching links. Collapsed search opens a small flyout without expanding the sidebar.
- Account menu closes on outside click or Escape, and mobile navigation closes after a route change.

## Acceptance criteria

Every configured visible item remains reachable; active routes and query tabs are highlighted; search links navigate; collapsed flyouts expose nested items; account menu supports Settings, network information, and disconnect; mobile backdrop, Escape, and navigation close work; typecheck, lint, tests, and production build pass.
