/**
 * useSyncActiveTabSideEffects — 将"新激活标签"的副作用同步到全局原子
 *
 * 标签页切换/关闭时，把 currentAgentSessionId、currentAgentWorkspaceId、
 * unviewedCompletedSessionIds 等全局状态同步到新激活的标签。
 */

import { useCallback } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  unviewedCompletedSessionIdsAtom,
} from '@/atoms/agent-atoms'
import type { TabItem } from '@/atoms/tab-atoms'

export type SyncActiveTabSideEffects = (newActiveTab: TabItem | null) => void

export function useSyncActiveTabSideEffects(): SyncActiveTabSideEffects {
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)

  return useCallback<SyncActiveTabSideEffects>(
    (newActiveTab) => {
      if (!newActiveTab) {
        setCurrentAgentSessionId(null)
        return
      }

      setCurrentAgentSessionId(newActiveTab.sessionId)

      // 清除该会话的"已完成未查看"标记
      setUnviewedCompleted((prev) => {
        if (!prev.has(newActiveTab.sessionId)) return prev
        const next = new Set(prev)
        next.delete(newActiveTab.sessionId)
        return next
      })

      // 同步 workspace
      const session = agentSessions.find((s) => s.id === newActiveTab.sessionId)
      if (session?.workspaceId) {
        setCurrentAgentWorkspaceId(session.workspaceId)
        window.electronAPI.updateSettings({
          agentWorkspaceId: session.workspaceId,
        }).catch(console.error)
      }
    },
    [
      setCurrentAgentSessionId,
      setCurrentAgentWorkspaceId,
      setUnviewedCompleted,
      agentSessions,
    ],
  )
}
