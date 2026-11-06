// apps/electron/src/renderer/hooks/useAuth.ts
/**
 * Auth hooks - spec §九 9.4
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { authStatusAtom, currentUserAtom, sessionMetaAtom } from '@/atoms/auth-atoms.ts'

export function useInitAuth(): () => Promise<void> {
  const setStatus = useSetAtom(authStatusAtom)
  const setUser = useSetAtom(currentUserAtom)
  const setMeta = useSetAtom(sessionMetaAtom)

  return React.useCallback(async () => {
    setStatus('checking')
    const [userResult, metaResult] = await Promise.all([
      window.electronAPI.auth.getCurrentUser(),
      window.electronAPI.auth.getSessionMeta(),
    ])
    if (userResult.ok && userResult.value !== null) {
      setUser(userResult.value)
      setStatus('authenticated')
    } else {
      setStatus('unauthenticated')
    }
    if (metaResult.ok && metaResult.value !== null) setMeta(metaResult.value)
    void window.electronAPI.auth.markRendererReady()
  }, [setStatus, setUser, setMeta])
}
