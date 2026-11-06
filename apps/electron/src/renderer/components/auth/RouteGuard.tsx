// apps/electron/src/renderer/components/auth/RouteGuard.tsx
/**
 * RouteGuard — 认证状态路由守卫
 *
 * authStatus 驱动：
 *   uninitialized / checking → AuthSplash
 *   unauthenticated          → LoginPage（含 oauth-pending 子态）
 *   authenticated            → children（AppShell）
 *
 * ASCI 自 2026-05-29 起将所有身份委托给 OPENSCI；
 * 不再有 register / reset / verify 路由。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { authStatusAtom, authRouteAtom } from '@/atoms/auth-atoms.ts'
import { useInitAuth } from '@/hooks/useAuth.ts'
import { AuthSplash } from './AuthSplash.tsx'
import { LoginPage } from './LoginPage.tsx'

interface RouteGuardProps {
  children: React.ReactNode
}

export function RouteGuard({ children }: RouteGuardProps): React.ReactElement {
  const status = useAtomValue(authStatusAtom)
  const authRoute = useAtomValue(authRouteAtom)
  const initAuth = useInitAuth()

  React.useEffect(() => {
    void initAuth()
  }, [initAuth])

  if (status === 'uninitialized' || status === 'checking') {
    return <AuthSplash />
  }

  if (status === 'unauthenticated') {
    if (authRoute === 'oauth-pending') {
      return <LoginPage initialOAuthPending />
    }
    return <LoginPage />
  }

  return <>{children}</>
}
