// Shared display helpers
import { Amount, usdcDecimalsFor } from '@/onchain-money'
import { arcTestnet } from 'viem/chains'

const USDC_DECIMALS = usdcDecimalsFor(arcTestnet.id)

export function fmtUsdc(raw: bigint | undefined, places = 2): string {
  if (raw === undefined) return '—'
  return Amount.fromRaw(raw, USDC_DECIMALS).toFixed(places)
}

export function fmtUsdcShort(raw: bigint): string {
  const n = Number(raw) / 10 ** USDC_DECIMALS
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`
  return n.toFixed(2)
}

export function fmtDate(ts: number): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function fmtDateShort(ts: number): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  })
}

export function fmtAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function fmtAddrFull(addr: string): string {
  return addr
}

/** Format bigint USDC as a plain decimal string for CSV export */
export function fmtUsdcCsv(raw: bigint): string {
  return Amount.fromRaw(raw, USDC_DECIMALS).toFixed(6)
}

export function fmtTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}
