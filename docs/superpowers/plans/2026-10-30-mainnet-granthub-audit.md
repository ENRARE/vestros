# Vestros mainnet and GrantHub audit implementation plan

## Intent

Complete the unfinished Arc mainnet preparation and GrantHub safety work found by auditing the repository. Preserve the existing React/sidebar UI, avoid deployments and financial transactions, and keep existing SQLite records intact.

## Scope

- Add one active Arc chain configuration for testnet or mainnet, with explicit USDC/vesting address and explorer selection.
- Keep GrantHub financial server and UI behavior disabled unless the existing explicit feature flag is enabled; cover every funding-state mutation.
- Make GrantHub application and award payloads match the persisted schema and raw USDC units.
- Strengthen award-activation verification around the configured GrantVesting integration without changing deployed contracts.
- Make deployment scripts compile and support Foundry external signers without a mainnet `PRIVATE_KEY`.
- Make SQLite migration and generated-file Git hygiene safe and document the resulting operational state.

## Approaches

1. Keep separate testnet/mainnet files: rejected because duplicated addresses and explorer logic would drift.
2. Use a single active-chain registry plus environment-selected addresses: chosen because the repository already has `onchain-facts.ts`, both Arc chain facts, and dynamic explorer helpers.
3. Block all GrantHub routes until audit completion: rejected because the requested product scope allows discovery, organizations, applications, and reviews to remain live.

## Tasks and checks

1. Add active-chain and contract configuration, update event indexing/formatters/UI labels/links, and document `.env.example` values. Check with typecheck/build.
2. Add failing server/UI gate and workflow checks, then implement default-off confirmation authorization, global disabled banner, and raw-amount field alignment. Check with focused Node tests plus typecheck/build.
3. Fix deployment-script compilation/signing path, update IVesting to the real GrantVesting ABI, and repair migration idempotence/data preservation. Check with Forge build/test and migration test.
4. Remove tracked SQLite WAL/SHM and generated broadcast artifacts from the index while preserving local files; update ignore rules and deployment docs. Check with `git ls-files` and diff inspection.
5. Run the complete available verification set and report any environment-blocked commands separately; do not claim unavailable checks passed.

## Non-goals

No contract deployment, transaction submission, database deletion, history rewrite, visual redesign, or automatic commit/push.
