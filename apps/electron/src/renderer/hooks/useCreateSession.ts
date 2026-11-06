/**
 * useCreateSession — 创建 Agent 会话并打开标签页
 *
 * 从 LeftSidebar 提取，供 WelcomeView 和侧边栏共同使用。
 */

import { useAtomValue, useSetAtom } from 'jotai'
import {
  agentSessionsAtom,
  agentChannelIdAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { useOpenSession } from './useOpenSession'

interface CreateSessionOptions {
  /** 标记为草稿会话（不在侧边栏显示，发送首条消息后自动取消） */
  draft?: boolean
}

interface CreateSessionActions {
  /** 创建新 Agent 会话并打开标签页 */
  createAgent: (options?: CreateSessionOptions) => Promise<string | undefined>
}

export function useCreateSession(): CreateSessionActions {
  const openSession = useOpenSession()
  const setActiveView = useSetAtom(activeViewAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)

  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)

  const createAgent = async (options?: CreateSessionOptions): Promise<string | undefined> => {
    try {
      const meta = await window.electronAPI.createAgentSession(
        undefined,
        agentChannelId || undefined,
        currentWorkspaceId || undefined,
      )
      setAgentSessions((prev) => [meta, ...prev])
      openSession('agent', meta.id, meta.title, meta.workspaceId)
      setActiveView('conversations')
      if (options?.draft) {
        setDraftSessionIds((prev: Set<string>) => { const next = new Set(prev); next.add(meta.id); return next })
      }
      return meta.id
    } catch (error) {
      console.error('[创建会话] 创建 Agent 会话失败:', error)
      return undefined
    }
  }

  return { createAgent }
}
