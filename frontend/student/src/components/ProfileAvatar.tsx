import { resolvePhotoUrl } from '../services/api'

interface ProfileAvatarProps {
  name: string
  photoUrl?: string | null
  size?: 'small' | 'medium' | 'large'
  shape?: 'circle' | 'rounded'
}

export function ProfileAvatar({ name, photoUrl, size = 'medium', shape = 'circle' }: ProfileAvatarProps) {
  const imageUrl = resolvePhotoUrl(photoUrl)
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')

  return (
    <span className={`profile-avatar profile-avatar-${size} profile-avatar-${shape}`} aria-label={`${name} profile picture`}>
      {imageUrl ? <img src={imageUrl} alt="" loading="lazy" /> : <span aria-hidden="true">{initials || '?'}</span>}
    </span>
  )
}