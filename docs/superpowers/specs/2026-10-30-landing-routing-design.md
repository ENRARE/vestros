# Landing Page and Workspace Routing Design

## Intent

Make Vestros publicly enter through a focused single-viewport landing page while keeping the existing workspace, wallet providers, GrantHub, and legacy URLs intact.

## Approved approach

Use `/` for the landing page and `/app` as the workspace entry. Existing workspace paths such as `/vesting`, `/treasury`, `/analytics`, `/settings`, `/help`, and `/granthub/*` remain valid. The workspace route table also accepts `/app/*` aliases so direct links and refreshes work from the explicit app namespace.

## Alternatives considered

- **Router basename migration:** rejected because it would require rewriting the existing absolute links and could break legacy GrantHub URLs.
- **Redirect `/app/*` to legacy paths:** rejected because the approved strategy calls for an explicit `/app/*` workspace entry and direct refresh support.
- **Duplicate route aliases around the existing AppShell:** selected because it is additive, low-risk, and leaves existing route components and providers unchanged.

## Scope and constraints

- Add one landing component using existing design tokens, fonts, Lucide icons, and React Router links.
- Keep the landing page within one viewport, with a concise hero, feature panels, CTA actions, and integrated footer.
- Keep all wallet, contract, backend, and financial behavior unchanged.
- Update workspace-only home links and navigation targets from `/` to `/app` so they do not send users back to the public landing page.
- Add pure route-normalization coverage for `/app/*` aliases and legacy paths.

## Success criteria

- `/` renders only the landing page.
- Launch App reaches `/app` and renders the existing workspace overview.
- `/app/*` and legacy workspace/GrantHub paths render the existing app shell and page components.
- Refreshing `/app`, `/vesting`, and `/granthub` preserves the intended screen.
- TypeScript, lint, route tests, and production build pass.
