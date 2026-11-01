import { getChain } from './onchain-facts.ts'

const ARC_TESTNET_ID = 5042002
const ARC_MAINNET_ID = 5042
const ARC_TESTNET_PRIMARY = 'https://rpc.testnet.arc.io'
const ARC_MAINNET_PRIMARY = 'https://rpc.mainnet.arc.io'

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export interface ArcRpcEnv {
  VITE_ARC_TESTNET_RPC?: string
  VITE_ARC_TESTNET_RPC_FALLBACK?: string
  /** Legacy server/provider variable accepted for typing only; never used in the browser. */
  VITE_ARC_TESTNET_RPC_SECONDARY?: string
  VITE_ARC_MAINNET_RPC?: string
  VITE_ARC_MAINNET_RPC_FALLBACK?: string
  /** Legacy server/provider variable accepted for typing only; never used in the browser. */
  VITE_ARC_MAINNET_RPC_SECONDARY?: string
}

const runtimeEnv: ArcRpcEnv = {
  VITE_ARC_TESTNET_RPC: optionalString(import.meta.env?.VITE_ARC_TESTNET_RPC),
  VITE_ARC_TESTNET_RPC_FALLBACK: optionalString(import.meta.env?.VITE_ARC_TESTNET_RPC_FALLBACK),
  VITE_ARC_MAINNET_RPC: optionalString(import.meta.env?.VITE_ARC_MAINNET_RPC),
  VITE_ARC_MAINNET_RPC_FALLBACK: optionalString(import.meta.env?.VITE_ARC_MAINNET_RPC_FALLBACK),
}

function validPublicHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.search === '' && url.hash === ''
  } catch {
    return false
  }
}

function configuredUrls(chainId: number, env: ArcRpcEnv): string[] {
  if (chainId === ARC_TESTNET_ID) {
    const primary = env.VITE_ARC_TESTNET_RPC?.trim() || ARC_TESTNET_PRIMARY
    return [primary, env.VITE_ARC_TESTNET_RPC_FALLBACK]
      .filter(validPublicHttpUrl)
      .map(url => url.trim())
  }
  if (chainId === ARC_MAINNET_ID) {
    const primary = env.VITE_ARC_MAINNET_RPC?.trim() || ARC_MAINNET_PRIMARY
    return [primary, env.VITE_ARC_MAINNET_RPC_FALLBACK]
      .filter(validPublicHttpUrl)
      .map(url => url.trim())
  }
  return []
}

/**
 * Resolves only public endpoints for the requested Arc network. Authenticated
 * provider URLs, query-string API keys, and the server proxy are excluded.
 * Mainnet never inherits Testnet configuration.
 */
export function resolveArcRpcUrls(chainId: number, env: ArcRpcEnv = runtimeEnv): string[] {
  const configured = configuredUrls(chainId, env)
  const defaults = getChain(chainId)?.rpcUrls ?? []
  const urls = configured.length > 0 ? configured : defaults
  return Array.from(new Set(urls.filter(validPublicHttpUrl)))
}
