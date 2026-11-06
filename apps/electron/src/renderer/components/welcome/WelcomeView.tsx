/**
 * WelcomeView — 主区域空状态启动器
 *
 * 当没有打开任何标签页时：
 * 1. 优先复用现有 Agent 会话（打开最近的一个）
 * 2. 没有现有会话时，创建一个 draft 会话
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Loader2 } from 'lucide-react'
import { currentAgentWorkspaceIdAtom, agentSettingsReadyAtom } from '@/atoms/agent-atoms'
import { tabsAtom, activeTabIdAtom, openTab } from '@/atoms/tab-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { useCreateSession } from '@/hooks/useCreateSession'

export function WelcomeView(): React.ReactElement {
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const agentSettingsReady = useAtomValue(agentSettingsReadyAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const [tabs, setTabs] = useAtom(tabsAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const { createAgent } = useCreateSession()
  const initRef = React.useRef(false)

  const latestRef = React.useRef({
    tabs,
    draftSessionIds,
    currentWorkspaceId,
    setTabs,
    setActiveTabId,
    createAgent,
  })
  latestRef.current = {
    tabs,
    draftSessionIds,
    currentWorkspaceId,
    setTabs,
    setActiveTabId,
    createAgent,
  }

  React.useEffect(() => {
    if (initRef.current) return
    if (!agentSettingsReady) return

    initRef.current = true

    window.electronAPI.listAgentSessions().then((freshSessions) => {
      const {
        tabs: currentTabs,
        draftSessionIds: currentDrafts,
        currentWorkspaceId: currentWs,
        setTabs: currentSetTabs,
        setActiveTabId: currentSetActiveTabId,
        createAgent: currentCreateAgent,
      } = latestRef.current

      const existing = freshSessions.find(
        (s) => !s.archived && s.workspaceId === currentWs && !currentDrafts.has(s.id),
      )
      if (existing) {
        const result = openTab(currentTabs, {
          type: 'agent',
          sessionId: existing.id,
          title: existing.title,
          workspaceId: existing.workspaceId,
        })
        currentSetTabs(result.tabs)
        currentSetActiveTabId(result.activeTabId)
        return
      }
      const draftSession = freshSessions.find(
        (s) => !s.archived && s.workspaceId === currentWs && currentDrafts.has(s.id),
      )
      if (draftSession) {
        const result = openTab(currentTabs, {
          type: 'agent',
          sessionId: draftSession.id,
          title: draftSession.title,
          workspaceId: draftSession.workspaceId,
        })
        currentSetTabs(result.tabs)
        currentSetActiveTabId(result.activeTabId)
        return
      }
      currentCreateAgent({ draft: true })
    }).catch(console.error)
  }, [agentSettingsReady])

  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground/40" />
    </div>
  )
}
