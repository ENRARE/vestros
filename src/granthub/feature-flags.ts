/**
 * GrantHub feature flags — read from Vite env at build/runtime.
 *
 * VITE_GRANTHUB_FINANCIAL=true   enables the financial UI when it exists.
 * VITE_GRANTHUB_FINANCIAL=false  (default) keeps financial actions unavailable
 *                                  and shows an informational banner instead.
 *
 * Change this in .env and restart the dev server (env vars are read at startup).
 */

export const GRANTHUB_FINANCIAL_ENABLED =
  import.meta.env.VITE_GRANTHUB_FINANCIAL === 'true'

/** The chain environment: 'testnet' (default) or 'mainnet'. */
export { CHAIN_ENV } from '../networkConfig'
