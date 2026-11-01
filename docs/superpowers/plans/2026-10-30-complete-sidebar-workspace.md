# Complete Sidebar & Functional Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every requested Vestros sidebar item route to a useful, data-backed screen while preserving the existing UI and financial safety gates.

**Architecture:** Keep `AppShell`, `Sidebar`, and the existing GrantHub router. Add small workspace pages that consume `useVestingEvents` and existing GrantHub REST endpoints, and map organization navigation to explicit dashboard query tabs. Add pure CSV/activity helpers with Node regression tests instead of introducing a frontend test framework.

**Tech Stack:** React 18, TypeScript, React Router, wagmi/viem, Lucide, existing CSS variables/design primitives, Bun HTTP/SQLite APIs.

**Spec:** `docs/superpowers/specs/2026-10-30-complete-sidebar-workspace-design.md`

## Global Constraints

- Preserve the existing fixed/collapsible responsive sidebar and dark UI.
- Financial operations remain disabled by default and no transaction is executed.
- Server/onchain permission checks remain authoritative.
- Do not delete databases or user records, deploy contracts, commit, or push.

## Review Focus

- A wallet can navigate without a GrantHub signature: read-only vesting pages still work, while signed-in data shows an auth prompt.
- A connected wallet is not automatically an organization reviewer/admin: dashboard actions must remain server-gated.
- Mainnet labels must not say Arc Testnet: network copy comes from `CHAIN_ENV`/`ACTIVE_ARC_CHAIN`.
- Empty and partial API responses must not break reports: CSV export handles no records and optional fields.
- CSV values containing commas, quotes, or newlines must remain valid: helper tests cover escaping.

### Task 1: Workspace data helpers and API profile surface

**Files:**
- Create: `src/features/workspace/workspace-utils.ts`
- Create: `src/features/workspace/workspace-utils.test.ts`
- Modify: `src/granthub/api.ts`
- Modify: `src/granthub/types.ts`
- Modify: `package.json`

**Interfaces:**
- `buildCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string`
- `filterEventLogs(logs, eventType, query): EventLog[]`
- `summarizeEventLogs(logs): { created: bigint; claimed: bigint; revoked: bigint; counts: Record<string, number> }`
- `getProfile(address)` and `updateProfile(body)` consume the existing `/api/profiles` routes.

- [ ] Write failing tests for CSV escaping, event filtering, and event aggregation.
- [ ] Run `node --experimental-strip-types --test src/features/workspace/workspace-utils.test.ts` and confirm the missing helper failure.
- [ ] Implement the pure helpers and profile API/types with no financial behavior.
- [ ] Run the focused test and the full server test command.

### Task 2: Complete navigation and route wiring

**Files:**
- Modify: `src/components/layout/navConfig.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/Topbar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/granthub/GrantHubRouter.tsx`
- Modify: `src/granthub/pages/MyGrants.tsx`
- Modify: `src/granthub/pages/OrgDashboard.tsx`

**Interfaces:**
- Every requested sidebar path resolves to an actual element.
- Organization dashboard reads `tab` from the URL and exposes overview,
  grants, applications, review, awards, and members views.

- [ ] Add required distinct sidebar destinations, including Funding & Sponsors,
  and remove disabled flags for pages that now exist.
- [ ] Add route aliases for separate My Applications/My Awards destinations and
  pass dashboard tab query parameters.
- [ ] Add the members and review queue views using existing organization/member
  and application API data; keep mutations server-gated.
- [ ] Derive network labels and explorer context from active chain configuration.
- [ ] Run typecheck to catch route and query-param errors.

### Task 3: Add functional workspace and organization pages

**Files:**
- Create: `src/features/workspace/ActivityPage.tsx`
- Create: `src/features/workspace/AnalyticsPage.tsx`
- Create: `src/features/workspace/ReportsPage.tsx`
- Create: `src/features/workspace/AccountPages.tsx`
- Create: `src/features/organization/FundingPage.tsx`
- Create: `src/features/vesting/TeamManagementPage.tsx`

**Interfaces:**
- Activity uses wallet-filtered onchain events and signed-in GrantHub records.
- Analytics uses onchain event-derived metrics and charts.
- Reports exposes event/user-record filters and valid CSV downloads.
- Settings saves profile fields through `/api/profiles`; Help renders current
  network/configuration guidance.
- Funding is read-only and displays verified deposit status/confirmed totals.
- Team Management is owner-gated and uses the existing Treasury data view.

- [ ] Implement loading, empty, error, disconnected, and permission states.
- [ ] Add links to explorers, existing vesting routes, and GrantHub routes.
- [ ] Keep all funding/activation controls absent or visibly disabled behind the
  existing financial gate.
- [ ] Run the focused workspace test after page integration.

### Task 4: Verification and hygiene

**Files:**
- Modify as needed after verification only.

- [ ] Run `npm.cmd run typecheck`.
- [ ] Run `npm.cmd exec -- oxlint --type-aware src scripts` and the server lint check.
- [ ] Run `npm.cmd run test:server` and `npm.cmd run test:workspace`.
- [ ] Run `forge build`, `forge test`, and `npm.cmd run build`.
- [ ] Run `git diff --check`, inspect tracked runtime artifacts/secrets, and confirm
  no database files were deleted or reset.
- [ ] Report live browser/wallet rehearsal limitations honestly if Bun/RPC/wallet
  access is unavailable.
