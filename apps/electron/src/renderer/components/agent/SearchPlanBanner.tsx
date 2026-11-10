/** 清理会话内遗留的科研待选状态；历史保存结果由消息 renderer 展示。 */
import { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { allPendingSearchPlanRequestsAtom } from '@/atoms/agent-atoms'

export function SearchPlanBanner({ sessionId }: { sessionId: string }): null {
  const setRequests = useSetAtom(allPendingSearchPlanRequestsAtom)
  useEffect(() => {
    setRequests(previous => {
      if (!previous.has(sessionId)) return previous
      const next = new Map(previous)
      next.delete(sessionId)
      return next
    })
  }, [sessionId, setRequests])
  return null
}
