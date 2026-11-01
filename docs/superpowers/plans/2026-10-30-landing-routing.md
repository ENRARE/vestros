# Landing Page and Workspace Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a premium single-viewport landing page at `/` and make `/app/*` the explicit workspace entry without breaking legacy workspace or GrantHub paths.

**Architecture:** Keep the existing `BrowserRouter`, wagmi/ConnectKit providers, and `AppShell`. Render the landing page outside the shell at `/`, and render the existing route table inside the shell for both `/app/*` aliases and legacy paths. Centralize the `/app` prefix normalization in a small pure helper used by navigation and route tests.

**Tech Stack:** React 18, TypeScript, React Router, Tailwind utility classes, existing CSS variables, Lucide icons, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-30-landing-routing-design.md`

## Global Constraints

- Preserve existing features, routes, wallet connections, business logic, and blockchain integrations.
- Keep the landing page within a single viewport and use the existing premium dark-blue design system.
- Keep legacy paths such as `/vesting` and `/granthub/*` functional.
- Do not modify smart contracts, backend financial logic, or wallet functionality.
- Do not commit or push changes.

## Review Focus

- Root refresh must render the landing page rather than the workspace overview.
- `/app` and `/app/*` must render the existing workspace without changing its page components.
- Legacy links and direct refreshes must continue to resolve.
- Workspace navigation must not link back to `/` now that it is public.
- Landing CTAs must be keyboard-accessible, single-line, and responsive without overflow.

### Task 1: Route normalization and regression tests

**Files:**
- Create: `src/appRoutes.ts`
- Create: `src/appRoutes.test.ts`
- Modify: `src/components/layout/sidebar-utils.ts`
- Modify: `src/components/layout/Topbar.tsx`
- Modify: `src/components/layout/navConfig.ts`
- Modify: `src/components/layout/Sidebar.tsx`

**Interfaces:**
- Produces `APP_PATH`, `LANDING_PATH`, and `workspacePathname(pathname)` for route-aware UI helpers.

- [ ] Write failing tests for `/app` normalization, `/app/granthub/...` normalization, and legacy path preservation.
- [ ] Run `node --experimental-strip-types --test src/appRoutes.test.ts` and confirm the expected missing-helper failure.
- [ ] Implement the pure route constants/helper and use it to make active navigation and topbar breadcrumbs understand `/app/*` while preserving legacy paths.
- [ ] Update the overview nav item and sidebar brand link to target `/app`.
- [ ] Run the route test plus existing sidebar tests and confirm they pass.

### Task 2: Landing page and route integration

**Files:**
- Create: `src/features/landing/LandingPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes the shared route constants from `src/appRoutes.ts`.
- Launch CTA links to `/app`; docs links target the existing `/help` route.

- [ ] Add the landing page component with a compact hero, feature cards, CTA buttons, and footer links using existing design tokens.
- [ ] Add a root landing route and workspace route aliases for `/app/*` alongside all existing legacy routes.
- [ ] Run TypeScript and route tests.

### Task 3: Final verification

**Files:**
- No additional files unless verification exposes a confirmed regression.

- [ ] Run the focused route/sidebar tests.
- [ ] Run `npm.cmd run typecheck`.
- [ ] Run `npm.cmd exec -- oxlint --type-aware src scripts --deny-warnings`.
- [ ] Run `npm.cmd run build`.
- [ ] Review the diff and report any existing unrelated worktree changes without modifying them.
