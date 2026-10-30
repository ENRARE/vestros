/**
 * feature-flags.ts — runtime feature gates for the GrantHub API.
 *
 * VITE_GRANTHUB_FINANCIAL=true   enables deposit recording and award activation.
 * VITE_GRANTHUB_FINANCIAL=false  (default) returns 503 on those endpoints.
 *
 * Set in .env. Requires server restart to take effect (Bun reads env at startup).
 * Never enable on mainnet until the external security audit is complete and every
 * GrantPool is owned by a multisig.
 */

export const GRANTHUB_FINANCIAL_ENABLED =
  process.env.VITE_GRANTHUB_FINANCIAL === 'true'

export function financialDisabled(): Response {
  return Response.json(
    {
      error: 'GrantHub financial features are not yet enabled on this network.',
      detail: 'Set VITE_GRANTHUB_FINANCIAL=true in .env after completing the external security audit.',
    },
    { status: 503 },
  )
}
