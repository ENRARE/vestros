import type { CSSProperties } from 'react'
import { AVATAR_PRESETS, DEFAULT_AVATAR_ID, type AvatarPresetId } from '@/features/profile/avatar'

interface ProfileAvatarProps {
  avatarId?: AvatarPresetId
  size?: number
  className?: string
}

function AvatarGlyph({ avatarId, foreground, accent }: { avatarId: AvatarPresetId; foreground: string; accent: string }) {
  if (avatarId === 'orbit') {
    return (
      <>
        <circle cx="12" cy="12" r="8.5" fill="none" stroke={accent} strokeWidth="1.2" strokeDasharray="2 2" />
        <circle cx="12" cy="9" r="3.1" fill={foreground} />
        <path d="M5.7 20c.6-3.1 2.9-5 6.3-5s5.7 1.9 6.3 5" fill={foreground} />
      </>
    )
  }

  if (avatarId === 'sage') {
    return (
      <>
        <path d="M12 4.2c2.8 0 4.7 2 4.7 4.8 0 2.7-1.9 4.6-4.7 4.6s-4.7-1.9-4.7-4.6c0-2.8 1.9-4.8 4.7-4.8Z" fill={foreground} />
        <path d="M4.8 20c.8-3.2 3.2-5 7.2-5s6.4 1.8 7.2 5" fill={foreground} />
        <path d="M17.4 3.8c2.1.2 3.2 1.4 3.4 3.6-1.8-.1-3-1.2-3.4-3.6Z" fill={accent} />
      </>
    )
  }

  if (avatarId === 'signal') {
    return (
      <>
        <path d="M7 7.2 12 4l5 3.2v5.5c0 3.1-2 5.4-5 6.8-3-1.4-5-3.7-5-6.8V7.2Z" fill={foreground} />
        <circle cx="10" cy="11" r="1" fill={accent} />
        <circle cx="14" cy="11" r="1" fill={accent} />
        <path d="M9.4 14.4c1.5 1 2.7 1 4.2 0" fill="none" stroke={accent} strokeWidth="1.1" strokeLinecap="round" />
      </>
    )
  }

  if (avatarId === 'ember') {
    return (
      <>
        <path d="M12 3.8c3.1 0 5 2.2 5 5.1 0 2.8-1.9 4.8-5 4.8s-5-2-5-4.8c0-2.9 1.9-5.1 5-5.1Z" fill={foreground} />
        <path d="M4.4 20c.8-3.1 3.4-5 7.6-5s6.8 1.9 7.6 5" fill={foreground} />
        <path d="M6.1 6.1c1.6-2.1 3.7-3 5.9-3 2.2 0 4.3.9 5.9 3" fill="none" stroke={accent} strokeWidth="1.2" strokeLinecap="round" />
      </>
    )
  }

  return (
    <>
      <circle cx="12" cy="9" r="3.5" fill={foreground} />
      <path d="M5 20c.8-3.3 3.1-5.1 7-5.1s6.2 1.8 7 5.1" fill={foreground} />
      <path d="M4.6 7.3c1.5-2.5 3.9-3.8 7.4-3.8s5.9 1.3 7.4 3.8" fill="none" stroke={accent} strokeWidth="1.2" strokeLinecap="round" />
    </>
  )
}

export function ProfileAvatar({ avatarId = DEFAULT_AVATAR_ID, size = 32, className = '' }: ProfileAvatarProps) {
  const preset = AVATAR_PRESETS.find(option => option.id === avatarId) ?? AVATAR_PRESETS[0]
  const style = {
    width: size,
    height: size,
    background: preset.background,
    borderColor: `${preset.accent}66`,
  } as CSSProperties

  return (
    <span className={`profile-avatar profile-avatar-${preset.id} ${className}`.trim()} style={style} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.7)} height={Math.round(size * 0.7)} fill="none">
        <AvatarGlyph avatarId={preset.id} foreground={preset.foreground} accent={preset.accent} />
      </svg>
    </span>
  )
}
