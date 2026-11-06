/**
 * LitReviewDirectionsBanner — lit-review Turn 1 方向选择 banner (spec §5.4)
 *
 * 与 ExitPlanModeBanner 对称：读 allPendingLitReviewDirectionsRequestsAtom 拿当前
 * sessionId 的 request 队列，渲染 LitReviewDirectionsCard，用户选择后 IPC 回填
 * + dequeue。slot 仲裁通过 useActiveBannerSlot 防止与其他 banner 同时挂载。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { allPendingLitReviewDirectionsRequestsAtom } from '@/atoms/agent-atoms'
import { useActiveBannerSlot } from './choice/useActiveBannerSlot.ts'
import { LitReviewDirectionsCard } from './choice/LitReviewDirectionsCard.tsx'
import type { LitReviewPresentDirectionsResponse } from '@asci/shared'

interface LitReviewDirectionsBannerProps {
  sessionId: string
}

export function LitReviewDirectionsBanner({ sessionId }: LitReviewDirectionsBannerProps): React.ReactElement | null {
  const slot = useActiveBannerSlot(sessionId)
  const [allRequests, setAllRequests] = useAtom(allPendingLitReviewDirectionsRequestsAtom)
  const [submitting, setSubmitting] = React.useState(false)

  const requests = allRequests.get(sessionId) ?? []
  const request = requests[0] ?? null

  if (slot !== 'litReviewDirections' || request == null) return null

  const respond = async (response: LitReviewPresentDirectionsResponse): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    try {
      await window.electronAPI.respondLitReviewPresentDirections(response)
      // 出队：本地立即移除当前 request；服务器侧 'litreview_present_directions_resolved'
      // 事件会触发 useGlobalAgentListeners 再次清理（幂等）
      setAllRequests((prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        const filtered = current.filter((r) => r.requestId !== response.requestId)
        if (filtered.length === 0) map.delete(sessionId)
        else map.set(sessionId, filtered)
        return map
      })
    } catch (err) {
      console.error('[LitReviewDirectionsBanner] respond failed:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return <LitReviewDirectionsCard request={request} onRespond={respond} />
}
