# Avatar, Settings, and Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a wallet-scoped shared avatar system and redesign Settings and Help & Documentation without changing wallet, auth, contract, or financial behavior.

**Architecture:** Store only the selected avatar ID in a React context backed by wallet-scoped localStorage. Render five SVG avatar variants through one reusable component. Split local wallet preferences from authenticated GrantHub profile editing in Settings, and organize Help around verified project documentation with reusable section/callout patterns.

**Tech Stack:** React 18, TypeScript, wagmi, React Router, Lucide, existing CSS variables and utility classes, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-30-avatar-settings-help-design.md`

## Global Constraints

- Keep the premium dark-blue styling, small radii, Plus Jakarta Sans headings, and Manrope body text.
- Persist the selected avatar locally for now and isolate it by wallet address.
- Preserve existing wallet connections, GrantHub authentication, profile APIs, routes, and backend permissions.
- Do not modify smart contracts, financial calculations, or deployment behavior.
- Do not commit or push automatically.

## Review Focus

- Wallet address changes must switch avatar storage keys and never leak the previous wallet's selection.
- Invalid or unavailable localStorage values must fall back to a valid default avatar.
- Settings without a GrantHub session must still expose local avatar and wallet controls while gating server profile writes.
- Avatar selection must update all mounted account surfaces in the same tab.
- Readiness documentation must distinguish ready, conditional, disabled-by-default, and outstanding work without inventing deployment facts.

### Task 1: Shared avatar preferences

**Files:**
- Create: `src/features/profile/avatar.ts`
- Create: `src/features/profile/avatar.test.ts`
- Create: `src/features/profile/ProfilePreferences.tsx`
- Create: `src/components/profile/ProfileAvatar.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- `AVATAR_PRESETS`, `DEFAULT_AVATAR_ID`, `avatarStorageKey(address)`, and `isAvatarPresetId(value)` from `avatar.ts`.
- `useProfilePreferences()` returns `{ avatarId, setAvatarId }`.
- `ProfileAvatar` accepts `{ avatarId, size?, className? }`.

- [ ] Write failing tests for five unique presets, normalized wallet-scoped keys, and invalid-ID fallback validation.
- [ ] Run the focused avatar test and observe the missing-module failure.
- [ ] Implement the preset registry, storage-key helper, context/provider, and SVG avatar component.
- [ ] Wrap the application with `ProfilePreferencesProvider` under `WagmiProvider`.
- [ ] Run the avatar test and verify it passes.

### Task 2: Account surfaces and Settings

**Files:**
- Modify: `src/components/layout/Topbar.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/features/workspace/AccountPages.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes `useProfilePreferences`, `ProfileAvatar`, and `AVATAR_PRESETS` from Task 1.

- [ ] Replace topbar hex badges and sidebar wallet badges with the shared avatar component.
- [ ] Add an accessible avatar picker and wallet/profile settings layout.
- [ ] Keep server-backed profile fields behind existing GrantHub session/auth behavior.
- [ ] Add focused styling for settings cards, avatar choices, metadata rows, and responsive layout.
- [ ] Run avatar/sidebar tests and TypeScript.

### Task 3: Help & Documentation hub

**Files:**
- Modify: `src/features/workspace/AccountPages.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Reuses existing route links, `ACTIVE_ARC_CHAIN`, `CHAIN_ENV`, contract config, and GrantHub financial flag.

- [ ] Replace the plain Help cards with structured overview, build inventory, mainnet readiness, vesting, GrantHub, restrictions, and quick-link sections.
- [ ] Use only verified facts from `docs/mainnet-readiness.md`, `docs/go-no-go.md`, and `docs/granthub-testnet-rehearsal.md`.
- [ ] Add responsive documentation navigation and meaningful status callouts.
- [ ] Run the full relevant tests, lint, and production build.
