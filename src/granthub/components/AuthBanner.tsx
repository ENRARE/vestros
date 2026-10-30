/**
 * AuthBanner — prompts wallet-connected users to sign in to GrantHub
 * for authenticated actions (apply, review, create grant, etc.)
 */
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { useAuth } from '../useAuth'
import { Wallet, LogIn } from 'lucide-react'

export function AuthBanner() {
  const { address: walletAddr } = useAccount()
  const { address: sessionAddr, loading, signIn } = useAuth()

  if (!walletAddr) {
    return (
      <div
        className="rounded-xl px-4 py-3 flex items-center gap-3"
        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
      >
        <Wallet size={16} style={{ color: 'var(--subtle)' }} />
        <span className="text-sm flex-1" style={{ color: 'var(--muted)' }}>Connect your wallet to apply, review, or manage grants.</span>
        <ConnectKitButton />
      </div>
    )
  }

  if (!sessionAddr) {
    return (
      <div
        className="rounded-xl px-4 py-3 flex items-center gap-3"
        style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent)' }}
      >
        <LogIn size={16} style={{ color: 'var(--accent)' }} />
        <span className="text-sm flex-1" style={{ color: 'var(--ink-2)' }}>Sign in with your wallet to access GrantHub features.</span>
        <button
          onClick={() => void signIn(walletAddr)}
          disabled={loading}
          className="px-3 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--accent-text)', minHeight: 32 }}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    )
  }

  return null
}
