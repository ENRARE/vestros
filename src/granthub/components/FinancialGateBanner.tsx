import { GRANTHUB_FINANCIAL_ENABLED } from '../feature-flags'
import { ShieldAlert } from 'lucide-react'

/**
 * Shows a compact notice only on financial operation surfaces.
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
        <strong>Financial actions are disabled by default.</strong>{' '}
        Verified funding records remain read-only until authorization is enabled.
      </span>
    </div>
  )
}
