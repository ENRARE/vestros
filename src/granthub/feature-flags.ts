/**
 * GrantHub feature flags — read from Vite env at build/runtime.
 *
 * VITE_GRANTHUB_FINANCIAL=true   shows deposit and award-activation UI.
 * VITE_GRANTHUB_FINANCIAL=false  (default) hides those controls and shows
 *                                  an informational banner instead.
 *
 * Change this in .env and restart the dev server (env vars are read at startup).
 */

export const GRANTHUB_FINANCIAL_ENABLED =
  import.meta.env.VITE_GRANTHUB_FINANCIAL === 'true'

/** The chain environment: 'testnet' (default) or 'mainnet'. */
export const CHAIN_ENV: 'testnet' | 'mainnet' =
  import.meta.env.VITE_CHAIN_ENV === 'mainnet' ? 'mainnet' : 'testnet'
