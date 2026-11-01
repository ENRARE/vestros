import { defineChain } from 'viem'
import { getChain } from './onchain-facts'
import { ARC_MAINNET_ID, ARC_TESTNET_ID, CHAIN_ENV } from './networkConfig'
import { resolveArcRpcUrls } from './arcRpcConfig'

function arcChain(chainId: number) {
  const fact = getChain(chainId)
  if (!fact) throw new Error(`Missing Arc chain facts for ${chainId}`)
  const rpcUrls = resolveArcRpcUrls(chainId)
  if (rpcUrls.length === 0) throw new Error(`No RPC endpoint configured for Arc chain ${chainId}`)

  return defineChain({
    id: fact.chainId,
    name: fact.name,
    nativeCurrency: {
      name: fact.nativeCurrency.symbol,
      symbol: fact.nativeCurrency.symbol,
      decimals: fact.nativeCurrency.decimals,
    },
    rpcUrls: { default: { http: rpcUrls } },
    blockExplorers: {
      default: { name: 'Arc Explorer', url: fact.explorerBase },
    },
    testnet: fact.isTestnet,
  })
}

export const arcTestnet = arcChain(ARC_TESTNET_ID)
export const arcMainnet = arcChain(ARC_MAINNET_ID)
export const ACTIVE_ARC_CHAIN = CHAIN_ENV === 'mainnet' ? arcMainnet : arcTestnet
