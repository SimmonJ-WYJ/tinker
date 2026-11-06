// apps/electron/src/renderer/lib/auth/auth-route-helpers.test.ts
import { test, expect, describe } from 'bun:test'
import { nextRouteAfter } from './auth-route-helpers.ts'

describe('nextRouteAfter', () => {
  test('login-success → null（让 status 主导，子 route 复位）', () => {
    expect(nextRouteAfter({ type: 'login-success' }, 'login')).toEqual({
      route: 'login',
      reason: 'reset-to-login-for-next-logout',
    })
  })
  test('logout → login', () => {
    expect(nextRouteAfter({ type: 'logout' }, 'register').route).toBe('login')
  })
  test('session-expired → login', () => {
    expect(nextRouteAfter({ type: 'session-expired' }, 'register').route).toBe('login')
  })
  test('user-updated → 保持当前', () => {
    expect(nextRouteAfter({ type: 'user-updated' }, 'register').route).toBe('register')
  })
  test('account-deleted → login（DO-3 删账户后回登录门）', () => {
    expect(nextRouteAfter({ type: 'account-deleted' }, 'register').route).toBe('login')
  })
})
