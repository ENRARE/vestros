# Premium Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the existing Vestros sidebar into a polished searchable, accordion-based, collapsible, responsive navigation without changing routes or financial logic.

**Architecture:** Keep `AppShell` as the responsive shell and `Sidebar` as the single navigation renderer. Add pure helpers for filtering and active-group selection, add group metadata to `navConfig`, and use existing CSS variables plus Lucide/wagmi/ConnectKit primitives for interactions.

**Tech Stack:** React 18, TypeScript, React Router, wagmi, ConnectKit, lucide-react, Tailwind CSS, existing CSS tokens.

**Spec:** `docs/superpowers/specs/2026-10-30-premium-sidebar-design.md`

## Global Constraints

- Preserve all existing routes, role gates, wallet connections, business logic, and page content.
- Do not modify smart contracts, backend financial logic, deployed configurations, or execute transactions.
- Do not add dependencies or redesign unrelated screens.
- Keep the sidebar dark, compact, token-driven, and accessible at desktop, tablet, and mobile widths.

## Review Focus

- Search must only expose currently visible role-authorized items and must preserve query-tab targets.
- A route inside an organization query tab must expand and highlight the correct parent/group item.
- Collapsed mode must provide every group through a flyout without empty gaps or inaccessible labels.
- Account menu and mobile drawer must close on outside click/Escape/navigation without trapping stale state.
- Wallet disconnected and owner-only states must not expose unauthorized actions.

### Task 1: Navigation helpers and configuration

**Files:**
- Modify: `src/components/layout/navConfig.ts`
- Create: `src/components/layout/sidebar-utils.ts`
- Create: `src/components/layout/sidebar-utils.test.ts`
- Modify: `package.json`

- [ ] Add group icon metadata and pure helpers for visible-item search and active group selection.
- [ ] Add tests for query targets, role filtering, no-result search, and active organization tabs.
- [ ] Run `npm.cmd run test:sidebar` and confirm it fails before implementation, then passes.

### Task 2: Sidebar visual system and interactions

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/index.css`

- [ ] Implement the expanded header, search, accordion groups, active child connector, collapsed flyouts, tooltips, and accessible focus states.
- [ ] Implement wallet/network footer, outside-click/Escape account menu, and wagmi disconnect behavior.
- [ ] Keep role filtering and query-aware active matching centralized through the helpers.
- [ ] Run typecheck and lint.

### Task 3: Shell responsiveness and mobile focus

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/Topbar.tsx`

- [ ] Keep persisted collapse preference, default tablet state, mobile drawer/backdrop, route-close behavior, and focus restoration.
- [ ] Verify no horizontal overflow from the sidebar transition.
- [ ] Run the sidebar unit tests, typecheck, lint, and local route smoke checks.

### Task 4: Final verification

- [ ] Run `npm.cmd run test:sidebar`, `npm.cmd run typecheck`, frontend/backend Oxlint, and `npm.cmd run build`.
- [ ] Check `git diff --check` and report any test limitations honestly.
