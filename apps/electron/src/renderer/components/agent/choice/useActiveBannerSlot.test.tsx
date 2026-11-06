/**
 * useActiveBannerSlot 单元测试 — 覆盖三队列空/单非空/同会话优先级/跨会话隔离。
 */

import { describe, it, expect, afterEach } from 'bun:test'
import { renderHook, cleanup } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import * as React from 'react'
import { useActiveBannerSlot } from './useActiveBannerSlot.ts'
import {
  allPendingPermissionRequestsAtom,
  allPendingAskUserRequestsAtom,
  allPendingExitPlanRequestsAtom,
} from '@/atoms/agent-atoms'

// 显式 cleanup：bun:test 不自带 testing-library auto-cleanup，避免跨用例 DOM 残留。
afterEach(() => {
  cleanup()
})

function wrapper(store: ReturnType<typeof createStore>): React.FC<{ children: React.ReactNode }> {
  return ({ children }) => <Provider store={store}>{children}</Provider>
}

describe('useActiveBannerSlot', () => {
  it('三队列都空返回 null', () => {
    const store = createStore()
    const { result } = renderHook(() => useActiveBannerSlot('s1'), { wrapper: wrapper(store) })
    expect(result.current).toBeNull()
  })

  it('仅 permission 非空返回 permission', () => {
    const store = createStore()
    store.set(allPendingPermissionRequestsAtom, new Map([['s1', [{ requestId: 'r1' } as never]]]))
    const { result } = renderHook(() => useActiveBannerSlot('s1'), { wrapper: wrapper(store) })
    expect(result.current).toBe('permission')
  })

  it('permission + askUser 同 sessionId 都非空，优先 permission', () => {
    const store = createStore()
    store.set(allPendingPermissionRequestsAtom, new Map([['s1', [{ requestId: 'r1' } as never]]]))
    store.set(allPendingAskUserRequestsAtom, new Map([['s1', [{ requestId: 'r2' } as never]]]))
    const { result } = renderHook(() => useActiveBannerSlot('s1'), { wrapper: wrapper(store) })
    expect(result.current).toBe('permission')
  })

  it('仅 exitPlan 非空返回 exitPlan', () => {
    const store = createStore()
    store.set(allPendingExitPlanRequestsAtom, new Map([['s1', [{ requestId: 'r3' } as never]]]))
    const { result } = renderHook(() => useActiveBannerSlot('s1'), { wrapper: wrapper(store) })
    expect(result.current).toBe('exitPlan')
  })

  it('其他 sessionId 的 pending 不影响入参 sessionId', () => {
    const store = createStore()
    store.set(allPendingPermissionRequestsAtom, new Map([['s2', [{ requestId: 'r1' } as never]]]))
    const { result } = renderHook(() => useActiveBannerSlot('s1'), { wrapper: wrapper(store) })
    expect(result.current).toBeNull()
  })
})
