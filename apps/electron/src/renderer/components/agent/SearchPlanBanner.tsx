/**
 * SearchPlanBanner — lit-search 检索方案确认 banner（issue #435）
 *
 * 与 LitReviewDirectionsBanner 对称：读 allPendingSearchPlanRequestsAtom 拿当前
 * sessionId 的 request 队列，渲染 SearchPlanCard，用户操作后 IPC 回填 + dequeue。
 * slot 仲裁通过 useActiveBannerSlot 防止与其他 banner 同时挂载。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { allPendingSearchPlanRequestsAtom } from '@/atoms/agent-atoms'
import { useActiveBannerSlot } from './choice/useActiveBannerSlot.ts'
import { SearchPlanCard } from './choice/SearchPlanCard.tsx'
import type { SearchPlanConfirmResponse } from '@asci/shared'

interface SearchPlanBannerProps {
  sessionId: string
}

export function SearchPlanBanner({ sessionId }: SearchPlanBannerProps): React.ReactElement | null {
  const slot = useActiveBannerSlot(sessionId)
  const [allRequests, setAllRequests] = useAtom(allPendingSearchPlanRequestsAtom)
  const [submitting, setSubmitting] = React.useState(false)

  const requests = allRequests.get(sessionId) ?? []
  const request = requests[0] ?? null

  if (slot !== 'searchPlan' || request == null) return null

  const respond = async (response: SearchPlanConfirmResponse): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    try {
      await window.electronAPI.respondSearchPlan(response)
      // 出队：本地立即移除当前 request；服务器侧 'search_plan_resolved' 事件会触发
      // useGlobalAgentListeners 再次清理（幂等）
      setAllRequests((prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        const filtered = current.filter((r) => r.requestId !== response.requestId)
        if (filtered.length === 0) map.delete(sessionId)
        else map.set(sessionId, filtered)
        return map
      })
    } catch (err) {
      console.error('[SearchPlanBanner] respond failed:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return <SearchPlanCard request={request} onRespond={respond} />
}
