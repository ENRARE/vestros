# GrantHub Complete Functional Implementation Plan

## Scope

1. Make wallet authentication shared and session-aware across GrantHub routes; validate opaque server sessions and clear state on expiry or account changes.
2. Remove the global funding notice while retaining a concise notice on funding and award-activation surfaces.
3. Extend the existing non-destructive SQLite schema and API validation for complete grant and application records.
4. Enforce organization permissions and the review workflow server-side, including reviewer versus admin approval authority.
5. Add functional frontend controls for grant editing, rich applications, review criteria, pending awards, and draft continuation.
6. Run migrations and the repository verification commands without deploying contracts, changing financial flags, or resetting data.

## Verification

- Bun unit/backend tests, including regression coverage for session, duplicate application, status, and permission rules.
- TypeScript, lint, and production build.
- Forge tests when the local Foundry toolchain is available.
- Inspect the existing database schema/version after migration and preserve record counts.

## Constraints

- Do not change Solidity contracts or perform onchain transactions.
- Keep financial operations disabled by default.
- Preserve existing routes, UI conventions, records, and unrelated working changes.
