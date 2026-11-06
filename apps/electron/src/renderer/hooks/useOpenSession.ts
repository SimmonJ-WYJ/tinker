/**
 * useOpenSession — 统一的"打开/聚焦 Agent 会话 Tab"操作
 *
 * 封装 openTab + setTabs + setActiveTabId + setCurrentAgentSessionId + 工作区同步。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { tabsAtom, activeTabIdAtom, openTab, type TabType } from '@/atoms/tab-atoms'
import {
  currentAgentSessionIdAtom,
  agentSessionsAtom,
  currentAgentWorkspaceIdAtom,
  unviewedCompletedSessionIdsAtom,
} from '@/atoms/agent-atoms'

type OpenSessionFn = (type: TabType, sessionId: string, title: string, workspaceId?: string) => void

export function useOpenSession(): OpenSessionFn {
  const [tabs, setTabs] = useAtom(tabsAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)

  return React.useCallback(
    (type: TabType, sessionId: string, title: string, workspaceId?: string): void => {
      // 调用方显式提供 workspaceId 优先（新建会话时 agentSessions 闭包尚未含该会话）
      const session = agentSessions.find((s) => s.id === sessionId)
      const effectiveWorkspaceId = workspaceId ?? session?.workspaceId

      const result = openTab(tabs, { type, sessionId, title, workspaceId: effectiveWorkspaceId })
      setTabs(result.tabs)
      setActiveTabId(result.activeTabId)

      setCurrentAgentSessionId(sessionId)

      // 清除该会话的"已完成未查看"标记，与 TabBar.handleActivate 保持一致
      setUnviewedCompleted((prev) => {
        if (!prev.has(sessionId)) return prev
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })

      // 同步 workspaceId，确保与 TabBar 切换行为一致
      if (effectiveWorkspaceId) {
        setCurrentAgentWorkspaceId(effectiveWorkspaceId)
        window.electronAPI.updateSettings({
          agentWorkspaceId: effectiveWorkspaceId,
        }).catch(console.error)
      }
    },
    [tabs, setTabs, setActiveTabId, setCurrentAgentSessionId, agentSessions, setCurrentAgentWorkspaceId, setUnviewedCompleted],
  )
}
