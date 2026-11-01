/**
 * BulkVesting — create multiple vesting schedules in sequence.
 *
 * Safety guarantees (Phase 2 audit + integration fixes):
 *  - FIX-01: stale-cursor closure eliminated with cursorRef
 *  - FIX-02: double-fire prevented with kickedRef
 *  - FIX-03/12: real owner check via contract owner() read
 *  - RETRY: failed rows can be retried individually; remaining rows continue
 *  - DEDUP: completed tx hashes stored in sessionStorage so a browser refresh
 *    never re-submits a confirmed schedule
 *  - ALLOWANCE: existing ERC-20 allowance checked before requesting approval;
 *    approve step is skipped when allowance >= amount
 *  - ERRORS: wallet rejection and insufficient balance reported distinctly
 *  - RESUME: batch can be manually resumed after a failure
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  useAccount, useReadContract, useWriteContract,
  useWaitForTransactionReceipt, useSwitchChain,
} from 'wagmi'
import { erc20Abi, type Abi, type Address } from 'viem'
import {
  Plus, Trash2, Upload, Play, CheckCircle2, XCircle, Clock,
  Download, Users, RefreshCw, AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { CHAIN_ID, CONTRACT, CONTRACT_CONFIG_ERROR, CONTRACT_DEPLOYED, USDC_ADDRESS, USDC_DECIMALS } from '@/contractConfig'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { parseUnitsExact } from '@/onchain-money'
import { fmtUsdc, fmtAddr } from '@/formatters'
import { Card, EmptyState } from '@/components/ui/Primitives'
import type { BulkEntry, BulkTxState } from '@/types'
import { parseBulkCsv } from '@/bulkVestingUtils'
import { useChainTime } from '@/hooks/useChainTime'
import { durationToSeconds, scheduleStartFromChainTime, validateDurationPair, validateScheduleTimes } from '@/vestingDuration'
import { appendLocalVestingRecords, decodeConfirmedVestingReceipt } from '@/features/vesting/transactionJournal'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9) }

function emptyRow(): BulkEntry {
  return { id: uid(), beneficiary: '', amount: '', cliffValue: '30', cliffUnit: 'days', vestingValue: '365', vestingUnit: 'days' }
}

function validateRow(row: BulkEntry, chainTimestamp?: number): string | undefined {
  if (row.error) return row.error
  if (!row.beneficiary.startsWith('0x') || row.beneficiary.length !== 42)
    return 'Invalid address'
  const amt = parseFloat(row.amount)
  if (isNaN(amt) || amt <= 0) return 'Amount must be > 0'
  const durationError = validateDurationPair(row.cliffValue, row.cliffUnit, row.vestingValue, row.vestingUnit)
  if (durationError || chainTimestamp === undefined) return durationError
  const cliffSeconds = durationToSeconds(row.cliffValue, row.cliffUnit)
  const vestingSeconds = durationToSeconds(row.vestingValue, row.vestingUnit)
  return validateScheduleTimes(BigInt(scheduleStartFromChainTime(chainTimestamp)), cliffSeconds, vestingSeconds)
}

function totalUsdc(entries: BulkEntry[], decimals: number): bigint {
  return entries.reduce((acc, e) => {
    try { return acc + parseUnitsExact(e.amount || '0', decimals) } catch { return acc }
  }, 0n)
}

function classifyError(err: unknown): string {
  const msg = (err as Error)?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('4001') || msg.includes('denied'))
    return 'Wallet rejected — transaction cancelled.'
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance') || msg.includes('transfer amount exceeds balance'))
    return 'Insufficient USDC balance.'
  if (msg.includes('reverted'))
    return 'Transaction reverted on-chain. Check the contract or USDC allowance.'
  return 'Transaction failed — see wallet for details.'
}

/** sessionStorage key for persisting completed tx hashes within a session */
const SS_BULK_DONE_KEY = 'vestros:bulkDone:v1'

function loadDoneTxs(): Map<string, string> {
  try {
    const raw = sessionStorage.getItem(SS_BULK_DONE_KEY)
    if (!raw) return new Map()
    return new Map(JSON.parse(raw) as [string, string][])
  } catch { return new Map() }
}

function saveDoneTx(beneficiary: string, txHash: string) {
  const map = loadDoneTxs()
  map.set(beneficiary.toLowerCase(), txHash)
  try { sessionStorage.setItem(SS_BULK_DONE_KEY, JSON.stringify([...map])) } catch { /* ignore */ }
}

// ─── Single-row processor ─────────────────────────────────────────────────────
interface RowProcessorProps {
  onDone: (txHash: string | undefined, success: boolean, errMsg?: string) => void
  contractConfig: { address: Address; abi: Abi; chainId: number }
  usdcAddress: Address
  usdcDecimals: number
  chainTime: number
}

function useRowProcessor({ onDone, contractConfig, usdcAddress, usdcDecimals, chainTime }: RowProcessorProps) {
  const { address } = useAccount()
  const { writeContract, data: txHash, isPending, reset, error: writeError } = useWriteContract()
  const { data: receipt, isLoading: isConfirming, isSuccess, isError: receiptError } = useWaitForTransactionReceipt({ hash: txHash })
  const phaseRef = useRef<'idle' | 'approve' | 'create'>('idle')
  const rowRef = useRef<BulkEntry | null>(null)
  const skipApproveRef = useRef(false)
  const submitCreate = useCallback((row: BulkEntry) => {
    const rawAmount = parseUnitsExact(row.amount, usdcDecimals)
    const cliffSeconds = durationToSeconds(row.cliffValue, row.cliffUnit)
    const vestingSeconds = durationToSeconds(row.vestingValue, row.vestingUnit)
    const startTime = BigInt(scheduleStartFromChainTime(chainTime))
    const scheduleTimeError = validateScheduleTimes(startTime, cliffSeconds, vestingSeconds)
    if (scheduleTimeError) {
      onDone(undefined, false, scheduleTimeError)
      return
    }
    writeContract({
      ...contractConfig,
      functionName: 'createSchedule',
      args: [
        row.beneficiary as `0x${string}`,
        rawAmount,
        cliffSeconds,
        vestingSeconds,
        startTime,
      ],
    })
  }, [chainTime, contractConfig, onDone, usdcDecimals, writeContract])

  const processApprove = useCallback((row: BulkEntry, existingAllowance: bigint) => {
    rowRef.current = row
    const rawAmount = parseUnitsExact(row.amount, usdcDecimals)

    if (existingAllowance >= rawAmount) {
      // Allowance sufficient — skip approve, go straight to create
      skipApproveRef.current = true
      phaseRef.current = 'create'
      submitCreate(row)
    } else {
      skipApproveRef.current = false
      phaseRef.current = 'approve'
      writeContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [contractConfig.address, rawAmount],
        chainId: contractConfig.chainId,
      })
    }
  }, [contractConfig, submitCreate, usdcAddress, usdcDecimals, writeContract])

  // Approval confirmed → submit createSchedule
  useEffect(() => {
    if (!isSuccess) return
    const row = rowRef.current
    if (!row) return

    if (phaseRef.current === 'approve') {
      phaseRef.current = 'create'
      reset()
      submitCreate(row)
    } else if (phaseRef.current === 'create') {
      const hash = txHash
      const doneRow = rowRef.current
      rowRef.current = null
      phaseRef.current = 'idle'
      skipApproveRef.current = false
      if (receipt && address) {
        appendLocalVestingRecords(decodeConfirmedVestingReceipt({
          chainId: contractConfig.chainId,
          wallet: address,
          vaultAddress: contractConfig.address,
        }, receipt))
      }
      reset()
      if (doneRow && hash) saveDoneTx(doneRow.beneficiary, hash)
      onDone(hash, true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, contractConfig.address, contractConfig.chainId, isSuccess, receipt, submitCreate])

  // Any error (write rejection or receipt failure)
  useEffect(() => {
    const err = writeError
    if (!err && !receiptError) return
    const msg = classifyError(err ?? new Error('receipt failed'))
    rowRef.current = null
    phaseRef.current = 'idle'
    skipApproveRef.current = false
    reset()
    onDone(undefined, false, msg)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writeError, receiptError])

  return {
    processApprove,
    isPending,
    isConfirming,
    phase: phaseRef.current,
    isIdle: phaseRef.current === 'idle' && !isPending && !isConfirming,
  }
}

// ─── BulkVesting ─────────────────────────────────────────────────────────────
interface BulkVestingProps {
  onCreated?: () => void
  contractConfig?: { address: Address; abi: Abi; chainId: number }
  usdcAddress?: Address
  usdcDecimals?: number
  chainId?: number
  contractDeployed?: boolean
  contractError?: string | null
}

export default function BulkVesting({
  onCreated,
  contractConfig = CONTRACT,
  usdcAddress = USDC_ADDRESS,
  usdcDecimals = USDC_DECIMALS,
  chainId: activeChainId = CHAIN_ID,
  contractDeployed = CONTRACT_DEPLOYED,
  contractError = CONTRACT_CONFIG_ERROR,
}: BulkVestingProps) {
  const { address, chainId: connectedChainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const chainTime = useChainTime()
  const [entries, setEntries] = useState<BulkEntry[]>([emptyRow()])
  const [txStates, setTxStates] = useState<BulkTxState[]>([])
  const [running, setRunning] = useState(false)
  const [cursor, setCursor] = useState(0)

  // Refs to avoid stale closures
  const cursorRef = useRef(0)
  const entriesRef = useRef(entries)
  const kickedRef = useRef<number>(-1)

  useEffect(() => { cursorRef.current = cursor }, [cursor])
  useEffect(() => { entriesRef.current = entries }, [entries])

  const isWrongChain = connectedChainId !== activeChainId

  // Real owner check
  const { data: ownerAddr } = useReadContract({ ...contractConfig, functionName: 'owner' })
  const isOwner = !!address && address.toLowerCase() === (ownerAddr as string | undefined)?.toLowerCase()

  // Current USDC allowance for the connected wallet
  const { data: allowanceRaw } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && contractConfig.address ? [address, contractConfig.address] : undefined,
    query: { enabled: !!address },
  })
  const currentAllowance = (allowanceRaw) ?? 0n

  const handleDone = useCallback((txHash: string | undefined, success: boolean, errMsg?: string) => {
    const idx = cursorRef.current
    const allEntries = entriesRef.current

    setTxStates(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], status: success ? 'done' : 'failed', txHash, errorMsg: errMsg }
      return next
    })

    if (!success) {
      setRunning(false)
      toast.error(errMsg ?? `Schedule ${idx + 1} failed — batch stopped.`)
      return
    }

    const nextIdx = idx + 1
    cursorRef.current = nextIdx
    setCursor(nextIdx)

    if (nextIdx >= allEntries.length) {
      setRunning(false)
      toast.success(`All ${allEntries.length} schedule${allEntries.length !== 1 ? 's' : ''} created!`)
      onCreated?.()
    }
  }, [onCreated])

  const { processApprove, isPending, isConfirming, phase } = useRowProcessor({ onDone: handleDone, contractConfig, usdcAddress, usdcDecimals, chainTime })

  // Kick off the current row exactly once per cursor value
  useEffect(() => {
    if (!running) return
    if (cursor >= entries.length) return
    if (kickedRef.current >= cursor) return
    kickedRef.current = cursor

    const row = entries[cursor]
    if (!row) return

    setTxStates(prev => {
      const next = [...prev]
      next[cursor] = { ...next[cursor], status: 'approving' }
      return next
    })

    processApprove(row, currentAllowance)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, running])

  const handleStart = () => {
    if (!contractDeployed) { toast.error(contractError ?? 'Vesting contract is not configured.'); return }
    if (isWrongChain) { switchChain({ chainId: activeChainId }); return }
    const validated = entries.map(e => ({ ...e, error: validateRow(e, chainTime) }))
    if (validated.some(e => e.error)) { setEntries(validated); return }

    // Guard against re-submitting already-confirmed entries (dedup by beneficiary)
    const doneTxs = loadDoneTxs()
    const initial: BulkTxState[] = entries.map((e, i) => {
      const prev = doneTxs.get(e.beneficiary.toLowerCase())
      if (prev) return { index: i, beneficiary: e.beneficiary, status: 'done', txHash: prev }
      return { index: i, beneficiary: e.beneficiary, status: 'idle' }
    })

    // Find first non-done entry to start from
    const firstPending = initial.findIndex(s => s.status !== 'done')
    if (firstPending === -1) {
      toast.success('All entries already confirmed.')
      return
    }

    setTxStates(initial)
    kickedRef.current = firstPending - 1
    cursorRef.current = firstPending
    setCursor(firstPending)
    setRunning(true)
  }

  /** Retry: resume batch from the failed row, clearing its error state */
  const handleRetry = () => {
    if (!running) {
      setTxStates(prev => prev.map((s, i) => i === cursor ? { ...s, status: 'idle', txHash: undefined, errorMsg: undefined } : s))
      kickedRef.current = cursor - 1
      setRunning(true)
    }
  }

  /** Reset: discard all state and session cache */
  const handleReset = () => {
    setRunning(false)
    setTxStates([])
    setCursor(0)
    cursorRef.current = 0
    kickedRef.current = -1
    try { sessionStorage.removeItem(SS_BULK_DONE_KEY) } catch { /* ignore */ }
  }

  const addRow = () => setEntries(e => [...e, emptyRow()])
  const removeRow = (id: string) => setEntries(e => e.filter(r => r.id !== id))
  const updateRow = (id: string, field: keyof BulkEntry, value: string) =>
    setEntries(e => e.map(r => r.id === id ? { ...r, [field]: value, error: undefined } : r))

  const handleCsvUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target?.result as string
      const rows = parseBulkCsv(text)
      if (rows.length > 0) { setEntries(rows); toast.success(`Loaded ${rows.length} entries from CSV`) }
      else toast.error('No valid rows found in CSV')
    }
    reader.readAsText(file)
  }

  const downloadTemplate = () => {
    const csv = 'beneficiary,amount,cliffValue,cliffUnit,vestingValue,vestingUnit\n0x0000000000000000000000000000000000000001,1000,90,days,365,days\n'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'vestros-bulk-template.csv'
    a.click()
  }

  const total = totalUsdc(entries, usdcDecimals)
  const isBusy = isPending || isConfirming
  const validCount = entries.filter(e => !validateRow(e, chainTime)).length
  const doneCount = txStates.filter(t => t.status === 'done').length
  const hasFailed = txStates.some(t => t.status === 'failed')
  const batchDone = txStates.length > 0 && doneCount === entries.length

  if (!contractDeployed) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState icon={<AlertCircle size={24} />} title="Contract not configured" sub={contractError ?? 'Configure the vesting contract for this network before creating schedules.'} />
      </div>
    )
  }

  if (!isOwner) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState icon={<Users size={24} />} title="Owner only" sub="Connect the contract owner wallet to use bulk vesting." />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end gap-2">
        <button onClick={downloadTemplate}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--subtle)' }}>
          <Download size={13} /> Download template
        </button>
        <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
          <Upload size={13} /> Import CSV
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={e => {
            const f = e.target.files?.[0]; if (f) handleCsvUpload(f)
          }} />
        </label>
      </div>

      {/* Allowance notice */}
      {currentAllowance > 0n && (
        <div className="rounded-xl px-3 py-2 text-xs flex items-center gap-2"
          style={{ background: 'rgba(26,128,71,0.06)', border: '1px solid rgba(26,128,71,0.2)', color: 'var(--success)' }}>
          <CheckCircle2 size={12} />
          Existing allowance: {fmtUsdc(currentAllowance)} USDC — approval may be skipped for covered rows.
        </div>
      )}

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl p-3 flex flex-col gap-0.5" style={{ background: 'var(--surface-muted)' }}>
          <span className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>Schedules</span>
          <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{entries.length}</span>
        </div>
        <div className="rounded-xl p-3 flex flex-col gap-0.5" style={{ background: 'var(--surface-muted)' }}>
          <span className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>Valid</span>
          <span className="text-lg font-bold tabular-nums" style={{ color: validCount === entries.length ? 'var(--success)' : 'var(--muted)' }}>{validCount}/{entries.length}</span>
        </div>
        <div className="rounded-xl p-3 flex flex-col gap-0.5" style={{ background: 'var(--surface-muted)' }}>
          <span className="text-xs font-medium uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>Total USDC</span>
          <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{fmtUsdc(total)}</span>
        </div>
      </div>

      {/* Row table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Beneficiary', 'USDC Amount', 'Cliff', 'Vesting', ''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((row, i) => {
                const txState = txStates[i]
                const isDone = txState?.status === 'done'
                const isFailed = txState?.status === 'failed'
                const isCurrent = running && i === cursor && !isDone && !isFailed
                return (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--border)', opacity: isDone ? 0.6 : 1 }}>
                    <td className="px-2 py-1.5">
                      <input type="text" placeholder="0x…" value={row.beneficiary}
                        onChange={e => updateRow(row.id, 'beneficiary', e.target.value)}
                        disabled={running}
                        className="w-36 rounded-lg px-2 py-1.5 font-medium mono text-xs outline-none"
                        style={{ background: row.error ? 'rgba(186,43,76,0.06)' : 'var(--surface-muted)', border: `1px solid ${row.error ? 'rgba(186,43,76,0.3)' : 'var(--border)'}`, color: 'var(--ink)' }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="0" placeholder="0.00" value={row.amount}
                        onChange={e => updateRow(row.id, 'amount', e.target.value)} disabled={running}
                        className="w-24 rounded-lg px-2 py-1.5 text-xs tabular-nums outline-none"
                        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex min-w-36 gap-1">
                        <input type="number" min="0" step="1" value={row.cliffValue}
                          onChange={e => updateRow(row.id, 'cliffValue', e.target.value)} disabled={running}
                          className="w-16 rounded-lg px-2 py-1.5 text-xs tabular-nums outline-none"
                          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
                        <select value={row.cliffUnit} aria-label="Cliff duration unit" disabled={running}
                          onChange={e => updateRow(row.id, 'cliffUnit', e.target.value)}
                          className="min-w-20 rounded-lg px-1.5 py-1.5 text-[11px] outline-none"
                          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
                          <option value="minutes">Min</option><option value="hours">Hours</option><option value="days">Days</option>
                        </select>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex min-w-36 gap-1">
                        <input type="number" min="1" step="1" value={row.vestingValue}
                          onChange={e => updateRow(row.id, 'vestingValue', e.target.value)} disabled={running}
                          className="w-16 rounded-lg px-2 py-1.5 text-xs tabular-nums outline-none"
                          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
                        <select value={row.vestingUnit} aria-label="Vesting duration unit" disabled={running}
                          onChange={e => updateRow(row.id, 'vestingUnit', e.target.value)}
                          className="min-w-20 rounded-lg px-1.5 py-1.5 text-[11px] outline-none"
                          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
                          <option value="minutes">Min</option><option value="hours">Hours</option><option value="days">Days</option>
                        </select>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 w-24 text-center">
                      {isDone && (
                        txState.txHash
                          ? <a href={buildTxExplorerUrl(activeChainId, txState.txHash)} target="_blank" rel="noopener noreferrer"><CheckCircle2 size={14} style={{ color: 'var(--success)' }} /></a>
                          : <CheckCircle2 size={14} style={{ color: 'var(--success)' }} />
                      )}
                      {isFailed && (
                        <span title={txState.errorMsg ?? 'Failed'}>
                          <XCircle size={14} style={{ color: 'var(--danger)' }} />
                        </span>
                      )}
                      {isCurrent && (
                        <span className="text-xs animate-pulse" style={{ color: 'var(--accent)' }}>
                          {phase === 'approve' ? 'Approving…' : 'Creating…'}
                        </span>
                      )}
                      {!running && !isDone && !isFailed && (
                        <button onClick={() => removeRow(row.id)} className="opacity-40 hover:opacity-100">
                          <Trash2 size={13} style={{ color: 'var(--danger)' }} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Validation errors */}
        {entries.some(e => e.error) && (
          <div className="px-4 py-2.5 flex flex-col gap-1" style={{ borderTop: '1px solid var(--border)' }}>
            {entries.filter(e => e.error).map(e => (
              <p key={e.id} className="text-xs flex items-center gap-1.5" style={{ color: 'var(--danger)' }}>
                <AlertCircle size={11} />
                {fmtAddr(e.beneficiary || '0x0000')}: {e.error}
              </p>
            ))}
          </div>
        )}

        {/* Failed-row error detail */}
        {hasFailed && txStates[cursor]?.errorMsg && (
          <div className="px-4 py-2.5 flex items-center gap-2 text-xs" style={{ borderTop: '1px solid var(--border)', background: 'rgba(186,43,76,0.04)', color: 'var(--danger)' }}>
            <AlertCircle size={12} />
            {txStates[cursor].errorMsg}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 flex-wrap" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            {!running && !batchDone && (
              <button onClick={addRow} className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                <Plus size={13} /> Add row
              </button>
            )}
            {(running || batchDone) && (
              <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                <Clock size={12} />
                {doneCount}/{entries.length} created
              </span>
            )}
            {(hasFailed || batchDone) && (
              <button onClick={handleReset} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--subtle)' }}>
                <RefreshCw size={11} /> Reset
              </button>
            )}
          </div>

          <div className="flex gap-2">
            {hasFailed && (
              <button onClick={handleRetry} disabled={isBusy}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
                style={{ background: 'rgba(26,128,71,0.08)', border: '1px solid rgba(26,128,71,0.2)', color: 'var(--success)' }}>
                <RefreshCw size={12} /> Retry row {cursor + 1}
              </button>
            )}
            {!hasFailed && !batchDone && (
              <button onClick={handleStart} disabled={isBusy || running || entries.length === 0}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--accent)', minHeight: 40 }}>
                <Play size={14} />
                {isWrongChain ? 'Switch chain' : running ? `Creating ${cursor + 1}/${entries.length}…` : `Create ${entries.length} schedule${entries.length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Transaction log */}
      {txStates.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>Transaction log</p>
          {txStates.map((t, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl px-3 py-2.5"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
              <span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>{fmtAddr(t.beneficiary)}</span>
              {t.status === 'done' && t.txHash ? (
                <a href={buildTxExplorerUrl(activeChainId, t.txHash as `0x${string}`)} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--success)' }}>
                  <CheckCircle2 size={12} /> Confirmed
                </a>
              ) : t.status === 'failed' ? (
                <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--danger)' }}>
                  <XCircle size={12} /> Failed — use Retry to continue
                </span>
              ) : t.status === 'approving' || t.status === 'creating' ? (
                <span className="text-xs animate-pulse" style={{ color: 'var(--accent)' }}>In progress…</span>
              ) : (
                <span className="text-xs" style={{ color: 'var(--subtle)' }}>Waiting</span>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs" style={{ color: 'var(--subtle)' }}>
        Each row requires up to 2 wallet confirmations (approve + create). If a row already has sufficient allowance, only the create step is needed.
        If a row fails, use <strong>Retry</strong> to try it again. Completed rows are saved in this browser session — refreshing will not re-submit them.
      </p>
    </div>
  )
}
