/**
 * useGlobalAgentListeners — 全局 Agent IPC 监听器
 *
 * 在应用顶层挂载，永不销毁。将所有 Agent 流式事件、
 * 权限请求、AskUser 请求写入对应 Jotai atoms。
 *
 * 使用 useStore() 直接操作 atoms，避免 React 订阅。
 */

import { payloadToLegacyEvents } from './agent-payload-events.ts'
import { createAgentNotificationHelpers } from './agent-notification-helpers.ts'
import { applyToolRunSnapshotAtom, clearToolRunPermissionsAtom } from './tool-run-snapshot-state.ts'
import { acceptAgentAttempt } from '@/lib/agent-attempt'
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
  openResearchGapTab,
  rightPanelTabsBySessionAtom,
} from '@/atoms/right-panel-tabs'
import { researchGapTablesBySessionAtom, appendResearchGapTable } from '@/atoms/research-gap-atoms'
import { isSessionDeliverable, resolveAgainstCwd } from '@/lib/deliverable-path'
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
import { toast } from 'sonner'
import { i18n } from '@/lib/i18n'
import type { AgentStreamEvent, AgentStreamCompletePayload } from '@asci/shared'
import { isSubagentToolUse, nowMs } from '@asci/shared'

// ============================================================================
// Phase 1 临时兼容层：将 AgentStreamPayload 转换为旧 AgentEvent
// Phase 2 将移除此转换，直接使用 SDKMessage 渲染
// ============================================================================

export function useGlobalAgentListeners(): void {
  const store = useStore()

  useEffect(() => {
    // 「产物文件生成即在右栏自动预览」用的关联表：Write 的 tool_start 先记下 file_path，
    // 待其 tool_result 成功回来时，若该文件是 cwd 根的可预览产物则在右栏开 tab。
    // 仅活在本 effect（永不销毁）生命周期内；replay 消息已被 payloadToLegacyEvents 过滤，不会回放重开。
    const pendingDeliverableWrites = new Map<string, string>() // toolUseId → 原始 file_path

    const { makeNavigateToSession, getSessionTitle, sendBlockingNotification, openDeliverableInRightPanel } = createAgentNotificationHelpers(store)
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
        if (!acceptAgentAttempt(store,sessionId,streamEvent.requestId)) return

        if (payload.kind === 'asci_event' && (payload.event.type === 'tool_run_snapshot' || payload.event.type === 'native_chain_snapshot')) {
          for (const request of store.set(applyToolRunSnapshotAtom, streamEvent)) {
            sendBlockingNotification(sessionId, i18n.t('conversation:banner.permissionRequired'), request.toolName, 'permissionRequest')
          }
          return
        }

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
                startedAt: streamEvent.startedAt,
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
          } else if (event.type === 'permission_resolved') {
            store.set(allPendingPermissionRequestsAtom, (prev) => {
              const current=prev.get(sessionId) ?? []
              const next=current.filter(p=>p.requestId!==event.requestId)
              return next.length===current.length ? prev : new Map(prev).set(sessionId,next)
            })
          } else if (event.type === 'permission_request') {
            if (store.get(allPendingPermissionRequestsAtom).get(sessionId)?.some(p=>p.requestId===event.request.requestId)) continue
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
              i18n.t('conversation:banner.permissionRequired'),
              event.request.toolName,
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
        if (!acceptAgentAttempt(store,data.sessionId,data.requestId)) return
        store.set(clearToolRunPermissionsAtom, data)
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
        // 竞态保护：整个回调已按 requestId 核对归属；旧 SDK 缺失时间元数据时保留原行为
        store.set(agentStreamingStatesAtom, (prev) => {
          const current = prev.get(data.sessionId)
          if (!current || !current.running) {
            return prev
          }
          if (data.requestId === undefined && current.startedAt != null && (data.startedAt == null || current.startedAt > data.startedAt)) {
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
          const msg = window.__DESKTOP_RUNTIME_PREVIEW__ === true
            ? i18n.t('desktopRuntime.failed', { ns: 'errors' })
            : messages[data.resultSubtype] ?? `任务异常结束（${data.resultSubtype}）`
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
              if (!acceptAgentAttempt(store,data.sessionId,data.requestId)) return
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
      (data: { sessionId: string; requestId?: string; startedAt?: number; error: string }) => {
        unstable_batchedUpdates(() => {
        if (!acceptAgentAttempt(store,data.sessionId,data.requestId)) return
        store.set(clearToolRunPermissionsAtom, data)
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
      // 原生项目有独立概览与新建入口，浏览项目本身不应创建或清理任何会话。
      if (window.__TAURI_FORMAL__?.bindProjectDirectory) return
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
