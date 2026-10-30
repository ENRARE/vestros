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
import { erc20Abi } from 'viem'
import {
  Plus, Trash2, Upload, Play, CheckCircle2, XCircle, Clock,
  Download, Users, RefreshCw, AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { CHAIN_ID, CONTRACT, USDC_ADDRESS, USDC_DECIMALS } from '@/contractConfig'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { parseUnitsExact } from '@/onchain-money'
import { fmtUsdc, fmtAddr } from '@/formatters'
import { SectionHeader, Card, EmptyState } from '@/components/ui/Primitives'
import type { BulkEntry, BulkTxState } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9) }

function emptyRow(): BulkEntry {
  return { id: uid(), beneficiary: '', amount: '', cliffDays: '30', vestingDays: '365' }
}

function validateRow(row: BulkEntry): string | undefined {
  if (!row.beneficiary.startsWith('0x') || row.beneficiary.length !== 42)
    return 'Invalid address'
  const amt = parseFloat(row.amount)
  if (isNaN(amt) || amt <= 0) return 'Amount must be > 0'
  const cliff = parseInt(row.cliffDays)
  const vest = parseInt(row.vestingDays)
  if (isNaN(vest) || vest <= 0) return 'Vesting days must be > 0'
  if (isNaN(cliff) || cliff < 0) return 'Cliff must be ≥ 0'
  if (cliff > vest) return 'Cliff > vesting period'
  return undefined
}

function parseCsv(text: string): BulkEntry[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  const rows: BulkEntry[] = []
  for (const line of lines) {
    const parts = line.split(',').map(s => s.trim())
    if (parts.length < 2) continue
    const [beneficiary, amount, cliffDays = '30', vestingDays = '365'] = parts
    if (beneficiary?.toLowerCase() === 'beneficiary') continue
    rows.push({ id: uid(), beneficiary: beneficiary ?? '', amount: amount ?? '', cliffDays, vestingDays })
  }
  return rows
}

function totalUsdc(entries: BulkEntry[]): bigint {
  return entries.reduce((acc, e) => {
    try { return acc + parseUnitsExact(e.amount || '0', USDC_DECIMALS) } catch { return acc }
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
}

function useRowProcessor({ onDone }: RowProcessorProps) {
  const { writeContract, data: txHash, isPending, reset, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess, isError: receiptError } = useWaitForTransactionReceipt({ hash: txHash })
  const phaseRef = useRef<'idle' | 'approve' | 'create'>('idle')
  const rowRef = useRef<BulkEntry | null>(null)
  const skipApproveRef = useRef(false)

  const processApprove = useCallback((row: BulkEntry, existingAllowance: bigint) => {
    rowRef.current = row
    const rawAmount = parseUnitsExact(row.amount, USDC_DECIMALS)

    if (existingAllowance >= rawAmount) {
      // Allowance sufficient — skip approve, go straight to create
      skipApproveRef.current = true
      phaseRef.current = 'create'
      const now = Math.floor(Date.now() / 1000)
      writeContract({
        ...CONTRACT,
        functionName: 'createSchedule',
        args: [
          row.beneficiary as `0x${string}`,
          rawAmount,
          BigInt(parseInt(row.cliffDays) * 86400),
          BigInt(parseInt(row.vestingDays) * 86400),
          BigInt(now),
        ],
      })
    } else {
      skipApproveRef.current = false
      phaseRef.current = 'approve'
      writeContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [CONTRACT.address, rawAmount],
        chainId: CHAIN_ID,
      })
    }
  }, [writeContract])

  // Approval confirmed → submit createSchedule
  useEffect(() => {
    if (!isSuccess) return
    const row = rowRef.current
    if (!row) return

    if (phaseRef.current === 'approve') {
      phaseRef.current = 'create'
      const rawAmount = parseUnitsExact(row.amount, USDC_DECIMALS)
      const now = Math.floor(Date.now() / 1000)
      reset()
      writeContract({
        ...CONTRACT,
        functionName: 'createSchedule',
        args: [
          row.beneficiary as `0x${string}`,
          rawAmount,
          BigInt(parseInt(row.cliffDays) * 86400),
          BigInt(parseInt(row.vestingDays) * 86400),
          BigInt(now),
        ],
      })
    } else if (phaseRef.current === 'create') {
      const hash = txHash
      const doneRow = rowRef.current
      rowRef.current = null
      phaseRef.current = 'idle'
      skipApproveRef.current = false
      reset()
      if (doneRow && hash) saveDoneTx(doneRow.beneficiary, hash)
      onDone(hash, true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])

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
export default function BulkVesting({ onCreated }: { onCreated?: () => void }) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
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

  const isWrongChain = chainId !== CHAIN_ID

  // Real owner check
  const { data: ownerAddr } = useReadContract({ ...CONTRACT, functionName: 'owner' })
  const isOwner = !!address && address.toLowerCase() === (ownerAddr as string | undefined)?.toLowerCase()

  // Current USDC allowance for the connected wallet
  const { data: allowanceRaw } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && CONTRACT.address ? [address, CONTRACT.address] : undefined,
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

  const { processApprove, isPending, isConfirming, phase } = useRowProcessor({ onDone: handleDone })

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
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return }
    const validated = entries.map(e => ({ ...e, error: validateRow(e) }))
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
      const rows = parseCsv(text)
      if (rows.length > 0) { setEntries(rows); toast.success(`Loaded ${rows.length} entries from CSV`) }
      else toast.error('No valid rows found in CSV')
    }
    reader.readAsText(file)
  }

  const downloadTemplate = () => {
    const csv = 'beneficiary,amount,cliffDays,vestingDays\n0x0000000000000000000000000000000000000001,1000,90,365\n'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'vestros-bulk-template.csv'
    a.click()
  }

  const total = totalUsdc(entries)
  const isBusy = isPending || isConfirming
  const validCount = entries.filter(e => !validateRow(e)).length
  const doneCount = txStates.filter(t => t.status === 'done').length
  const hasFailed = txStates.some(t => t.status === 'failed')
  const batchDone = txStates.length > 0 && doneCount === entries.length

  if (!isOwner) {
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader title="Bulk Vesting" sub="Create multiple schedules at once" />
        <EmptyState icon={<Users size={24} />} title="Owner only" sub="Connect the contract owner wallet to use bulk vesting." />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Bulk Vesting"
        sub="Create multiple vesting schedules in sequence. Each requires two wallet confirmations unless allowance is already set."
        action={
          <div className="flex gap-2">
            <button onClick={downloadTemplate}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--subtle)' }}>
              <Download size={13} /> Template
            </button>
            <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
              <Upload size={13} /> Import CSV
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={e => {
                const f = e.target.files?.[0]; if (f) handleCsvUpload(f)
              }} />
            </label>
          </div>
        }
      />

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
                {['Beneficiary', 'USDC Amount', 'Cliff (d)', 'Vest (d)', ''].map(h => (
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
                      <input type="number" min="0" value={row.cliffDays}
                        onChange={e => updateRow(row.id, 'cliffDays', e.target.value)} disabled={running}
                        className="w-16 rounded-lg px-2 py-1.5 text-xs tabular-nums outline-none"
                        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min="1" value={row.vestingDays}
                        onChange={e => updateRow(row.id, 'vestingDays', e.target.value)} disabled={running}
                        className="w-16 rounded-lg px-2 py-1.5 text-xs tabular-nums outline-none"
                        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                      />
                    </td>
                    <td className="px-2 py-1.5 w-24 text-center">
                      {isDone && (
                        txState.txHash
                          ? <a href={buildTxExplorerUrl(CHAIN_ID, txState.txHash)} target="_blank" rel="noopener noreferrer"><CheckCircle2 size={14} style={{ color: 'var(--success)' }} /></a>
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
                <a href={buildTxExplorerUrl(CHAIN_ID, t.txHash as `0x${string}`)} target="_blank" rel="noopener noreferrer"
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
