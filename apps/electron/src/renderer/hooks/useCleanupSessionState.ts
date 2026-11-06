/**
 * useCleanupSessionState - 会话状态清理 hook
 *
 * 当会话被删除、归档后回到活跃列表、或迁移到其他工作区时，需要清理多个
 * per-session 状态 atom，避免残留 id 影响后续 UI。
 *
 * 返回一个 (sessionId: string) => void 的函数，一次性清掉：
 * - 3 个 per-session Map atom：agentSidePanelOpen / agentSessionChannelMap / agentSessionModelMap
 * - 1 个 Set atom：workingDoneSessionIds（由 useGlobalAgentListeners 写入）
 *
 * 注意：不清理 `draftSessionIdsAtom`（调用方按场景自行决定是否清）。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import {
  agentSessionChannelMapAtom,
  agentSessionModelMapAtom,
  agentSidePanelOpenMapAtom,
  workingDoneSessionIdsAtom,
} from '@/atoms/agent-atoms'

export function useCleanupSessionState(): (sessionId: string) => void {
  const setAgentSidePanelOpen = useSetAtom(agentSidePanelOpenMapAtom)
  const setSessionChannelMap = useSetAtom(agentSessionChannelMapAtom)
  const setSessionModelMap = useSetAtom(agentSessionModelMapAtom)
  const setWorkingDone = useSetAtom(workingDoneSessionIdsAtom)

  return React.useCallback((sessionId: string) => {
    const deleteMapKey = <T,>(prev: Map<string, T>): Map<string, T> => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    }
    const deleteSetKey = (prev: Set<string>): Set<string> => {
      if (!prev.has(sessionId)) return prev
      const set = new Set(prev)
      set.delete(sessionId)
      return set
    }
    setAgentSidePanelOpen(deleteMapKey)
    setSessionChannelMap(deleteMapKey)
    setSessionModelMap(deleteMapKey)
    setWorkingDone(deleteSetKey)
  }, [
    setAgentSidePanelOpen,
    setSessionChannelMap,
    setSessionModelMap,
    setWorkingDone,
  ])
}
