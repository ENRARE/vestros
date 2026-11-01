# Premium Product UI Redesign

## Intent

Give the existing Vestros application a coherent premium financial-operations visual system using the supplied references: near-black canvas, charcoal surfaces, restrained blue accent, Plus Jakarta Sans headings, Manrope UI text, compact layouts, and sharp radii.

## Goals

- Replace the teal/green-heavy base palette with the specified dark-blue token system.
- Centralize typography, radii, surfaces, borders, focus states, button density, and form controls.
- Preserve all routes, wallet/blockchain behavior, financial calculations, permissions, and existing content sources.
- Refine the existing sidebar and topbar wallet control without changing navigation semantics.
- Make legacy Tailwind utility usage visually consistent through scoped global compatibility rules rather than a broad component rewrite.

## Non-goals

- No smart-contract, backend, financial-calculation, deployment, or route changes.
- No new data, mock metrics, dependencies, or page-specific feature work.
- No replacement of existing charts, forms, tables, or wallet integrations.

## Design system

- Canvas `#0B0D10`, sidebar `#101113`, cards `#17191D`, elevated surfaces `#1E2025`, borders `#282B30`.
- Primary text `#F5F5F5`, secondary text `#91959D`, accent `#2389E8`.
- Headings Plus Jakarta Sans; body/UI Manrope; existing JetBrains Mono remains for addresses and raw values.
- Buttons/inputs/navigation/tables use 4px radius; cards 6px; dropdowns/tooltips 5px; modals 6px; circular avatars/progress indicators stay circular.
- Buttons are compact and `white-space: nowrap`; green/red remain semantic-only.

## Approach

Update `index.css`, `tailwind.config.js`, and `index.html` as the token layer; update `Primitives.tsx` and `DesignSystem.tsx` as the shared component layer; update `Topbar.tsx` and the existing `Sidebar.tsx` wallet control as the shell layer. Use CSS selectors keyed to element type plus existing Tailwind radius classes to normalize legacy page markup while preserving behavior and route/page code.

## Acceptance criteria

All current routes and features remain present; only blue accents appear for normal actions/active navigation; no active navigation dots or duplicated route highlights; buttons do not wrap; forms/cards/dropdowns use the specified compact radii; typecheck, lint, tests, and production build pass.
