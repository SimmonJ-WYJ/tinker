// apps/electron/src/renderer/lib/auth/account-menu-helpers.ts
import type { User } from '@asci/shared'

export function formatUserDisplay(user: User): string {
  if (user.nickname) return user.nickname
  return user.email.split('@')[0] ?? user.email
}

export function formatAvatarFallback(user: User): string {
  const src = user.nickname || user.email
  return src.charAt(0).toUpperCase()
}
