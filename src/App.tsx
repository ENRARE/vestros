import { useState, useRef, useEffect, useMemo, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { ConnectKitButton } from 'connectkit'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from 'wagmi'
import { erc20Abi, type Abi, type Address } from 'viem'
import {
  Wallet, Clock, Unlock, Lock, AlertCircle, ExternalLink, Coins,
  CheckCircle2, XCircle, ChevronDown, ChevronUp, Info, History, Copy,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import { buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'
import { parseUnitsExact } from '@/onchain-money'
import { CONTRACT, CONTRACT_ADDRESS, CONTRACT_CONFIG_ERROR, CONTRACT_DEPLOYED, USDC_ADDRESS, USDC_DECIMALS } from '@/contractConfig'
import { fmtUsdc, fmtDate, fmtAddr, fmtTimestamp } from '@/formatters'
import { computeVested, getStatus, getNow, pct } from '@/vestingMath'
import { useChainTime } from '@/hooks/useChainTime'
import {
  durationToSeconds,
  isDisplayableTimestamp,
  scheduleStartFromChainTime,
  validateDurationPair,
  validateScheduleTimes,
  type DurationUnit,
} from '@/vestingDuration'
import type { VestingSchedule, ScheduleStatus } from '@/types'

import BulkVesting from '@/components/BulkVesting'
import TimelineForecast from '@/components/TimelineForecast'
import TreasuryDashboard from '@/components/TreasuryDashboard'
import { GrantHubRouter } from '@/granthub/GrantHubRouter'
import { AppShell } from '@/components/layout/AppShell'
import { OverviewPage } from '@/features/overview/OverviewPage'
import { ActivityPage } from '@/features/workspace/ActivityPage'
import { AnalyticsPage } from '@/features/workspace/AnalyticsPage'
import { ReportsPage } from '@/features/workspace/ReportsPage'
import { HelpPage, SettingsPage } from '@/features/workspace/AccountPages'
import { TeamManagementPage } from '@/features/vesting/TeamManagementPage'
import { LandingPage } from '@/features/landing/LandingPage'
import { APP_PATH, LANDING_PATH } from '@/appRoutes'
import { VestingVaultSetup } from '@/components/VestingVaultSetup'
import { useUserVestingVault } from '@/hooks/useUserVestingVault'
import { useBeneficiaryVestingSchedules } from '@/hooks/useBeneficiaryVestingSchedules'
import { mergeScheduleRefs, normalizeVestingSchedule } from '@/hooks/beneficiaryScheduleDiscovery'
import { isSelfServiceVaultOwner } from '@/features/vesting/selfServiceWorkflow'
import { SELF_SERVICE_CHAIN_ID, SELF_SERVICE_USDC_ADDRESS, SELF_SERVICE_USDC_DECIMALS } from '@/vestingFactoryConfig'
import { useVestingEvents } from '@/hooks/useVestingEvents'
import { useScheduleTransactionHistory, type ScheduleHistoryRecord } from '@/hooks/useScheduleTransactionHistory'
import { selectMyVestingScheduleLogs } from '@/features/vesting/myVestingSchedule'
import { appendLocalVestingRecords, decodeConfirmedVestingReceipt } from '@/features/vesting/transactionJournal'

type VestingContractConfig = { address: Address; abi: Abi; chainId: number }

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
          className="absolute z-20 left-5 top-0 w-56 px-3 py-2 text-xs shadow-lg"
          style={{ background: 'var(--surface-elevated)', color: 'var(--ink)', lineHeight: '1.5', border: '1px solid var(--border)', borderRadius: 'var(--radius-menu)' }}
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
    vesting:     { label: 'Vesting',      bg: 'var(--accent-dim)',         color: 'var(--accent)',  icon: <Unlock size={11} /> },
    fully_vested:{ label: 'Fully Vested', bg: 'rgba(74,222,128,0.12)',    color: 'var(--success)', icon: <CheckCircle2 size={11} /> },
    revoked:     { label: 'Revoked',      bg: 'rgba(248,113,113,0.12)',   color: 'var(--danger)',  icon: <XCircle size={11} /> },
  }
  const { label, bg, color, icon } = map[status]
  return (
    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5" style={{ background: bg, color, borderRadius: 'var(--radius-control)' }}>
      {icon}{label}
    </span>
  )
}

// ─── ProgressBar ─────────────────────────────────────────────────────────────
function ProgressBar({ vested, claimed }: { vested: number; claimed: number }) {
  return (
    <div className="relative h-2 w-full rounded-full overflow-hidden" style={{ background: 'var(--surface-elevated)' }}>
      <div className="absolute left-0 top-0 h-full rounded-full transition-all" style={{ width: `${vested}%`, background: 'rgba(35,137,232,0.2)' }} />
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

function historyEventLabel(type: ScheduleHistoryRecord['type']): string {
  if (type === 'created') return 'Schedule created'
  if (type === 'claimed') return 'USDC claimed'
  return 'Schedule revoked'
}

function ScheduleTransactionHistory({ vaultAddress, scheduleId, chainId }: { vaultAddress: Address; scheduleId: bigint; chainId: number }) {
  const [expanded, setExpanded] = useState(false)
  const { records, status, error, retry } = useScheduleTransactionHistory({ vaultAddress, scheduleId, enabled: expanded })

  const copyHash = (hash: string) => {
    const clipboard = navigator.clipboard
    if (!clipboard) return
    void clipboard.writeText(hash).then(() => toast.success('Transaction hash copied'))
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <button
        onClick={() => setExpanded(value => !value)}
        className="flex items-center justify-between px-5 py-3 text-xs font-medium w-full transition-colors"
        style={{ color: 'var(--subtle)', background: expanded ? 'var(--surface-elevated)' : 'transparent' }}
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-1.5"><History size={13} />Transaction History</span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {expanded && (
        <div className="px-5 pb-4 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          {status === 'loading' && <p className="text-xs" style={{ color: 'var(--muted)' }}>Loading verified transaction history…</p>}
          {status === 'empty' && <p className="text-xs" style={{ color: 'var(--muted)' }}>No verified transaction history is available yet.</p>}
          {status === 'degraded' && records.length === 0 && (
            <div className="flex items-center justify-between gap-3 text-xs" style={{ color: 'var(--muted)' }}>
              <span>{error ?? 'Transaction history is temporarily unavailable.'}</span>
              <button onClick={retry} className="font-semibold shrink-0" style={{ color: 'var(--accent)' }}>Retry</button>
            </div>
          )}
          {status === 'degraded' && records.length > 0 && (
            <div className="flex items-center justify-between gap-3 mb-2 text-xs" style={{ color: 'var(--muted)' }}>
              <span>Some transaction details are temporarily unavailable.</span>
              <button onClick={retry} className="font-semibold shrink-0" style={{ color: 'var(--accent)' }}>Retry</button>
            </div>
          )}
          {records.length > 0 && (
            <div className="flex flex-col gap-2">
              {records.map(record => (
                <div key={`${record.vaultAddress}-${record.scheduleId.toString()}-${record.txHash}-${record.logIndex}`} className="rounded-xl px-3 py-2.5" style={{ background: 'var(--surface-muted)' }}>
                  <div className="flex items-start gap-2">
                    <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--surface-elevated)' }}>
                      {record.type === 'created' ? <History size={13} style={{ color: 'var(--accent)' }} /> : record.type === 'claimed' ? <CheckCircle2 size={13} style={{ color: 'var(--success)' }} /> : <XCircle size={13} style={{ color: 'var(--danger)' }} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>{historyEventLabel(record.type)}</span>
                        {record.amount > 0n && <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--ink-2)' }}>{fmtUsdc(record.amount)} USDC</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" style={{ color: 'var(--muted)' }}>
                        <span>{record.timestamp === undefined ? 'Timestamp unavailable' : fmtTimestamp(Number(record.timestamp))}</span>
                        <span style={{ color: record.status === 'confirmed' ? 'var(--success)' : record.status === 'failed' ? 'var(--danger)' : 'var(--subtle)' }}>{record.status === 'confirmed' ? 'Confirmed' : record.status === 'failed' ? 'Failed' : 'Unavailable'}</span>
                        {record.from && <span className="mono">from {fmtAddr(record.from)}</span>}
                      </div>
                      {record.txHash && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="mono text-[11px]" style={{ color: 'var(--subtle)' }}>{fmtAddr(record.txHash)}</span>
                          <button onClick={() => copyHash(record.txHash)} aria-label="Copy transaction hash" className="p-0.5" style={{ color: 'var(--subtle)' }}><Copy size={11} /></button>
                          <a href={buildTxExplorerUrl(chainId, record.txHash)} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>View on Explorer</a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ScheduleCard ─────────────────────────────────────────────────────────────
function ScheduleCard({ id, isOwner, isMine, contractConfig = CONTRACT, contractDeployed = CONTRACT_DEPLOYED, contractError = CONTRACT_CONFIG_ERROR, prefetchedSchedule, prefetchedClaimable, onUpdated }: {
  id: bigint
  isOwner: boolean
  isMine: boolean
  contractConfig?: VestingContractConfig
  contractDeployed?: boolean
  contractError?: string | null
  prefetchedSchedule?: VestingSchedule
  prefetchedClaimable?: bigint
  onUpdated?: () => void
}) {
  const { address } = useAccount()
  const [expanded, setExpanded] = useState(false)
  const [showRevokeModal, setShowRevokeModal] = useState(false)

  const { data: raw, refetch } = useReadContract({ ...contractConfig, functionName: 'getSchedule', args: [id], query: { enabled: prefetchedSchedule === undefined } })
  const { data: claimable, refetch: refetchClaimable } = useReadContract({ ...contractConfig, functionName: 'claimableAmount', args: [id], query: { enabled: prefetchedClaimable === undefined } })
  const { writeContract, data: txHash, isPending, reset: resetWrite } = useWriteContract()
  const { data: receipt, isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const handleClaim = () => {
    if (!contractDeployed) { toast.error(contractError ?? 'Vesting contract is not configured.'); return }
    try { writeContract({ ...contractConfig, functionName: 'claim', args: [id] }) }
    catch (e) { toast.error(parseOnchainError(e)) }
  }

  const handleRevokeConfirm = () => {
    if (!contractDeployed) { toast.error(contractError ?? 'Vesting contract is not configured.'); return }
    try {
      writeContract({ ...contractConfig, functionName: 'revoke', args: [id] })
      setShowRevokeModal(false)
    } catch (e) {
      toast.error(parseOnchainError(e))
      setShowRevokeModal(false)
    }
  }

  useEffect(() => {
    if (isSuccess) {
      if (receipt && address) {
        appendLocalVestingRecords(decodeConfirmedVestingReceipt({
          chainId: contractConfig.chainId,
          wallet: address,
          vaultAddress: contractConfig.address,
        }, receipt))
      }
      toast.success('Transaction confirmed!', {
        action: txHash ? { label: 'Explorer', onClick: () => window.open(buildTxExplorerUrl(contractConfig.chainId, txHash), '_blank') } : undefined,
      })
      void refetch()
      void refetchClaimable()
      onUpdated?.()
      resetWrite()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, contractConfig.address, contractConfig.chainId, isSuccess, receipt, refetch, refetchClaimable, resetWrite, txHash, onUpdated])

  const s = prefetchedSchedule ?? normalizeVestingSchedule(raw)
  if (!s || s.totalAmount === 0n) return null

  const now = getNow()
  const status = getStatus(s, now)
  const vested = computeVested(s, now)
  const vestedPct = pct(vested, s.totalAmount)
  const claimedPct = pct(s.claimedAmount, s.totalAmount)
  const claimableAmt = prefetchedClaimable ?? (claimable as bigint | undefined) ?? 0n
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
              <a href={buildAddressExplorerUrl(contractConfig.chainId, s.beneficiary)} target="_blank" rel="noopener noreferrer"
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
        <ScheduleTransactionHistory vaultAddress={contractConfig.address} scheduleId={id} chainId={contractConfig.chainId} />
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
function CreateScheduleForm({ onCreated, contractConfig = CONTRACT, usdcAddress = USDC_ADDRESS, usdcDecimals = USDC_DECIMALS, contractDeployed = CONTRACT_DEPLOYED, contractError = CONTRACT_CONFIG_ERROR }: {
  onCreated: () => void
  contractConfig?: VestingContractConfig
  usdcAddress?: Address
  usdcDecimals?: number
  contractDeployed?: boolean
  contractError?: string | null
}) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const chainTime = useChainTime()
  const [form, setForm] = useState({ beneficiary: '', amount: '', cliffValue: '30', cliffUnit: 'days' as DurationUnit, vestingValue: '365', vestingUnit: 'days' as DurationUnit })
  const [step, setStep] = useState<'idle' | 'approve' | 'create'>('idle')

  const { writeContract: approve, data: approveTx, isPending: approvePending } = useWriteContract()
  const { isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveTx })
  const { writeContract: create, data: createTx, isPending: createPending } = useWriteContract()
  const { data: createReceipt, isLoading: createConfirming, isSuccess: createSuccess } = useWaitForTransactionReceipt({ hash: createTx })

  useEffect(() => {
    if (createSuccess) {
      if (createReceipt && address) {
        appendLocalVestingRecords(decodeConfirmedVestingReceipt({
          chainId: contractConfig.chainId,
          wallet: address,
          vaultAddress: contractConfig.address,
        }, createReceipt))
      }
      toast.success('Vesting schedule created!', {
        action: createTx ? { label: 'Explorer', onClick: () => window.open(buildTxExplorerUrl(contractConfig.chainId, createTx), '_blank') } : undefined,
      })
      setStep('idle')
      setForm({ beneficiary: '', amount: '', cliffValue: '30', cliffUnit: 'days', vestingValue: '365', vestingUnit: 'days' })
      onCreated()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, contractConfig.address, contractConfig.chainId, createReceipt, createSuccess, createTx, onCreated])

  const isWrongChain = chainId !== contractConfig.chainId
  const durationError = validateDurationPair(form.cliffValue, form.cliffUnit, form.vestingValue, form.vestingUnit)
  const cliffSeconds = durationError ? undefined : durationToSeconds(form.cliffValue, form.cliffUnit)
  const vestingSeconds = durationError ? undefined : durationToSeconds(form.vestingValue, form.vestingUnit)
  const previewStart = BigInt(scheduleStartFromChainTime(chainTime))
  const previewCliff = cliffSeconds === undefined ? undefined : previewStart + cliffSeconds
  const previewEnd = vestingSeconds === undefined ? undefined : previewStart + vestingSeconds
  const scheduleTimeError = durationError === undefined && cliffSeconds !== undefined && vestingSeconds !== undefined
    ? validateScheduleTimes(previewStart, cliffSeconds, vestingSeconds)
    : undefined
  const validationError = durationError ?? scheduleTimeError
  const formatPreviewTimestamp = (timestamp: bigint | undefined) => {
    if (timestamp === undefined) return '—'
    return isDisplayableTimestamp(timestamp) ? fmtTimestamp(Number(timestamp)) : 'Beyond calendar range'
  }
  const isValid =
    form.beneficiary.startsWith('0x') && form.beneficiary.length === 42 &&
    parseFloat(form.amount) > 0 &&
    validationError === undefined

  const handleApprove = () => {
    if (!contractDeployed) { toast.error(contractError ?? 'Vesting contract is not configured.'); return }
    if (isWrongChain) { switchChain({ chainId: contractConfig.chainId }); return }
    if (!isValid) return
    try {
      const rawAmount = parseUnitsExact(form.amount, usdcDecimals)
      approve({ address: usdcAddress, abi: erc20Abi, functionName: 'approve', args: [contractConfig.address, rawAmount], chainId: contractConfig.chainId })
      setStep('approve')
    } catch (e) { toast.error(parseOnchainError(e)) }
  }

  const handleCreate = () => {
    if (!contractDeployed) { toast.error(contractError ?? 'Vesting contract is not configured.'); return }
    if (!isValid) return
    try {
      const rawAmount = parseUnitsExact(form.amount, usdcDecimals)
      if (cliffSeconds === undefined || vestingSeconds === undefined) return
      create({
        ...contractConfig,
        functionName: 'createSchedule',
        args: [form.beneficiary as `0x${string}`, rawAmount, cliffSeconds, vestingSeconds, previewStart],
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
      {!contractDeployed && (
        <div className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'rgba(234,179,8,0.3)', color: 'var(--text)' }}>
          {contractError ?? 'Vesting contract is not configured for this network.'}
        </div>
      )}
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
              Cliff duration<Tooltip text="No tokens unlock before this duration. Set to 0 for no cliff." />
            </span>
            <div className="flex gap-2">
              <input type="number" min="0" step="1" value={form.cliffValue}
                onChange={e => setForm(f => ({ ...f, cliffValue: e.target.value }))}
                className="min-w-0 flex-1 rounded-xl px-3 py-3 text-sm font-medium tabular-nums outline-none"
                style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
              <select value={form.cliffUnit} aria-label="Cliff duration unit"
                onChange={e => setForm(f => ({ ...f, cliffUnit: e.target.value as DurationUnit }))}
                className="rounded-xl px-2 py-3 text-xs font-semibold outline-none"
                style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="flex items-center text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>
              Vesting duration<Tooltip text="Total duration over which tokens unlock linearly after the cliff." />
            </span>
            <div className="flex gap-2">
              <input type="number" min="1" step="1" value={form.vestingValue}
                onChange={e => setForm(f => ({ ...f, vestingValue: e.target.value }))}
                className="min-w-0 flex-1 rounded-xl px-3 py-3 text-sm font-medium tabular-nums outline-none"
                style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
              <select value={form.vestingUnit} aria-label="Vesting duration unit"
                onChange={e => setForm(f => ({ ...f, vestingUnit: e.target.value as DurationUnit }))}
                className="rounded-xl px-2 py-3 text-xs font-semibold outline-none"
                style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
          </label>
        </div>
        {validationError && (
          <p className="text-xs rounded-xl px-3 py-2" style={{ background: 'var(--danger-dim)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.2)' }}>
            {validationError}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl px-4 py-3 text-xs" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}>
        <span style={{ color: 'var(--subtle)' }}>Beneficiary</span><span className="mono truncate text-right" style={{ color: 'var(--ink-2)' }}>{form.beneficiary || '—'}</span>
        <span style={{ color: 'var(--subtle)' }}>Total USDC</span><span className="tabular-nums text-right" style={{ color: 'var(--ink-2)' }}>{form.amount || '—'} USDC</span>
        <span style={{ color: 'var(--subtle)' }}>Vesting start</span><span className="text-right" style={{ color: 'var(--ink-2)' }}>{formatPreviewTimestamp(previewStart)}</span>
        <span style={{ color: 'var(--subtle)' }}>Cliff unlock</span><span className="text-right" style={{ color: 'var(--ink-2)' }}>{formatPreviewTimestamp(previewCliff)}</span>
        <span style={{ color: 'var(--subtle)' }}>Vesting completion</span><span className="text-right" style={{ color: 'var(--ink-2)' }}>{formatPreviewTimestamp(previewEnd)}</span>
        <span style={{ color: 'var(--subtle)' }}>Contract</span><span className="mono truncate text-right" style={{ color: 'var(--ink-2)' }}>{fmtAddr(contractConfig.address)}</span>
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
    </div>
  )
}

// ─── ScheduleLookup ───────────────────────────────────────────────────────────
function ScheduleLookup({ refreshKey, contractConfig = CONTRACT, contractDeployed = CONTRACT_DEPLOYED, contractError = CONTRACT_CONFIG_ERROR }: {
  refreshKey: number
  contractConfig?: VestingContractConfig
  contractDeployed?: boolean
  contractError?: string | null
}) {
  const [input, setInput] = useState('')
  const [ids, setIds] = useState<bigint[] | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [isMine, setIsMine] = useState(false)
  const [lookupNonce, setLookupNonce] = useState(0)
  const { address } = useAccount()

  const { refetch: fetchByAddress } = useReadContract({
    ...contractConfig, functionName: 'getScheduleIds', args: [input as `0x${string}`], query: { enabled: false },
  })
  const { data: ownerAddr } = useReadContract({ ...contractConfig, functionName: 'owner' })

  const doLookup = (addr: string, mine: boolean) => {
    if (!addr.startsWith('0x') || addr.length !== 42) { toast.error('Enter a valid 0x address'); return }
    setInput(addr)
    setIsMine(mine)
    setIsOwner(address?.toLowerCase() === (ownerAddr as string | undefined)?.toLowerCase())
    setLookupNonce(n => n + 1)
  }

  const handleLookup = () => void doLookup(input, false)
  const handleMySchedules = () => {
    if (!address) { toast.error('Connect your wallet first'); return }
    setInput(address)
    void doLookup(address, true)
  }

  useEffect(() => {
    if (lookupNonce === 0 || !input) return
    void fetchByAddress().then(res => {
      setIds((res.data as bigint[] | undefined) ?? [])
    }).catch(() => setIds([]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupNonce, refreshKey])

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
            {ids.map(id => <ScheduleCard key={id.toString()} id={id} isOwner={isOwner} isMine={isMine} contractConfig={contractConfig} contractDeployed={contractDeployed} contractError={contractError} />)}
          </div>
        )
      )}
    </div>
  )
}

// ─── Page wrappers ────────────────────────────────────────────────────────────
function DiscoveredVestingSchedules({ address, managedVault, isOwner }: { address: Address; managedVault?: Address; isOwner: boolean }) {
  const { logs, loading, syncing, error, refresh } = useVestingEvents()
  const directReads = useBeneficiaryVestingSchedules(address)
  const directByKey = useMemo(() => new Map(
    directReads.schedules.map(item => [`${item.vaultAddress.toLowerCase()}:${item.scheduleId.toString()}`, item]),
  ), [directReads.schedules])
  const refs = useMemo(() => {
    const indexedRefs = selectMyVestingScheduleLogs(logs, address, isOwner ? managedVault : undefined)
    return mergeScheduleRefs(directReads.refs, indexedRefs)
  }, [address, directReads.refs, isOwner, logs, managedVault])

  if (directReads.error && refs.length === 0 && !directReads.isLoading && !loading && !syncing) {
    return <p className="text-xs" style={{ color: 'var(--muted)' }}>Vesting schedules are temporarily unavailable. <button onClick={directReads.refresh} className="font-semibold" style={{ color: 'var(--accent)', background: 'none', border: 0, padding: 0 }}>Retry</button></p>
  }
  if ((loading || syncing) && refs.length === 0) return <p className="text-xs" style={{ color: 'var(--muted)' }}>Loading vesting schedules…</p>
  if (directReads.isLoading && refs.length === 0) return <p className="text-xs" style={{ color: 'var(--muted)' }}>Reading vesting schedules across supported vaults...</p>
  if (error && refs.length === 0 && !loading && !syncing) {
    return <p className="text-xs" style={{ color: 'var(--muted)' }}>Vesting history is temporarily unavailable. <button onClick={refresh} className="font-semibold" style={{ color: 'var(--accent)', background: 'none', border: 0, padding: 0 }}>Retry</button></p>
  }
  if (refs.length === 0) return null

  return <div className="flex flex-col gap-3">
    {directReads.error && <p className="text-xs" style={{ color: 'var(--muted)' }}>Some schedule details are temporarily unavailable. <button onClick={directReads.refresh} className="font-semibold" style={{ color: 'var(--accent)', background: 'none', border: 0, padding: 0 }}>Retry</button></p>}
    <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>{isOwner ? 'Managed and beneficiary schedules' : 'Discovered schedules'}</p>
    {refs.map(log => {
      const direct = directByKey.get(`${log.vaultAddress.toLowerCase()}:${log.scheduleId.toString()}`)
      return <ScheduleCard
        key={`${log.vaultAddress}-${log.scheduleId.toString()}`}
        id={log.scheduleId}
        isOwner={isOwner && managedVault?.toLowerCase() === log.vaultAddress.toLowerCase()}
        isMine
        contractConfig={{ ...CONTRACT, address: log.vaultAddress }}
        contractDeployed
        contractError={null}
        prefetchedSchedule={direct?.schedule}
        prefetchedClaimable={direct?.claimable}
        onUpdated={direct ? directReads.refresh : undefined}
      />
    })}
  </div>
}

function MyVestingPage({ refreshKey }: { refreshKey: number }) {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()
  const vault = useUserVestingVault()
  const activeContract = vault.contract ?? CONTRACT
  const { data: ownerAddr } = useReadContract({ ...activeContract, functionName: 'owner', query: { enabled: vault.vaultAddress !== undefined } })
  const { data: legacyOwnerAddr } = useReadContract({ ...CONTRACT, functionName: 'owner', query: { enabled: vault.vaultAddress === undefined } })
  const isOwner = vault.vaultAddress !== undefined
    ? isSelfServiceVaultOwner(address, ownerAddr as string | undefined)
    : isSelfServiceVaultOwner(address, legacyOwnerAddr as string | undefined)
  const managedVault = vault.vaultAddress ?? (isOwner ? CONTRACT_ADDRESS : undefined)

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
        {isOwner ? (
          <button
            onClick={() => void navigate('/vesting/create')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
          >
            + New Schedule
          </button>
        ) : <VestingVaultSetup />}
      </div>
      <DiscoveredVestingSchedules address={address!} managedVault={managedVault} isOwner={isOwner} />
      <ScheduleLookup refreshKey={refreshKey} contractConfig={activeContract} contractDeployed={vault.vaultAddress ? true : CONTRACT_DEPLOYED} contractError={vault.vaultAddress ? null : CONTRACT_CONFIG_ERROR} />
    </div>
  )
}

function CreateVestingPage({ onCreated }: { onCreated: () => void }) {
  const navigate = useNavigate()
  const { address } = useAccount()
  const vault = useUserVestingVault()
  const activeContract = vault.contract
  const { data: ownerAddr, isLoading: ownerLoading } = useReadContract({ ...(activeContract ?? CONTRACT), functionName: 'owner', query: { enabled: activeContract !== undefined } })
  const { data: legacyOwnerAddr, isLoading: legacyOwnerLoading } = useReadContract({ ...CONTRACT, functionName: 'owner', query: { enabled: vault.vaultAddress === undefined } })
  const isOwner = vault.vaultAddress !== undefined
    ? isSelfServiceVaultOwner(address, ownerAddr as string | undefined)
    : isSelfServiceVaultOwner(address, legacyOwnerAddr as string | undefined)
  const formContract = vault.contract ?? (isOwner ? CONTRACT : undefined)

  if (vault.isLoading || ownerLoading || legacyOwnerLoading) return <div className="px-6 py-8 max-w-2xl mx-auto"><p className="text-sm" style={{ color: 'var(--muted)' }}>Checking your vesting vault…</p></div>
  if (!formContract) return <div className="px-6 py-8 max-w-2xl mx-auto"><VestingVaultSetup /></div>
  if (!isOwner) return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Lock size={28} style={{ color: 'var(--subtle)' }} />
        <p className="font-semibold" style={{ color: 'var(--ink)' }}>Owner access required</p>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Your vault owner could not be verified onchain.</p>
      </div>
    </div>
  )

  return (
    <div className="px-6 py-6 max-w-2xl mx-auto w-full">
      <div className="mb-6">
        <h2 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Create Vesting Schedule</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Lock USDC for a beneficiary with cliff + linear vesting</p>
      </div>
      <CreateScheduleForm
        contractConfig={formContract}
        usdcAddress={vault.contract ? SELF_SERVICE_USDC_ADDRESS : USDC_ADDRESS}
        usdcDecimals={vault.contract ? SELF_SERVICE_USDC_DECIMALS : USDC_DECIMALS}
        onCreated={() => { onCreated(); void navigate('/vesting') }}
      />
    </div>
  )
}

function BulkVestingPage({ onCreated }: { onCreated: () => void }) {
  const { address } = useAccount()
  const vault = useUserVestingVault()
  const activeContract = vault.contract
  const { data: ownerAddr, isLoading: ownerLoading } = useReadContract({ ...(activeContract ?? CONTRACT), functionName: 'owner', query: { enabled: activeContract !== undefined } })
  const { data: legacyOwnerAddr, isLoading: legacyOwnerLoading } = useReadContract({ ...CONTRACT, functionName: 'owner', query: { enabled: vault.vaultAddress === undefined } })
  const isOwner = vault.vaultAddress !== undefined
    ? isSelfServiceVaultOwner(address, ownerAddr as string | undefined)
    : isSelfServiceVaultOwner(address, legacyOwnerAddr as string | undefined)
  const bulkContract = vault.contract ?? (isOwner ? CONTRACT : undefined)

  if (vault.isLoading || ownerLoading || legacyOwnerLoading) return <div className="px-6 py-8 max-w-2xl mx-auto"><p className="text-sm" style={{ color: 'var(--muted)' }}>Checking your vesting vault…</p></div>
  if (!bulkContract) return <div className="px-6 py-8 max-w-2xl mx-auto"><VestingVaultSetup /></div>
  if (!isOwner) return (
    <div className="px-6 py-8 max-w-2xl mx-auto">
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Lock size={28} style={{ color: 'var(--subtle)' }} />
        <p className="font-semibold" style={{ color: 'var(--ink)' }}>Owner access required</p>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Your vault owner could not be verified onchain.</p>
      </div>
    </div>
  )

  return (
    <div className="px-6 py-6 max-w-2xl mx-auto w-full">
      <BulkVesting
        onCreated={onCreated}
        contractConfig={bulkContract}
        usdcAddress={vault.contract ? SELF_SERVICE_USDC_ADDRESS : USDC_ADDRESS}
        usdcDecimals={vault.contract ? SELF_SERVICE_USDC_DECIMALS : USDC_DECIMALS}
        chainId={vault.contract ? SELF_SERVICE_CHAIN_ID : bulkContract.chainId}
      />
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
  const vault = useUserVestingVault()
  return (
    <div className="px-6 py-6 max-w-3xl mx-auto w-full">
      <div className="mb-6">
        <h2 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>Treasury</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>USDC allocation overview and beneficiary breakdown</p>
      </div>
      {vault.isLoading ? <p className="text-sm" style={{ color: 'var(--muted)' }}>Checking your vesting vault…</p> : <TreasuryDashboard vaultAddress={vault.vaultAddress ?? CONTRACT_ADDRESS} />}
    </div>
  )
}

// ─── App Routes ───────────────────────────────────────────────────────────────
function AppRoutes() {
  const [refreshKey, setRefreshKey] = useState(0)
  const triggerRefresh = () => setRefreshKey(k => k + 1)

  return (
    <Routes>
      <Route path={LANDING_PATH} element={<LandingPage />} />
      <Route element={<WorkspaceShell onRefresh={triggerRefresh} />}>
        {/* Explicit workspace namespace. */}
        <Route path="app"                 element={<OverviewPage refreshKey={refreshKey} />} />
        <Route path="app/activity"          element={<ActivityPage />} />
        <Route path="app/vesting"          element={<MyVestingPage refreshKey={refreshKey} />} />
        <Route path="app/vesting/create"   element={<CreateVestingPage onCreated={triggerRefresh} />} />
        <Route path="app/vesting/bulk"     element={<BulkVestingPage onCreated={triggerRefresh} />} />
        <Route path="app/vesting/timeline" element={<TimelinePage />} />
        <Route path="app/vesting/team"     element={<TeamManagementPage />} />
        <Route path="app/treasury"         element={<TreasuryPage />} />
        <Route path="app/analytics"        element={<AnalyticsPage />} />
        <Route path="app/reports"          element={<ReportsPage />} />
        <Route path="app/settings"         element={<SettingsPage />} />
        <Route path="app/help"             element={<HelpPage />} />
        <Route path="app/granthub/*"       element={<GrantHubWrapper />} />

        {/* Existing paths remain valid for bookmarks and internal links. */}
        <Route path="activity"          element={<ActivityPage />} />
        <Route path="vesting"          element={<MyVestingPage refreshKey={refreshKey} />} />
        <Route path="vesting/create"   element={<CreateVestingPage onCreated={triggerRefresh} />} />
        <Route path="vesting/bulk"     element={<BulkVestingPage onCreated={triggerRefresh} />} />
        <Route path="vesting/timeline" element={<TimelinePage />} />
        <Route path="vesting/team"     element={<TeamManagementPage />} />
        <Route path="treasury"         element={<TreasuryPage />} />
        <Route path="analytics"        element={<AnalyticsPage />} />
        <Route path="reports"          element={<ReportsPage />} />
        <Route path="settings"         element={<SettingsPage />} />
        <Route path="help"             element={<HelpPage />} />
        <Route path="granthub/*"       element={<GrantHubWrapper />} />

        <Route path="app/*" element={<Navigate to={APP_PATH} replace />} />
        <Route path="*" element={<Navigate to={LANDING_PATH} replace />} />
      </Route>
    </Routes>
  )
}

function WorkspaceShell({ onRefresh }: { onRefresh: () => void }) {
  return (
    <AppShell onRefresh={onRefresh}>
      <Outlet />
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
