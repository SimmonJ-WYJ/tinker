/**
 * useReasoningEffort —— 每会话推理深度的状态 + 持久化。
 *
 * 推理深度已并入模型下拉（底部「推理深度」区），不再有独立入口；这里把
 * 「读默认 / 按 session 隔离 / 加载工作区值 / 切换即存 IPC」收成 hook，供 AgentView
 * 读取后传给 ModelSelector 的 reasoning 区。
 */
import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  agentReasoningEffortMapAtom,
  agentDefaultReasoningEffortAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
} from '@/atoms/agent-atoms'
import type { AgentEffort } from '@asci/shared'

export function useReasoningEffort(sessionId: string): {
  effort: AgentEffort
  setEffort: (next: AgentEffort) => void
} {
  const [effortMap, setEffortMap] = useAtom(agentReasoningEffortMapAtom)
  const defaultEffort = useAtomValue(agentDefaultReasoningEffortAtom)
  const setDefaultEffort = useSetAtom(agentDefaultReasoningEffortAtom)
  const effort = effortMap.get(sessionId) ?? defaultEffort
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)

  const workspaceSlug = React.useMemo(() => {
    if (!currentWorkspaceId) return null
    return workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  }, [currentWorkspaceId, workspaces])

  // 初始化：session 不在 Map 中则从默认值写入，确保隔离
  React.useEffect(() => {
    if (!effortMap.has(sessionId)) {
      setEffortMap((prev) => {
        if (prev.has(sessionId)) return prev
        const next = new Map(prev)
        next.set(sessionId, defaultEffort)
        return next
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 sessionId 变化时初始化
  }, [sessionId])

  // 加载工作区推理深度（仅值变化时更新，避免切换会话抖动）
  React.useEffect(() => {
    if (!workspaceSlug) return
    window.electronAPI
      .getReasoningEffort(workspaceSlug)
      .then((savedEffort) => {
        if (savedEffort !== defaultEffort) setDefaultEffort(savedEffort)
        setEffortMap((prev) => {
          const current = prev.get(sessionId)
          if (current && current !== defaultEffort) return prev
          if (current === savedEffort) return prev
          const next = new Map(prev)
          next.set(sessionId, savedEffort)
          return next
        })
      })
      .catch((error) => {
        console.error('[useReasoningEffort] 加载推理深度失败:', error)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在 workspaceSlug/sessionId 变化时重新加载
  }, [workspaceSlug, sessionId])

  const setEffort = React.useCallback(
    (next: AgentEffort): void => {
      setEffortMap((prev) => {
        const updated = new Map(prev)
        updated.set(sessionId, next)
        return updated
      })
      if (workspaceSlug) {
        window.electronAPI
          .setReasoningEffort(workspaceSlug, next)
          .catch((error) => console.error('[useReasoningEffort] 保存推理深度失败:', error))
      }
    },
    [sessionId, workspaceSlug, setEffortMap],
  )

  return { effort, setEffort }
}
