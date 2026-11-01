# Premium Product UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply a consistent sharp dark-blue financial-product design system across the existing Vestros shell, primitives, and page markup without changing functionality.

**Architecture:** Token-first CSS and Tailwind configuration provide the palette, fonts, radii, control density, and legacy utility normalization. Shared primitives and the shell receive explicit blue/compact styling, while feature pages continue to use their existing data and route logic.

**Tech Stack:** React, TypeScript, Tailwind CSS, CSS variables, lucide-react, wagmi, ConnectKit.

**Spec:** `docs/superpowers/specs/2026-10-30-premium-product-redesign-design.md`

## Global Constraints

- Preserve all existing routes, wallet connections, business logic, financial calculations, permissions, and blockchain integrations.
- Do not modify smart contracts, backend financial logic, deployment configuration, or data sources.
- Use only Plus Jakarta Sans, Manrope, and JetBrains Mono; no new dependency.
- Use 4px controls/navigation/tables, 6px cards/modals, 5px dropdowns/tooltips, and circular avatars/progress indicators only where semantically circular.
- Keep buttons on one line and keep green/red for meaningful success/error states.

## Review Focus

- Blue accent replacement must not turn success/error states blue or green/red states into decoration.
- Legacy `rounded-*` classes must sharpen by element role without flattening progress bars or avatars.
- Wallet controls must preserve ConnectKit/wagmi behavior and fit narrow widths without wrapping.
- Sidebar active route behavior must remain single-item and query-aware.
- Mobile/tablet layout must not introduce horizontal overflow or clipped dropdowns.

### Task 1: Token and typography system

**Files:** `index.html`, `tailwind.config.js`, `src/index.css`

- [ ] Update fonts, colors, radii, focus, control, table, dropdown, and no-wrap tokens.
- [ ] Add legacy Tailwind radius compatibility rules scoped by element type.

### Task 2: Shared primitives and shell

**Files:** `src/components/ui/Primitives.tsx`, `src/components/ui/DesignSystem.tsx`, `src/components/layout/Topbar.tsx`, `src/components/layout/Sidebar.tsx`

- [ ] Tighten shared cards, metric tiles, badges, inputs, buttons, tooltips, and section headers.
- [ ] Polish topbar network/wallet controls while retaining existing wallet actions.
- [ ] Apply the blue/sidebar tokens without changing navigation routes or permissions.

### Task 3: Verification

- [ ] Run Bun/Node tests, TypeScript, frontend/backend lint, production build, and route smoke checks.
- [ ] Inspect changed selectors for wrapping, radius, teal leftovers, and active-dot remnants.
