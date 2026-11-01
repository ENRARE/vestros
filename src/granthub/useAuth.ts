/** Shared GrantHub wallet-signature session. */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { fetchNonce, verifyAuth, validateSession, getStoredSession, clearSession } from './api'
import { toast } from 'sonner'

export interface AuthState {
  address: string | null
  loading: boolean
  signIn: (walletAddress: string) => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(() => getStoredSession()?.address ?? null)
  const [loading, setLoading] = useState(() => Boolean(getStoredSession()))
  const { address: walletAddress } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const mismatchNotice = useRef('')

  const refreshFromStorage = useCallback(() => {
    setAddress(getStoredSession()?.address ?? null)
  }, [])

  useEffect(() => {
    if (!getStoredSession()) return
    let active = true
    void validateSession()
      .then(session => { if (active) setAddress(session.address) })
      .catch(() => {
        if (active) {
          clearSession()
          setAddress(null)
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    window.addEventListener('gh-auth-change', refreshFromStorage)
    return () => window.removeEventListener('gh-auth-change', refreshFromStorage)
  }, [refreshFromStorage])

  const walletMismatch = Boolean(walletAddress && address && walletAddress.toLowerCase() !== address.toLowerCase())
  useEffect(() => {
    if (!walletMismatch || !walletAddress || !address) {
      mismatchNotice.current = ''
      return
    }
    const key = `${walletAddress.toLowerCase()}:${address.toLowerCase()}`
    if (mismatchNotice.current !== key) {
      mismatchNotice.current = key
      clearSession()
      window.dispatchEvent(new Event('gh-auth-change'))
      toast('Wallet changed. Sign in again to continue.')
    }
  }, [walletMismatch, walletAddress, address])

  const signIn = useCallback(async (wallet: string) => {
    const normalized = wallet.toLowerCase()
    setLoading(true)
    try {
      const existing = getStoredSession()
      if (existing?.address.toLowerCase() === normalized) {
        try {
          const valid = await validateSession()
          setAddress(valid.address)
          return
        } catch {
          clearSession()
          setAddress(null)
        }
      } else if (existing) {
        clearSession()
        setAddress(null)
      }

      const { nonce, message } = await fetchNonce(wallet)
      const signature = await signMessageAsync({ message })
      const { address: authedAddr } = await verifyAuth(nonce, signature, wallet)
      setAddress(authedAddr)
      toast.success('Signed in to GrantHub')
    } catch (err) {
      toast.error((err as Error).message ?? 'Sign-in failed')
    } finally {
      setLoading(false)
    }
  }, [signMessageAsync])

  const signOut = useCallback(() => {
    clearSession()
    setAddress(null)
    window.dispatchEvent(new Event('gh-auth-change'))
    toast('Signed out')
  }, [])

  const value = useMemo(() => ({ address, loading, signIn, signOut }), [address, loading, signIn, signOut])
  return createElement(AuthContext.Provider, { value: walletMismatch ? { ...value, address: null } : value }, children)
}

export function useAuth(): AuthState {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used inside AuthProvider')
  return auth
}
