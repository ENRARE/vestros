import { useState, useRef, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { ConnectKitButton } from 'connectkit'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from 'wagmi'
import { erc20Abi } from 'viem'
import {
  Wallet, Clock, Unlock, Lock, AlertCircle, ExternalLink, Coins,
  CheckCircle2, XCircle, ChevronDown, ChevronUp, Info,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import { buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'
import { parseUnitsExact } from '@/onchain-money'
import { CHAIN_ID, CONTRACT, USDC_ADDRESS, USDC_DECIMALS } from '@/contractConfig'
import { fmtUsdc, fmtDate, fmtAddr } from '@/formatters'
import { computeVested, getStatus, getNow, pct } from '@/vestingMath'
import type { VestingSchedule, ScheduleStatus } from '@/types'

import BulkVesting from '@/components/BulkVesting'
import TimelineForecast from '@/components/TimelineForecast'
import TreasuryDashboard from '@/components/TreasuryDashboard'
import { GrantHubRouter } from '@/granthub/GrantHubRouter'
import { AppShell } from '@/components/layout/AppShell'
import { OverviewPage } from '@/features/overview/OverviewPage'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseOnchainError(err: unknown): string {
  const msg = (err as Error)?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('4001')) return 'Transaction cancelled.'
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance')) return 'Insufficient USDC balance.'
  if (msg.includes('reverted')) {
    const m = msg.match(/revert reason: "([^"]+)"/) ?? msg.match(/error: ([a-z]+\(\))/i)
    return m ? `Transaction failed: ${m[1]}` : 'Transaction reverted.'
  }
  return 'Something went wrong. Please try again.'
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────
function Tooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])
  return (
    <span className="relative inline-flex items-center">
      <button
        ref={ref}
        type="button"
        onClick={() => setShow(v => !v)}
        className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full transition-opacity opacity-60 hover:opacity-100"
        style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}
        aria-label="Info"
      >
        <Info size={10} />
      </button>
      {show && (
        <span
          className="absolute z-20 left-5 top-0 w-56 rounded-xl px-3 py-2 text-xs shadow-lg"
          style={{ background: 'var(--surface-elevated)', color: 'var(--ink)', lineHeight: '1.5', border: '1px solid var(--border)' }}
        >
          {text}
        </span>
      )}
    </span>
  )
}

// ─── StatusBadge (vesting-specific) ──────────────────────────────────────────
function VestingStatusBadge({ status }: { status: ScheduleStatus }) {
  const map: Record<ScheduleStatus, { label: string; bg: string; color: string; icon: ReactNode }> = {
    locked:      { label: 'Locked',       bg: 'rgba(90,100,120,0.18)',    color: 'var(--muted)',   icon: <Lock size={11} /> },
    vesting:     { label: 'Vesting',      bg: 'rgba(45,212,191,0.12)',    color: 'var(--accent)',  icon: <Unlock size={11} /> },
    fully_vested:{ label: 'Fully Vested', bg: 'rgba(74,222,128,0.12)',    color: 'var(--success)', icon: <CheckCircle2 size={11} /> },
    revoked:     { label: 'Revoked',      bg: 'rgba(248,113,113,0.12)',   color: 'var(--danger)',  icon: <XCircle size={11} /> },
  }
  const { label, bg, color, icon } = map[status]
  return (
    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: bg, color }}>
      {icon}{label}
    </span>
  )
}

// ─── ProgressBar ─────────────────────────────────────────────────────────────
function ProgressBar({ vested, claimed }: { vested: number; claimed: number }) {
  return (
    <div className="relative h-2 w-full rounded-full overflow-hidden" style={{ background: 'var(--surface-elevated)' }}>
      <div className="absolute left-0 top-0 h-full rounded-full transition-all" style={{ width: `${vested}%`, background: 'rgba(45,212,191,0.2)' }} />
      <div className="absolute left-0 top-0 h-full rounded-full transition-all" style={{ width: `${claimed}%`, background: 'var(--accent)' }} />
    </div>
  )
}

// ─── BalanceRow ───────────────────────────────────────────────────────────────
function BalanceRow({
  label, value, tooltip, highlight, dim,
}: { label: string; value: string; tooltip?: string; highlight?: string; dim?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--border)', opacity: dim ? 0.55 : 1 }}>
      <span className="flex items-center text-xs font-medium" style={{ color: 'var(--subtle)' }}>
        {label}
        {tooltip && <Tooltip text={tooltip} />}
      </span>
      <span className="text-sm font-semibold tabular-nums" style={{ color: highlight ?? 'var(--ink-2)' }}>
        {value}
      </span>
    </div>
  )
}

// ─── RevokeModal ─────────────────────────────────────────────────────────────
function RevokeModal({
  schedule, scheduleId, onConfirm, onCancel, isBusy,
}: {
  schedule: VestingSchedule
  scheduleId: bigint
  onConfirm: () => void
  onCancel: () => void
  isBusy: boolean
}) {
  const now = getNow()
  const vested = computeVested(schedule, now)
  const claimableNow = vested - schedule.claimedAmount
  const unvested = schedule.totalAmount - vested
  const beneficiaryKeeps = schedule.claimedAmount + claimableNow
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)' }} onClick={onCancel} />
      <div
        className="relative w-full max-w-md rounded-2xl p-6 flex flex-col gap-5"
        style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--danger-dim)' }}>
            <XCircle size={20} style={{ color: 'var(--danger)' }} />
          </div>
          <div>
            <h3 className="display text-base font-bold" style={{ color: 'var(--ink)' }}>Revoke Schedule #{scheduleId.toString()}</h3>
            <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
              This stops further vesting immediately and cannot be undone.
            </p>
          </div>
        </div>

        <div className="rounded-xl p-4 flex flex-col" style={{ background: 'var(--surface-muted)' }}>
          <p className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: 'var(--subtle)' }}>What happens to the funds</p>
          <div className="flex flex-col divide-y" style={{ borderTop: '1px solid var(--border)' }}>
            <BalanceRow label="Already claimed (stays with beneficiary)" value={`${fmtUsdc(schedule.claimedAmount)} USDC`} />
            <BalanceRow label="Vested but unclaimed (stays claimable)" value={`${fmtUsdc(claimableNow)} USDC`} tooltip="The beneficiary can still claim this after revocation." highlight="var(--success)" />
            <BalanceRow label="Beneficiary keeps (total)" value={`${fmtUsdc(beneficiaryKeeps)} USDC`} />
            <BalanceRow label="Unvested — returned to you" value={`${fmtUsdc(unvested)} USDC`} tooltip="Only tokens that hadn't vested yet are returned to the owner." highlight={unvested > 0n ? 'var(--ink)' : 'var(--subtle)'} />
          </div>
        </div>

        <p className="text-xs rounded-xl px-3 py-2.5" style={{ background: 'var(--danger-dim)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.25)' }}>
          These are estimates based on the current block time. The exact amounts are determined on-chain.
        </p>

        <div className="flex gap-2">
          <button onClick={onCancel} disabled={isBusy} className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isBusy} className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
            style={{ background: 'var(--danger)', color: '#fff' }}>
            {isBusy ? 'Confirm in wallet…' : 'Revoke Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ScheduleCard ─────────────────────────────────────────────────────────────
function ScheduleCard({ id, isOwner, isMine }: { id: bigint; isOwner: boolean; isMine: boolean }) {
  const { address } = useAccount()
  const [expanded, setExpanded] = useState(false)
  const [showRevokeModal, setShowRevokeModal] = useState(false)

  const { data: raw, refetch } = useReadContract({ ...CONTRACT, functionName: 'getSchedule', args: [id] })
  const { data: claimable, refetch: refetchClaimable } = useReadContract({ ...CONTRACT, functionName: 'claimableAmount', args: [id] })
  const { writeContract, data: txHash, isPending, reset: resetWrite } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const handleClaim = () => {
    try { writeContract({ ...CONTRACT, functionName: 'claim', args: [id] }) }
    catch (e) { toast.error(parseOnchainError(e)) }
  }

  const handleRevokeConfirm = () => {
    try {
      writeContract({ ...CONTRACT, functionName: 'revoke', args: [id] })
      setShowRevokeModal(false)
    } catch (e) {
      toast.error(parseOnchainError(e))
      setShowRevokeModal(false)
    }
  }

  useEffect(() => {
    if (isSuccess) {
      toast.success('Transaction confirmed!', {
        action: txHash ? { label: 'Explorer', onClick: () => window.open(buildTxExplorerUrl(CHAIN_ID, txHash), '_blank') } : undefined,
      })
      void refetch()
      void refetchClaimable()
      resetWrite()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])

  const s = raw as VestingSchedule | undefined
  if (!s || s.totalAmount === 0n) return null

  const now = getNow()
  const status = getStatus(s, now)
  const vested = computeVested(s, now)
  const vestedPct = pct(vested, s.totalAmount)
  const claimedPct = pct(s.claimedAmount, s.totalAmount)
  const claimableAmt = (claimable as bigint | undefined) ?? 0n
  const stillLocked = s.totalAmount - vested
  const isBeneficiary = address?.toLowerCase() === s.beneficiary.toLowerCase()
  const isBusy = isPending || isConfirming
  const canRevoke = isOwner && !s.revoked && s.claimedAmount < s.totalAmount

  const roleTag = isMine
    ? isBeneficiary ? 'You are the beneficiary' : isOwner ? 'You are the owner' : null
    : null

  const nextUnlockCopy = (() => {
    if (status === 'locked') return `Cliff on ${fmtDate(s.cliffTime)}`
    if (status === 'vesting') return `Fully vested ${fmtDate(s.endTime)}`
    if (status === 'fully_vested') return 'Fully vested'
    if (status === 'revoked') return `Revoked ${fmtDate(s.revokeTime)}`
    return null
  })()

  return (
    <>
      {showRevokeModal && s && (
        <RevokeModal schedule={s} scheduleId={id} onConfirm={handleRevokeConfirm} onCancel={() => setShowRevokeModal(false)} isBusy={isBusy} />
      )}
      <div
        className="rounded-2xl flex flex-col overflow-hidden"
        style={{
          background: 'var(--surface-muted)',
          border: `1px solid ${status === 'revoked' ? 'rgba(248,113,113,0.2)' : 'var(--border)'}`,
        }}
      >
        <div className="px-5 pt-5 pb-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>Schedule #{id.toString()}</span>
                <VestingStatusBadge status={status} />
              </div>
              <a href={buildAddressExplorerUrl(CHAIN_ID, s.beneficiary)} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm font-medium hover:underline mt-0.5" style={{ color: 'var(--ink-2)' }}>
                <span className="mono">{fmtAddr(s.beneficiary)}</span>
                <ExternalLink size={12} />
              </a>
              {roleTag && <span className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{roleTag}</span>}
            </div>
            {claimableAmt > 0n && (
              <div className="rounded-xl px-3 py-2 flex flex-col items-end" style={{ background: 'var(--success-dim)', border: '1px solid rgba(74,222,128,0.25)' }}>
                <span className="text-xs font-medium" style={{ color: 'var(--success)' }}>Claimable now</span>
                <span className="text-base font-bold tabular-nums" style={{ color: 'var(--success)' }}>+{fmtUsdc(claimableAmt)} USDC</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <ProgressBar vested={vestedPct} claimed={claimedPct} />
            <div className="flex justify-between text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
              <span>{vestedPct.toFixed(1)}% vested</span>
              <span>{claimedPct.toFixed(1)}% claimed</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {([
              { label: 'Total', value: fmtUsdc(s.totalAmount), tooltip: 'Total USDC locked when this schedule was created.' },
              { label: 'Claimed', value: fmtUsdc(s.claimedAmount), tooltip: 'USDC already withdrawn by the beneficiary.' },
              { label: 'Claimable', value: fmtUsdc(claimableAmt), tooltip: 'Vested USDC the beneficiary can withdraw right now.', color: claimableAmt > 0n ? 'var(--success)' : undefined },
              { label: 'Still locked', value: fmtUsdc(stillLocked), tooltip: status === 'revoked' ? 'Vesting stopped at revocation. This USDC was returned to the owner.' : 'USDC that has not vested yet.', dim: status === 'revoked' },
            ] as { label: string; value: string; tooltip: string; color?: string; dim?: boolean }[]).map(item => (
              <div key={item.label} className="rounded-xl px-3 py-2.5 flex flex-col gap-0.5" style={{ background: 'var(--surface-elevated)', opacity: item.dim ? 0.55 : 1 }}>
                <span className="flex items-center text-xs font-medium" style={{ color: 'var(--subtle)' }}>
                  {item.label}<Tooltip text={item.tooltip} />
                </span>
                <span className="text-sm font-bold tabular-nums" style={{ color: item.color ?? 'var(--ink)' }}>{item.value}</span>
              </div>
            ))}
          </div>

          {nextUnlockCopy && (
            <div className="flex items-center gap-1.5">
              <Clock size={12} style={{ color: 'var(--subtle)' }} />
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{nextUnlockCopy}</span>
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            {isBeneficiary && claimableAmt > 0n && (
              <button onClick={handleClaim} disabled={isBusy}
                className="flex-1 min-w-[140px] py-3 px-4 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                style={{ background: isBusy ? 'var(--subtle)' : 'var(--accent)', color: 'var(--accent-text)', minHeight: 44 }}>
                {isPending ? 'Confirm in wallet…' : isConfirming ? 'Confirming…' : <><CheckCircle2 size={15} />Claim {fmtUsdc(claimableAmt)} USDC</>}
              </button>
            )}
            {isBeneficiary && claimableAmt === 0n && status !== 'revoked' && (
              <div className="flex-1 py-3 px-4 rounded-xl text-sm font-medium text-center"
                style={{ background: 'var(--surface-elevated)', color: 'var(--subtle)', border: '1px solid var(--border)', minHeight: 44 }}>
                {status === 'locked' ? 'Nothing claimable yet — cliff not reached' : 'Nothing to claim right now'}
              </div>
            )}
            {status === 'revoked' && claimableAmt > 0n && isBeneficiary && (
              <div className="w-full text-xs rounded-xl px-3 py-2" style={{ background: 'var(--danger-dim)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.2)' }}>
                Schedule revoked — you can still claim the {fmtUsdc(claimableAmt)} USDC that vested before revocation.
              </div>
            )}
            {canRevoke && (
              <button onClick={() => setShowRevokeModal(true)} disabled={isBusy}
                className="py-3 px-4 rounded-xl text-sm font-semibold transition-all disabled:opacity-60"
                style={{ background: 'var(--danger-dim)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.2)', minHeight: 44 }}>
                Revoke
              </button>
            )}
          </div>
        </div>

        <button onClick={() => setExpanded(v => !v)}
          className="flex items-center justify-between px-5 py-3 text-xs font-medium w-full transition-colors"
          style={{ color: 'var(--subtle)', borderTop: '1px solid var(--border)', background: expanded ? 'var(--surface-elevated)' : 'transparent' }}>
          <span>Timeline details</span>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {expanded && (
          <div className="px-5 pb-5 pt-3 grid grid-cols-3 gap-2" style={{ borderTop: '1px solid var(--border)' }}>
            {([
              { label: 'Start', ts: s.startTime, tooltip: 'Vesting begins accumulating from this date.' },
              { label: 'Cliff', ts: s.cliffTime, tooltip: 'No tokens are claimable before this date.' },
              { label: s.revoked ? 'Revoked' : 'End', ts: s.revoked ? s.revokeTime : s.endTime, tooltip: s.revoked ? 'Vesting was stopped at this time.' : 'All tokens are fully vested by this date.' },
            ] as { label: string; ts: number; tooltip: string }[]).map(({ label, ts, tooltip }) => (
              <div key={label} className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-elevated)' }}>
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Clock size={10} style={{ color: 'var(--subtle)' }} />
                  <span className="text-xs tracking-widest uppercase font-medium" style={{ color: 'var(--subtle)' }}>{label}</span>
                  <Tooltip text={tooltip} />
                </div>
                <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--ink-2)' }}>{fmtDate(ts)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ─── GlossaryBar ─────────────────────────────────────────────────────────────
function GlossaryBar() {
  const [open, setOpen] = useState(false)
  const terms = [
    { term: 'Cliff', def: 'A waiting period before any tokens unlock. Nothing is claimable until this date passes.' },
    { term: 'Vesting', def: 'Tokens unlock gradually over time after the cliff. The longer you wait, the more you can claim.' },
    { term: 'Claimable', def: 'Tokens that have already vested and are ready for the beneficiary to withdraw right now.' },
    { term: 'Revoked', def: 'The owner stopped the schedule early. Vested tokens remain claimable; unvested tokens return to the owner.' },
  ]
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--surface-muted)' }}>
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center justify-between w-full px-4 py-3 text-xs font-semibold transition-colors" style={{ color: 'var(--subtle)' }}>
        <span className="flex items-center gap-1.5"><Info size={13} />Key terms explained</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 gap-2" style={{ borderTop: '1px solid var(--border)' }}>
          {terms.map(({ term, def }) => (
            <div key={term} className="pt-3">
              <span className="text-xs font-bold" style={{ color: 'var(--ink)' }}>{term} </span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{def}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── CreateScheduleForm ───────────────────────────────────────────────────────
function CreateScheduleForm({ onCreated }: { onCreated: () => void }) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const [form, setForm] = useState({ beneficiary: '', amount: '', cliffDays: '30', vestingDays: '365' })
  const [step, setStep] = useState<'idle' | 'approve' | 'create'>('idle')

  const { writeContract: approve, data: approveTx, isPending: approvePending } = useWriteContract()
  const { isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveTx })
  const { writeContract: create, data: createTx, isPending: createPending } = useWriteContract()
  const { isLoading: createConfirming, isSuccess: createSuccess } = useWaitForTransactionReceipt({ hash: createTx })

  useEffect(() => {
    if (createSuccess) {
      toast.success('Vesting schedule created!', {
        action: createTx ? { label: 'Explorer', onClick: () => window.open(buildTxExplorerUrl(CHAIN_ID, createTx), '_blank') } : undefined,
      })
      setStep('idle')
      setForm({ beneficiary: '', amount: '', cliffDays: '30', vestingDays: '365' })
      onCreated()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createSuccess])

  const isWrongChain = chainId !== CHAIN_ID
  const parsedCliff = parseInt(form.cliffDays)
  const parsedVesting = parseInt(form.vestingDays)
  const isValid =
    form.beneficiary.startsWith('0x') && form.beneficiary.length === 42 &&
    parseFloat(form.amount) > 0 &&
    parsedVesting > 0 && parsedCliff >= 0 && parsedCliff <= parsedVesting

  const handleApprove = () => {
    if (isWrongChain) { switchChain({ chainId: CHAIN_ID }); return }
    if (!isValid) return
    try {
      const rawAmount = parseUnitsExact(form.amount, USDC_DECIMALS)
      approve({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [CONTRACT.address, rawAmount], chainId: CHAIN_ID })
      setStep('approve')
    } catch (e) { toast.error(parseOnchainError(e)) }
  }

  const handleCreate = () => {
    if (!isValid) return
    try {
      const rawAmount = parseUnitsExact(form.amount, USDC_DECIMALS)
      const now = getNow()
      create({
        ...CONTRACT,
        functionName: 'createSchedule',
        args: [form.beneficiary as `0x${string}`, rawAmount, BigInt(parsedCliff * 86400), BigInt(parsedVesting * 86400), BigInt(now)],
      })
      setStep('create')
    } catch (e) { toast.error(parseOnchainError(e)) }
  }

  const isBusy = approvePending || createPending || createConfirming
  const readyToCreate = step === 'approve' && approveSuccess

  return (
    <div className="rounded-2xl p-6 flex flex-col gap-5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
      <div>
        <h2 className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>New Vesting Schedule</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Cliff + linear unlock. USDC is pulled from your wallet on creation.</p>
      </div>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>Beneficiary address</span>
          <input type="text" placeholder="0x..." value={form.beneficiary}
            onChange={e => setForm(f => ({ ...f, beneficiary: e.target.value }))}
            className="rounded-xl px-4 py-3 text-sm font-medium mono outline-none"
            style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink)', fontFamily: 'inherit' }} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>USDC amount</span>
          <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}>
            <TokenUSDC variant="branded" size={18} />
            <input type="number" placeholder="0.00" min="0" step="0.000001" value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              className="flex-1 bg-transparent text-sm font-medium tabular-nums outline-none" style={{ color: 'var(--ink)' }} />
            <span className="text-xs font-semibold" style={{ color: 'var(--subtle)' }}>USDC</span>
          </div>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="flex items-center text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>
              Cliff (days)<Tooltip text="No tokens unlock before this many days. Set to 0 for no cliff." />
            </span>
            <input type="number" min="0" value={form.cliffDays}
              onChange={e => setForm(f => ({ ...f, cliffDays: e.target.value }))}
              className="rounded-xl px-4 py-3 text-sm font-medium tabular-nums outline-none"
              style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="flex items-center text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>
              Vesting (days)<Tooltip text="Total duration over which tokens unlock linearly after the cliff." />
            </span>
            <input type="number" min="1" value={form.vestingDays}
              onChange={e => setForm(f => ({ ...f, vestingDays: e.target.value }))}
              className="rounded-xl px-4 py-3 text-sm font-medium tabular-nums outline-none"
              style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
          </label>
        </div>
        {parsedCliff > parsedVesting && (
          <p className="text-xs rounded-xl px-3 py-2" style={{ background: 'var(--danger-dim)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.2)' }}>
            Cliff cannot be longer than the total vesting period.
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        {([{ n: 1, label: 'Approve USDC' }, { n: 2, label: 'Create Schedule' }] as { n: number; label: string }[]).map(({ n, label }) => (
          <div key={n} className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                background: (n === 1 && step !== 'idle') || (n === 2 && step === 'create') ? 'var(--accent)' : 'var(--surface-elevated)',
                color: (n === 1 && step !== 'idle') || (n === 2 && step === 'create') ? 'var(--accent-text)' : 'var(--subtle)',
              }}>{n}</span>
            <span className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>{label}</span>
            {n < 2 && <span style={{ color: 'var(--border)' }}>›</span>}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {!readyToCreate ? (
          <button onClick={handleApprove} disabled={isBusy || !isValid}
            className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--accent-text)', minHeight: 44 }}>
            {isWrongChain ? 'Switch to Arc Testnet' : approvePending ? 'Confirm in wallet…' : '1. Approve USDC'}
          </button>
        ) : (
          <button onClick={handleCreate} disabled={isBusy}
            className="flex-1 py-3 px-4 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--accent-text)', minHeight: 44 }}>
            {createPending ? 'Confirm in wallet…' : createConfirming ? 'Creating…' : '2. Create Schedule'}
          </button>
        )}
      </div>
      {address && <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>Connected as <span className="mono">{fmtAddr(address)}</span></p>}
    </div>
  )
}

// ─── ScheduleLookup ───────────────────────────────────────────────────────────
function ScheduleLookup({ refreshKey }: { refreshKey: number }) {
  const [input, setInput] = useState('')
  const [ids, setIds] = useState<bigint[] | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [isMine, setIsMine] = useState(false)
  const { address } = useAccount()

  const { refetch: fetchByAddress } = useReadContract({
    ...CONTRACT, functionName: 'getScheduleIds', args: [input as `0x${string}`], query: { enabled: false },
  })
  const { data: ownerAddr } = useReadContract({ ...CONTRACT, functionName: 'owner' })

  const doLookup = async (addr: string, mine: boolean) => {
    if (!addr.startsWith('0x') || addr.length !== 42) { toast.error('Enter a valid 0x address'); return }
    const res = await fetchByAddress()
    const fetched = res.data as bigint[] | undefined
    setIds(fetched ?? [])
    setIsMine(mine)
    setIsOwner(address?.toLowerCase() === (ownerAddr as string | undefined)?.toLowerCase())
  }

  const handleLookup = () => void doLookup(input, false)
  const handleMySchedules = () => {
    if (!address) { toast.error('Connect your wallet first'); return }
    setInput(address)
    void doLookup(address, true)
  }

  useEffect(() => {
    if (refreshKey > 0 && ids !== null && input) void doLookup(input, isMine)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <input type="text" placeholder="Beneficiary address 0x..." value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleLookup() }}
          className="flex-1 rounded-xl px-4 py-3 text-sm font-medium mono outline-none"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)', minHeight: 44, fontFamily: 'inherit' }} />
        <button onClick={handleLookup}
          className="px-4 py-3 rounded-xl text-sm font-semibold"
          style={{ background: 'var(--accent)', color: 'var(--accent-text)', minHeight: 44 }}>
          Look up
        </button>
      </div>
      <button onClick={handleMySchedules}
        className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)', minHeight: 44 }}>
        <Wallet size={15} /> My schedules
      </button>
      <GlossaryBar />
      {ids !== null && (
        ids.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertCircle size={32} style={{ color: 'var(--subtle)' }} />
            <p className="text-sm" style={{ color: 'var(--muted)' }}>No vesting schedules found for this address.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {ids.map(id => <ScheduleCard key={id.toString()} id={id} isOwner={isOwner} isMine={isMine} />)}
          </div>
        )
      )}
    </div>
  )
}

// ─── Page wrappers ────────────────────────────────────────────────────────────
function MyVestingPage({ refreshKey }: { refreshKey: number }) {
  const navigate = useNavigate()
  const { data: ownerAddr } = useReadContract({ ...CONTRACT, functionName: 'owner' })
  const { address, isConnected } = useAccount()
  const isOwner = !!address && address.toLowerCase() === (ownerAddr as string | undefined)?.toLowerCase()

  if (!isConnected) {
    return (
      <div className="px-6 py-8 max-w-2xl mx-auto">
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'var(--surface-muted)' }}>
            <Coins size={24} style={{ color: 'var(--muted)' }} />
          </div>
          <div>
            <p className="font-semibold" style={{ color: 'var(--ink)' }}>Connect your wallet</p>
            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Connect to view and claim your vesting schedules.</p>
          </div>
          <ConnectKitButton />
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 py-6 max-w-2xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>My Vesting</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Look up vesting schedules by beneficiary address</p>
        </div>
        {isOwner && (
          <button
            onClick={() => void navigate('/vesting/create')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
          >
            + New Schedule
          </button>
        )}
      </div>
      <ScheduleLookup refreshKey={refreshKey} />
    </div>
  )
}

function CreateVestingPage({ onCreated }: { onCreated: () => void }) {
  const navigate = useNavigate()
  const { data: ownerAddr } = useReadContract({ ...CONTRACT, functionName: 'owner' })
  const { address } = useAccount()
  const isOwner = !!address && address.toLowerCase() === (ownerAddr as string | undefined)?.toLowerCase()

  if (!isOwner) return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Lock size={28} style={{ color: 'var(--subtle)' }} />
        <p className="font-semibold" style={{ color: 'var(--ink)' }}>Owner access required</p>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Only the contract owner can create vesting schedules.</p>
      </div>
    </div>
  )

  return (
    <div className="px-6 py-6 max-w-2xl mx-auto w-full">
      <div className="mb-6">
        <h2 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Create Vesting Schedule</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Lock USDC for a beneficiary with cliff + linear vesting</p>
      </div>
      <CreateScheduleForm onCreated={() => { onCreated(); void navigate('/vesting') }} />
    </div>
  )
}

function BulkVestingPage({ onCreated }: { onCreated: () => void }) {
  const { data: ownerAddr } = useReadContract({ ...CONTRACT, functionName: 'owner' })
  const { address } = useAccount()
  const isOwner = !!address && address.toLowerCase() === (ownerAddr as string | undefined)?.toLowerCase()

  if (!isOwner) return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Lock size={28} style={{ color: 'var(--subtle)' }} />
        <p className="font-semibold" style={{ color: 'var(--ink)' }}>Owner access required</p>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Only the contract owner can create bulk vesting schedules.</p>
      </div>
    </div>
  )

  return (
    <div className="px-6 py-6 max-w-2xl mx-auto w-full">
      <div className="mb-6">
        <h2 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Bulk Vesting</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Import a CSV or paste addresses to vest for multiple recipients at once</p>
      </div>
      <BulkVesting onCreated={onCreated} />
    </div>
  )
}

function TimelinePage() {
  return (
    <div className="px-6 py-6 max-w-3xl mx-auto w-full">
      <div className="mb-6">
        <h2 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Vesting Timeline</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Cliff and unlock forecast across all schedules</p>
      </div>
      <TimelineForecast />
    </div>
  )
}

function TreasuryPage() {
  return (
    <div className="px-6 py-6 max-w-3xl mx-auto w-full">
      <div className="mb-6">
        <h2 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Treasury</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>USDC allocation overview and beneficiary breakdown</p>
      </div>
      <TreasuryDashboard />
    </div>
  )
}

// ─── App Routes ───────────────────────────────────────────────────────────────
function AppRoutes() {
  const [refreshKey, setRefreshKey] = useState(0)
  const triggerRefresh = () => setRefreshKey(k => k + 1)

  return (
    <AppShell onRefresh={triggerRefresh}>
      <Routes>
        <Route path="/"                 element={<OverviewPage refreshKey={refreshKey} />} />
        <Route path="/vesting"          element={<MyVestingPage refreshKey={refreshKey} />} />
        <Route path="/vesting/create"   element={<CreateVestingPage onCreated={triggerRefresh} />} />
        <Route path="/vesting/bulk"     element={<BulkVestingPage onCreated={triggerRefresh} />} />
        <Route path="/vesting/timeline" element={<TimelinePage />} />
        <Route path="/vesting/team"     element={<MyVestingPage refreshKey={refreshKey} />} />
        <Route path="/treasury"         element={<TreasuryPage />} />
        <Route path="/granthub/*"       element={<GrantHubWrapper />} />
        <Route path="*"                 element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}

function GrantHubWrapper() {
  return (
    <div className="px-0 py-0">
      <GrantHubRouter />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
