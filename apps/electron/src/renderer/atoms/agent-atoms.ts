/**
 * Agent Atoms — Agent 模式的 Jotai 状态管理
 *
 * 管理 Agent 会话列表、当前会话、消息、流式状态等。
 * 模式照搬 chat-atoms.ts。
 */

import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import type { AgentSessionMeta, AgentMessage, AgentEvent, AgentWorkspace, AgentPendingFile, RecentFileEntry, RetryAttempt, ASCIPermissionMode, PermissionRequest, AskUserRequest, ExitPlanModeRequest, LitReviewPresentDirectionsRequest, SearchPlanConfirmRequest, AgentEffort, TaskUsage, SDKMessage, MentionKind } from '@asci/shared'
import { isSubagentToolUse, DEFAULT_AGENT_EFFORT, nowMs } from '@asci/shared'

/** 活动状态 */
export type ActivityStatus = 'pending' | 'running' | 'completed' | 'error' | 'backgrounded'

/** 工具活动状态 */
export interface ToolActivity {
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  intent?: string
  displayName?: string
  result?: string
  isError?: boolean
  done: boolean
  parentToolUseId?: string
  elapsedSeconds?: number
  taskId?: string
  shellId?: string
  isBackground?: boolean
  /** MCP 工具返回的图片附件 */
  imageAttachments?: Array<{ localPath: string; filename: string; mediaType: string }>
}

/** 活动分组（Task 子代理） */
export interface ActivityGroup {
  parent: ToolActivity
  children: ToolActivity[]
}

/** Teammate 状态枚举 */
export type TeammateStatus = 'running' | 'completed' | 'failed' | 'stopped'

/** 单个 teammate 的实时状态（Agent Teams 功能） */
export interface TeammateState {
  /** SDK task_id */
  taskId: string
  /** 关联的 tool_use_id（Task 工具调用 ID） */
  toolUseId?: string
  /** 任务描述（spawn 时 Claude 给出的说明） */
  description: string
  /** 任务类型（SDK 内部类型，如 in_process_teammate） */
  taskType?: string
  /** 在当前对话中的序号（从 1 开始） */
  index: number
  /** 当前状态 */
  status: TeammateStatus
  /** 最近一次 task_progress 的描述（实时思考内容） */
  progressDescription?: string
  /** 当前正在运行的工具名 */
  currentToolName?: string
  /** 当前工具已运行秒数 */
  currentToolElapsedSeconds?: number
  /** 当前工具 toolUseId */
  currentToolUseId?: string
  /** 已使用的工具历史记录（最近 N 个，去重） */
  toolHistory: string[]
  /** 完成时的摘要 */
  summary?: string
  /** 完成时输出文件路径 */
  outputFile?: string
  /** 累计用量 */
  usage?: TaskUsage
  /** 开始时间戳 */
  startedAt: number
  /** 结束时间戳 */
  endedAt?: number
}

/** 工具历史最大记录数 */
const MAX_TOOL_HISTORY = 20

/**
 * 将流式状态中未完成的 toolActivities 和 running teammates 标记为终态。
 * 用于 complete、handleStop、STREAM_COMPLETE 等多个终态入口的兜底清理。
 * 当所有项已处于终态时返回原引用，避免不必要的 React 重渲染。
 */
export function finalizeStreamingActivities(
  toolActivities: ToolActivity[],
  teammates: TeammateState[]
): { toolActivities: ToolActivity[]; teammates: TeammateState[] } {
  const hasUnfinishedTools = toolActivities.some((ta) => !ta.done)
  const hasRunningTeammates = teammates.some((tm) => tm.status === 'running')

  return {
    toolActivities: hasUnfinishedTools
      ? toolActivities.map((ta) => (ta.done ? ta : { ...ta, done: true }))
      : toolActivities,
    teammates: hasRunningTeammates
      ? teammates.map((tm) =>
          tm.status === 'running'
            ? { ...tm, status: 'stopped' as const, endedAt: nowMs(), currentToolName: undefined, currentToolElapsedSeconds: undefined, currentToolUseId: undefined }
            : tm
        )
      : teammates,
  }
}

/** Agent 会话的流式状态 */
export interface AgentStreamState {
  running: boolean
  content: string
  toolActivities: ToolActivity[]
  model?: string
  /** 当前输入 token 数（上下文使用量） */
  inputTokens?: number
  /** 输出 token 数 */
  outputTokens?: number
  /** 缓存读取 token 数 */
  cacheReadTokens?: number
  /** 缓存写入 token 数 */
  cacheCreationTokens?: number
  /** 费用（美元） */
  costUsd?: number
  /** 模型上下文窗口大小 */
  contextWindow?: number
  /** 是否正在压缩上下文 */
  isCompacting?: boolean
  /**
   * 压缩流程是否进行中（含收尾窗口）。
   * 从用户点击压缩 / SDK compacting 事件开始 → 到整个 stream 结束（state 被删除）前一直为 true。
   * 用于抑制压缩分隔符切换期间 AgentRunningIndicator 的短暂闪烁。
   */
  compactInFlight?: boolean
  /** 流式开始时间戳（用于思考计时持久化） */
  startedAt?: number
  /** 重试状态（扩展版） */
  retrying?: {
    /** 当前第几次尝试 */
    currentAttempt: number
    /** 最大尝试次数 */
    maxAttempts: number
    /** 重试历史记录（按时间顺序） */
    history: RetryAttempt[]
    /** 是否已失败 */
    failed: boolean
  }
  /** Agent Teams: teammate 状态列表 */
  teammates: TeammateState[]
  /** 是否等待 auto-resume（teammate 结果收集中） */
  waitingResume?: boolean
  /**
   * 本轮已解析的输出语言（由 orchestrator 在 user-turn 入口处发布 resolved_language 事件设置）。
   * 用于 UI 显示语言锁徽标 + 流式漂移检测。turn 结束（complete/error）时不清除，
   * 持续显示直至下一 turn 的 resolved_language 事件覆盖。
   */
  resolvedLanguage?: 'en' | 'zh'
}

/** 从 ToolActivity 派生状态 */
export function getActivityStatus(activity: ToolActivity): ActivityStatus {
  if (activity.isBackground) return 'backgrounded'
  if (!activity.done) return 'running'
  if (activity.isError) return 'error'
  return 'completed'
}

/**
 * 合并同层 TodoWrite 活动：多次调用只保留最新 input，置底显示
 *
 * TodoWrite 每次调用都包含完整的 todo 列表，只需展示最新状态。
 */
function mergeTodoWrites(activities: ToolActivity[]): ToolActivity[] {
  const todoWrites: ToolActivity[] = []
  const others: ToolActivity[] = []

  for (const a of activities) {
    if (a.toolName === 'TodoWrite') {
      todoWrites.push(a)
    } else {
      others.push(a)
    }
  }

  if (todoWrites.length === 0) return activities

  const latest = todoWrites[todoWrites.length - 1]!
  const allDone = todoWrites.every((t) => t.done)

  const merged: ToolActivity = {
    ...latest,
    done: allDone,
    isError: allDone && todoWrites.some((t) => t.isError),
  }

  return [...others, merged]
}

/**
 * 将扁平活动列表按 parentToolUseId 分组
 *
 * 返回顶层项（ActivityGroup | ToolActivity），
 * Task 类型的工具作为 group.parent，其子活动嵌套在 children 中。
 * 每层内 TodoWrite 合并去重并置底。
 */
export function groupActivities(activities: ToolActivity[]): Array<ActivityGroup | ToolActivity> {
  // 过滤幽灵条目：tool_progress 创建的空 input 条目，完成后仍无内容
  const filtered = activities.filter((a) => {
    if (a.done && Object.keys(a.input).length === 0 && !a.result) return false
    return true
  })
  const processed = mergeTodoWrites(filtered)

  const parentIds = new Set<string>()
  for (const a of processed) {
    if (isSubagentToolUse({ name: a.toolName })) parentIds.add(a.toolUseId)
  }

  const childrenMap = new Map<string, ToolActivity[]>()
  const topLevel: Array<ActivityGroup | ToolActivity> = []

  for (const a of processed) {
    if (a.parentToolUseId && parentIds.has(a.parentToolUseId)) {
      const children = childrenMap.get(a.parentToolUseId) ?? []
      children.push(a)
      childrenMap.set(a.parentToolUseId, children)
    } else {
      topLevel.push(a)
    }
  }

  return topLevel.map((item) => {
    if ('toolUseId' in item && parentIds.has(item.toolUseId)) {
      const children = childrenMap.get(item.toolUseId) ?? []
      return { parent: item, children: mergeTodoWrites(children) } as ActivityGroup
    }
    return item
  })
}

/** 判断是否为 ActivityGroup */
export function isActivityGroup(item: ActivityGroup | ToolActivity): item is ActivityGroup {
  return 'parent' in item && 'children' in item
}


/** 待自动发送的 Agent 提示（从设置页"对话完成配置"触发） */
export interface AgentPendingPrompt {
  sessionId: string
  message: string
}

// ===== Atoms =====

export const agentSessionsAtom = atom<AgentSessionMeta[]>([])
export const agentWorkspacesAtom = atom<AgentWorkspace[]>([])
export const currentAgentWorkspaceIdAtom = atom<string | null>(null)
/** 全局默认渠道 ID（新会话继承用，从 settings.json 加载） */
export const agentChannelIdAtom = atom<string | null>(null)
/** 全局默认模型 ID（新会话继承用，从 settings.json 加载） */
export const agentModelIdAtom = atom<string | null>(null)
/** Agent 启用的渠道 ID 列表（多选，设置页 Switch 开关控制） */
export const agentChannelIdsAtom = atom<string[]>([])

/** Per-session 渠道 ID Map — sessionId → channelId */
export const agentSessionChannelMapAtom = atom<Map<string, string>>(new Map())
/** Per-session 模型 ID Map — sessionId → modelId */
export const agentSessionModelMapAtom = atom<Map<string, string>>(new Map())
export const currentAgentSessionIdAtom = atom<string | null>(null)
export const currentAgentMessagesAtom = atom<AgentMessage[]>([])
export const agentStreamingStatesAtom = atom<Map<string, AgentStreamState>>(new Map())

/**
 * 实时 SDKMessage 累积 Map — Phase 2 新增
 *
 * 流式期间每条 SDKMessage 直接追加，供新 UI 渲染。
 * 流式完成后清空（持久化消息从 JSONL 加载）。
 */
export const liveMessagesMapAtom = atom<Map<string, SDKMessage[]>>(new Map())

export const agentPendingPromptAtom = atom<AgentPendingPrompt | null>(null)

/** Agent 待发送文件列表 */
export const agentPendingFilesAtom = atom<AgentPendingFile[]>([])

/**
 * Agent 待发送 mention 列表（@ 选中的项目文件 / Zotero 条目 / Zotero 类目 / 证据集）。
 * 选中后不再 inline 插入编辑器，而是挂在编辑器上方独立的 chip 行；
 * 发送时由上层格式化为 `@file:…` / `@zotero-item:…|label` / `@zotero-col:…|label`
 * / `@evidence-set:…|label` token 拼到正文。
 */
export interface AgentPendingMention {
  kind: MentionKind
  /** 唯一标识：file=path, zotero-*=key, evidence-set=证据集 id */
  id: string
  /** 展示标签：file=name, zotero-item=title, zotero-col=path, evidence-set=name */
  label: string
}

export const agentPendingMentionsAtom = atom<AgentPendingMention[]>([])

/**
 * 批量追加 mention 到 agentPendingMentionsAtom，按 kind+id 去重。
 * 已存在的项跳过、未存在的追加，保持顺序。空数组 no-op。
 *
 * 单一真相：F38 / F43 / F44 三处 mention 入口（@-trigger / 拖拽 / 右键引用）
 * 都通过此 writer 写入；dedup 不在调用方重复实现。
 */
export const addPendingMentionsAtom = atom(
  null,
  (_get, set, items: AgentPendingMention[]) => {
    if (items.length === 0) return
    set(agentPendingMentionsAtom, (prev) => {
      const next = [...prev]
      let added = false
      for (const item of items) {
        if (next.some((x) => x.kind === item.kind && x.id === item.id)) continue
        next.push(item)
        added = true
      }
      return added ? next : prev
    })
  },
)

/** 排队中消息：uuid + 展示文本（文本在入队时即确定，无需再回 liveMessages 反查） */
export interface QueuedMessage {
  uuid: string
  text: string
}

/**
 * per-session「排队中」消息有序队列（队头 = 最先执行）。
 *
 * 连发消息时，未被打断的新消息进入此队列，文本固定展示在输入框上方的排队条；
 * turn 结束（complete / STREAM_COMPLETE）清空整条。打断消息插到队头（它会立即成为下一轮）。
 * 每条在入队时就带上展示文本，渲染层直接读取，不依赖 liveMessages（避免流式期逐 token 反查）。
 */
export const queuedMessageUuidsAtom = atom<Map<string, QueuedMessage[]>>(new Map())

/** 入队：mode='tail' 排队追加到队尾；mode='head' 打断插到队头 */
export const enqueueMessageUuidAtom = atom(
  null,
  (_get, set, { sessionId, uuid, text, mode }: { sessionId: string; uuid: string; text: string; mode: 'tail' | 'head' }) => {
    set(queuedMessageUuidsAtom, (prev) => {
      const map = new Map(prev)
      const list = map.get(sessionId) ?? []
      const item: QueuedMessage = { uuid, text }
      map.set(sessionId, mode === 'head' ? [item, ...list] : [...list, item])
      return map
    })
  },
)

/** 按 uuid 移除队列中某条（发送失败回滚用）；移除后列表为空则删除 session key */
export const removeMessageUuidAtom = atom(
  null,
  (_get, set, { sessionId, uuid }: { sessionId: string; uuid: string }) => {
    set(queuedMessageUuidsAtom, (prev) => {
      const list = prev.get(sessionId)
      if (!list || !list.some((m) => m.uuid === uuid)) return prev
      const next = list.filter((m) => m.uuid !== uuid)
      const map = new Map(prev)
      if (next.length === 0) map.delete(sessionId)
      else map.set(sessionId, next)
      return map
    })
  },
)

/** 清空某会话队列（硬 Stop / 终态错误） */
export const clearQueuedMessageUuidsAtom = atom(
  null,
  (_get, set, sessionId: string) => {
    set(queuedMessageUuidsAtom, (prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })
  },
)

/** 工作区能力版本号 — 每次修改 MCP/Skills 后自增，触发侧边栏重新获取 */
export const workspaceCapabilitiesVersionAtom = atom(0)

/** 工作区文件版本号 — 文件变化时自增，触发文件浏览器重新加载 */
export const workspaceFilesVersionAtom = atom(0)

// ===== 侧面板 Atoms =====

/** 侧面板是否打开（per-session Map） */
export const agentSidePanelOpenMapAtom = atom<Map<string, boolean>>(new Map())

/** 当前会话的侧面板是否打开（派生只读，供 AppShell 使用，避免全 Map 订阅导致无关重渲染） */
export const currentSessionSidePanelOpenAtom = atom<boolean>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return false
  return get(agentSidePanelOpenMapAtom).get(currentId) ?? false
})

/** 当前会话的工作路径 Map — sessionId → path */
export const agentSessionPathMapAtom = atom<Map<string, string>>(new Map())

// ===== 权限系统 Atoms =====

/** 工作区默认权限模式（初始化和新会话使用） */
export const agentDefaultPermissionModeAtom = atom<ASCIPermissionMode>('acceptEdits')

/** Per-session 权限模式 Map — sessionId → ASCIPermissionMode */
export const agentPermissionModeMapAtom = atom<Map<string, ASCIPermissionMode>>(new Map())

/** 工作区默认推理深度（初始化和新会话使用） */
export const agentDefaultReasoningEffortAtom = atom<AgentEffort | ''>(DEFAULT_AGENT_EFFORT)

/** Per-session 推理深度 Map — sessionId → AgentEffort */
export const agentReasoningEffortMapAtom = atom<Map<string, AgentEffort | ''>>(new Map())

/** 待处理的权限请求 Map — 以 sessionId 为 key，切换会话时保留状态 */
export const allPendingPermissionRequestsAtom = atom<Map<string, readonly PermissionRequest[]>>(new Map())

type PermissionRequestsUpdate = readonly PermissionRequest[] | ((prev: readonly PermissionRequest[]) => readonly PermissionRequest[])

/** 当前会话的权限请求队列（派生读写原子） */
export const pendingPermissionRequestsAtom = atom(
  (get): readonly PermissionRequest[] => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return []
    return get(allPendingPermissionRequestsAtom).get(currentId) ?? []
  },
  (get, set, update: PermissionRequestsUpdate) => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return
    set(allPendingPermissionRequestsAtom, (prev) => {
      const map = new Map(prev)
      const current = map.get(currentId) ?? []
      const newValue = typeof update === 'function' ? update(current) : update
      if (newValue.length === 0) map.delete(currentId)
      else map.set(currentId, newValue)
      return map
    })
  }
)

/** 待处理的 AskUser 请求 Map — 以 sessionId 为 key，切换会话时保留状态 */
export const allPendingAskUserRequestsAtom = atom<Map<string, readonly AskUserRequest[]>>(new Map())

type AskUserRequestsUpdate = readonly AskUserRequest[] | ((prev: readonly AskUserRequest[]) => readonly AskUserRequest[])

/** 当前会话的 AskUser 请求队列（派生读写原子） */
export const pendingAskUserRequestsAtom = atom(
  (get): readonly AskUserRequest[] => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return []
    return get(allPendingAskUserRequestsAtom).get(currentId) ?? []
  },
  (get, set, update: AskUserRequestsUpdate) => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return
    set(allPendingAskUserRequestsAtom, (prev) => {
      const map = new Map(prev)
      const current = map.get(currentId) ?? []
      const newValue = typeof update === 'function' ? update(current) : update
      if (newValue.length === 0) map.delete(currentId)
      else map.set(currentId, newValue)
      return map
    })
  }
)

/** 待处理的 ExitPlanMode 请求 Map — 以 sessionId 为 key */
export const allPendingExitPlanRequestsAtom = atom<Map<string, readonly ExitPlanModeRequest[]>>(new Map())

/** 待处理的 lit-review present_directions 请求 Map — 以 sessionId 为 key（spec §5.4 Turn 1）*/
export const allPendingLitReviewDirectionsRequestsAtom = atom<Map<string, readonly LitReviewPresentDirectionsRequest[]>>(new Map())

/** 待处理的检索方案确认请求 Map — 以 sessionId 为 key（issue #435）*/
export const allPendingSearchPlanRequestsAtom = atom<Map<string, readonly SearchPlanConfirmRequest[]>>(new Map())

/** 当前处于 Plan 模式的会话 ID 集合 */
export const agentPlanModeSessionsAtom = atom<Set<string>>(new Set<string>())

export const currentAgentSessionAtom = atom<AgentSessionMeta | null>((get) => {
  const sessions = get(agentSessionsAtom)
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return null
  return sessions.find((s) => s.id === currentId) ?? null
})

export const agentStreamingAtom = atom<boolean>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return false
  return get(agentStreamingStatesAtom).get(currentId)?.running ?? false
})

export const agentStreamingContentAtom = atom<string>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return ''
  return get(agentStreamingStatesAtom).get(currentId)?.content ?? ''
})

export const agentToolActivitiesAtom = atom<ToolActivity[]>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return []
  return get(agentStreamingStatesAtom).get(currentId)?.toolActivities ?? []
})

export const agentStreamingModelAtom = atom<string | undefined>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return undefined
  return get(agentStreamingStatesAtom).get(currentId)?.model
})

export const agentRetryingAtom = atom<AgentStreamState['retrying'] | undefined>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return undefined
  return get(agentStreamingStatesAtom).get(currentId)?.retrying
})

export const agentStartedAtAtom = atom<number | undefined>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return undefined
  return get(agentStreamingStatesAtom).get(currentId)?.startedAt
})

export const agentRunningSessionIdsAtom = atom<Set<string>>((get) => {
  const states = get(agentStreamingStatesAtom)
  const ids = new Set<string>()
  for (const [id, state] of states) {
    if (state.running) ids.add(id)
  }
  return ids
})

/** 侧边栏会话指示点状态 */
export type SessionIndicatorStatus = 'idle' | 'running' | 'blocked' | 'completed'

/** 已完成但用户尚未查看的会话 ID 集合 */
export const unviewedCompletedSessionIdsAtom = atom<Set<string>>(new Set<string>())

/** Working 区域"已完成"组：本次 App 会话中完成且 Tab 仍打开的会话 ID（关闭 Tab 时移除） */
export const workingDoneSessionIdsAtom = atom<Set<string>>(new Set<string>())

/**
 * 每个会话的指示点状态（只包含非 idle 的会话）
 * 优先级：blocked > running > completed > idle
 */
export const agentSessionIndicatorMapAtom = atom<Map<string, SessionIndicatorStatus>>((get) => {
  const streamStates = get(agentStreamingStatesAtom)
  const pendingPerms = get(allPendingPermissionRequestsAtom)
  const pendingAskUser = get(allPendingAskUserRequestsAtom)
  const pendingExitPlan = get(allPendingExitPlanRequestsAtom)
  const unviewedCompleted = get(unviewedCompletedSessionIdsAtom)

  const map = new Map<string, SessionIndicatorStatus>()

  for (const [id, state] of streamStates) {
    if (!state.running) continue
    const hasBlock = (pendingPerms.get(id)?.length ?? 0) > 0
      || (pendingAskUser.get(id)?.length ?? 0) > 0
      || (pendingExitPlan.get(id)?.length ?? 0) > 0
    map.set(id, hasBlock ? 'blocked' : 'running')
  }

  for (const id of unviewedCompleted) {
    if (!map.has(id)) {
      map.set(id, 'completed')
    }
  }

  return map
})

/**
 * 追加工具名到历史记录（不可变版本）
 * 相同工具不连续重复，超出上限则删除最旧的
 */
function appendToolHistory(history: string[], toolName: string): string[] {
  if (history[history.length - 1] === toolName) return history
  const next = [...history, toolName]
  return next.length > MAX_TOOL_HISTORY ? next.slice(next.length - MAX_TOOL_HISTORY) : next
}

/**
 * 处理 AgentEvent 并更新流式状态（纯函数）
 */
export function applyAgentEvent(
  prev: AgentStreamState,
  event: AgentEvent,
): AgentStreamState {
  switch (event.type) {
    case 'text_delta':
      // 开始接收文本 - 清除重试状态（重试成功）
      return { ...prev, content: prev.content + event.text, retrying: undefined }

    case 'text_complete':
      // 用完整文本替换增量累积的文本（用于回放场景：只需 text_complete 即可重建文本状态）
      return { ...prev, content: event.text }

    case 'tool_start': {
      const existing = prev.toolActivities.find((t) => t.toolUseId === event.toolUseId)
      if (existing) {
        return {
          ...prev,
          toolActivities: prev.toolActivities.map((t) =>
            t.toolUseId === event.toolUseId
              ? { ...t, input: event.input, intent: event.intent || t.intent, displayName: event.displayName || t.displayName }
              : t
          ),
          // 开始工具调用 - 清除重试状态（重试成功）
          retrying: undefined,
        }
      }
      return {
        ...prev,
        toolActivities: [...prev.toolActivities, {
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          input: event.input,
          intent: event.intent,
          displayName: event.displayName,
          done: false,
          parentToolUseId: event.parentToolUseId,
        }],
        // 开始工具调用 - 清除重试状态（重试成功）
        retrying: undefined,
      }
    }

    case 'tool_result':
      return {
        ...prev,
        toolActivities: prev.toolActivities.map((t) =>
          t.toolUseId === event.toolUseId
            ? { ...t, result: event.result, isError: event.isError, done: true, imageAttachments: event.imageAttachments }
            : t
        ),
      }

    case 'task_backgrounded':
      return {
        ...prev,
        toolActivities: prev.toolActivities.map((t) =>
          t.toolUseId === event.toolUseId
            ? { ...t, isBackground: true, taskId: event.taskId, done: true }
            : t
        ),
      }

    case 'task_progress':
      // Teams 级别的 teammate 进度（带 taskId）
      if (event.taskId) {
        const tmIdx = prev.teammates.findIndex((t) => t.taskId === event.taskId)
        if (tmIdx >= 0) {
          const tm = prev.teammates[tmIdx]!
          const updatedTm: TeammateState = {
            ...tm,
            progressDescription: event.description ?? tm.progressDescription,
            usage: event.usage ?? tm.usage,
            // 更新当前工具名和计时（来自 tool_progress 或 system task_progress）
            ...(event.lastToolName && {
              currentToolName: event.lastToolName,
              currentToolElapsedSeconds: event.elapsedSeconds ?? tm.currentToolElapsedSeconds,
              currentToolUseId: event.toolUseId,
              toolHistory: appendToolHistory(tm.toolHistory, event.lastToolName),
            }),
            // 无 lastToolName 但有真实 elapsedSeconds 时仅更新计时
            ...(!event.lastToolName && event.elapsedSeconds != null && {
              currentToolElapsedSeconds: event.elapsedSeconds,
            }),
            // 主对话仍在运行时，收到进度说明 teammate 实际仍在工作，重置 stopped/failed
            // 主对话已结束时（running: false），不重置（防止建议信息等后续事件错误唤醒）
            ...(prev.running && (tm.status === 'stopped' || tm.status === 'failed')
              ? { status: 'running' as const, endedAt: undefined }
              : {}),
          }
          const nextTeammates = [...prev.teammates]
          nextTeammates[tmIdx] = updatedTm
          return { ...prev, teammates: nextTeammates }
        }
      }
      // 普通 tool 计时语义（仅当有真实 elapsedSeconds 时更新）
      if (event.elapsedSeconds != null) {
        return {
          ...prev,
          toolActivities: prev.toolActivities.map((t) =>
            t.toolUseId === event.toolUseId
              ? { ...t, elapsedSeconds: event.elapsedSeconds! }
              : t
          ),
        }
      }
      return prev

    case 'task_started': {
      // 查找匹配 toolUseId 的 ToolActivity，更新 intent 和 taskId
      let nextActivities = prev.toolActivities
      if (event.toolUseId) {
        const idx = prev.toolActivities.findIndex((t) => t.toolUseId === event.toolUseId)
        if (idx >= 0) {
          nextActivities = prev.toolActivities.map((t) =>
            t.toolUseId === event.toolUseId
              ? { ...t, intent: event.description, taskId: event.taskId }
              : t
          )
        }
      }
      // 去重：已有同 taskId 的 teammate 时仅更新 activities
      if (prev.teammates.some((t) => t.taskId === event.taskId)) {
        return { ...prev, toolActivities: nextActivities }
      }
      // 创建 TeammateState
      const newTeammate: TeammateState = {
        taskId: event.taskId,
        toolUseId: event.toolUseId,
        description: event.description,
        taskType: event.taskType,
        index: prev.teammates.length + 1,
        status: 'running',
        toolHistory: [],
        startedAt: nowMs(),
      }
      return {
        ...prev,
        toolActivities: nextActivities,
        teammates: [...prev.teammates, newTeammate],
      }
    }

    case 'shell_backgrounded':
      return {
        ...prev,
        toolActivities: prev.toolActivities.map((t) =>
          t.toolUseId === event.toolUseId
            ? { ...t, isBackground: true, shellId: event.shellId, done: true }
            : t
        ),
      }

    case 'shell_killed':
      return prev

    case 'task_notification': {
      // Agent Teams: teammate 完成/失败/停止
      const nextTeammates = [...prev.teammates]
      let tmIdx = nextTeammates.findIndex((t) => t.taskId === event.taskId)
      if (tmIdx < 0) {
        // task_started 丢失时的兜底：从 notification 补创 teammate
        nextTeammates.push({
          taskId: event.taskId,
          toolUseId: event.toolUseId,
          description: event.summary || event.taskId,
          index: nextTeammates.length + 1,
          status: 'running',
          toolHistory: [],
          startedAt: nowMs(),
        })
        tmIdx = nextTeammates.length - 1
      }
      nextTeammates[tmIdx] = {
        ...nextTeammates[tmIdx]!,
        status: event.status,
        summary: event.summary,
        outputFile: event.outputFile,
        endedAt: nowMs(),
        ...(event.usage && { usage: event.usage }),
        // 任务结束后清除实时工具状态
        currentToolName: undefined,
        currentToolElapsedSeconds: undefined,
        currentToolUseId: undefined,
      }
      return { ...prev, teammates: nextTeammates }
    }

    case 'tool_use_summary':
      // 工具使用摘要 — 目前不影响流式状态，仅用于 UI 展示
      return prev

    case 'waiting_resume':
      return { ...prev, waitingResume: true }

    case 'resume_start':
      return { ...prev, waitingResume: false }

    case 'complete':
      // 成功完成 — 清除 retrying，但保持 running: true
      // 等待 STREAM_COMPLETE IPC 回调通过删除流式状态来控制 UI 就绪状态
      // 这避免了用户在后端尚未完成清理时就能发送新消息的竞态条件
      // 同时将仍 running 的 teammates 标记为 stopped、未完成的工具活动标记为 done（兜底）
      return {
        ...prev,
        retrying: undefined,
        ...finalizeStreamingActivities(prev.toolActivities, prev.teammates),
      }

    case 'typed_error':
      // 处理类型化错误（TypedError）
      // 停止运行，清除重试状态
      return { ...prev, running: false, retrying: undefined }

    case 'error':
      // 改进：error 事件不再清除 retrying 状态
      // retrying 状态由专用事件控制
      return { ...prev, running: false }

    case 'usage_update':
      return {
        ...prev,
        inputTokens: event.usage.inputTokens,
        ...(event.usage.outputTokens != null && { outputTokens: event.usage.outputTokens }),
        ...(event.usage.cacheReadTokens != null && { cacheReadTokens: event.usage.cacheReadTokens }),
        ...(event.usage.cacheCreationTokens != null && { cacheCreationTokens: event.usage.cacheCreationTokens }),
        ...(event.usage.costUsd != null && { costUsd: event.usage.costUsd }),
        ...(event.usage.contextWindow && { contextWindow: event.usage.contextWindow }),
      }

    case 'compacting':
      return { ...prev, isCompacting: true, compactInFlight: true }

    case 'compact_complete':
      return { ...prev, isCompacting: false }

    case 'model_resolved':
      // 不用 SDK 返回的实际模型名覆盖，保持用户选择的 modelId
      // 以确保 resolveModelDisplayName 能匹配到渠道配置的显示名
      return prev

    case 'retrying':
      // 向后兼容：保留原有的简单 retrying 事件
      return {
        ...prev,
        retrying: prev.retrying ?? {
          currentAttempt: event.attempt,
          maxAttempts: event.maxAttempts,
          history: [],
          failed: false,
        },
      }

    case 'retry_attempt': {
      // 新增：记录详细的重试尝试
      const currentHistory = prev.retrying?.history ?? []
      return {
        ...prev,
        retrying: {
          currentAttempt: event.attemptData.attempt,
          maxAttempts: prev.retrying?.maxAttempts ?? 3,
          history: [...currentHistory, event.attemptData],
          failed: false,
        },
      }
    }

    case 'retry_cleared':
      // 新增：重试成功，清除状态
      return { ...prev, retrying: undefined }

    case 'retry_failed': {
      // 新增：重试失败，标记为 failed 但保留历史
      const finalHistory = prev.retrying?.history ?? []
      return {
        ...prev,
        running: false,
        retrying: {
          currentAttempt: event.finalAttempt.attempt,
          maxAttempts: prev.retrying?.maxAttempts ?? 3,
          history: [...finalHistory, event.finalAttempt],
          failed: true,
        },
      }
    }

    case 'permission_request':
      // 权限请求事件由 PermissionBanner 处理，不影响流式状态
      return prev

    case 'permission_resolved':
      // 权限解决事件由 PermissionBanner 处理，不影响流式状态
      return prev

    case 'ask_user_request':
      // AskUser 请求事件由 AskUserBanner 处理，不影响流式状态
      return prev

    case 'ask_user_resolved':
      // AskUser 解决事件由 AskUserBanner 处理，不影响流式状态
      return prev

    case 'prompt_suggestion':
      // 提示建议由全局监听器处理，不影响流式状态
      return prev

    case 'resolved_language':
      // 记录本轮已解析输出语言；用于 UI 语言锁徽标 + 漂移检测
      return { ...prev, resolvedLanguage: event.language }

    default:
      return prev
  }
}

/** 上下文使用量状态 */
export interface AgentContextStatus {
  isCompacting: boolean
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  costUsd?: number
  contextWindow?: number
}

/** 当前会话的上下文使用量派生 atom */
export const agentContextStatusAtom = atom<AgentContextStatus>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return { isCompacting: false }
  const state = get(agentStreamingStatesAtom).get(currentId)
  return {
    isCompacting: state?.isCompacting ?? false,
    inputTokens: state?.inputTokens,
    outputTokens: state?.outputTokens,
    cacheReadTokens: state?.cacheReadTokens,
    cacheCreationTokens: state?.cacheCreationTokens,
    costUsd: state?.costUsd,
    contextWindow: state?.contextWindow,
  }
})

/**
 * Agent 流式错误消息 Map — 以 sessionId 为 key
 * 错误发生时写入，下次发送或手动关闭时清除
 */
export const agentStreamErrorsAtom = atom<Map<string, string>>(new Map())

/**
 * Agent 消息刷新版本 Map — 以 sessionId 为 key
 * 全局监听器在流式完成/错误时递增版本号，
 * AgentView 监听版本号变化来重新加载消息。
 */
export const agentMessageRefreshAtom = atom<Map<string, number>>(new Map())

/** 当前 Agent 会话的错误消息（派生只读原子） */
export const currentAgentErrorAtom = atom<string | null>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return null
  return get(agentStreamErrorsAtom).get(currentId) ?? null
})

/**
 * Agent 会话输入框草稿 Map — 以 sessionId 为 key
 * 用于在切换会话时保留输入框内容
 */
export const agentSessionDraftsAtom = atom<Map<string, string>>(new Map())

/**
 * Agent 会话输入框 HTML 草稿 Map — 以 sessionId 为 key
 * 保存 TipTap 编辑器的原始 HTML，用于切换会话时恢复 mention 等富文本节点
 */
export const agentSessionDraftHtmlAtom = atom<Map<string, string>>(new Map())

/**
 * 工作区级附加目录列表（按 workspaceId 存储）
 *
 * 工作区内所有会话共享这些附加目录。
 */
export const workspaceAttachedDirectoriesMapAtom = atom<Map<string, string[]>>(new Map())

/** 当前 Agent 会话的草稿内容（派生读写原子） */
export const currentAgentSessionDraftAtom = atom(
  (get) => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return ''
    return get(agentSessionDraftsAtom).get(currentId) ?? ''
  },
  (get, set, newDraft: string) => {
    const currentId = get(currentAgentSessionIdAtom)
    if (!currentId) return
    set(agentSessionDraftsAtom, (prev) => {
      const map = new Map(prev)
      if (newDraft.trim() === '') {
        map.delete(currentId)
      } else {
        map.set(currentId, newDraft)
      }
      return map
    })
  }
)

// ===== 提示建议 Atoms =====

/** Agent 提示建议 Map — 以 sessionId 为 key，存储最近一条建议 */
export const agentPromptSuggestionsAtom = atom<Map<string, string>>(new Map())

/** 当前 Agent 会话的提示建议（派生只读原子） */
export const currentAgentSuggestionAtom = atom<string | null>((get) => {
  const currentId = get(currentAgentSessionIdAtom)
  if (!currentId) return null
  return get(agentPromptSuggestionsAtom).get(currentId) ?? null
})

// ===== 后台任务管理 =====

/**
 * 后台任务数据结构
 *
 * 用于 ActiveTasksBar 显示运行中的 Agent 任务和 Shell 任务。
 */
export interface BackgroundTask {
  /** 任务或 Shell ID */
  id: string
  /** 任务类型 */
  type: 'agent' | 'shell'
  /** 关联的工具调用 ID（用于滚动定位到 ToolActivityItem） */
  toolUseId: string
  /** 任务开始时间戳 */
  startTime: number
  /** 已耗时（秒） */
  elapsedSeconds: number
  /** 任务意图/描述 */
  intent?: string
}

/**
 * 后台任务列表原子家族
 *
 * 按 sessionId 隔离，每个会话独立管理后台任务。
 * 任务完成后从列表中移除（只显示运行中任务）。
 */
export const backgroundTasksAtomFamily = atomFamily((sessionId: string) =>
  atom<BackgroundTask[]>([])
)

// ===== 用户打断状态 =====

/** 被用户手动打断的会话集合（仅当前 streaming 周期有效，reload 后清除） */
export const stoppedByUserSessionsAtom = atom<Set<string>>(new Set<string>())

// ===== 初始化就绪状态 =====

/** AgentSettingsInitializer 是否已完成加载（渠道/工作区/设置全部就绪） */
export const agentSettingsReadyAtom = atom(false)

// ===== 项目文件面板（左侧 Sidebar 底部） =====

/** 每工作区独立的项目文件面板展开状态，持久化到 settings.json */
export const sidebarProjectFilesExpandedMapAtom = atom<Map<string, boolean>>(new Map())

/** 项目文件面板当前数据：最近 N 个文件 + 总数 + capped 标志 */
export interface SidebarRecentFilesState {
  workspaceId: string
  files: RecentFileEntry[]
  totalCount: number
  capped: boolean
}

/**
 * 最近文件状态 atom。
 *
 * 由 `SidebarProjectFilesSection` 组件内的 effect 订阅
 * `currentAgentWorkspaceIdAtom` + `workspaceFilesVersionAtom`，
 * 变化时触发 IPC fetch 并写回（带版本号防竞态）。
 * `null` 表示尚未加载或当前无工作区。
 */
export const recentWorkspaceFilesAtom = atom<SidebarRecentFilesState | null>(null)
