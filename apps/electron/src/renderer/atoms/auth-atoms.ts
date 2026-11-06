// apps/electron/src/renderer/atoms/auth-atoms.ts
/**
 * Auth atoms - spec §四 4.4
 */

import { atom } from 'jotai'
import type { AuthRoute, AuthStatus, SessionMeta, User } from '@asci/shared'

export const authStatusAtom = atom<AuthStatus>('uninitialized')
export const currentUserAtom = atom<User | null>(null)
export const authRouteAtom = atom<AuthRoute>('login')
export const oauthPendingIdAtom = atom<string | null>(null)
export const sessionMetaAtom = atom<SessionMeta | null>(null)

export const isAuthenticatedAtom = atom((get) => get(authStatusAtom) === 'authenticated')
