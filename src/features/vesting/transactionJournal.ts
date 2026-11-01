import {
  decodeEventLog,
  isAddress,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'

export type JournalEventType = 'created' | 'claimed' | 'revoked'

export interface ReceiptLogLike {
  address: string
  data: Hex
  topics: readonly Hex[]
  logIndex?: number | bigint
}

export interface ReceiptLike {
  status: 'success' | 'reverted'
  to?: string | null
  transactionHash: Hex
  blockNumber?: bigint
  blockHash?: Hex
  logs: readonly ReceiptLogLike[]
}

export interface ReceiptJournalContext {
  chainId: number
  wallet: Address
  vaultAddress: Address
  blockTimestamp?: bigint
}

export interface LocalVestingRecord {
  chainId: number
  wallet: Address
  vaultAddress: Address
  scheduleId: bigint
  type: JournalEventType
  beneficiary: Address
  amount: bigint
  blockNumber: bigint
  blockHash: Hex
  timestamp?: bigint
  txHash: Hex
  logIndex: number
  from: Address
  status: 'confirmed'
}

const JOURNAL_PREFIX = 'vestros:vesting-journal:v1'
const MAX_LOCAL_RECORDS = 1_000
const LIFECYCLE_ABI = parseAbi([
  'event ScheduleCreated(uint256 indexed scheduleId,address indexed beneficiary,uint128 totalAmount,uint48 startTime,uint48 cliffTime,uint48 endTime)',
  'event Claimed(uint256 indexed scheduleId,address indexed beneficiary,uint128 amount)',
  'event ScheduleRevoked(uint256 indexed scheduleId,address indexed beneficiary,uint128 unvestedReturned)',
])

function normalizeAddress(address: string): string {
  return address.toLowerCase()
}

function browserStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  try { return window.localStorage } catch { return undefined }
}

function validTransactionHash(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value)
}

export function journalRecordKey(record: Pick<LocalVestingRecord, 'chainId' | 'vaultAddress' | 'txHash' | 'logIndex'>): string {
  return `${record.chainId}:${normalizeAddress(record.vaultAddress)}:${record.txHash.toLowerCase()}:${record.logIndex}`
}

export function decodeConfirmedVestingReceipt(
  context: ReceiptJournalContext,
  receipt: ReceiptLike,
): LocalVestingRecord[] {
  if (receipt.status !== 'success') return []
  if (!receipt.to || normalizeAddress(receipt.to) !== normalizeAddress(context.vaultAddress)) return []
  if (receipt.blockNumber === undefined || receipt.blockHash === undefined || !validTransactionHash(receipt.transactionHash)) return []

  const records: LocalVestingRecord[] = []
  for (const log of receipt.logs) {
    if (normalizeAddress(log.address) !== normalizeAddress(context.vaultAddress)) continue
    if (log.logIndex === undefined) continue
    let decoded: { eventName?: string; args?: Record<string, unknown> }
    try {
      decoded = decodeEventLog({ abi: LIFECYCLE_ABI, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] })
    } catch {
      continue
    }

    const args = decoded.args ?? {}
    const scheduleId = args.scheduleId
    const beneficiary = args.beneficiary
    const amount = decoded.eventName === 'ScheduleCreated' ? args.totalAmount : decoded.eventName === 'Claimed' ? args.amount : args.unvestedReturned
    if (!decoded.eventName || !['ScheduleCreated', 'Claimed', 'ScheduleRevoked'].includes(decoded.eventName)) continue
    if (typeof scheduleId !== 'bigint' || typeof beneficiary !== 'string' || !isAddress(beneficiary) || typeof amount !== 'bigint') continue
    const type: JournalEventType = decoded.eventName === 'ScheduleCreated' ? 'created' : decoded.eventName === 'Claimed' ? 'claimed' : 'revoked'
    records.push({
      chainId: context.chainId,
      wallet: context.wallet,
      vaultAddress: context.vaultAddress,
      scheduleId,
      type,
      beneficiary,
      amount,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      timestamp: context.blockTimestamp,
      txHash: receipt.transactionHash,
      logIndex: typeof log.logIndex === 'bigint' ? Number(log.logIndex) : log.logIndex,
      from: context.wallet,
      status: 'confirmed',
    })
  }
  return records
}

export function mergeJournalRecords(records: readonly LocalVestingRecord[]): LocalVestingRecord[] {
  const unique = new Map<string, LocalVestingRecord>()
  for (const record of records) unique.set(journalRecordKey(record), record)
  return [...unique.values()].sort((left, right) => right.blockNumber === left.blockNumber
    ? right.logIndex - left.logIndex
    : right.blockNumber > left.blockNumber ? 1 : -1)
}

export function journalStorageKey(chainId: number, wallet: Address): string {
  return `${JOURNAL_PREFIX}:${chainId}:${normalizeAddress(wallet)}`
}

interface StoredLocalVestingRecord extends Omit<LocalVestingRecord, 'scheduleId' | 'amount' | 'blockNumber' | 'timestamp'> {
  scheduleId: string
  amount: string
  blockNumber: string
  timestamp?: string
}

function toStored(record: LocalVestingRecord): StoredLocalVestingRecord {
  return {
    ...record,
    scheduleId: record.scheduleId.toString(),
    amount: record.amount.toString(),
    blockNumber: record.blockNumber.toString(),
    timestamp: record.timestamp?.toString(),
  }
}

function fromStored(record: StoredLocalVestingRecord): LocalVestingRecord | undefined {
  if (!validTransactionHash(record.txHash) || !isAddress(record.wallet) || !isAddress(record.vaultAddress) || !isAddress(record.beneficiary) || !isAddress(record.from)) return undefined
  return {
    ...record,
    wallet: record.wallet,
    vaultAddress: record.vaultAddress,
    beneficiary: record.beneficiary,
    from: record.from,
    scheduleId: BigInt(record.scheduleId),
    amount: BigInt(record.amount),
    blockNumber: BigInt(record.blockNumber),
    timestamp: record.timestamp === undefined ? undefined : BigInt(record.timestamp),
    txHash: record.txHash,
    blockHash: record.blockHash,
    status: 'confirmed',
  }
}

export interface JournalFilter {
  vaultAddress?: Address
  beneficiary?: Address
  scheduleId?: bigint
  type?: JournalEventType
}

export function readLocalVestingRecords(chainId: number, wallet: Address, filter: JournalFilter = {}): LocalVestingRecord[] {
  const storage = browserStorage()
  if (!storage) return []
  try {
    const raw = storage.getItem(journalStorageKey(chainId, wallet))
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredLocalVestingRecord[]
    return mergeJournalRecords(parsed.flatMap(record => {
      try {
        const restored = fromStored(record)
        if (!restored) return []
        if (filter.vaultAddress && normalizeAddress(restored.vaultAddress) !== normalizeAddress(filter.vaultAddress)) return []
        if (filter.beneficiary && normalizeAddress(restored.beneficiary) !== normalizeAddress(filter.beneficiary)) return []
        if (filter.scheduleId !== undefined && restored.scheduleId !== filter.scheduleId) return []
        if (filter.type && restored.type !== filter.type) return []
        return [restored]
      } catch { return [] }
    }))
  } catch { return [] }
}

export function appendLocalVestingRecords(records: readonly LocalVestingRecord[]): void {
  if (records.length === 0) return
  const byScope = new Map<string, LocalVestingRecord[]>()
  for (const record of records) {
    const key = journalStorageKey(record.chainId, record.wallet)
    const current = byScope.get(key) ?? readLocalVestingRecords(record.chainId, record.wallet)
    byScope.set(key, [...current, record])
  }
  const storage = browserStorage()
  if (!storage) return
  for (const [key, scoped] of byScope) {
    try { storage.setItem(key, JSON.stringify(mergeJournalRecords(scoped).slice(0, MAX_LOCAL_RECORDS).map(toStored))) } catch { /* storage is optional */ }
  }
}

export function clearLocalVestingRecords(chainId: number, wallet: Address): void {
  browserStorage()?.removeItem(journalStorageKey(chainId, wallet))
}
