export type AvatarPresetId = 'atlas' | 'orbit' | 'sage' | 'signal' | 'ember'

export interface AvatarPreset {
  id: AvatarPresetId
  label: string
  background: string
  foreground: string
  accent: string
}

export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  { id: 'atlas', label: 'Atlas', background: '#173452', foreground: '#D9ECFF', accent: '#5EA9E8' },
  { id: 'orbit', label: 'Orbit', background: '#2B2447', foreground: '#E6DEFF', accent: '#9A82E8' },
  { id: 'sage', label: 'Sage', background: '#173B3B', foreground: '#D7F1E8', accent: '#5FC0A1' },
  { id: 'signal', label: 'Signal', background: '#3B3020', foreground: '#FFF0D2', accent: '#E0AD5A' },
  { id: 'ember', label: 'Ember', background: '#42252D', foreground: '#FFE2E8', accent: '#E58398' },
]

export const DEFAULT_AVATAR_ID: AvatarPresetId = 'atlas'

export function avatarStorageKey(address?: string | null): string | null {
  const normalized = address?.trim().toLowerCase()
  return normalized ? `vestros-avatar:${normalized}` : null
}

export function isAvatarPresetId(value: unknown): value is AvatarPresetId {
  return typeof value === 'string' && AVATAR_PRESETS.some(preset => preset.id === value)
}
