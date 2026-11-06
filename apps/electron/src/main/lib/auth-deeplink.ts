// apps/electron/src/main/lib/auth-deeplink.ts
/**
 * Deep link handler - spec §六
 *
 * 注册 asci:// 协议；处理三类 URL：oauth callback / verify / reset
 * earlyQueue：renderer 未 ready 时缓冲；ready 后回放。
 * pendingOAuth：state nonce 反查 + 5 min 过期。
 */

import { parseAsciUrl, type ParsedAsciUrl } from './auth-deeplink-parser.ts'
import type { AuthProvider, AuthDeeplinkEvent } from '@asci/shared'
import { nowMs } from '@asci/shared'

const PENDING_TTL_MS = 5 * 60 * 1000

interface PendingOAuth {
  state: string
  provider: Exclude<AuthProvider, 'email'>
  createdAt: number
}

export interface AuthDeeplinkDeps {
  /** 由 AuthService 提供：处理 OAuth callback */
  onOAuthCallback: (pendingId: string, code: string | null, state: string, error: string | null) => Promise<void>
  /** 由 AuthService 提供：转发 verify / reset event 到 renderer */
  sendToRenderer: (event: AuthDeeplinkEvent) => void
  /** 提示 renderer "state 不匹配" 错误 */
  notifyOAuthError: (message: string) => void
}

export interface AuthDeeplinkHandler {
  start(pendingId: string, state: string, provider: Exclude<AuthProvider, 'email'>): void
  cancel(pendingId: string): void
  handle(url: string): void
  markRendererReady(): void
  // 测试 hook
  __peekPending(): ReadonlyMap<string, PendingOAuth>
}

export function createAuthDeeplinkHandler(deps: AuthDeeplinkDeps): AuthDeeplinkHandler {
  const pending = new Map<string, PendingOAuth>()
  const earlyQueue: string[] = []
  let rendererReady = false

  function expire(pendingId: string): void {
    pending.delete(pendingId)
  }

  function dispatch(parsed: ParsedAsciUrl): void {
    if (parsed.kind === 'oauth-callback') {
      // 反查 pendingId by state
      const entry = [...pending.entries()].find(([, v]) => v.state === parsed.state)
      if (!entry) {
        console.warn('[deeplink] oauth-state-mismatch:', parsed.state)
        deps.notifyOAuthError('oauth-state-mismatch')
        return
      }
      const [pendingId] = entry
      pending.delete(pendingId)
      void deps.onOAuthCallback(pendingId, parsed.code, parsed.state, parsed.error)
      return
    }
    if (parsed.kind === 'verify') {
      deps.sendToRenderer({ kind: 'verify', token: parsed.token })
      return
    }
    if (parsed.kind === 'reset') {
      deps.sendToRenderer({ kind: 'reset', token: parsed.token })
      return
    }
  }

  return {
    start(pendingId, state, provider) {
      pending.set(pendingId, { state, provider, createdAt: nowMs() })
      setTimeout(() => expire(pendingId), PENDING_TTL_MS)
    },
    cancel(pendingId) {
      pending.delete(pendingId)
    },
    handle(url) {
      if (!rendererReady) {
        earlyQueue.push(url)
        return
      }
      const parsed = parseAsciUrl(url)
      if (!parsed) {
        console.warn('[deeplink] unparseable url:', url)
        return
      }
      dispatch(parsed)
    },
    markRendererReady() {
      rendererReady = true
      for (const url of earlyQueue) {
        const parsed = parseAsciUrl(url)
        if (parsed) dispatch(parsed)
      }
      earlyQueue.length = 0
    },
    __peekPending: () => pending,
  }
}
