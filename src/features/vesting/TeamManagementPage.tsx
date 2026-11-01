import { useAccount, useReadContract } from 'wagmi'
import { Lock } from 'lucide-react'
import { CONTRACT } from '@/contractConfig'
import TreasuryDashboard from '@/components/TreasuryDashboard'
import { SectionHeader } from '@/components/ui/Primitives'
import { VestingVaultSetup } from '@/components/VestingVaultSetup'
import { useUserVestingVault } from '@/hooks/useUserVestingVault'
import { isSelfServiceVaultOwner } from './selfServiceWorkflow'

export function TeamManagementPage() {
  const { address } = useAccount()
  const vault = useUserVestingVault()
  const { data: ownerAddr, isLoading: ownerLoading } = useReadContract({
    ...(vault.contract ?? CONTRACT),
    functionName: 'owner',
    query: { enabled: vault.vaultAddress !== undefined },
  })
  const { data: legacyOwnerAddr, isLoading: legacyOwnerLoading } = useReadContract({
    ...CONTRACT,
    functionName: 'owner',
    query: { enabled: vault.vaultAddress === undefined },
  })
  const isOwner = vault.vaultAddress !== undefined
    ? isSelfServiceVaultOwner(address, ownerAddr as string | undefined)
    : isSelfServiceVaultOwner(address, legacyOwnerAddr as string | undefined)

  if (vault.isLoading || ownerLoading || legacyOwnerLoading) {
    return <div className="max-w-4xl mx-auto px-6 py-8"><p className="text-sm" style={{ color: 'var(--muted)' }}>Checking your vesting vault…</p></div>
  }
  if (!vault.vaultAddress && !isOwner) {
    return <div className="max-w-4xl mx-auto px-6 py-8"><VestingVaultSetup /></div>
  }
  if (!isOwner) {
    return <div className="max-w-4xl mx-auto px-6 py-8"><div className="flex flex-col items-center gap-3 py-16 text-center"><Lock size={26} style={{ color: 'var(--subtle)' }} /><p className="font-semibold" style={{ color: 'var(--ink)' }}>Vault owner verification failed</p><p className="text-sm" style={{ color: 'var(--muted)' }}>This wallet is not authorized to manage the selected vault.</p></div></div>
  }

  return <div className="max-w-5xl mx-auto px-6 py-6 space-y-5"><SectionHeader title="Team Management" sub="Review beneficiaries, allocations, claims, and schedule history" /><TreasuryDashboard vaultAddress={vault.vaultAddress ?? CONTRACT.address} /></div>
}
