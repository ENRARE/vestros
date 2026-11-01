/**
 * feature-flags.ts — runtime feature gates for the GrantHub API.
 *
 * GRANTHUB_FINANCIAL_ENABLED=true   enables deposit recording and award activation.
 * Any other value (including the frontend VITE flag) returns 503 on those endpoints.
 *
 * Set in .env. Requires server restart to take effect (Bun reads env at startup).
 * Never enable on mainnet until the external security audit is complete and every
 * GrantPool is owned by a multisig.
 */

export const GRANTHUB_FINANCIAL_ENABLED =
  process.env.GRANTHUB_FINANCIAL_ENABLED === 'true'

export function financialDisabled(): Response {
  return Response.json(
    {
      error: 'GrantHub financial features are not yet enabled on this network.',
      detail: 'Set GRANTHUB_FINANCIAL_ENABLED=true in the server environment only after completing the external security audit.',
    },
    { status: 503 },
  )
}
