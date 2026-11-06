// apps/electron/src/renderer/components/auth/GlobalListeners.tsx
/**
 * GlobalListeners — 跨进程认证事件订阅
 *
 * 订阅 main → renderer 的 STATE_CHANGED 事件，更新 auth atoms。
 * 返回 null，不渲染任何 UI。由 App.tsx 挂载。
 *
 * Deep link verify / reset 已在 2026-05-29 移除（OPENSCI SSO 后所有
 * 邮件验证 / 密码重置链路都走 opensci.io）；asci:// 仅承载 OAuth callback。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { useT } from '@/hooks/useT.ts'
import {
  authStatusAtom,
  currentUserAtom,
  authRouteAtom,
  oauthPendingIdAtom,
} from '@/atoms/auth-atoms.ts'

export function GlobalListeners(): null {
  const setStatus = useSetAtom(authStatusAtom)
  const setUser = useSetAtom(currentUserAtom)
  const setRoute = useSetAtom(authRouteAtom)
  const setOAuthPending = useSetAtom(oauthPendingIdAtom)
  const { t } = useT('auth')

  React.useEffect(() => {
    const offAuth = window.electronAPI.auth.onStateChanged((event) => {
      switch (event.type) {
        case 'login-success':
          setUser(event.user)
          setStatus('authenticated')
          setOAuthPending(null)
          setRoute('login')
          break
        case 'logout':
          setUser(null)
          setStatus('unauthenticated')
          setOAuthPending(null)
          setRoute('login')
          break
        case 'session-expired':
          setUser(null)
          setStatus('unauthenticated')
          // OAuth 进行中失败（token 交换被拒等）→ 清 pending，退回登录页而非卡在"登录中"
          setOAuthPending(null)
          setRoute('login')
          toast.warning(t(event.error ? `errors.${event.error.code}` : 'errors.session-expired'), { description: event.error?.message })
          break
        case 'user-updated':
          setUser(event.user)
          break
        case 'account-deleted':
          // 账户已删（服务端身份+遥测清空，本地研究库保留）→ 退回登录门
          setUser(null)
          setStatus('unauthenticated')
          setOAuthPending(null)
          setRoute('login')
          toast.success(t('profile.deleteConfirm.success'))
          break
      }
    })

    return () => {
      offAuth()
    }
  }, [setStatus, setUser, setRoute, setOAuthPending, t])

  return null
}
