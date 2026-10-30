/**
 * useChainTime — returns the current blockchain timestamp (seconds), refreshed
 * every 30 seconds by polling the latest block. Falls back to Date.now() while
 * the first block is loading.
 *
 * Derives chainTs from wagmi's block data during render rather than setting
 * it inside a useEffect, which avoids the set-state-in-effect lint error.
 */
import { useBlockNumber, useBlock } from 'wagmi'
import { CHAIN_ID } from '@/contractConfig'

/** Fallback: wall-clock seconds */
function wallNow(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Returns the chain's current block timestamp in seconds.
 * Refreshed every 30 s. While the first block is fetching, returns wall-clock time.
 */
export function useChainTime(): number {
  // Poll block number every 30 s
  const { data: blockNumber } = useBlockNumber({
    chainId: CHAIN_ID,
    watch: true,
    query: { refetchInterval: 30_000 },
  })

  // Fetch the block to get its timestamp
  const { data: block } = useBlock({
    chainId: CHAIN_ID,
    blockNumber,
    query: { enabled: blockNumber !== undefined },
  })

  // Derive during render — no useEffect needed, no cascading render
  if (block?.timestamp !== undefined) {
    return Number(block.timestamp)
  }
  return wallNow()
}
