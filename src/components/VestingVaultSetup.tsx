import { AlertCircle, CheckCircle2, Info, LoaderCircle, Plus } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { useUserVestingVault } from '@/hooks/useUserVestingVault'
import { SELF_SERVICE_UNAVAILABLE_COPY, SELF_SERVICE_UNAVAILABLE_TITLE } from '@/hooks/userVestingVaultState'
import { SELF_SERVICE_CHAIN_ID } from '@/vestingFactoryConfig'

export function VestingVaultSetup() {
  const {
    isConnected,
    isLoading,
    isCreating,
    isConfigured,
    canCreate,
    vaultAddress,
    createTxHash,
    creationConfirmed,
    error,
    createVault,
  } = useUserVestingVault()

  if (vaultAddress) return null

  return (
    <section className="rounded-md border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-start gap-3">
        {creationConfirmed ? <CheckCircle2 size={18} style={{ color: 'var(--success)' }} /> : <Plus size={18} style={{ color: 'var(--accent)' }} />}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{isConnected && !isConfigured ? SELF_SERVICE_UNAVAILABLE_TITLE : 'Set up your vesting vault'}</h3>
          {!isConnected ? (
            <>
              <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>Connect your wallet to create schedules you control.</p>
              <div className="mt-3"><ConnectKitButton /></div>
            </>
          ) : !isConfigured ? (
            <div className="mt-2 flex items-start gap-2 text-xs" style={{ color: 'var(--muted)' }}>
              <Info size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
              <span>{SELF_SERVICE_UNAVAILABLE_COPY}</span>
            </div>
          ) : isLoading ? (
            <p className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}><LoaderCircle size={13} className="animate-spin" /> Checking your vault…</p>
          ) : (
            <>
              <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>Create one vault for this wallet. You will approve USDC only for your own vault.</p>
              <button type="button" onClick={createVault} disabled={!canCreate || isCreating} className="mt-3 inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}>
                {isCreating ? <LoaderCircle size={13} className="animate-spin" /> : <Plus size={13} />}
                {isCreating ? 'Confirming vault…' : 'Create your vault'}
              </button>
            </>
          )}
          {createTxHash && (
            <a className="mt-2 block truncate text-xs" style={{ color: 'var(--accent)' }} href={buildTxExplorerUrl(SELF_SERVICE_CHAIN_ID, createTxHash)} target="_blank" rel="noreferrer">
              {creationConfirmed ? 'Vault creation confirmed' : 'View vault transaction'}
            </a>
          )}
          {error && <p className="mt-2 flex items-start gap-2 text-xs" style={{ color: 'var(--danger)' }}><AlertCircle size={13} /> Vault creation failed. No vault was registered.</p>}
        </div>
      </div>
    </section>
  )
}
