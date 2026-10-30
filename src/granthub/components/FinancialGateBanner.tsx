import { GRANTHUB_FINANCIAL_ENABLED } from '../feature-flags'
import { ShieldAlert } from 'lucide-react'

/**
 * Shows an informational banner when GrantHub financial features
 * (deposits, award activation) are disabled by the VITE_GRANTHUB_FINANCIAL flag.
 * Renders nothing when the flag is enabled.
 */
export function FinancialGateBanner() {
  if (GRANTHUB_FINANCIAL_ENABLED) return null
  return (
    <div
      className="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm"
      style={{
        background: 'rgba(234,179,8,0.08)',
        borderColor: 'rgba(234,179,8,0.3)',
        color: 'var(--text)',
      }}
    >
      <ShieldAlert size={16} className="mt-0.5 shrink-0" style={{ color: '#EAB308' }} />
      <span>
        <strong>Funding features are currently paused.</strong>{' '}
        Grant discovery, applications, and reviews are fully operational.
        USDC deposits and award activation will be enabled after our external
        security audit completes.
      </span>
    </div>
  )
}
