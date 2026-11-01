import { createPublicClient, fallback, http, parseAbi, parseAbiItem, type Address, type PublicClient } from 'viem'
import { db } from './db'
import {
  insertVestingEvents,
  readIndexerSources,
  readVestingVaults,
  replaceReorgWindow as replaceStoredReorgWindow,
  saveIndexerSource,
  saveVestingVault,
  type IndexCoverage,
  type IndexerSourceRow,
  type VestingHistoryRecord,
} from './vestingStorage'

const CHAIN_ID = 5042002
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const PRIMARY_LOG_RANGE = 2_000n
const SECONDARY_LOG_RANGE = 10n
const DEFAULT_MAX_BACKFILL_BLOCKS = 300_000n
const DEFAULT_OVERLAP_BLOCKS = 2n
const MAX_VAULTS = 100n

const SCHEDULE_CREATED_ABI = parseAbiItem(
  'event ScheduleCreated(uint256 indexed scheduleId, address indexed beneficiary, uint128 totalAmount, uint48 startTime, uint48 cliffTime, uint48 endTime)',
)
const CLAIMED_ABI = parseAbiItem(
  'event Claimed(uint256 indexed scheduleId, address indexed beneficiary, uint128 amount)',
)
const REVOKED_ABI = parseAbiItem(
  'event ScheduleRevoked(uint256 indexed scheduleId, address indexed beneficiary, uint128 unvestedReturned)',
)
const VAULT_CREATED_ABI = parseAbiItem(
  'event VaultCreated(address indexed creator, address indexed vault)',
)
const FACTORY_ABI = parseAbi([
  'function vaultCount() view returns (uint256)',
  'function vaultAt(uint256 index) view returns (address)',
])
const OWNER_ABI = parseAbi(['function owner() view returns (address)'])

const env = process.env
let activeRun: Promise<IndexerRunResult> | null = null

export interface IndexerRunResult {
  coverage: IndexCoverage
  indexedSources: number
  indexedEvents: number
  error?: string
}

interface IndexerOptions {
  database?: import('bun:sqlite').Database
  client?: PublicClient
  maxBackfillBlocks?: bigint
}

interface SourceConfig {
  chainId: number
  sourceAddress: Address
  sourceKind: 'core' | 'factory' | 'vault'
  startBlock: bigint
  ownerAddress?: Address
  createdTxHash?: string
}

interface FactoryVaultCreation {
  vault: Address
  owner: Address
  blockNumber: bigint
  txHash?: string
}

function isAddress(value: string | undefined): value is Address {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && value.toLowerCase() !== ZERO_ADDRESS
}

function addressOrUndefined(value: string | undefined): Address | undefined {
  return isAddress(value?.trim()) ? value!.trim() as Address : undefined
}

function txHashOrUndefined(value: string | undefined): string | undefined {
  return value && /^0x[0-9a-fA-F]{64}$/.test(value.trim()) ? value.trim().toLowerCase() : undefined
}

function bigintEnv(name: string, fallbackValue: bigint): bigint {
  const raw = env[name]?.trim()
  if (!raw) return fallbackValue
  try {
    const value = BigInt(raw)
    return value >= 0n ? value : fallbackValue
  } catch {
    return fallbackValue
  }
}

function optionalBigintEnv(name: string): bigint | undefined {
  const raw = env[name]?.trim()
  if (!raw) return undefined
  try {
    const value = BigInt(raw)
    return value >= 0n ? value : undefined
  } catch {
    return undefined
  }
}

function testnetValue(name: string): string | undefined {
  return env[`${name}_TESTNET`]?.trim() || env[name]?.trim() || undefined
}

function configuredClient(): PublicClient {
  const primary = env.VITE_ARC_TESTNET_RPC?.trim() || 'https://rpc.testnet.arc.io'
  const secondary = env.ARC_TESTNET_RPC_SECONDARY?.trim()
  const urls = [primary, secondary].filter((url, index, all): url is string => Boolean(url) && all.indexOf(url) === index)
  return createPublicClient({
    chain: {
      id: CHAIN_ID,
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: urls } },
    },
    transport: fallback(urls.map(url => http(url, { retryCount: 0 })), { rank: false }),
  })
}

export function historyRecordKey(record: Pick<VestingHistoryRecord, 'chainId' | 'vaultAddress' | 'txHash' | 'logIndex'>): string {
  return `${record.chainId}:${record.vaultAddress.toLowerCase()}:${record.txHash.toLowerCase()}:${record.logIndex}`
}

export function deduplicateHistoryRecords(records: readonly VestingHistoryRecord[]): VestingHistoryRecord[] {
  const seen = new Set<string>()
  return records.filter(record => {
    const key = historyRecordKey(record)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function replaceReorgWindow(
  database: import('bun:sqlite').Database,
  chainId: number,
  vaultAddress: string,
  fromBlock: string,
  records: readonly VestingHistoryRecord[],
): void {
  replaceStoredReorgWindow(database, chainId, vaultAddress, fromBlock, records)
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 240).replace(/https?:\/\/\S+/gi, '[provider]')
}

function isRateLimitError(error: unknown): boolean {
  const message = errorText(error).toLowerCase()
  return message.includes('429') || message.includes('rate limit') || message.includes('too many requests') || message.includes('-32005')
}

function isLogRangeError(error: unknown): boolean {
  const message = errorText(error).toLowerCase()
  return message.includes('requested range too large') || message.includes('range too large') || message.includes('block range')
}

function isHttp400Error(error: unknown): boolean {
  const message = errorText(error).toLowerCase()
  return message.includes('status: 400') || message.includes('status 400') || message.includes('http 400')
}

async function withRetry<T>(task: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await task() } catch (error) {
      lastError = error
      if (attempt < 2) await sleep(Math.min(8_000, 250 * 2 ** attempt))
    }
  }
  throw lastError
}

async function resolveDeploymentBlock(client: PublicClient, txHash: string | undefined): Promise<bigint | undefined> {
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return undefined
  const receipt = await withRetry(() => client.getTransactionReceipt({ hash: txHash as `0x${string}` }))
  return receipt.blockNumber
}

function parseKnownVaults(): SourceConfig[] {
  const raw = testnetValue('VESTING_INDEXER_VAULTS') ?? ''
  return raw.split(',').map(entry => entry.trim()).filter(Boolean).flatMap(entry => {
    const [addressValue, blockValue, ownerValue, txHashValue] = entry.split('@').map(value => value?.trim())
    if (!isAddress(addressValue) || !blockValue) return []
    try {
      const block = BigInt(blockValue)
      if (block < 0n) return []
      return [{
        chainId: CHAIN_ID,
        sourceAddress: addressValue,
        sourceKind: 'vault' as const,
        startBlock: block,
        ownerAddress: addressOrUndefined(ownerValue),
        createdTxHash: txHashOrUndefined(txHashValue),
      }]
    } catch { return [] }
  })
}

async function configuredSources(client: PublicClient): Promise<SourceConfig[]> {
  const sources: SourceConfig[] = []
  const coreAddress = addressOrUndefined(testnetValue('VITE_USDC_VESTING_CONTRACT'))
  const factoryAddress = addressOrUndefined(testnetValue('VITE_VESTING_FACTORY'))
  const coreStart = coreAddress
    ? optionalBigintEnv('VESTING_INDEXER_CORE_START_BLOCK_TESTNET')
      ?? await resolveDeploymentBlock(client, testnetValue('VITE_USDC_VESTING_DEPLOY_TX'))
    : undefined
  const factoryStart = factoryAddress
    ? optionalBigintEnv('VESTING_INDEXER_FACTORY_START_BLOCK_TESTNET')
      ?? await resolveDeploymentBlock(client, testnetValue('VITE_VESTING_FACTORY_DEPLOY_TX'))
    : undefined

  if (coreAddress && coreStart !== undefined) sources.push({ chainId: CHAIN_ID, sourceAddress: coreAddress, sourceKind: 'core', startBlock: coreStart })
  if (factoryAddress && factoryStart !== undefined) sources.push({ chainId: CHAIN_ID, sourceAddress: factoryAddress, sourceKind: 'factory', startBlock: factoryStart })
  sources.push(...parseKnownVaults())
  return sources
}

async function blockTimestamp(client: PublicClient, blockNumber: bigint, cache: Map<string, number>): Promise<number | undefined> {
  const key = blockNumber.toString()
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const block = await withRetry(() => client.getBlock({ blockNumber }))
  const timestamp = Number(block.timestamp)
  cache.set(key, timestamp)
  return timestamp
}

async function fetchEvents(
  client: PublicClient,
  config: SourceConfig,
  fromBlock: bigint,
  toBlock: bigint,
  timestampCache: Map<string, number>,
): Promise<VestingHistoryRecord[]> {
  const eventQueries = [
    { event: SCHEDULE_CREATED_ABI, type: 'created' as const, amountKey: 'totalAmount' as const },
    { event: CLAIMED_ABI, type: 'claimed' as const, amountKey: 'amount' as const },
    { event: REVOKED_ABI, type: 'revoked' as const, amountKey: 'unvestedReturned' as const },
  ]
  const records: VestingHistoryRecord[] = []
  for (const query of eventQueries) {
    const logs = await withRetry(() => client.getLogs({ address: config.sourceAddress, event: query.event, fromBlock, toBlock } as never))
    for (const log of logs) {
      const args = log.args as unknown as Record<string, unknown>
      const amount = args[query.amountKey]
      const scheduleId = args.scheduleId
      const beneficiary = args.beneficiary
      if (typeof amount !== 'bigint' || typeof scheduleId !== 'bigint' || typeof beneficiary !== 'string') continue
      const blockNumber = log.blockNumber ?? fromBlock
      records.push({
        chainId: CHAIN_ID,
        vaultAddress: config.sourceAddress,
        vaultOwner: config.ownerAddress,
        scheduleId: scheduleId.toString(),
        type: query.type,
        beneficiary: beneficiary.toLowerCase(),
        amount: amount.toString(),
        blockNumber: blockNumber.toString(),
        blockHash: log.blockHash,
        blockTimestamp: await blockTimestamp(client, blockNumber, timestampCache),
        txHash: log.transactionHash ?? '',
        logIndex: Number(log.logIndex ?? 0),
        status: 'confirmed',
      })
    }
  }
  return deduplicateHistoryRecords(records)
}

async function fetchFactoryVaultCreations(
  client: PublicClient,
  factory: SourceConfig,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<FactoryVaultCreation[]> {
  const logs = await withRetry(() => client.getLogs({
    address: factory.sourceAddress,
    event: VAULT_CREATED_ABI,
    fromBlock,
    toBlock,
  } as never))
  return logs.flatMap(log => {
    const args = log.args as unknown as Record<string, unknown>
    const vault = args.vault
    const creator = args.creator
    if (typeof vault !== 'string' || !isAddress(vault) || typeof creator !== 'string' || !isAddress(creator)) return []
    return [{
      vault: vault as Address,
      owner: creator as Address,
      blockNumber: log.blockNumber ?? fromBlock,
      txHash: log.transactionHash,
    }]
  })
}

function sourceRow(config: SourceConfig, overrides: Partial<IndexerSourceRow> = {}): IndexerSourceRow {
  return {
    chainId: config.chainId,
    sourceAddress: config.sourceAddress,
    sourceKind: config.sourceKind,
    startBlock: config.startBlock.toString(),
    nextBlock: config.startBlock.toString(),
    headBlock: '0',
    status: 'pending',
    error: null,
    ...overrides,
  }
}

async function indexEventSource(
  database: import('bun:sqlite').Database,
  client: PublicClient,
  config: SourceConfig,
  head: bigint,
  maxBackfillBlocks: bigint,
  timestampCache: Map<string, number>,
): Promise<number> {
  const existing = readIndexerSources(database).find(source => source.chainId === config.chainId && source.sourceAddress === config.sourceAddress.toLowerCase() && source.sourceKind === config.sourceKind)
  const nextBlock = existing ? BigInt(existing.nextBlock) : config.startBlock
  const overlap = existing ? bigintEnv('VESTING_INDEXER_OVERLAP_BLOCKS', DEFAULT_OVERLAP_BLOCKS) : 0n
  const fromBlock = existing ? (nextBlock > overlap ? nextBlock - overlap : config.startBlock) : config.startBlock
  if (fromBlock > head) {
    saveIndexerSource(database, sourceRow(config, { nextBlock: head.toString(), headBlock: head.toString(), status: 'complete' }))
    return 0
  }
  if (head - fromBlock > maxBackfillBlocks) {
    saveIndexerSource(database, sourceRow(config, { nextBlock: fromBlock.toString(), headBlock: head.toString(), status: 'partial', error: `Backfill exceeds configured limit of ${maxBackfillBlocks} blocks` }))
    return 0
  }

  saveIndexerSource(database, sourceRow(config, { nextBlock: fromBlock.toString(), headBlock: head.toString(), status: 'running' }))
  let current = fromBlock
  let chunkSize = PRIMARY_LOG_RANGE
  let firstBatch = existing !== undefined
  let rateLimitAttempts = 0
  let count = 0
  while (current <= head) {
    const end = current + chunkSize - 1n < head ? current + chunkSize - 1n : head
    let records: VestingHistoryRecord[]
    try {
      records = await fetchEvents(client, config, current, end, timestampCache)
    } catch (error) {
      if (isRateLimitError(error)) {
        if (rateLimitAttempts >= 2) throw error
        rateLimitAttempts++
        await sleep(Math.min(8_000, 1_000 * 2 ** rateLimitAttempts))
        continue
      }
      if ((isLogRangeError(error) || isHttp400Error(error)) && chunkSize > SECONDARY_LOG_RANGE) {
        rateLimitAttempts = 0
        chunkSize = chunkSize > SECONDARY_LOG_RANGE * 2n ? chunkSize / 2n : SECONDARY_LOG_RANGE
        await sleep(250)
        continue
      }
      throw error
    }
    if (firstBatch && existing) replaceStoredReorgWindow(database, CHAIN_ID, config.sourceAddress, current.toString(), records)
    else insertVestingEvents(database, records)
    firstBatch = false
    rateLimitAttempts = 0
    count += records.length
    current = end + 1n
    if (chunkSize < PRIMARY_LOG_RANGE) chunkSize = chunkSize * 2n > PRIMARY_LOG_RANGE ? PRIMARY_LOG_RANGE : chunkSize * 2n
    saveIndexerSource(database, sourceRow(config, { nextBlock: current.toString(), headBlock: head.toString(), status: 'running' }))
  }
  saveIndexerSource(database, sourceRow(config, { nextBlock: current.toString(), headBlock: head.toString(), status: 'complete' }))
  return count
}

async function indexFactoryCreationSource(
  database: import('bun:sqlite').Database,
  client: PublicClient,
  config: SourceConfig,
  head: bigint,
  maxBackfillBlocks: bigint,
): Promise<FactoryVaultCreation[]> {
  const existing = readIndexerSources(database).find(source => source.chainId === config.chainId && source.sourceAddress === config.sourceAddress.toLowerCase() && source.sourceKind === 'factory')
  const nextBlock = existing ? BigInt(existing.nextBlock) : config.startBlock
  const overlap = existing ? bigintEnv('VESTING_INDEXER_OVERLAP_BLOCKS', DEFAULT_OVERLAP_BLOCKS) : 0n
  const fromBlock = existing ? (nextBlock > overlap ? nextBlock - overlap : config.startBlock) : config.startBlock
  if (fromBlock > head) {
    saveIndexerSource(database, sourceRow(config, { nextBlock: head.toString(), headBlock: head.toString(), status: 'complete' }))
    return []
  }
  if (head - fromBlock > maxBackfillBlocks) {
    saveIndexerSource(database, sourceRow(config, {
      nextBlock: fromBlock.toString(),
      headBlock: head.toString(),
      status: 'partial',
      error: `Factory backfill exceeds configured limit of ${maxBackfillBlocks} blocks`,
    }))
    return []
  }

  saveIndexerSource(database, sourceRow(config, { nextBlock: fromBlock.toString(), headBlock: head.toString(), status: 'running' }))
  let current = fromBlock
  let chunkSize = PRIMARY_LOG_RANGE
  let rateLimitAttempts = 0
  const creations: FactoryVaultCreation[] = []
  while (current <= head) {
    const end = current + chunkSize - 1n < head ? current + chunkSize - 1n : head
    try {
      creations.push(...await fetchFactoryVaultCreations(client, config, current, end))
    } catch (error) {
      if (isRateLimitError(error)) {
        if (rateLimitAttempts >= 2) throw error
        rateLimitAttempts++
        await sleep(Math.min(8_000, 1_000 * 2 ** rateLimitAttempts))
        continue
      }
      if ((isLogRangeError(error) || isHttp400Error(error)) && chunkSize > SECONDARY_LOG_RANGE) {
        rateLimitAttempts = 0
        chunkSize = chunkSize > SECONDARY_LOG_RANGE * 2n ? chunkSize / 2n : SECONDARY_LOG_RANGE
        await sleep(250)
        continue
      }
      throw error
    }
    rateLimitAttempts = 0
    current = end + 1n
    if (chunkSize < PRIMARY_LOG_RANGE) chunkSize = chunkSize * 2n > PRIMARY_LOG_RANGE ? PRIMARY_LOG_RANGE : chunkSize * 2n
    saveIndexerSource(database, sourceRow(config, { nextBlock: current.toString(), headBlock: head.toString(), status: 'running' }))
  }
  saveIndexerSource(database, sourceRow(config, { nextBlock: current.toString(), headBlock: head.toString(), status: 'complete' }))
  const unique = new Map<string, FactoryVaultCreation>()
  for (const creation of creations) unique.set(creation.vault.toLowerCase(), creation)
  return [...unique.values()]
}

async function discoverFactoryVaults(
  database: import('bun:sqlite').Database,
  client: PublicClient,
  factory: SourceConfig,
  head: bigint,
  factoryCreations: readonly FactoryVaultCreation[],
): Promise<SourceConfig[]> {
  const count = await withRetry(() => client.readContract({ address: factory.sourceAddress, abi: FACTORY_ABI, functionName: 'vaultCount' })) as bigint
  const known = parseKnownVaults()
  const byAddress = new Map(known.map(config => [config.sourceAddress.toLowerCase(), config]))
  const persisted = new Map(readVestingVaults(database, CHAIN_ID).map(vault => [vault.vaultAddress.toLowerCase(), vault]))
  const createdByAddress = new Map(factoryCreations.map(creation => [creation.vault.toLowerCase(), creation]))
  const boundedCount = count > MAX_VAULTS ? MAX_VAULTS : count
  for (let index = 0n; index < boundedCount; index++) {
    const vault = await withRetry(() => client.readContract({ address: factory.sourceAddress, abi: FACTORY_ABI, functionName: 'vaultAt', args: [index] })) as Address
    const owner = await withRetry(() => client.readContract({ address: vault, abi: OWNER_ABI, functionName: 'owner' })) as Address
    const key = vault.toLowerCase()
    const existing = byAddress.get(key)
    const stored = persisted.get(key)
    const factoryCreation = createdByAddress.get(key)
    const startBlock = existing?.startBlock
      ?? (factoryCreation?.blockNumber ?? (stored && stored.createdBlock !== '0' ? BigInt(stored.createdBlock) : head + 1n))
    const config: SourceConfig = existing ?? { chainId: CHAIN_ID, sourceAddress: vault, sourceKind: 'vault', startBlock, ownerAddress: owner }
    config.ownerAddress = owner
    byAddress.set(key, config)
    saveVestingVault(database, {
      chainId: CHAIN_ID,
      vaultAddress: vault,
      ownerAddress: owner,
      createdBlock: factoryCreation?.blockNumber.toString() ?? existing?.startBlock.toString() ?? (stored?.createdBlock && stored.createdBlock !== '0' ? stored.createdBlock : '0'),
      createdTxHash: factoryCreation?.txHash ?? existing?.createdTxHash ?? stored?.createdTxHash,
    })
  }
  return [...byAddress.values()]
}

export async function runVestingIndexerOnce(options: IndexerOptions = {}): Promise<IndexerRunResult> {
  if (activeRun) return activeRun
  activeRun = runIndexer(options).finally(() => { activeRun = null })
  return activeRun
}

async function runIndexer(options: IndexerOptions): Promise<IndexerRunResult> {
  const database = options.database ?? db
  const client = options.client ?? configuredClient()
  const maxBackfillBlocks = options.maxBackfillBlocks ?? bigintEnv('VESTING_INDEXER_MAX_BACKFILL_BLOCKS', DEFAULT_MAX_BACKFILL_BLOCKS)
  try {
    const chainId = await withRetry(() => client.getChainId())
    if (chainId !== CHAIN_ID) throw new Error(`Indexer RPC returned chain ${chainId}; expected ${CHAIN_ID}`)
    const head = await withRetry(() => client.getBlockNumber())
    const configured = await configuredSources(client)
    const factory = configured.find(source => source.sourceKind === 'factory')
    let factoryCreations: FactoryVaultCreation[] = []
    if (factory) {
      try {
        factoryCreations = await indexFactoryCreationSource(database, client, factory, head, maxBackfillBlocks)
      } catch (error) {
        const checkpoint = readIndexerSources(database).find(row =>
          row.chainId === factory.chainId &&
          row.sourceAddress === factory.sourceAddress.toLowerCase() &&
          row.sourceKind === 'factory',
        )
        saveIndexerSource(database, sourceRow(factory, {
          nextBlock: checkpoint?.nextBlock ?? factory.startBlock.toString(),
          headBlock: head.toString(),
          status: 'unavailable',
          error: errorText(error),
        }))
      }
    }
    const discovered = factory ? await discoverFactoryVaults(database, client, factory, head, factoryCreations) : []
    const sources = [...configured.filter(source => source.sourceKind !== 'factory'), ...discovered]
    const unique = new Map(sources.map(source => [`${source.sourceKind}:${source.sourceAddress.toLowerCase()}`, source]))
    let indexedEvents = 0
    for (const source of unique.values()) {
      if (source.sourceKind === 'vault' && source.startBlock > head) {
        saveIndexerSource(database, sourceRow(source, { nextBlock: source.startBlock.toString(), headBlock: head.toString(), status: 'partial', error: 'Vault discovered without a configured historical start block' }))
        continue
      }
      try {
        indexedEvents += await indexEventSource(database, client, source, head, maxBackfillBlocks, new Map())
      } catch (error) {
        const checkpoint = readIndexerSources(database).find(row =>
          row.chainId === source.chainId &&
          row.sourceAddress === source.sourceAddress.toLowerCase() &&
          row.sourceKind === source.sourceKind,
        )
        saveIndexerSource(database, sourceRow(source, {
          nextBlock: checkpoint?.nextBlock ?? source.startBlock.toString(),
          headBlock: head.toString(),
          status: 'unavailable',
          error: errorText(error),
        }))
      }
    }
    const sourceRows = readIndexerSources(database)
    const coverage: IndexCoverage = sourceRows.length === 0
      ? 'unavailable'
      : sourceRows.some(source => source.status === 'unavailable') && sourceRows.some(source => source.status === 'complete')
        ? 'partial'
        : sourceRows.some(source => source.status !== 'complete') ? 'partial' : 'complete'
    return { coverage, indexedSources: sourceRows.length, indexedEvents }
  } catch (error) {
    return { coverage: 'unavailable', indexedSources: 0, indexedEvents: 0, error: errorText(error) }
  }
}
