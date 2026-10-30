/**
 * useAuth — GrantHub wallet-signature session.
 * Keeps the session in localStorage; exposes sign-in, sign-out, and the current address.
 */
import { useState, useCallback } from 'react'
import { useSignMessage } from 'wagmi'
import { fetchNonce, verifyAuth, getStoredSession, clearSession } from './api'
import { toast } from 'sonner'

export interface AuthState {
  address: string | null
  loading: boolean
  signIn: (walletAddress: string) => Promise<void>
  signOut: () => void
}

export function useAuth(): AuthState {
  const [address, setAddress] = useState<string | null>(() => getStoredSession()?.address ?? null)
  const [loading, setLoading] = useState(false)
  const { signMessageAsync } = useSignMessage()

  const signIn = useCallback(async (walletAddress: string) => {
    setLoading(true)
    try {
      const { nonce, message } = await fetchNonce(walletAddress)
      const signature = await signMessageAsync({ message })
      const { address: authedAddr } = await verifyAuth(nonce, signature, walletAddress)
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
    toast('Signed out')
  }, [])

  return { address, loading, signIn, signOut }
}
