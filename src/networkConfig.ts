export type ChainEnvironment = 'testnet' | 'mainnet'

export const ARC_TESTNET_ID = 5042002
export const ARC_MAINNET_ID = 5042

export const CHAIN_ENV: ChainEnvironment =
  import.meta.env.VITE_CHAIN_ENV === 'mainnet' ? 'mainnet' : 'testnet'

export const ACTIVE_CHAIN_ID = CHAIN_ENV === 'mainnet' ? ARC_MAINNET_ID : ARC_TESTNET_ID
