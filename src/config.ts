/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { createConfig } from 'wagmi'
import { mainnet } from 'viem/chains'
import { fallback, http } from 'viem'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { ACTIVE_ARC_CHAIN } from './arcChains'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(ACTIVE_ARC_CHAIN.id, ACTIVE_ARC_CHAIN.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [ACTIVE_ARC_CHAIN, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [ACTIVE_ARC_CHAIN.id]: fallback(
      ACTIVE_ARC_CHAIN.rpcUrls.default.http.map(url => http(url, { retryCount: 0 })),
      { rank: false },
    ),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
