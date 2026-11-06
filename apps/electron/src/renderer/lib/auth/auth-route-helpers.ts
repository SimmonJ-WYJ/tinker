// apps/electron/src/renderer/lib/auth/auth-route-helpers.ts
import type { AuthRoute, AuthStateChangedEvent } from '@asci/shared'

export interface RouteTransition {
  route: AuthRoute
  reason: string
}

export function nextRouteAfter(
  event: { type: AuthStateChangedEvent['type'] },
  current: AuthRoute,
): RouteTransition {
  switch (event.type) {
    case 'login-success':
      return { route: 'login', reason: 'reset-to-login-for-next-logout' }
    case 'logout':
    case 'session-expired':
    case 'account-deleted':
      return { route: 'login', reason: 'force-back-to-login' }
    case 'user-updated':
      return { route: current, reason: 'no-route-change' }
  }
}
