/**
 * useGlobalAgentListeners — 全局 Agent IPC 监听器
 *
 * 在应用顶层挂载，永不销毁。将所有 Agent 流式事件、
 * 权限请求、AskUser 请求写入对应 Jotai atoms。
 *
 * 使用 useStore() 直接操作 atoms，避免 React 订阅。
 */

import { useEffect } from 'react'
import { unstable_batchedUpdates } from 'react-dom'
import { useStore } from 'jotai'
import {
  agentStreamingStatesAtom,
  agentStreamErrorsAtom,
  agentSessionsAtom,
  agentMessageRefreshAtom,
  allPendingPermissionRequestsAtom,
  allPendingAskUserRequestsAtom,
  allPendingExitPlanRequestsAtom,
  allPendingLitReviewDirectionsRequestsAtom,
  allPendingSearchPlanRequestsAtom,
  agentPromptSuggestionsAtom,
  backgroundTasksAtomFamily,
  agentSidePanelOpenMapAtom,
  applyAgentEvent,
  liveMessagesMapAtom,
  agentSessionModelMapAtom,
  agentModelIdAtom,
  agentPermissionModeMapAtom,
  stoppedByUserSessionsAtom,
  agentPlanModeSessionsAtom,
  finalizeStreamingActivities,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  unviewedCompletedSessionIdsAtom,
  workingDoneSessionIdsAtom,
  agentChannelIdAtom,
  agentSessionPathMapAtom,
  clearQueuedMessageUuidsAtom,
} from '@/atoms/agent-atoms'
import {
  rightPanelTabsBySessionAtom,
  upsertTab,
  kindOfTarget,
  titleOfTarget,
  tabIdOfTarget,
  openResearchGapTab,
} from '@/atoms/right-panel-tabs'
import { researchGapTablesBySessionAtom, appendResearchGapTable } from '@/atoms/research-gap-atoms'
import { isSessionDeliverable, resolveAgainstCwd, extOf } from '@/lib/deliverable-path'
import type { PreviewTarget } from '@/atoms/side-panel-layout'
import {
  notificationsEnabledAtom,
  notificationSoundEnabledAtom,
  notificationSoundsAtom,
  sendDesktopNotification,
} from '@/atoms/notifications'
import { tabsAtom, activeTabIdAtom, activeTabIdByWorkspaceAtom, openTab, closeTab, updateTabTitle, backfillTabWorkspaceIds } from '@/atoms/tab-atoms'
import { workspacePapersAtom } from '@/atoms/workspace-papers-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import type { AgentStreamState } from '@/atoms/agent-atoms'
import type { NotificationSoundType } from '@/types/settings'
import { toast } from 'sonner'
import { i18n } from '@/lib/i18n'
import type { AgentStreamEvent, AgentStreamCompletePayload, AgentEvent, AgentStreamPayload, SDKAssistantMessage, SDKUserMessage, SDKSystemMessage, SDKContentBlock, SDKUserContentBlock } from '@asci/shared'
import { inferModelContextWindow, isSubagentToolUse, nowMs } from '@asci/shared'

// ============================================================================
// Phase 1 临时兼容层：将 AgentStreamPayload 转换为旧 AgentEvent
// Phase 2 将移除此转换，直接使用 SDKMessage 渲染
// ============================================================================

function payloadToLegacyEvents(payload: AgentStreamPayload): AgentEvent[] {
  if (payload.kind === 'asci_event') {
    const evt = payload.event
    switch (evt.type) {
      case 'permission_request':
        return [{ type: 'permission_request', request: evt.request }]
      case 'permission_resolved':
        return [{ type: 'permission_resolved', requestId: evt.requestId, behavior: evt.behavior }]
      case 'ask_user_request':
        return [{ type: 'ask_user_request', request: evt.request }]
      case 'ask_user_resolved':
        return [{ type: 'ask_user_resolved', requestId: evt.requestId }]
      case 'exit_plan_mode_request':
        return [{ type: 'exit_plan_mode_request', request: evt.request }]
      case 'exit_plan_mode_resolved':
        return [{ type: 'exit_plan_mode_resolved', requestId: evt.requestId }]
      case 'litreview_present_directions_request':
        return [{ type: 'litreview_present_directions_request', request: evt.request }]
      case 'litreview_present_directions_resolved':
        return [{ type: 'litreview_present_directions_resolved', requestId: evt.requestId }]
      case 'search_plan_request':
        return [{ type: 'search_plan_request', request: evt.request }]
      case 'search_plan_resolved':
        return [{ type: 'search_plan_resolved', requestId: evt.requestId }]
      case 'research_gap_table':
        return [{ type: 'research_gap_table', table: evt.table }]
      case 'enter_plan_mode':
        return [{ type: 'enter_plan_mode', sessionId: evt.sessionId }]
      case 'model_resolved':
        return [{ type: 'model_resolved', model: evt.model }]
      case 'model_fallback_notice': {
        // 子 Agent model 别名家族未激活的提示（纯 toast，无内部 AgentEvent 承载）
        const msg = evt.noClaudeActivated
          ? i18n.t('modelFallback.noClaudeActivated', { ns: 'common' })
          : i18n.t(evt.agentCount ? 'modelFallback.summary' : 'modelFallback.aliasInactive', {
              ns: 'common',
              agentName: evt.agentName,
              count: evt.agentCount,
              family: evt.requestedFamily,
              model: evt.fallbackModelId,
            })
        toast.warning(msg)
        return []
      }
      case 'permission_mode_changed':
        return [{ type: 'permission_mode_changed', mode: evt.mode }]
      case 'resolved_language':
        return [{ type: 'resolved_language', language: evt.language }]
      case 'waiting_resume':
        return [{ type: 'waiting_resume', message: evt.message }]
      case 'resume_start':
        return [{ type: 'resume_start', messageId: evt.messageId }]
      case 'retry': {
        const events: AgentEvent[] = []
        if (evt.status === 'starting' && evt.attempt != null && evt.maxAttempts != null) {
          events.push({ type: 'retrying', attempt: evt.attempt, maxAttempts: evt.maxAttempts, delaySeconds: evt.delaySeconds ?? 0, reason: evt.reason ?? '' })
        }
        if (evt.status === 'attempt' && evt.attemptData) {
          events.push({ type: 'retry_attempt', attemptData: evt.attemptData })
        }
        if (evt.status === 'cleared') {
          events.push({ type: 'retry_cleared' })
        }
        if (evt.status === 'failed' && evt.attemptData) {
          events.push({ type: 'retry_failed', finalAttempt: evt.attemptData })
        }
        return events
      }
      default:
        return []
    }
  }

  // sdk_message → 转换为对应的 AgentEvent
  const msg = payload.message

  switch (msg.type) {
    case 'assistant': {
      const aMsg = msg as SDKAssistantMessage
      if (aMsg.isReplay) return []
      if (aMsg.error) {
        // 错误已在主进程处理，这里仅作为 typed_error 透传
        return [{ type: 'error', message: aMsg.error.message }]
      }
      const events: AgentEvent[] = []
      for (const block of aMsg.message.content) {
        if (block.type === 'text' && 'text' in block) {
          events.push({ type: 'text_complete', text: (block as { text: string }).text, isIntermediate: false, parentToolUseId: aMsg.parent_tool_use_id ?? undefined })
        } else if (block.type === 'tool_use') {
          const tb = block as SDKContentBlock & { id: string; name: string; input: Record<string, unknown> }
          const intent = (tb.input._intent as string | undefined)
            ?? (tb.name === 'Bash' ? (tb.input.description as string | undefined) : undefined)
          events.push({
            type: 'tool_start',
            toolName: tb.name,
            toolUseId: tb.id,
            input: tb.input,
            intent,
            displayName: tb.input._displayName as string | undefined,
            parentToolUseId: aMsg.parent_tool_use_id ?? undefined,
          })
        }
      }
      // Usage（保留完整字段用于详细展示）
      if (!aMsg.parent_tool_use_id && aMsg.message.usage) {
        const u = aMsg.message.usage
        const inputTokens = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        // 流式过程中 SDK 不返回 contextWindow，按模型名推断一个默认值作为 fallback
        const modelName = aMsg.message.model ?? aMsg._channelModelId
        const fallbackWindow = modelName ? inferModelContextWindow(modelName) : undefined
        events.push({
          type: 'usage_update',
          usage: {
            inputTokens,
            outputTokens: u.output_tokens,
            cacheReadTokens: u.cache_read_input_tokens,
            cacheCreationTokens: u.cache_creation_input_tokens,
            ...(fallbackWindow ? { contextWindow: fallbackWindow } : {}),
          },
        })
      }
      return events
    }

    case 'user': {
      const uMsg = msg as SDKUserMessage
      if (uMsg.isReplay) return []
      const events: AgentEvent[] = []
      const contentBlocks = uMsg.message?.content ?? []
      for (const block of contentBlocks) {
        if (block.type === 'tool_result') {
          const tb = block as SDKUserContentBlock & { tool_use_id: string; content?: unknown; is_error?: boolean }
          const resultStr = typeof tb.content === 'string' ? tb.content : (tb.content != null ? JSON.stringify(tb.content) : '')
          events.push({
            type: 'tool_result',
            toolUseId: tb.tool_use_id,
            result: resultStr,
            isError: tb.is_error ?? false,
            parentToolUseId: uMsg.parent_tool_use_id ?? undefined,
          })
        }
      }
      return events
    }

    case 'result': {
      const rMsg = msg as { subtype: string; usage?: { input_tokens: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }; total_cost_usd?: number; modelUsage?: Record<string, { contextWindow?: number }> }
      const usage = rMsg.usage
      // 优先用 SDK 返回的真实 contextWindow；非 Anthropic 渠道常常不带 modelUsage，
      // 此时按 modelUsage 的 model 键（或缺省时回退）推断窗口大小
      const modelUsageEntries = rMsg.modelUsage ? Object.entries(rMsg.modelUsage) : []
      const sdkContextWindow = modelUsageEntries[0]?.[1]?.contextWindow
      const sdkModelId = modelUsageEntries[0]?.[0]
      const contextWindow = sdkContextWindow ?? (sdkModelId ? inferModelContextWindow(sdkModelId) : undefined)
      return [{
        type: 'complete',
        stopReason: rMsg.subtype === 'success' ? 'end_turn' : 'error',
        usage: usage ? {
          inputTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens,
          cacheCreationTokens: usage.cache_creation_input_tokens,
          costUsd: rMsg.total_cost_usd,
          contextWindow,
        } : undefined,
      }]
    }

    case 'system': {
      const sMsg = msg as SDKSystemMessage
      if (sMsg.subtype === 'compact_boundary') return [{ type: 'compact_complete' }]
      if (sMsg.subtype === 'compacting') return [{ type: 'compacting' }]
      if (sMsg.subtype === 'task_started' && sMsg.task_id) {
        return [{ type: 'task_started', taskId: sMsg.task_id, description: sMsg.description ?? '', taskType: sMsg.task_type, toolUseId: sMsg.tool_use_id }]
      }
      if (sMsg.subtype === 'task_notification' && sMsg.task_id) {
        return [{
          type: 'task_notification',
          taskId: sMsg.task_id,
          status: (sMsg.status as 'completed' | 'failed' | 'stopped') ?? 'completed',
          summary: sMsg.summary ?? '',
          outputFile: sMsg.output_file,
          toolUseId: sMsg.tool_use_id,
          usage: sMsg.usage ? {
            totalTokens: sMsg.usage.total_tokens ?? 0,
            toolUses: sMsg.usage.tool_uses ?? 0,
            durationMs: sMsg.usage.duration_ms ?? 0,
          } : undefined,
        }]
      }
      if (sMsg.subtype === 'task_progress' && sMsg.task_id) {
        return [{
          type: 'task_progress',
          taskId: sMsg.task_id,
          toolUseId: sMsg.tool_use_id ?? sMsg.task_id,
          description: sMsg.description,
          lastToolName: sMsg.last_tool_name,
          usage: sMsg.usage ? {
            totalTokens: sMsg.usage.total_tokens ?? 0,
            toolUses: sMsg.usage.tool_uses ?? 0,
            durationMs: sMsg.usage.duration_ms ?? 0,
          } : undefined,
        }]
      }
      return []
    }

    case 'tool_progress': {
      const tpMsg = msg as { tool_use_id: string; elapsed_time_seconds?: number; task_id?: string }
      return [{
        type: 'task_progress',
        toolUseId: tpMsg.tool_use_id,
        elapsedSeconds: tpMsg.elapsed_time_seconds,
        taskId: tpMsg.task_id,
      }]
    }

    case 'prompt_suggestion': {
      const psMsg = msg as { suggestion?: string }
      if (psMsg.suggestion) return [{ type: 'prompt_suggestion', suggestion: psMsg.suggestion }]
      return []
    }

    case 'tool_use_summary': {
      const tusMsg = msg as { summary?: string; preceding_tool_use_ids?: string[] }
      if (tusMsg.summary) return [{ type: 'tool_use_summary', summary: tusMsg.summary, precedingToolUseIds: tusMsg.preceding_tool_use_ids ?? [] }]
      return []
    }

    default:
      return []
  }
}

export function useGlobalAgentListeners(): void {
  const store = useStore()

  useEffect(() => {
    // 「产物文件生成即在右栏自动预览」用的关联表：Write 的 tool_start 先记下 file_path，
    // 待其 tool_result 成功回来时，若该文件是 cwd 根的可预览产物则在右栏开 tab。
    // 仅活在本 effect（永不销毁）生命周期内；replay 消息已被 payloadToLegacyEvents 过滤，不会回放重开。
    const pendingDeliverableWrites = new Map<string, string>() // toolUseId → 原始 file_path

    /** 在指定会话的右栏新建/聚焦一个文件预览 tab（与 useOpenInRightPanel 等价，store 版） */
    const openDeliverableInRightPanel = (sessionId: string, fullPath: string): void => {
      const target: PreviewTarget = {
        kind: 'file',
        path: fullPath,
        ext: extOf(fullPath.split('/').pop() ?? fullPath),
        size: 0, // 渲染器自行读文件；size 仅用于无 renderer 时的占位判断
      }
      store.set(rightPanelTabsBySessionAtom(sessionId), (prev) =>
        upsertTab(prev, tabIdOfTarget(target), kindOfTarget(target), titleOfTarget(target), target),
      )
      // 确保右栏可见，否则新建的产物 tab 用户看不到
      store.set(agentSidePanelOpenMapAtom, (prev) => {
        if (prev.get(sessionId)) return prev
        const map = new Map(prev)
        map.set(sessionId, true)
        return map
      })
    }

    /** 构建导航到指定会话的回调 */
    const makeNavigateToSession = (sessionId: string, sessionTitle: string) => () => {
      const tabs = store.get(tabsAtom)
      const sessions = store.get(agentSessionsAtom)
      const session = sessions.find((s) => s.id === sessionId)
      const result = openTab(tabs, {
        type: 'agent',
        sessionId,
        title: sessionTitle,
        workspaceId: session?.workspaceId,
      })
      store.set(tabsAtom, result.tabs)
      store.set(activeTabIdAtom, result.activeTabId)
      store.set(currentAgentSessionIdAtom, sessionId)
      if (session?.workspaceId) {
        store.set(currentAgentWorkspaceIdAtom, session.workspaceId)
      }
    }

    /** 获取会话标题 */
    const getSessionTitle = (sessionId: string): string => {
      const sessions = store.get(agentSessionsAtom)
      return sessions.find((s) => s.id === sessionId)?.title ?? '未命名会话'
    }

    /** 发送阻塞通知（带提示音 + 会话导航） */
    const sendBlockingNotification = (sessionId: string, title: string, body: string, soundType: NotificationSoundType) => {
      const enabled = store.get(notificationsEnabledAtom)
      const soundEnabled = store.get(notificationSoundEnabledAtom)
      const sounds = store.get(notificationSoundsAtom)
      const sessionTitle = getSessionTitle(sessionId)
      sendDesktopNotification(
        title,
        `[${sessionTitle}] ${body}`,
        enabled,
        {
          force: true,
          playSound: enabled && soundEnabled,
          soundType,
          sounds,
          onNavigate: makeNavigateToSession(sessionId, sessionTitle),
        }
      )
    }
    // ===== 0. 初始化：从持久化 meta 恢复 stoppedByUser 状态 =====
    window.electronAPI.listAgentSessions().then((sessions) => {
      const stoppedIds = new Set<string>(
        sessions.filter((s) => s.stoppedByUser).map((s) => s.id)
      )
      if (stoppedIds.size > 0) {
        store.set(stoppedByUserSessionsAtom, stoppedIds)
      }
    }).catch(console.error)

    // ===== 1. 流式事件 =====
    const cleanupEvent = window.electronAPI.onAgentStreamEvent(
      (streamEvent: AgentStreamEvent) => {
        unstable_batchedUpdates(() => {
        const { sessionId, payload } = streamEvent

        // 如果收到未知会话的事件（跨工作区场景），立即刷新会话列表
        const knownSessions = store.get(agentSessionsAtom)
        if (!knownSessions.some((s) => s.id === sessionId)) {
          window.electronAPI.listAgentSessions()
            .then((sessions) => store.set(agentSessionsAtom, sessions))
            .catch(console.error)
        }

        // Phase 2: 直接累积 SDKMessage 到 liveMessagesMapAtom（跳过 replay 消息，避免与持久化消息重复）
        if (payload.kind === 'sdk_message') {
          const msgRecord = payload.message as Record<string, unknown>
          // prompt_suggestion 不是对话转录消息，不能进入 liveMessages（会被错误渲染到最后一条助手消息中）
          // 它通过下方 legacyEvents 分支写入 agentPromptSuggestionsAtom，显示在输入框上方
          if (msgRecord.type === 'prompt_suggestion') {
            // 跳过写入 liveMessages
          } else if (!msgRecord.isReplay) {
            // 为实时消息补充 _createdAt 时间戳（与持久化时的逻辑一致），
            // 避免 AssistantTurnRenderer 因缺少时间戳导致 header 时间消失
            if (typeof msgRecord._createdAt !== 'number') {
              msgRecord._createdAt = nowMs()
            }

            // 为 assistant 消息注入渠道 modelId，确保流式期间就绑定正确模型
            if (msgRecord.type === 'assistant' && !msgRecord._channelModelId) {
              const sessionModelMap = store.get(agentSessionModelMapAtom)
              const defaultModelId = store.get(agentModelIdAtom)
              msgRecord._channelModelId = sessionModelMap.get(sessionId) ?? defaultModelId ?? undefined
            }

            store.set(liveMessagesMapAtom, (prev) => {
              const map = new Map(prev)
              const current = map.get(sessionId) ?? []

              // UUID 去重：队列消息已被乐观注入，SDK 再次推送时跳过
              const incomingUuid = msgRecord.uuid as string | undefined
              if (incomingUuid && current.some((m) => (m as Record<string, unknown>).uuid === incomingUuid)) {
                return prev
              }

              map.set(sessionId, [...current, payload.message])
              return map
            })
          }
        }

        // Phase 1 兼容：将新 AgentStreamPayload 转换为旧 AgentEvent[]
        const legacyEvents = payloadToLegacyEvents(payload)

        for (const event of legacyEvents) {
          // 会话首次进入 running 时，从 Working Done 集合移除（它会出现在 Running 组）
          if (event.type !== 'prompt_suggestion') {
            const prevState = store.get(agentStreamingStatesAtom).get(sessionId)
            if (!prevState || !prevState.running) {
              store.set(workingDoneSessionIdsAtom, (prev: Set<string>) => {
                if (!prev.has(sessionId)) return prev
                const next = new Set(prev)
                next.delete(sessionId)
                return next
              })
            }
          }

          // 更新流式状态（prompt_suggestion 不影响流式状态，跳过以避免在 session 结束后用默认值 running:true 重新激活）
          if (event.type !== 'prompt_suggestion') {
            store.set(agentStreamingStatesAtom, (prev) => {
              const current: AgentStreamState = prev.get(sessionId) ?? {
                running: true,
                content: '',
                toolActivities: [],
                teammates: [],
                model: undefined,
                // startedAt 留空：让 STREAM_COMPLETE 竞态保护跳过时间戳比较，
                // 正常流程中 handleSend 已设置了正确的 startedAt，此 fallback 仅在极端情况下触发
                startedAt: undefined,
              }
              const next = applyAgentEvent(current, event)
              const map = new Map(prev)
              map.set(sessionId, next)
              return map
            })
          }

          // 排队徽标清除：一个 turn 结束（complete = SDK result）即清掉该会话所有「排队中」徽标。
          // 语义——「排队中」= 排在当前 turn 后面等待；当前 turn 一结束，排队消息就被 Agent 接手，不再是等待态。
          // 用 turn 边界（一定会发生）而非 SDK user 回显（DeepSeek 等会 batch 消费、不逐条回显，不可靠）。
          if (event.type === 'complete') {
            store.set(clearQueuedMessageUuidsAtom, sessionId)
          }

          // 自动打开侧面板：检测到 Agent/Task 工具启动或 teammate 任务开始时
          if (
            (event.type === 'tool_start' && isSubagentToolUse({ name: event.toolName })) ||
            event.type === 'task_started'
          ) {
            store.set(agentSidePanelOpenMapAtom, (prev) => {
              const map = new Map(prev)
              map.set(sessionId, true)
              return map
            })
          }

          // 产物自动预览：记下 Write 的目标路径，待其成功完成后若为 cwd 根产物则在右栏开 tab。
          if (event.type === 'tool_start' && event.toolName === 'Write') {
            const fp = event.input?.file_path
            if (typeof fp === 'string' && fp) pendingDeliverableWrites.set(event.toolUseId, fp)
          } else if (event.type === 'tool_result') {
            const fp = pendingDeliverableWrites.get(event.toolUseId)
            if (fp) {
              pendingDeliverableWrites.delete(event.toolUseId) // 一次性：删除即不会重开
              if (!event.isError) {
                const cwd = store.get(agentSessionPathMapAtom).get(sessionId) ?? ''
                const fullPath = resolveAgainstCwd(fp, cwd)
                if (isSessionDeliverable(fullPath, cwd)) {
                  openDeliverableInRightPanel(sessionId, fullPath)
                }
              }
            }
          }

          // 处理后台任务事件
          if (event.type === 'task_backgrounded') {
            store.set(backgroundTasksAtomFamily(sessionId), (prev) => {
              if (prev.some((t) => t.toolUseId === event.toolUseId)) return prev
              return [...prev, {
                id: event.taskId,
                type: 'agent' as const,
                toolUseId: event.toolUseId,
                startTime: nowMs(),
                elapsedSeconds: 0,
                intent: event.intent,
              }]
            })
          } else if (event.type === 'task_progress') {
            store.set(backgroundTasksAtomFamily(sessionId), (prev) =>
              prev.map((t) =>
                t.toolUseId === event.toolUseId
                  ? { ...t, elapsedSeconds: event.elapsedSeconds ?? t.elapsedSeconds }
                  : t
              )
            )
          } else if (event.type === 'shell_backgrounded') {
            store.set(backgroundTasksAtomFamily(sessionId), (prev) => {
              if (prev.some((t) => t.toolUseId === event.toolUseId)) return prev
              return [...prev, {
                id: event.shellId,
                type: 'shell' as const,
                toolUseId: event.toolUseId,
                startTime: nowMs(),
                elapsedSeconds: 0,
                intent: event.command || event.intent,
              }]
            })
          } else if (event.type === 'tool_result') {
            // 工具完成时，移除对应的后台任务
            store.set(backgroundTasksAtomFamily(sessionId), (prev) =>
              prev.filter((t) => t.toolUseId !== event.toolUseId)
            )
          } else if (event.type === 'shell_killed') {
            store.set(backgroundTasksAtomFamily(sessionId), (prev) => {
              const task = prev.find((t) => t.id === event.shellId)
              if (!task) return prev
              return prev.filter((t) => t.toolUseId !== task.toolUseId)
            })
          } else if (event.type === 'prompt_suggestion') {
            // 存储提示建议到 atom
            console.log(`[GlobalAgentListeners] 收到建议: sessionId=${sessionId}, suggestion="${event.suggestion.slice(0, 50)}..."`)
            store.set(agentPromptSuggestionsAtom, (prev) => {
              const map = new Map(prev)
              map.set(sessionId, event.suggestion)
              return map
            })
          } else if (event.type === 'permission_request') {
            // 权限请求入队（统一通道，不区分当前/后台会话）
            store.set(allPendingPermissionRequestsAtom, (prev) => {
              const map = new Map(prev)
              const current = map.get(sessionId) ?? []
              map.set(sessionId, [...current, event.request])
              return map
            })
            // 桌面通知（带提示音 + 会话导航）
            sendBlockingNotification(
              sessionId,
              '需要权限确认',
              event.request.toolName
                ? `Agent 请求使用工具: ${event.request.toolName}`
                : 'Agent 需要你的权限确认',
              'permissionRequest'
            )
          } else if (event.type === 'ask_user_request') {
            // AskUser 请求入队（统一通道，不区分当前/后台会话）
            store.set(allPendingAskUserRequestsAtom, (prev) => {
              const map = new Map(prev)
              const current = map.get(sessionId) ?? []
              map.set(sessionId, [...current, event.request])
              return map
            })
            // 桌面通知（带提示音 + 会话导航）
            sendBlockingNotification(
              sessionId,
              'Agent 需要你的输入',
              event.request.questions[0]?.question ?? 'Agent 有问题需要你回答',
              'permissionRequest'
            )
          } else if (event.type === 'exit_plan_mode_request') {
            // ExitPlanMode 请求入队
            store.set(allPendingExitPlanRequestsAtom, (prev) => {
              const map = new Map(prev)
              const current = map.get(sessionId) ?? []
              map.set(sessionId, [...current, event.request])
              return map
            })
            // 退出 Plan 模式指示状态
            store.set(agentPlanModeSessionsAtom, (prev: Set<string>) => {
              if (!prev.has(sessionId)) return prev
              const next = new Set(prev)
              next.delete(sessionId)
              return next
            })
            // 桌面通知（带提示音 + 会话导航）
            sendBlockingNotification(
              sessionId,
              'Agent 计划待审批',
              'Agent 已完成计划，等待你的审批',
              'exitPlanMode'
            )
          } else if (event.type === 'litreview_present_directions_resolved') {
            // 用户已选择，移除 pending
            store.set(allPendingLitReviewDirectionsRequestsAtom, (prev) => {
              const map = new Map(prev)
              const current = map.get(sessionId) ?? []
              const filtered = current.filter((r) => r.requestId !== event.requestId)
              if (filtered.length === 0) map.delete(sessionId)
              else map.set(sessionId, filtered)
              return map
            })
          } else if (event.type === 'research_gap_table') {
            // 研究空白对照表产出：按 tableId 追加（每次分析独立累积）+ 自动打开该表对应的可关闭 Tab（0.4 Epic 1）
            const table = event.table
            store.set(researchGapTablesBySessionAtom, (prev) =>
              appendResearchGapTable(prev, sessionId, table),
            )
            store.set(rightPanelTabsBySessionAtom(sessionId), (s) =>
              openResearchGapTab(s, table.id, table.title),
            )
            sendBlockingNotification(
              sessionId,
              '研究空白对照表已生成',
              '已在右侧整理好对照表与洞察；关掉后可在对话中点结果卡片再打开',
              'exitPlanMode',
            )
          } else if (event.type === 'search_plan_resolved') {
            // 用户已确认/调整/取消，移除 pending
            store.set(allPendingSearchPlanRequestsAtom, (prev) => {
              const map = new Map(prev)
              const current = map.get(sessionId) ?? []
              const filtered = current.filter((r) => r.requestId !== event.requestId)
              if (filtered.length === 0) map.delete(sessionId)
              else map.set(sessionId, filtered)
              return map
            })
          } else if (event.type === 'enter_plan_mode') {
            // 进入 Plan 模式
            store.set(agentPlanModeSessionsAtom, (prev: Set<string>) => {
              if (prev.has(sessionId)) return prev
              const next = new Set(prev)
              next.add(sessionId)
              return next
            })
            // 同步更新权限模式选择器（per-session）
            store.set(agentPermissionModeMapAtom, (prev: Map<string, import('@asci/shared').ASCIPermissionMode>) => {
              const next = new Map(prev)
              next.set(sessionId, 'plan')
              return next
            })
          } else if (event.type === 'permission_mode_changed') {
            // 权限模式变更（如 Plan 模式退出时切换到完全自动）
            console.log(`[GlobalAgentListeners] 权限模式变更: ${event.mode}`)
            store.set(agentPermissionModeMapAtom, (prev: Map<string, import('@asci/shared').ASCIPermissionMode>) => {
              const next = new Map(prev)
              next.set(sessionId, event.mode)
              return next
            })
          }
        }
        }) // unstable_batchedUpdates
      }
    )

    // ===== 2. 流式完成 =====
    const cleanupComplete = window.electronAPI.onAgentStreamComplete(
      (data: AgentStreamCompletePayload) => {
        unstable_batchedUpdates(() => {
        // 发送桌面通知（任务完成，始终播放提示音）
        const enabled = store.get(notificationsEnabledAtom)
        const soundEnabled = store.get(notificationSoundEnabledAtom)
        const sounds = store.get(notificationSoundsAtom)
        const sessionTitle = getSessionTitle(data.sessionId)
        sendDesktopNotification(
          'Agent 任务完成',
          `[${sessionTitle}] 任务已完成`,
          enabled,
          {
            playSound: enabled && soundEnabled,
            soundType: 'taskComplete',
            sounds,
            onNavigate: makeNavigateToSession(data.sessionId, sessionTitle),
          }
        )

        // STREAM_COMPLETE 表示后端已完全结束 — 立即标记 running: false
        // 同时将所有未完成的工具活动标记为已完成，防止 subagent spinner 继续转动
        // （complete 事件只清除 retrying，保持 running: true 以防竞态）
        // 竞态保护：通过 startedAt 区分新旧流，防止旧流的 complete 事件重置新流的 running 状态
        store.set(agentStreamingStatesAtom, (prev) => {
          const current = prev.get(data.sessionId)
          if (!current || !current.running) {
            return prev
          }
          if (current.startedAt != null && (data.startedAt == null || current.startedAt > data.startedAt)) {
            return prev
          }
          const map = new Map(prev)
          map.set(data.sessionId, {
            ...current,
            running: false,
            ...finalizeStreamingActivities(current.toolActivities, current.teammates),
          })
          return map
        })

        // 排队徽标兜底清除：整段 agent run 结束（STREAM_COMPLETE）时，确保该会话不残留「排队中」徽标
        store.set(clearQueuedMessageUuidsAtom, data.sessionId)

        // 如果用户当前不在查看该会话，标记为"未查看的已完成"
        const currentSessionId = store.get(currentAgentSessionIdAtom)
        if (data.sessionId !== currentSessionId) {
          store.set(unviewedCompletedSessionIdsAtom, (prev: Set<string>) => {
            const next = new Set(prev)
            next.add(data.sessionId)
            return next
          })
        }

        // 添加到 Working Done 集合（保持到 Tab 关闭）
        store.set(workingDoneSessionIdsAtom, (prev: Set<string>) => {
          const next = new Set(prev)
          next.add(data.sessionId)
          return next
        })

        // 标记用户主动打断状态
        if (data.stoppedByUser) {
          store.set(stoppedByUserSessionsAtom, (prev: Set<string>) => {
            const next = new Set(prev)
            next.add(data.sessionId)
            return next
          })
        }

        // 非正常结束时显示截断提示
        if (data.resultSubtype && data.resultSubtype !== 'success' && !data.stoppedByUser) {
          const messages: Record<string, string> = {
            error_max_turns: '任务被中断：已达到轮次上限。继续对话可让 Agent 接着完成。',
            error_max_budget_usd: '任务被中断：已达到预算上限。',
            error_during_execution: '任务执行过程中发生错误。',
          }
          const msg = messages[data.resultSubtype] ?? `任务异常结束（${data.resultSubtype}）`
          toast.warning(msg)
        }

        // 清除 Plan 模式状态（防止异常退出时残留）
        store.set(agentPlanModeSessionsAtom, (prev: Set<string>) => {
          if (!prev.has(data.sessionId)) return prev
          const next = new Set(prev)
          next.delete(data.sessionId)
          return next
        })

        /** 竞态保护：检查该会话是否已有新的流式请求正在运行 */
        const isNewStreamRunning = (): boolean => {
          const state = store.get(agentStreamingStatesAtom).get(data.sessionId)
          return state?.running === true
        }

        /** 递增消息刷新版本号，通知 AgentView 重新加载消息 */
        const bumpRefresh = (): void => {
          store.set(agentMessageRefreshAtom, (prev) => {
            const map = new Map(prev)
            map.set(data.sessionId, (prev.get(data.sessionId) ?? 0) + 1)
            return map
          })
        }

        const finalize = (): void => {
          // 竞态保护：新流已启动时不要清理状态
          if (isNewStreamRunning()) return

          // 清理后台任务
          store.set(backgroundTasksAtomFamily(data.sessionId), [])

          // 注意：liveMessages 的清理已移至 AgentView 消息加载完成后执行，
          // 与 streamingState 清理同步，避免「实时消息已清 → 持久化消息未到」的空档闪烁

          // 刷新会话列表并同步 stoppedByUser 状态
          window.electronAPI
            .listAgentSessions()
            .then((sessions) => {
              store.set(agentSessionsAtom, sessions)
              // 从持久化 meta 对齐 stoppedByUser 状态
              store.set(stoppedByUserSessionsAtom, new Set<string>(
                sessions.filter((s) => s.stoppedByUser).map((s) => s.id)
              ))
            })
            .catch(console.error)

          // 注意：流式状态的完全清除由 AgentView 在消息加载完成后执行，
          // 确保不会出现「气泡消失 → 持久化消息尚未加载」的空档闪烁
        }

        // 通知 AgentView 重新加载消息（无论是否为当前会话）
        if (!isNewStreamRunning()) {
          bumpRefresh()
        }
        finalize()
        }) // unstable_batchedUpdates
      }
    )

    // ===== 3. 流式错误 =====
    const cleanupError = window.electronAPI.onAgentStreamError(
      (data: { sessionId: string; error: string }) => {
        unstable_batchedUpdates(() => {
        console.error('[GlobalAgentListeners] 流式错误:', data.error)

        // 存储错误消息
        store.set(agentStreamErrorsAtom, (prev) => {
          const map = new Map(prev)
          map.set(data.sessionId, data.error)
          return map
        })

        // 递增消息刷新版本号，通知 AgentView 重新加载消息
        const state = store.get(agentStreamingStatesAtom).get(data.sessionId)
        if (!state?.running) {
          store.set(agentMessageRefreshAtom, (prev) => {
            const map = new Map(prev)
            map.set(data.sessionId, (prev.get(data.sessionId) ?? 0) + 1)
            return map
          })
        }
        }) // unstable_batchedUpdates
      }
    )

    // ===== 4. 标题更新 =====
    const cleanupTitleUpdated = window.electronAPI.onAgentTitleUpdated(() => {
      window.electronAPI
        .listAgentSessions()
        .then((sessions) => {
          const prevSessions = store.get(agentSessionsAtom)
          store.set(agentSessionsAtom, sessions)
          // 同步更新标签页标题（比较新旧标题，有变化才更新）
          for (const session of sessions) {
            const prev = prevSessions.find((s) => s.id === session.id)
            if (prev && prev.title !== session.title) {
              store.set(tabsAtom, (tabs) => updateTabTitle(tabs, session.id, session.title))
            }
          }
        })
        .catch(console.error)
    })

    // ===== 工作区论文库：当前工作区切换 + 后端 changed 事件 → 全量重载 =====
    const reloadWorkspacePapers = async () => {
      const wsId = store.get(currentAgentWorkspaceIdAtom)
      if (!wsId) {
        store.set(workspacePapersAtom, [])
        return
      }
      try {
        const list = await window.electronAPI.workspacePapers.list(wsId, {})
        // 竞态保护：await 期间工作区可能已被切换，只有仍在原工作区才写入
        if (store.get(currentAgentWorkspaceIdAtom) !== wsId) return
        store.set(workspacePapersAtom, list)
      } catch (err) {
        console.error('[全局监听] 加载工作区论文失败:', err)
      }
    }

    // 首次挂载：拉一次当前工作区
    void reloadWorkspacePapers()

    // 后端推送的 changed 事件
    const cleanupWorkspacePapersChanged = window.electronAPI.workspacePapers.onChanged((event) => {
      const currentWsId = store.get(currentAgentWorkspaceIdAtom)
      if (event.workspaceId !== currentWsId) return
      if (event.reason === 'reflow_failed') {
        // Stage D 会接入 toast UI；此处先 error 日志，避免静默丢失
        console.error('[全局监听] 工作区论文回流失败（将在 Stage D 接 toast）:', event)
        return
      }
      void reloadWorkspacePapers()
    })

    // 工作区切换：直接订阅 atom，返回 unsub
    const cleanupWorkspaceSub = store.sub(currentAgentWorkspaceIdAtom, () => {
      void reloadWorkspacePapers()
    })

    // ===== 工作区切换 → 右侧对话框自动加载该项目最近会话 (F46 / #89) =====
    // 当 currentAgentWorkspaceId 变化时，按优先级路由：
    //   1) 活跃 tab 已属于新工作区 → 反向同步路径（TabBar.handleActivate 等），跳过
    //   1.5) 工作区记忆的 active tab 仍打开 → 还原（#458）
    //   2) 已打开 tabs 中有属于新工作区的最近会话 → 激活
    //   3) 工作区有历史会话但无 tab → 打开最近一个
    //   4) 工作区完全无历史 → 创建一个 draft 新会话
    const openAndActivateAgentTab = (sessionId: string, title: string, workspaceId: string): void => {
      const result = openTab(store.get(tabsAtom), { type: 'agent', sessionId, title, workspaceId })
      store.set(tabsAtom, result.tabs)
      store.set(activeTabIdAtom, result.activeTabId)
      store.set(currentAgentSessionIdAtom, sessionId)
    }
    const clearUnviewed = (sessionId: string): void => {
      store.set(unviewedCompletedSessionIdsAtom, (prev) => {
        if (!prev.has(sessionId)) return prev
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
    }
    // 防止快速 A→B→A 切换在 createAgentSession await 间隙产生重复 draft
    const creatingDraftForWorkspace = new Set<string>()
    // 关闭其它工作区遗留的空标签：切换项目时，旧项目自动开的"新 Agent 会话"
    // （未发任何消息）不应继续占着标签，否则多次切项目会堆积多个"新 Agent 会话"。
    // 以"消息文件是否为空"判定，而非依赖内存 draft 集合——复用的空会话可能已不在
    // draftSessionIdsAtom 中（如 getOrCreateDraftAgentSession 复用的历史空会话）。
    const pruneForeignEmptyTabs = async (keepWsId: string): Promise<void> => {
      const tabs = store.get(tabsAtom)
      const sessions = store.get(agentSessionsAtom)
      const foreign = tabs.filter(
        (t) => (t.workspaceId ?? sessions.find((s) => s.id === t.sessionId)?.workspaceId) !== keepWsId,
      )
      if (foreign.length === 0) return

      const emptyIds = new Set<string>()
      await Promise.all(
        foreign.map(async (t) => {
          try {
            const msgs = await window.electronAPI.getAgentSessionMessages(t.sessionId)
            if (msgs.length === 0) emptyIds.add(t.id)
          } catch { /* 读取失败则保守保留该标签 */ }
        }),
      )
      if (emptyIds.size === 0) return

      // 竞态保护：await 期间工作区可能已被切走
      if (store.get(currentAgentWorkspaceIdAtom) !== keepWsId) return

      let nextTabs = store.get(tabsAtom)
      let activeTabId = store.get(activeTabIdAtom)
      for (const id of emptyIds) {
        const result = closeTab(nextTabs, activeTabId, id, keepWsId)
        nextTabs = result.tabs
        activeTabId = result.activeTabId
      }
      store.set(tabsAtom, nextTabs)
      store.set(activeTabIdAtom, activeTabId)
    }

    const switchActiveSessionForWorkspace = async (): Promise<void> => {
      const wsId = store.get(currentAgentWorkspaceIdAtom)
      if (!wsId) return

      await pruneForeignEmptyTabs(wsId)

      const tabs = store.get(tabsAtom)
      const activeTabId = store.get(activeTabIdAtom)
      const agentSessions = store.get(agentSessionsAtom)

      const activeTab = activeTabId ? tabs.find((t) => t.id === activeTabId) ?? null : null
      if (activeTab) {
        const activeSession = agentSessions.find((s) => s.id === activeTab.sessionId)
        if (activeSession?.workspaceId === wsId) return
      }

      // 1.5) 该工作区记忆的 active tab 仍打开且归属匹配 → 直接还原（#458）
      const rememberedId = store.get(activeTabIdByWorkspaceAtom)[wsId]
      const rememberedTab = rememberedId ? tabs.find((t) => t.id === rememberedId) : undefined
      if (rememberedTab && (rememberedTab.workspaceId == null || rememberedTab.workspaceId === wsId)) {
        store.set(activeTabIdAtom, rememberedTab.id)
        store.set(currentAgentSessionIdAtom, rememberedTab.sessionId)
        clearUnviewed(rememberedTab.sessionId)
        return
      }

      const workspaceSessions = agentSessions
        .filter((s) => s.workspaceId === wsId && !s.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt)

      const tabSessionIds = new Set(tabs.map((t) => t.sessionId))
      const tabbedSession = workspaceSessions.find((s) => tabSessionIds.has(s.id))
      if (tabbedSession) {
        store.set(activeTabIdAtom, tabbedSession.id)
        store.set(currentAgentSessionIdAtom, tabbedSession.id)
        clearUnviewed(tabbedSession.id)
        return
      }

      if (workspaceSessions.length > 0) {
        const recent = workspaceSessions[0]!
        openAndActivateAgentTab(recent.id, recent.title, wsId)
        clearUnviewed(recent.id)
        return
      }

      if (creatingDraftForWorkspace.has(wsId)) return
      creatingDraftForWorkspace.add(wsId)
      try {
        const channelId = store.get(agentChannelIdAtom) ?? undefined
        // 复用该工作区下已存在的空会话，没有才新建，避免堆积多个"新 Agent 会话"
        const meta = await window.electronAPI.getOrCreateDraftAgentSession(channelId, wsId)
        // 竞态保护：await 期间工作区可能已被切换
        if (store.get(currentAgentWorkspaceIdAtom) !== wsId) return
        store.set(agentSessionsAtom, (prev) => [meta, ...prev.filter((s) => s.id !== meta.id)])
        store.set(draftSessionIdsAtom, (prev) => {
          const next = new Set(prev)
          next.add(meta.id)
          return next
        })
        openAndActivateAgentTab(meta.id, meta.title, wsId)
        store.set(activeViewAtom, 'conversations')
      } catch (err) {
        console.error('[全局监听] 工作区切换时创建草稿会话失败:', err)
      } finally {
        creatingDraftForWorkspace.delete(wsId)
      }
    }

    // 启动恢复守卫：app 启动时 atom 从 null → settings 中的 wsId 会触发一次订阅，
    // 此时 agentSessions / tabs 都还在异步加载，必须跳过否则会误创建 draft
    let startupRestoreSkipped = store.get(currentAgentWorkspaceIdAtom) !== null
    const cleanupWorkspaceSessionSub = store.sub(currentAgentWorkspaceIdAtom, () => {
      if (!startupRestoreSkipped) {
        startupRestoreSkipped = true
        return
      }
      void switchActiveSessionForWorkspace()
    })

    // ===== tab.workspaceId 自愈回填（#458）=====
    // openTab 调用方拿到的 session 列表可能 stale（新建会话同渲染周期内查不到），
    // 会话列表更新时用 meta 补齐缺失的归属，保证 tab 栏按工作区过滤不漏
    const cleanupTabWorkspaceBackfillSub = store.sub(agentSessionsAtom, () => {
      const tabs = store.get(tabsAtom)
      const next = backfillTabWorkspaceIds(tabs, store.get(agentSessionsAtom))
      if (next !== tabs) store.set(tabsAtom, next)
    })

    return () => {
      cleanupEvent()
      cleanupComplete()
      cleanupError()
      cleanupTitleUpdated()
      cleanupWorkspacePapersChanged()
      cleanupWorkspaceSub()
      cleanupWorkspaceSessionSub()
      cleanupTabWorkspaceBackfillSub()
    }
  }, [store]) // store 引用稳定，effect 只执行一次
}
