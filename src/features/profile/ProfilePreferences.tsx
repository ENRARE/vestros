import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAccount } from 'wagmi'
import { avatarStorageKey, DEFAULT_AVATAR_ID, isAvatarPresetId, type AvatarPresetId } from './avatar'

interface ProfilePreferencesState {
  avatarId: AvatarPresetId
  setAvatarId: (avatarId: AvatarPresetId) => void
}

const ProfilePreferencesContext = createContext<ProfilePreferencesState | null>(null)

function readStoredAvatar(address?: string): AvatarPresetId {
  const key = avatarStorageKey(address)
  if (!key || typeof window === 'undefined') return DEFAULT_AVATAR_ID
  try {
    const stored = window.localStorage.getItem(key)
    return isAvatarPresetId(stored) ? stored : DEFAULT_AVATAR_ID
  } catch {
    return DEFAULT_AVATAR_ID
  }
}

export function ProfilePreferencesProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount()
  const activeStorageKey = avatarStorageKey(address)
  const [storedAvatar, setStoredAvatar] = useState<{ key: string | null; avatarId: AvatarPresetId }>(() => ({
    key: activeStorageKey,
    avatarId: readStoredAvatar(address),
  }))
  const avatarId = storedAvatar.key === activeStorageKey ? storedAvatar.avatarId : readStoredAvatar(address)

  useEffect(() => {
    const key = avatarStorageKey(address)
    if (!key || typeof window === 'undefined') return

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key) return
      setStoredAvatar({ key, avatarId: isAvatarPresetId(event.newValue) ? event.newValue : DEFAULT_AVATAR_ID })
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [address])

  const setAvatarId = useCallback((nextAvatarId: AvatarPresetId) => {
    const key = avatarStorageKey(address)
    setStoredAvatar({ key, avatarId: nextAvatarId })
    if (!key || typeof window === 'undefined') return
    try { window.localStorage.setItem(key, nextAvatarId) } catch { /* local persistence is best effort */ }
  }, [address])

  const value = useMemo(() => ({ avatarId, setAvatarId }), [avatarId, setAvatarId])
  return <ProfilePreferencesContext.Provider value={value}>{children}</ProfilePreferencesContext.Provider>
}

export function useProfilePreferences(): ProfilePreferencesState {
  const preferences = useContext(ProfilePreferencesContext)
  if (!preferences) throw new Error('useProfilePreferences must be used inside ProfilePreferencesProvider')
  return preferences
}
