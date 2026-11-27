/**
 * Agent 相关类型定义
 *
 * 包含 Agent SDK 集成所需的事件类型、会话管理、消息持久化和 IPC 通道常量。
 */

// ===== Agent 工作区 =====

/** Agent 工作区 */
export interface AgentWorkspace {
  /** 隔离原生项目的宿主投影；目录只以可用状态公开。 */
  directoryStatus?: 'unbound' | 'bound' | 'unavailable'
  projectOrigin?: 'imported' | 'orphan' | 'native'
  hasDirectoryHint?: boolean
  /** 工作区唯一标识 */
  id: string
  /** 显示名称 */
  name: string
  /** URL-safe 目录名（创建后不可变） */
  slug: string
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

// ===== SDK 新增类型声明（0.2.52 ~ 0.2.63） =====

/**
 * 思考模式配置
 *
 * 控制 Claude 的推理/思考行为：
 * - adaptive: Claude 自行决定何时以及思考多少（Opus 4.6+ 默认）
 * - enabled: 固定思考 Token 预算（旧模型）
 * - disabled: 不使用扩展思考
 */
export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' }

/**
 * 推理深度等级
 *
 * 与 adaptive thinking 配合使用，引导思考深度：
 * - low: 最少思考，最快响应
 * - medium: 适度思考
 * - high: 深度推理（默认）
 * - max: 最大深度（仅 Opus 4.6）
 */
export type AgentEffort = 'low' | 'medium' | 'high' | 'max'

/** 推理深度定义顺序（由浅到深，用于选择器列表与值校验） */
export const AGENT_EFFORT_ORDER: readonly AgentEffort[] = ['low', 'medium', 'high', 'max']

/** 默认推理深度（无会话/工作区/全局覆盖时的兜底，对齐 SDK 默认） */
export const DEFAULT_AGENT_EFFORT: AgentEffort = 'high'

/** 校验任意字符串是否为合法推理深度 */
export function isValidAgentEffort(value: string): value is AgentEffort {
  return (AGENT_EFFORT_ORDER as readonly string[]).includes(value)
}

/**
 * 自定义子代理定义
 *
 * 通过 SDK 的 agents 选项注册可被 Agent 工具调用的自定义子代理。
 */
export interface AgentDefinition {
  /** 自然语言描述，说明何时使用该代理 */
  description: string
  /** 允许使用的工具名称列表，省略则继承父级所有工具 */
  tools?: string[]
  /** 明确禁止使用的工具名称列表 */
  disallowedTools?: string[]
  /** 自定义系统提示词 */
  prompt?: string
  /** 使用的模型（覆盖父级） */
  model?: string
  /** 最大轮次（覆盖父级） */
  maxTurns?: number
}

/**
 * Agent 最大轮次默认硬上限
 *
 * 用户未在设置中显式配置（或留空 / 配为 0）时使用此值作为 SDK 的 maxTurns，
 * 避免 SDK 默认无上限导致的循环调用 / token 损耗（参考 issue #140 #1）。
 * 用户在设置中显式输入正整数仍优先。
 */
export const DEFAULT_AGENT_MAX_TURNS = 30

/**
 * SDK 会话信息（listSessions 返回）
 *
 * SDK 0.2.53 新增，用于发现和列出历史会话。
 */
export interface SDKSessionInfo {
  /** 会话 ID */
  sessionId: string
  /** 项目路径 */
  projectPath?: string
  /** 会话标题（从 transcript 提取） */
  title?: string
  /** 创建时间 ISO 字符串 */
  createdAt?: string
  /** 最后更新时间 ISO 字符串 */
  lastUpdatedAt?: string
  /** 消息计数概要 */
  messageCount?: number
}

/**
 * SDK 会话消息（getSessionMessages 返回）
 *
 * SDK 0.2.59 新增，用于读取会话的完整对话历史。
 */
export interface SDKSessionMessage {
  /** 消息类型（SDK 原始类型标识） */
  type: string
  /** 消息角色 */
  role?: 'user' | 'assistant'
  /** 消息内容 */
  content?: unknown
  /** 时间戳 */
  timestamp?: string
}

/**
 * SDK Beta 特性标识
 *
 * 当前支持：
 * - context-1m-2025-08-07: 启用 1M token 上下文窗口（仅 Sonnet 4/4.5）
 */
export type SdkBeta = 'context-1m-2025-08-07'

/**
 * JSON Schema 输出格式
 *
 * 用于指定结构化输出，Agent 将返回符合 Schema 的 JSON 数据。
 */
export interface JsonSchemaOutputFormat {
  type: 'json_schema'
  /** JSON Schema 定义 */
  schema: Record<string, unknown>
  /** Schema 名称（可选） */
  name?: string
  /** Schema 描述（可选） */
  description?: string
}

// ===== SDK 消息类型（直接透传，不再翻译） =====

/** SDK 文本内容块 */
export interface SDKTextBlock {
  type: 'text'
  text: string
}

/** SDK 工具调用内容块 */
export interface SDKToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

/** SDK 思考内容块 */
export interface SDKThinkingBlock {
  type: 'thinking'
  thinking: string
}

/** SDK 内容块联合类型 */
export type SDKContentBlock =
  | SDKTextBlock
  | SDKToolUseBlock
  | SDKThinkingBlock
  | { type: string; [key: string]: unknown }

/** SDK tool_result 内容块（在 user 消息中） */
export interface SDKToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content?: unknown
  is_error?: boolean
}

/** SDK user 消息内容块联合类型 */
export type SDKUserContentBlock =
  | SDKToolResultBlock
  | SDKTextBlock
  | { type: string; [key: string]: unknown }

/** 原生导入回放的可信附件清单，仅包含目标会话中已校验的文件。 */
export interface ImportedMessageMetadata {
  _electronImported?: boolean
  _importedFiles?: { filename: string; path: string; mediaType: 'image/png' | 'text/plain' | 'text/markdown' }[]
}

/** Rust 的原生图片任务身份，存入工具调用及对应的用户消息。 */
interface NativeImageTaskIdentity {
  _desktopImageTaskRequestId?: string
  _desktopImageTaskKind?: 'generate' | 'edit'
}

/** SDK assistant 消息 */
export interface SDKAssistantMessage extends ImportedMessageMetadata, NativeImageTaskIdentity {
  /** 宿主确认本条已完成文字具有可复查的原始路由和提问。 */
  _desktopCanRevise?: boolean
  _desktopImageTaskError?: string
  _desktopImageTaskStatus?: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted'
  /** 宿主按提交顺序核实原始输入、绑定和源图后才允许重试。 */
  _desktopTaskRetryable?: boolean
  /** 仅原生普通文字任务持久化的请求身份；用于显式重试原始绑定。 */
  _desktopTextTaskRequestId?: string
  /** Rust 宿主持久终态；不是 SDK 会话来源或 token 用量。 */
  _desktopRuntimeStatus?: 'completed' | 'failed' | 'cancelled' | 'interrupted'
  type: 'assistant'
  message: {
    content: SDKContentBlock[]
    usage?: {
      input_tokens: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    model?: string
    stop_reason?: string
  }
  parent_tool_use_id: string | null
  session_id?: string
  /** SDK 消息唯一标识，用于 forkSession / resumeSessionAt */
  uuid?: string
  error?: { message: string; errorType?: string }
  isReplay?: boolean
  /** 渠道配置的模型 ID，持久化/流式期间注入，用于正确匹配模型显示名 */
  _channelModelId?: string
}

/** 用户编辑时选中的确定版本；独立于 prompt 保存，供历史消息显示原图。 */
export interface UserImageEditReference {
  /** 原生导入素材的原始显示名称；读取只用宿主确认的 localPath。 */
  displayName?: string
  imageId: string
  /** 宿主根据确定图片产物验证的来源 SDK UUID；旧消息可缺省。 */
  sourceMessageId?: string
  /** 从旧会话选择图片后，由宿主核实的原始托管附件路径。 */
  sourceAttachmentPath?: string
  /** 经宿主校验的会话相对附件路径 */
  localPath: string
  filename: string
  mediaType: string
}

/** 原生项目资料的闭区间行号，从 1 开始。 */
export interface NativeDocumentReference {
  documentId: string
  /** PDF 页码从 1 开始，引用行号相对于本页；纯文本文档不传。 */
  page?: number
  startLine: number
  endLine: number
}

export interface NativeDocumentSource extends NativeDocumentReference {
  filename: string
}

/** SDK user 消息 */
export interface SDKUserMessage extends ImportedMessageMetadata, NativeImageTaskIdentity {
  _desktopDocumentSource?: NativeDocumentSource
  /** 与原生助手投影共享文字任务身份，替换尚无 SDK uuid 的乐观用户行。 */
  _desktopTextTaskRequestId?: string
  type: 'user'
  message?: {
    content?: SDKUserContentBlock[]
  }
  parent_tool_use_id: string | null
  session_id?: string
  /** SDK 消息唯一标识 */
  uuid?: string
  tool_use_result?: unknown
  isReplay?: boolean
  /** SDK 合成的消息（如 Skill 展开 prompt），非人类用户输入 */
  isSynthetic?: boolean
  /** 可选以兼容旧消息；仅引用本轮选定的原图，不追随 latest。 */
  imageEditReference?: UserImageEditReference
}

/** SDK result 消息（查询结束时返回） */
export interface SDKResultMessage {
  type: 'result'
  subtype: 'success' | 'error' | 'error_max_turns' | 'error_max_budget_usd' | 'error_during_execution' | (string & {})
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  total_cost_usd?: number
  /**
   * 按【模型】聚合的 token 用量明细（SDK ModelUsage 口径）。
   * 这是整个 query 的全量聚合：主 Agent + 经 Task 工具拉起的所有子 Agent 都计入，
   * 故对各项求和即为本轮真实消耗的 token 总数（遥测 totalTokens 取此口径）。
   */
  modelUsage?: Record<
    string,
    {
      inputTokens?: number
      outputTokens?: number
      cacheReadInputTokens?: number
      cacheCreationInputTokens?: number
      contextWindow?: number
    }
  >
  errors?: string[]
  session_id?: string
}

/** SDK system 消息（init / compact_boundary / task_started / task_progress / task_notification） */
export interface SDKSystemMessage {
  type: 'system'
  subtype?: string
  session_id?: string
  /** init: 确认的模型 */
  model?: string
  /** task 相关字段 */
  task_id?: string
  description?: string
  task_type?: string
  tool_use_id?: string
  status?: string
  summary?: string
  output_file?: string
  last_tool_name?: string
  usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number }
  /** init: 每个 MCP server 的连接状态（issue #587 诊断埋点消费） */
  mcp_servers?: Array<{ name?: string; status?: string }>
  /** init: 本 turn 可用工具全集（含 mcp__* 前缀工具） */
  tools?: string[]
  [key: string]: unknown
}

/** SDK tool_progress 消息（工具执行心跳） */
export interface SDKToolProgressMessage {
  type: 'tool_progress'
  tool_use_id: string
  tool_name: string
  parent_tool_use_id: string | null
  elapsed_time_seconds?: number
  /** Agent Teams: 所属 teammate 任务 ID */
  task_id?: string
  session_id?: string
}

/** SDK prompt_suggestion 消息 */
export interface SDKPromptSuggestionMessage {
  type: 'prompt_suggestion'
  suggestion?: string
  session_id?: string
}

/** SDK tool_use_summary 消息 */
export interface SDKToolUseSummaryMessage {
  type: 'tool_use_summary'
  summary?: string
  preceding_tool_use_ids?: string[]
  session_id?: string
}

/** SDK 消息联合类型（v1 query + includePartialMessages: false 返回的完整 JSON 对象） */
export type SDKMessage =
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKResultMessage
  | SDKSystemMessage
  | SDKToolProgressMessage
  | SDKPromptSuggestionMessage
  | SDKToolUseSummaryMessage
  | { type: string; session_id?: string; parent_tool_use_id?: string | null; [key: string]: unknown }

// ===== Agent 事件类型 =====

/** 错误代码 */
export type ErrorCode =
  | 'invalid_api_key'
  | 'invalid_credentials'
  | 'response_too_large'
  | 'expired_oauth_token'
  | 'token_expired'
  | 'rate_limited'
  | 'service_error'
  | 'service_unavailable'
  | 'network_error'
  | 'mcp_auth_required'
  | 'mcp_unreachable'
  | 'billing_error'
  | 'model_no_tool_support'
  | 'invalid_model'
  | 'data_policy_error'
  | 'invalid_request'
  | 'image_too_large'
  | 'prompt_too_long'
  | 'provider_error'
  | 'unknown_error'

/** 恢复操作 */
export interface RecoveryAction {
  /** 操作键（用于快捷键） */
  key: string
  /** 操作标签 */
  label: string
  /** 操作类型 */
  action: 'settings' | 'retry' | 'cancel' | 'compact' | string
}

/** 类型化错误 */
export interface TypedError {
  /** 错误代码，用于程序化处理 */
  code: ErrorCode
  /** 用户友好的标题 */
  title: string
  /** 详细的错误消息 */
  message: string
  /** 建议的恢复操作 */
  actions: RecoveryAction[]
  /** 是否可以自动重试 */
  canRetry: boolean
  /** 重试延迟（毫秒） */
  retryDelayMs?: number
  /** 诊断详情（用于调试） */
  details?: string[]
  /** 原始错误消息（用于调试） */
  originalError?: string
}

/** Agent 事件 Usage 信息 */
export interface AgentEventUsage {
  inputTokens: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  costUsd?: number
  contextWindow?: number
}

/** Teammate 任务用量统计 */
export interface TaskUsage {
  /** 总 Token 数 */
  totalTokens: number
  /** 工具调用次数 */
  toolUses: number
  /** 运行耗时（毫秒） */
  durationMs: number
}

/**
 * 重试尝试记录
 *
 * 记录每次重试尝试的详细信息，用于错误诊断和 UI 展示。
 */
export interface RetryAttempt {
  /** 第几次尝试 (1-based) */
  attempt: number
  /** 时间戳 */
  timestamp: number
  /** 错误原因（简短描述，如"SDK 响应超时"） */
  reason: string
  /** 完整错误消息 */
  errorMessage: string
  /** stderr 输出（可选） */
  stderr?: string
  /** 堆栈跟踪（可选） */
  stack?: string
  /** 运行环境信息（可选） */
  environment?: {
    /** 运行时，如 "Bun 1.0.0" */
    runtime: string
    /** 平台，如 "darwin arm64" */
    platform: string
    /** 模型，如 "claude-sonnet-4-5-20250929" */
    model: string
    /** 工作区名称 */
    workspace?: string
    /** 工作目录 */
    cwd?: string
  }
  /** 延迟秒数 */
  delaySeconds: number
}

/**
 * Agent 事件类型
 *
/** MCP 工具结果中的图片附件 */
export interface AgentToolResultImage {
  localPath: string
  filename: string
  mediaType: string
}

/**
 * Agent 事件流类型
 *
 * 从 SDK 消息转换而来的扁平事件流，用于驱动 UI 渲染。
 */
export type AgentEvent =
  // 文本流式输出
  | { type: 'text_delta'; text: string; turnId?: string; parentToolUseId?: string }
  | { type: 'text_complete'; text: string; isIntermediate: boolean; turnId?: string; parentToolUseId?: string }
  // 工具执行
  | { type: 'tool_start'; toolName: string; toolUseId: string; input: Record<string, unknown>; intent?: string; displayName?: string; turnId?: string; parentToolUseId?: string }
  | { type: 'tool_result'; toolUseId: string; toolName?: string; result: string; isError: boolean; input?: Record<string, unknown>; turnId?: string; parentToolUseId?: string; imageAttachments?: AgentToolResultImage[] }
  // 后台任务
  | { type: 'task_backgrounded'; toolUseId: string; taskId: string; intent?: string; turnId?: string }
  | { type: 'task_started'; taskId: string; toolUseId?: string; description: string; taskType?: string; turnId?: string }
  | { type: 'task_progress'; toolUseId: string; elapsedSeconds?: number; turnId?: string; taskId?: string; description?: string; lastToolName?: string; usage?: TaskUsage }
  | { type: 'task_notification'; taskId: string; toolUseId?: string; status: 'completed' | 'failed' | 'stopped'; summary: string; outputFile?: string; usage?: TaskUsage; turnId?: string }
  | { type: 'shell_backgrounded'; toolUseId: string; shellId: string; intent?: string; command?: string; turnId?: string }
  | { type: 'shell_killed'; shellId: string; turnId?: string }
  // 工具使用摘要
  | { type: 'tool_use_summary'; summary: string; precedingToolUseIds: string[] }
  // 控制流
  | { type: 'complete'; stopReason?: string; usage?: AgentEventUsage }
  | { type: 'error'; message: string }
  | { type: 'typed_error'; error: TypedError }
  // 重试机制
  | { type: 'retrying'; attempt: number; maxAttempts: number; delaySeconds: number; reason: string }  // 保留向后兼容
  | { type: 'retry_attempt'; attemptData: RetryAttempt }  // 新增：记录详细尝试信息
  | { type: 'retry_cleared' }  // 新增：重试成功，清除状态
  | { type: 'retry_failed'; finalAttempt: RetryAttempt }  // 新增：重试失败
  // Usage 更新
  | { type: 'usage_update'; usage: AgentEventUsage }
  // 上下文压缩
  | { type: 'compacting' }
  | { type: 'compact_complete' }
  // 权限请求
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_resolved'; requestId: string; behavior: 'allow' | 'deny' }
  // AskUserQuestion 交互式问答
  | { type: 'ask_user_request'; request: AskUserRequest }
  | { type: 'ask_user_resolved'; requestId: string }
  // ExitPlanMode 计划审批
  | { type: 'exit_plan_mode_request'; request: ExitPlanModeRequest }
  | { type: 'exit_plan_mode_resolved'; requestId: string }
  // lit-review present_directions（spec §5.4 Turn 1）
  | { type: 'litreview_present_directions_request'; request: import('./litreview-ipc.ts').LitReviewPresentDirectionsRequest }
  | { type: 'litreview_present_directions_resolved'; requestId: string }
  // lit-search present_search_plan 检索方案确认（issue #435）
  | { type: 'search_plan_request'; request: import('./search-plan-ipc.ts').SearchPlanConfirmRequest }
  | { type: 'search_plan_resolved'; requestId: string }
  // research-gap 研究空白对照表产出（0.4 Epic 1，fire-and-forget 推到右侧 Tab）
  | { type: 'research_gap_table'; table: import('./research-gap.ts').ResearchGapTable }
  // EnterPlanMode 进入计划模式
  | { type: 'enter_plan_mode'; sessionId: string }
  // 提示建议
  | { type: 'prompt_suggestion'; suggestion: string }
  // 模型确认（SDK 确认实际使用的模型）
  | { type: 'model_resolved'; model: string }
  // 子 Agent model 别名家族未激活 → 已回退到 lead 模型（noClaudeActivated 时表 channel 零激活 Claude 模型）
  | { type: 'model_fallback_notice'; agentName: string; requestedFamily: string; fallbackModelId: string; agentCount?: number; noClaudeActivated?: boolean }
  // Auto-Resume（Teams 完成后自动收集结果）
  | { type: 'waiting_resume'; message: string }
  | { type: 'resume_start'; messageId: string }
  // 权限模式变更（Plan → bypassPermissions 等）
  | { type: 'permission_mode_changed'; mode: ASCIPermissionMode }
  // 已解析的本轮输出语言（UI 锁/漂移检测用；orchestrator 在 user-turn 入口处发出）
  | { type: 'resolved_language'; language: 'en' | 'zh' }

// ===== ASCI 内部事件（SDK 不覆盖的场景） =====

export interface ToolRunSnapshotEvent {
  type: 'tool_run_snapshot'
  sdkMessages: SDKMessage[]
  activeText: string
  pendingPermissions: PermissionRequest[]
}

/** 原生链快照只增加认证元数据，原 Electron 输入及事件保持兼容。 */
export interface NativeChainSnapshotEvent {
  type: 'native_chain_snapshot'
  chainId: string
  revision: number
  badgeClearBoundary: number
  badgeClearRevision?: number
  activeRequestId: string | null
  closureReason: string | null
  executions: {requestId: string; runId: string; snapshot: ToolRunSnapshotEvent}[]
  pendingMessages: SDKMessage[]
  receipts: {uuid:string; userMessageId:string; userMessage?:string|null; interrupt?:boolean; requestId:string|null; disposition:string; receipt:{uuid:string;chainId:string;sessionId:string;revision?:number}}[]
}

/** ASCI 内部事件类型 */
export type ASCIEvent =
  | NativeChainSnapshotEvent
  | ToolRunSnapshotEvent
  | { type: 'text_snapshot'; text: string; model: string }
  | { type: 'text_delta'; text: string; turnId?: string }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'permission_resolved'; requestId: string; behavior: 'allow' | 'deny' }
  | { type: 'ask_user_request'; request: AskUserRequest }
  | { type: 'ask_user_resolved'; requestId: string }
  | { type: 'exit_plan_mode_request'; request: ExitPlanModeRequest }
  | { type: 'exit_plan_mode_resolved'; requestId: string }
  | { type: 'litreview_present_directions_request'; request: import('./litreview-ipc.ts').LitReviewPresentDirectionsRequest }
  | { type: 'litreview_present_directions_resolved'; requestId: string }
  | { type: 'search_plan_request'; request: import('./search-plan-ipc.ts').SearchPlanConfirmRequest }
  | { type: 'search_plan_resolved'; requestId: string }
  | { type: 'research_gap_table'; table: import('./research-gap.ts').ResearchGapTable }
  | { type: 'enter_plan_mode'; sessionId: string }
  | { type: 'retry'; status: 'starting' | 'attempt' | 'cleared' | 'failed'; attempt?: number; maxAttempts?: number; delaySeconds?: number; reason?: string; attemptData?: RetryAttempt; error?: TypedError }
  | { type: 'model_resolved'; model: string }
  | { type: 'model_fallback_notice'; agentName: string; requestedFamily: string; fallbackModelId: string; agentCount?: number; noClaudeActivated?: boolean }
  | { type: 'waiting_resume'; message: string }
  | { type: 'resume_start'; messageId: string }
  | { type: 'permission_mode_changed'; mode: ASCIPermissionMode }
  | { type: 'resolved_language'; language: 'en' | 'zh' }


/**
 * Speaker 标识（A4 phase4）—— 区分主 Agent 与场景 Agent 派发流。
 * scenario 对象的 name 来自 SDK tool_use.input.subagent_type；packId 来自 SubagentRegistry。
 */
export type AgentSpeaker =
  | 'master'
  | { kind: 'scenario'; name: string; packId?: string }

export interface AgentStreamMetadata {
  /** 该条 payload 来自哪个 speaker；缺省表示历史消息或转换前的 raw payload */
  speaker?: AgentSpeaker
}

/** IPC 传输的统一 payload（替代 AgentEvent） */
export type AgentStreamPayload =
  | { kind: 'sdk_message'; message: SDKMessage; asci_metadata?: AgentStreamMetadata }
  | { kind: 'asci_event'; event: ASCIEvent; asci_metadata?: AgentStreamMetadata }

// ===== Agent 会话管理 =====

/**
 * 子 Agent 一次派发的生命周期 span（A0a）。
 *
 * 由 SubagentStart / SubagentStop hook 写入；finishedAt / success / durationMs
 * 在 SubagentStop hook 触发时回填。failed / timed-out 时 success = false。
 *
 * 0.2 阶段仅本地落 session meta，不上报远端；0.3 §三-A 自进化埋点接入
 * telemetry consumer 时直接读这里。
 */
export interface SubagentSpan {
  /** 子 Agent 名（即 SDK subagent_type） */
  scenarioAgentName: string
  /** SubagentStart 时间戳（毫秒） */
  startedAt: number
  /** SubagentStop 时间戳；未结束 / 未配对时缺省 */
  finishedAt?: number
  /** 是否成功结束（出错 / abort / timeout 时 false） */
  success?: boolean
  /** 派发耗时；缺 finishedAt 时缺省 */
  durationMs?: number
  /** 来源能力包 ID（来自 SubagentRegistry entry.packId） */
  packId?: string
}

/**
 * Agent 会话轻量索引项
 *
 * 存储在 ~/.asci/agent-sessions.json 中，
 * 类似 ConversationMeta，独立存储。
 */
export interface AgentSessionMeta {
  /** 原生分支第一次文字提交前的源渠道绑定。随历史备份导出时不复制。 */
  nativeRevisionRoute?: { channelId: string; modelId: string; configRevision: string }
  /** 会话唯一标识 */
  id: string
  /** 会话标题 */
  title: string
  /** 使用的渠道 ID */
  channelId?: string
  /** SDK 内部会话 ID（用于 resume 衔接上下文） */
  sdkSessionId?: string
  /** 所属工作区 ID */
  workspaceId?: string
  /** 是否置顶 */
  pinned?: boolean
  /** 是否已归档 */
  archived?: boolean
  /** 分叉来源：源会话的 ASCI 工作目录（SDK session 文件在此目录的项目空间中，首次 resume 后清除） */
  forkSourceDir?: string
  /** 分叉来源：源会话的 SDK session ID（用于 rewind 时读取源会话的 file-history-snapshot 和备份文件） */
  forkSourceSdkSessionId?: string
  /** 回退后的 resume 截断点：下次发消息时传给 SDK resumeSessionAt（消费后清除） */
  resumeAtMessageUuid?: string
  /** 最后一次流式执行是否被用户主动中断 */
  stoppedByUser?: boolean
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
  /** 子 Agent 派发 span 数组（A0a） — 0.2 dogfood 阶段本地统计，0.3 telemetry consumer 读入 */
  subagentSpans?: SubagentSpan[]
  /** 当前会话粘滞的 capability pack id（A4 phase4）— Master 在新一轮派发时优先派给该 pack 的 scenario agent */
  stickyCapabilityPackId?: string
  /** 本会话最近成功执行的上下文策略，旧会话缺省保持原流程。 */
  runtimeProfile?: 'conversation' | 'general' | 'coding' | 'research'
}

/**
 * Agent 持久化消息
 *
 * 存储在 ~/.asci/agent-sessions/{id}.jsonl 中。
 */
export interface AgentMessage {
  /** 消息唯一标识 */
  id: string
  /** 角色 */
  role: 'user' | 'assistant' | 'tool' | 'status'
  /** 消息内容 */
  content: string
  /** 创建时间戳 */
  createdAt: number
  /** 使用的模型 ID（assistant 消息） */
  model?: string
  /** 工具活动数据（agent 事件列表，用于回放工具调用） */
  events?: AgentEvent[]
  /** 错误代码（status 消息，role='status' 时使用） */
  errorCode?: ErrorCode
  /** 错误标题（status 消息） */
  errorTitle?: string
  /** 错误详细信息（status 消息） */
  errorDetails?: string[]
  /** 原始错误消息（status 消息） */
  errorOriginal?: string
  /** 是否可以重试（status 消息） */
  errorCanRetry?: boolean
  /** 错误恢复操作（status 消息） */
  errorActions?: RecoveryAction[]
  /** 耗时（毫秒），assistant 消息从流式开始到完成的时间 */
  durationMs?: number
  /** Token 用量明细（assistant 消息完成时记录） */
  usage?: AgentEventUsage
}

// ===== Agent 消息搜索 =====

/**
 * Agent 会话消息搜索结果
 */
export interface AgentMessageSearchResult {
  /** 会话 ID */
  sessionId: string
  /** 会话标题 */
  sessionTitle: string
  /** 消息 ID */
  messageId: string
  /** 消息角色 */
  role: 'user' | 'assistant' | 'tool' | 'status'
  /** 匹配上下文片段（约 80 字符） */
  snippet: string
  /** snippet 内匹配起始位置 */
  matchStart: number
  /** 匹配长度 */
  matchLength: number
  /** 是否已归档 */
  archived?: boolean
}

// ===== MCP 服务器配置 =====

/** MCP 传输类型 */
export type McpTransportType = 'stdio' | 'http' | 'sse'

/** MCP 服务器条目 */
export interface McpServerEntry {
  type: McpTransportType
  /** stdio: 可执行命令 */
  command?: string
  /** stdio: 命令参数 */
  args?: string[]
  /** stdio: 环境变量 */
  env?: Record<string, string>
  /** http/sse: 服务端 URL */
  url?: string
  /** http/sse: 请求头 */
  headers?: Record<string, string>
  /** 启动超时（秒），仅 stdio 类型有效，默认 30 */
  timeout?: number
  /** 是否启用 */
  enabled: boolean
  /** 最后一次测试结果 */
  lastTestResult?: {
    success: boolean
    message: string
    timestamp: number
  }
}

/** 全局 MCP 配置文件（持久化在 ~/.asci/mcp.json，对所有工作区可见） */
export interface GlobalMcpConfig {
  servers: Record<string, McpServerEntry>
}

/**
 * 内建 MCP 保留名 —— renderer 表单校验用，与 main/lib/mcp/builtin-mcp-resolver.ts
 * 中的 BUILTIN_MCP_NAMES 同源（main 侧将 import 此常量构造 Set）。
 */
export const BUILTIN_MCP_RESERVED_NAMES = ['zotero', 'ocr', 'asr', 'paper-search'] as const

/** 单个内建 MCP 保留名的字面量类型 */
export type BuiltinMcpReservedName = typeof BUILTIN_MCP_RESERVED_NAMES[number]

// ===== Skill 元数据 =====

/** 从其他工作区导入的 Skill 来源元数据 */
export interface SkillImportSource {
  sourceWorkspaceSlug: string
  sourceWorkspaceName: string
  importedAt: string        // ISO 8601
  sourceVersion: string     // 导入时源 Skill 的 version，无则 '0.0.0'
}

/**
 * Skill 显示名的双语映射
 * 仅供 UI 展示使用；Agent 侧始终读取 `name`/`description`，保持英文不译
 */
export interface SkillMetaNameI18n {
  zh?: string
  en?: string
}

/** 工作区 Skill 元数据 */
export interface SkillMeta {
  slug: string
  /** 英文规范名，注入 Agent 系统提示用，必须保持英文 */
  name: string
  /** 英文描述，Agent 用作选择依据，保持英文唯一不译 */
  description?: string
  icon?: string
  version?: string
  /** Skill 分类。来自 SKILL.md frontmatter 的 `category` 字段，为空时解析层会回填为 'custom' */
  category?: string
  enabled: boolean
  /** 如果此 Skill 是从其他工作区导入的，则携带来源信息 */
  importSource?: SkillImportSource
  /** 是否有可用更新（源 Skill 版本 > importSource.sourceVersion） */
  hasUpdate?: boolean
  /**
   * 可选的 UI 显示名双语映射（来自 SKILL.md frontmatter 的 `nameI18n` 字段）
   * UI 渲染时按 `nameI18n[lang] ?? name` 解析；不影响 Agent 注入
   */
  nameI18n?: SkillMetaNameI18n
}

/** 批量开关 · 入参（与既有 *Input 命名风格一致） */
export interface BatchToggleSkillsByCategoryInput {
  workspaceSlug: string
  category: string                // 直接用 frontmatter 里的 category 原值
  enable: boolean                 // true=启用(移入 skills/)，false=禁用(移入 skills-inactive/)
  onlySlugs?: string[]            // 可选：只作用于这些 slug（撤销时仅回滚成功项）
}

/** 批量开关 · 单项失败 */
export interface BatchToggleFailure {
  slug: string
  reason: string                  // 错误码或短描述，如 'ENOENT' / 'EACCES' / 'already in target state'
}

/** 批量开关 · 结果 */
export interface BatchToggleSkillsByCategoryResult {
  moved: string[]                 // 成功切换的 skill slug
  skipped: string[]               // 已处于目标态、无需动
  failed: BatchToggleFailure[]
}

/** 其他工作区 Skill 分组（导入对话框用） */
export interface OtherWorkspaceSkillsGroup {
  workspaceName: string
  workspaceSlug: string
  skills: SkillMeta[]
}

/** 工作区能力摘要（MCP + Skill 计数） */
export interface WorkspaceCapabilities {
  mcpServers: Array<{
    name: string
    enabled: boolean
    type: McpTransportType
    /** 内建 MCP（zotero/ocr/asr/paper-search）由运行时拼接，UI 区分展示用；持久化层不存此字段 */
    isBuiltin?: boolean
  }>
  skills: SkillMeta[]
}

// ===== 论文检索记录 =====

/**
 * 论文检索记录
 *
 * 由 paper-result-recorder 从 tool_result 内容中识别并持久化到
 * ~/.asci/agent-sessions-papers/{sessionId}.jsonl（每行一条）。
 */
export interface PaperRecord {
  /** ISO 8601 写入时间 */
  ts: string
  /** 触发此结果的检索 query（从 tool_use.input 抽取，可能为空） */
  query: string | null
  /** 来源工具标签，如 'tool:WebFetch' / 'tool:Skill:paper-lookup' / 'tool:mcp__...' */
  source: string
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  doi: string | null
  url: string | null
  abstract: string | null
  /** 源特有字段：paperId / arxivId / openalexId / pmid / citedBy / takeaway / raw */
  extra?: Record<string, unknown>
  /** 本轮检索簇 ID（paper-search MCP 落盘时注入；多轮检索共享同一簇） */
  turn_id?: string
}

/**
 * session 论文集变更事件（主进程 watcher → 渲染进程推送）
 * - live：检索流式进度文件更新（fan-out 进行中，未去重）
 * - canonical：正式 JSONL 落盘（retrieve 去重后写入 / apply_rerank 打分回写 / recorder 补漏）
 */
export interface SessionPapersChangedEvent {
  sessionId: string
  kind: 'live' | 'canonical'
}

/** 单源检索进度（live 进度文件内的每源状态） */
export interface SessionPapersLiveSource {
  /** pending=未返回 / ok=有结果 / empty=真空 / failed=超时或出错（重试成功可升回 ok） */
  verdict: 'pending' | 'ok' | 'empty' | 'failed'
  /** 该源累计原始命中数（去重前） */
  count: number
}

/**
 * session 检索流式进度快照（paper-search MCP retrieve 期间原子写的 live 文件）。
 * records 为去重打分前的 PaperRecord 轻量快照（与正式 JSONL 同 recordKey 语义，
 * canonical 落地后前端靠同 key 收敛）；retrieve 结束文件即被删除。
 *
 * #775：retrieve（searching/processing）结束后，scorer 与报告阶段沿用同一 live 文件
 * 续写进度，消除 searcher 完成后 ~116s 的静态死等：
 * - phase=scoring：scorer 分片打分中，scored/scoreTotal 给「已评分 X/Y」进度。
 * - phase=reporting：报告 judgments 黑盒生成中，用 prepare 已算的确定性数据
 *   （reportCandidateCount/reportTier/reportSectionCount）做「将得到什么」预告，
 *   不做假进度条；报告 HTML 写出后文件被删。
 */
export interface SessionPapersLive {
  schemaVersion: number
  sessionId: string
  /** 本轮检索簇 ID；与 canonical record 的 turn_id 对照判断"本轮是否已落正式数据" */
  turnId: string
  /**
   * searching=fan-out 中 / processing=去重与补摘要中 /
   * scoring=scorer 分片打分中（#775）/ reporting=报告生成中（#775）。
   * scoring/reporting 阶段 canonical 已落地，前端按 phase 直接显示进度（不再靠 turnId 对照）。
   */
  phase: 'searching' | 'processing' | 'scoring' | 'reporting'
  /** 最后更新时刻（Unix 秒）；主进程读取时做 TTL 兜底过滤残留 */
  updatedAt: number
  sources: Record<string, SessionPapersLiveSource>
  records: PaperRecord[]
  /** 累计原始命中（含未进 records 截断上限的部分） */
  rawTotal: number
  /** phase=processing：已处理（跑完 enrich）篇数（X）。仅 enrich 真发生时存在。 */
  processed?: number
  /** phase=processing：需补全摘要总数（Y）。只代表补摘要工作量，去重瞬时不计。 */
  processTotal?: number
  /** phase=scoring：已评分篇数（X）。scorer 分片在写锁内累计。 */
  scored?: number
  /** phase=scoring：评分窗口总数（Y）= 本轮 scoring window 大小，非召回总数。 */
  scoreTotal?: number
  /** phase=reporting：报告覆盖的候选论文数（来自 prepare 确定性统计）。 */
  reportCandidateCount?: number
  /** phase=reporting：报告档位（FULL=完整六节 / MINIMAL=精简三节）。 */
  reportTier?: 'FULL' | 'MINIMAL'
  /** phase=reporting：报告章节数（FULL=6 / MINIMAL=3），由 tier 定。 */
  reportSectionCount?: number
}

// ===== 工作区论文库（沉淀池）=====

/**
 * 工作区级论文条目
 *
 * 由 paper-result-recorder 在 session jsonl 落地后回流到
 * ~/.asci/agent-workspaces/{slug}/papers.jsonl（每行一条），按 key 去重。
 *
 * 与 PaperRecord 的关系：
 *   - PaperRecord 是 session 级原始检索快照（每次 tool_result 写一条）
 *   - WorkspacePaperEntry 是工作区级带状态的实体（多次 PaperRecord 合并升级）
 */
export interface WorkspacePaperEntry {
  // —— 论文身份（来自 PaperRecord，去重时取字段最丰富的一份）——
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  doi: string | null
  url: string | null
  abstract: string | null
  extra?: Record<string, unknown>

  // —— 用户标注层 ——
  status: 'unread' | 'read' | 'saved' | 'archived'
  starred: boolean
  tags: string[]
  /** 短笔记，最多 500 字（UI 不严格限制，仅默认提示） */
  note: string | null
  /** 长笔记 markdown 文件相对路径（位于 workspace-files/paper-notes/）；null 表示未展开成长笔记 */
  noteRelPath: string | null
  /** 已下载 PDF 在 workspace-files/papers/ 下的相对路径；null 表示未下载 */
  pdfRelPath: string | null
  /** Zotero item key；null 表示未加入 Zotero */
  linkedZoteroKey: string | null

  // —— 系统维护字段 ——
  /** 稳定去重 key（DOI 优先，否则用 PaperRecord recordKey 同款逻辑） */
  key: string
  /** 第一次被检到的 ISO 时间 */
  firstSeenAt: string
  /** 最近一次被检到的 ISO 时间 */
  lastSeenAt: string
  /** 在哪些 session 里被检到过（去重） */
  sessionRefs: string[]
  /** 累计被检次数（每次新 session 命中 +1） */
  seenCount: number
}

/** 工作区论文筛选条件 */
export interface WorkspacePapersFilter {
  status?: Array<'unread' | 'read' | 'saved' | 'archived'>
  tags?: string[]
  starred?: boolean
  /** 关键词（匹配 title / authors / abstract，简单 includes） */
  keyword?: string
  limit?: number
  offset?: number
}

/** 用户对论文条目的可修改字段 patch（仅这些字段可改） */
export interface WorkspacePaperPatch {
  status?: 'unread' | 'read' | 'saved' | 'archived'
  starred?: boolean
  tags?: string[]
  note?: string | null
  noteRelPath?: string | null
  pdfRelPath?: string | null
  linkedZoteroKey?: string | null
}

/** 论文变更事件（IPC 推送给 renderer） */
export interface WorkspacePapersChangedEvent {
  workspaceId: string
  /** 被改动的 key 列表（用于精确重渲染；空数组表示需要全量重载） */
  changedKeys: string[]
  /**
   * 原因：
   * - append = 新检索回流写入
   * - update = 用户手动修改单条
   * - batchUpdate = 批量更新
   * - external = 外部改文件，renderer 需全量重载
   * - reflow_failed = 工作区回流写入失败（renderer 应 toast 告知用户数据未入库）
   */
  reason: 'append' | 'update' | 'batchUpdate' | 'external' | 'reflow_failed'
}

/** workspace_papers IPC 通道常量 */
export const WORKSPACE_PAPERS_IPC_CHANNELS = {
  LIST: 'workspace-papers:list',
  GET: 'workspace-papers:get',
  UPDATE: 'workspace-papers:update',
  BATCH_UPDATE: 'workspace-papers:batch-update',
  LINK_ZOTERO: 'workspace-papers:link-zotero',
  DOWNLOAD_PDF: 'workspace-papers:download-pdf',
  CREATE_NOTE: 'workspace-papers:create-note',
  CHANGED_EVENT: 'workspace-papers:changed',
  /** 用户主动把 session PaperRecord 合并入 workspace-papers（加 Zotero / 收藏前的前置） */
  INGEST_RECORDS: 'workspace-papers:ingest-records',
} as const

export type WorkspacePapersIpcChannel = typeof WORKSPACE_PAPERS_IPC_CHANNELS[keyof typeof WORKSPACE_PAPERS_IPC_CHANNELS]

/**
 * linkZotero 调用 Zotero connector saveAttachmentFromResolver 的结果
 *
 * - attached: 通过 OA resolver 拉到 PDF 并落盘
 * - no_pdf:   resolver 返回 false / 失败 / 无 OA — 条目本身写入成功
 * - skipped:  无 DOI 等前置条件不满足，未尝试 resolver
 */
export type LinkZoteroPdfStatus = 'attached' | 'no_pdf' | 'skipped'

/**
 * linkZotero 把 item 移到目标 collection（connector updateSession）的结果
 *
 * Zotero 本地 Web API 只读（PATCH 返 501），故移动改走 connector /updateSession，
 * 用 treeViewID 指定目标（见 LinkZoteroOpts.targetTreeViewID）。
 *
 * - ok:      updateSession 成功，item 落到用户选的目标 collection / library 根
 * - failed:  updateSession 失败，item 仍留在 Zotero UI 当前选中处（不回滚，UI 应告警）
 * - skipped: 用户选 zoteroCurrent（targetTreeViewID=null），按设计未尝试移动
 */
export type LinkZoteroCollectionStatus = 'ok' | 'failed' | 'skipped'

/** linkZotero IPC 入参（renderer → main） */
export interface LinkZoteroOpts {
  /** 可选标签数组 */
  tags?: string[]
  /**
   * 目标 treeViewID（connector /updateSession 的 target 字段）：
   *   - null / 未传 : 落到 Zotero UI 当前选中（不调 updateSession）
   *   - 'L1'        : 「我的文献库」根（library 根）
   *   - 'C<整数>'   : 指定 collection（Zotero 本地 collectionID，非 8 字符 Web API key）
   * treeViewID 由 listCollectionTargets / getSelectedCollection 提供。
   */
  targetTreeViewID?: string | null
}

/** linkZotero IPC 返回值 */
export interface LinkZoteroResult {
  entry: WorkspacePaperEntry
  pdfStatus: LinkZoteroPdfStatus
  /** 目标 collection 移动结果；failed 时 UI 应改报告警而非纯成功 */
  collectionStatus: LinkZoteroCollectionStatus
}

/**
 * 主 → 渲染 推送：Agent 通过 asci-zotero 工具请求打开"批量加入 Zotero"对话框时的负载。
 * - sessionId: 触发工具调用的 Agent session；渲染侧若 currentSessionId !== sessionId 必须忽略。
 * - recordKeys: 经 main 端 listSessionPapers 解析后的 canonical recordKey 列表
 *               （形如 `doi:10.xxx` / `arx:1234.5678` / `pid:...`）。
 *               渲染侧在 rowMeta 里按 recordKey / entry.key 命中即勾选，绕开 selectionKey 内部规则。
 */
export interface ZoteroOpenBatchImportPayload {
  sessionId: string
  recordKeys: string[]
}

// ===== Inline Preview 系统 =====

/** 预览读取文本的响应 */
export interface PreviewReadTextResult {
  content: string
  /** 若因超过上限被截断，返回 true */
  truncated: boolean
  /**
   * 若文件不存在（ENOENT）返回 true。
   * 例如 Agent 写了临时脚本（minimal.js）跑完即删，但产物卡片仍指向它（#704 同源场景）。
   * 此时不抛错，由渲染端展示"文件已不存在"的降级提示，而非把原始 ENOENT 堆栈上屏。
   */
  notFound?: boolean
}

/** 预览解析 Notebook cell */
export interface NotebookCell {
  type: 'code' | 'markdown' | 'raw'
  source: string
  /** code cell 的输出（stdout / display_data / error），已拼成字符串 */
  outputs?: string
}

/** Preview 解析 Notebook 的响应 */
export interface PreviewParseNotebookResult {
  cells: NotebookCell[]
  kernelName?: string
  language?: string
}

/** Preview 下载 PDF 参数 */
export interface PreviewDownloadPdfInput {
  sessionId: string
  /** 原始 url（若已是 .pdf 直接下载） */
  url?: string | null
  /** DOI（用于 arXiv 映射 / 后续扩展） */
  doi?: string | null
  /** arXiv id（优先级高于 DOI 映射） */
  arxivId?: string | null
}

export interface PreviewDownloadPdfResult {
  /** 下载后的本地绝对路径 */
  localPath: string
  /** 文件字节数 */
  size: number
}

/** 下载论文 PDF 到系统下载文件夹的结果（input 复用 PreviewDownloadPdfInput） */
export interface DownloadPdfLocalResult {
  /** 保存到下载文件夹后的绝对路径 */
  savedPath: string
  /** 最终文件名（可能因重名追加后缀） */
  filename: string
}

// ===== Agent 发送输入 =====

/**
 * Agent 对话框 @ 提及的对象种类（单一事实源，跨 atoms / 输入组件 / suggestion 工厂共用）。
 * 新增一类可提及对象时只改这里：file / dir（项目目录）/ Zotero 条目 / Zotero 类目 / 证据集。
 */
export type MentionKind = 'file' | 'dir' | 'zotero-item' | 'zotero-col' | 'evidence-set'

/**
 * Agent 发送消息的输入参数
 */
export interface AgentSendInput {
  /** 原生重新生成必须使用源文字任务的原始渠道版本。 */
  expectedConfigRevision?: string
  /** 仅本次普通文字任务引用的选区，正文由原生宿主读取。 */
  nativeDocumentReference?: NativeDocumentReference
  /** 可选稳定请求身份；Rust 预览用于幂等绑定。 */
  requestId?: string
  /** 用户在结果卡选中的确定图片 ID；宿主按会话检查，不允许 latest。 */
  imageEditReferenceId?: string
  /** 输入框选择的任务意图；缺省保留原有调用行为。 */
  taskMode?: 'coding' | 'search'
  /** Manual compaction: last measured context usage, never an estimate. */
  contextBeforeTokens?: number
  /** 会话 ID */
  sessionId: string
  /** 用户消息内容 */
  userMessage: string
  /** 渠道 ID（用于获取 API Key） */
  channelId: string
  /** 模型 ID */
  modelId?: string
  /** 工作区 ID（用于确定 cwd） */
  workspaceId?: string
  /** 附加的外部目录（绝对路径，传递给 SDK additionalDirectories） */
  additionalDirectories?: string[]
  /** 动态注入的 MCP 服务器（仅在本次会话中生效，如飞书群聊工具） */
  customMcpServers?: Record<string, Record<string, unknown>>
  /** 强制覆盖权限模式（飞书等无 UI 交互场景下强制 'bypassPermissions'） */
  permissionModeOverride?: ASCIPermissionMode
  /** 本次会话的推理深度，随请求透传到 Agent SDK（每会话独立，缺省时 orchestrator 兜底） */
  effort?: AgentEffort
  /** 用户通过 /skill:xxx 引用的 Skill slug 列表 */
  mentionedSkills?: string[]
  /** 用户通过 #mcp:xxx 引用的 MCP 服务器名称列表 */
  mentionedMcpServers?: string[]
  /** 用户通过 @zotero-item:xxx 引用的 Zotero 条目（key + 显示元数据） */
  mentionedZoteroItems?: Array<{
    key: string
    title: string
    creators: string[]
    date?: string
  }>
  /** 用户通过 @zotero-col:xxx 引用的 Zotero 类目（key + 名字 + 路径） */
  mentionedZoteroCollections?: Array<{
    key: string
    name: string
    /** 形如 "Papers / Transformers / 2024" 的路径 */
    path: string
  }>
  /**
   * 用户 @ Zotero 条目后由 renderer 采集的 PDF 绝对路径（位于 Zotero storage 下）。
   * 主进程会：
   *   1) 把这些路径拼进 <zotero_attachments> XML 标签注入 userMessage
   *   2) 把 Zotero storage 根目录加入 SDK additionalDirectories 让 Agent Read 工具可访问
   * 不复制到 session 目录，零落盘。
   */
  zoteroAttachments?: Array<{
    itemKey: string
    filename: string
    /** Zotero storage 下的 PDF 绝对路径 */
    path: string
  }>
  /**
   * 用户通过 @evidence-set:xxx 引用的证据集（id + 显示名）。
   * 仅带轻量标识——主进程按 id 用 queryEvidenceSetDetail 展开完整内容，
   * 序列化成 <evidence-set-context> 注入 userMessage（证据集无 Agent 工具可拉取，必须 inline）。
   */
  mentionedEvidenceSets?: Array<{
    id: string
    name: string
  }>
  /** 渲染进程生成的流式开始时间戳，主进程原样回传到 STREAM_COMPLETE，确保竞态保护比较的是同一个值 */
  startedAt?: number
}

// ===== Agent 队列消息 =====

/** 流式追加消息的输入参数（Agent 流式中发送新消息） */
export interface AgentQueueMessageInput {
  /** 会话 ID */
  sessionId: string
  /** 用户消息内容 */
  userMessage: string
  /** 前端预生成的 UUID（用于乐观更新去重） */
  uuid?: string
  /**
   * 软中断当前 Agent turn 后再追加消息。
   * true：先调用 SDK query.interrupt() 立即打断正在输出的 turn，再注入消息。
   * false / undefined：排队追加（默认行为，turn 结束后才会被消费）。
   */
  interrupt?: boolean
}

// ===== 会话迁移输入 =====


/** Fork（分叉）会话输入 */
export interface ForkSessionInput {
  /** ASCI 会话 ID */
  sessionId: string
  /** SDK 消息 uuid（截断点，inclusive）。省略时复制全部历史 */
  upToMessageUuid?: string
}

/** 快照回退输入（同一会话内回退到指定点） */
export interface RewindSessionInput {
  /** ASCI 会话 ID */
  sessionId: string
  /** 回退到哪条 assistant message（inclusive，截断该消息之后的一切） */
  assistantMessageUuid: string
}

/**
 * 回退软失败原因。
 *
 * - `fork-pre-fork`：在 fork 会话中尝试回退到 fork 之前的源会话消息，
 *   目标 uuid 只存在于源 SDK JSONL，当前 fork JSONL 不可用 resumeSessionAt。
 * - `post-recovery`：当前 sdkSessionId 是 session-not-found 恢复后的新会话，
 *   目标 uuid 来自被替换的旧会话，已无法在 SDK 端定位。
 */
export interface RewindBlockedResult {
  reason: 'fork-pre-fork' | 'post-recovery'
  details?: string
}

/** 快照回退结果 */
export interface RewindSessionResult {
  /** 截断后剩余的消息数；blocked 时为 0 */
  remainingMessages: number
  /** 文件恢复结果（enableFileCheckpointing 启用时可用） */
  fileRewind?: {
    canRewind: boolean
    error?: string
    filesChanged?: string[]
    insertions?: number
    deletions?: number
  }
  blocked?: RewindBlockedResult
}

// ===== 后台任务管理 =====

/**
 * 获取任务输出请求
 */
export interface GetTaskOutputInput {
  /** 任务 ID */
  taskId: string
  /** 是否阻塞等待完成（默认 false） */
  block?: boolean
}

/**
 * 获取任务输出响应
 */
export interface GetTaskOutputResult {
  /** 任务输出内容 */
  output: string
  /** 任务是否已完成 */
  isComplete: boolean
}

/**
 * 停止任务请求
 */
export interface StopTaskInput {
  /** 会话 ID */
  sessionId: string
  /** 任务 ID */
  taskId: string
  /** 任务类型 */
  type: 'agent' | 'shell'
}

// ===== Agent 流式事件载荷 =====

/**
 * Agent 流式事件（主进程 → 渲染进程推送）
 */
export interface AgentStreamEvent {
  /** 本地发送入口生成的不透明请求身份；旧 SDK 事件可不提供。 */
  requestId?: string
  /** 实际开始时间，不用于请求排序。 */
  startedAt?: number
  /** 会话 ID */
  sessionId: string
  /** 事件数据（新格式） */
  payload: AgentStreamPayload
  /** @deprecated 兼容旧格式，Phase 2 后移除 */
  event?: AgentEvent
}

/**
 * Agent 流式完成事件载荷（主进程 → 渲染进程）
 * 包含已持久化的消息列表，避免异步重新加载的竞态窗口。
 */
export interface AgentStreamCompletePayload {
  sessionId: string
  /** 本地请求身份，缺省时保持旧 SDK / 外部启动兼容。 */
  requestId?: string
  /** 已持久化的完整消息列表 */
  messages?: AgentMessage[]
  /** 是否由用户手动中止 */
  stoppedByUser?: boolean
  /** 本轮实际流式开始时间戳（不作为单调请求序号） */
  startedAt?: number
  /** SDK result 消息的 subtype（success / error_max_turns / error_max_budget_usd / error_during_execution 等） */
  resultSubtype?: string
}

// ===== 文件浏览器 =====

/** 文件/目录条目（用于文件浏览器树形视图） */
export interface FileEntry {
  /** 原生导入图片的展示名；路径与实际文件格式以 name/path 为准。 */
  displayName?: string
  /** 文件/目录名称 */
  name: string
  /** 完整路径 */
  path: string
  /** 是否为目录 */
  isDirectory: boolean
  /** 子条目（懒加载，仅目录展开时填充） */
  children?: FileEntry[]
}

/**
 * 目录列出结果
 * - entries: 过滤隐藏条目后的可见项
 * - hiddenCount: 被过滤的隐藏条目数量（用于 UI 提示"已隐藏 N 项"）
 */
export interface ListDirectoryResult {
  entries: FileEntry[]
  hiddenCount: number
}

/** 目录列出选项 */
export interface ListDirectoryOptions {
  /**
   * 允许在 UI 中显示的隐藏条目白名单（按名称精确匹配）
   * 例如：['.context']
   */
  visibleHiddenEntries?: string[]
}

/** 文件索引条目（用于 @ 引用搜索） */
export interface FileIndexEntry {
  /** 文件/目录名称 */
  name: string
  /** 相对于工作区的路径 */
  path: string
  /** 条目类型 */
  type: 'file' | 'dir'
}

/** 文件搜索结果 */
export interface FileSearchResult {
  entries: FileIndexEntry[]
  total: number
}

// ===== Agent 附件 =====

/** Agent 待发送文件（UI 侧暂存） */
export interface AgentPendingFile {
  id: string
  filename: string
  size: number
  mediaType: string
  /** 图片预览 URL（blob/data URL） */
  previewUrl?: string
}

/** Agent 文件保存到 session 的输入 */
export interface AgentSaveFilesInput {
  /** 兼容旧调用方；实际目录由后端会话归属决定，独立会话可省略。 */
  workspaceSlug?: string
  sessionId: string
  files: Array<{ filename: string; data: string }>
}

/** Agent 已保存文件信息 */
export interface AgentSavedFile {
  filename: string
  targetPath: string
}

/** Agent 文件保存到工作区文件目录的输入 */
export interface AgentSaveWorkspaceFilesInput {
  workspaceSlug: string
  files: Array<{ filename: string; data: string }>
}

/** 工作区级附加/分离目录的输入参数 */
export interface WorkspaceAttachDirectoryInput {
  /** 工作区 slug */
  workspaceSlug: string
  /** 目录的绝对路径 */
  directoryPath: string
}

// ===== AskUserQuestion 交互式问答类型 =====

/** AskUserQuestion 工具的选项定义 */
export interface AskUserQuestionOption {
  /** 选项显示文本 */
  label: string
  /** 选项说明 */
  description?: string
}

/** AskUserQuestion 工具的问题定义 */
export interface AskUserQuestion {
  /** 问题内容 */
  question: string
  /** 短标签（chip 显示） */
  header?: string
  /** 可选项列表 */
  options: AskUserQuestionOption[]
  /** 是否支持多选 */
  multiSelect?: boolean
}

/** AskUser 请求（主进程 → 渲染进程） */
export interface AskUserRequest {
  /** 请求唯一 ID */
  requestId: string
  /** 会话 ID */
  sessionId: string
  /** 问题列表 */
  questions: AskUserQuestion[]
  // #710：raw toolInput 不再下发 renderer，仅留 main pending state（用于 resolve 时拼 updatedInput）。
}

/** AskUser 响应（渲染进程 → 主进程） */
export interface AskUserResponse {
  /** 请求 ID */
  requestId: string
  /** 用户答案（问题索引字符串 → 答案文本） */
  answers: Record<string, string>
}

// ===== ExitPlanMode 计划审批类型 =====

/** ExitPlanMode SDK 工具输入中的 allowedPrompts 项 */
export interface ExitPlanAllowedPrompt {
  /** 工具名称（目前仅 "Bash"） */
  tool: 'Bash'
  /** 语义化的操作描述（如 "run tests"、"install dependencies"） */
  prompt: string
}

/** ExitPlanMode 请求（主进程 → 渲染进程） */
export interface ExitPlanModeRequest {
  /** 请求唯一 ID */
  requestId: string
  /** 会话 ID */
  sessionId: string
  // #710：raw toolInput 不再下发 renderer，仅留 main pending state（PendingExitPlan.toolInput）供 resume。
  /** 解析后的 allowedPrompts 列表 */
  allowedPrompts: ExitPlanAllowedPrompt[]
}

/** ExitPlanMode 用户选择行为 */
export type ExitPlanModeAction = 'approve_auto' | 'approve_edit' | 'deny' | 'feedback'

/** ExitPlanMode 响应（渲染进程 → 主进程） */
export interface ExitPlanModeResponse {
  /** 请求 ID */
  requestId: string
  /** 用户选择的行为 */
  action: ExitPlanModeAction
  /** 用户反馈内容（action 为 feedback 时有值） */
  feedback?: string
}

// ===== 权限系统类型 =====

/** ASCI 权限模式（ASCI 对外语义；SDK 模式可在适配层内部映射） */
export type ASCIPermissionMode = 'acceptEdits' | 'bypassPermissions' | 'plan'

/** 权限模式定义顺序（按风险递进，用于循环切换） */
export const ASCI_PERMISSION_MODE_ORDER: readonly ASCIPermissionMode[] = ['acceptEdits', 'bypassPermissions', 'plan']

/** 迁移旧权限模式值到新模式 */
export function migratePermissionMode(mode: string): ASCIPermissionMode {
  if (mode === 'acceptEdits' || mode === 'bypassPermissions' || mode === 'plan') return mode
  const migration: Record<string, ASCIPermissionMode> = {
    auto: 'acceptEdits',
    smart: 'acceptEdits',
    supervised: 'acceptEdits',
  }
  return migration[mode] ?? 'acceptEdits'
}

/** 危险等级 */
export type DangerLevel = 'safe' | 'normal' | 'dangerous'

/**
 * 权限弹窗的工具参数预览（#710）：main 生成的**已脱敏**结构，是 renderer 唯一可读的参数来源。
 * 原始 raw toolInput 不再下发 renderer（发到 renderer 的数据视同用户可见），仅留 main pending state
 * 供 approve 后 SDK resume。未知 / MCP 工具走 'redacted'（脱敏预览 + hash + bytes，不暴露 raw JSON）。
 */
export type ToolPreview =
  | { kind: 'command'; command: string }
  | { kind: 'file'; path: string; meta?: string }
  | { kind: 'pattern'; pattern: string; path?: string }
  | { kind: 'redacted'; preview: string; hash: string; bytes: number }

/** 权限请求（主进程 → 渲染进程） */
export interface PermissionRequest {
  /** 请求唯一 ID */
  requestId: string
  /** 会话 ID */
  sessionId: string
  /** 工具名称 */
  toolName: string
  /** 工具参数预览（#710：main 已脱敏；不再下发 raw toolInput，raw 留 main pending state 供 SDK resume） */
  toolPreview: ToolPreview
  /** 操作描述（人类可读，主进程语言；renderer 优先用 descriptionI18n 翻译） */
  description: string
  /**
   * i18n 形式的描述：renderer 用 t(key, params) 翻译。
   * 缺失时回退到 description 字段。
   * key 必须在 renderer 端 conversation ns 的 banner.description.* 下存在。
   */
  descriptionI18n?: { key: string; params?: Record<string, unknown> }
  /** 具体命令（Bash 工具时有值） */
  command?: string
  /** 危险等级 */
  dangerLevel: DangerLevel
  /** SDK 提供的原因说明 */
  decisionReason?: string
  /** ASCI hard rule ID（命中 hard rule 时有值） */
  hardRuleId?: string
  /** ASCI hard rule 原因说明（命中 hard rule 时有值） */
  hardRuleReason?: string
  /**
   * 是否允许把该请求加入会话白名单。
   * 命中 'ask' 类型的 hard rule（如 git push、rm）时为 false：这些规则要求逐次确认，不应被白名单绕过。
   */
  canAlwaysAllow?: boolean
}

/** 权限响应（渲染进程 → 主进程） */
export interface PermissionResponse {
  requestId: string
  behavior: 'allow' | 'deny'
  /** 是否记住选择（加入会话白名单） */
  alwaysAllow: boolean
}

// ===== Agent Teams 数据类型 =====

/** Team 配置（~/.claude/teams/{name}/config.json） */
export interface TeamConfig {
  /** 团队名称 */
  name: string
  /** 团队描述 */
  description?: string
  /** 创建时间戳 */
  createdAt: number
  /** 领导 Agent ID */
  leadAgentId?: string
  /** 领导 Agent 的 SDK 会话 ID */
  leadSessionId?: string
  /** 团队成员列表 */
  members: TeamMember[]
}

/** Team 成员 */
export interface TeamMember {
  /** Agent ID */
  agentId: string
  /** 显示名称 */
  name: string
  /** Agent 类型（如 'general-purpose', 'Explore'） */
  agentType: string
  /** 使用的模型 */
  model?: string
  /** 颜色标识 */
  color?: string
  /** 加入时间戳 */
  joinedAt?: number
}

/** 任务项（~/.claude/tasks/{teamName}/） */
export interface TaskItem {
  /** 任务 ID */
  id: string
  /** 任务标题 */
  subject: string
  /** 任务描述 */
  description?: string
  /** 进行中的显示文本 */
  activeForm?: string
  /** 负责人 Agent 名称 */
  owner?: string
  /** 任务状态 */
  status: 'pending' | 'in_progress' | 'completed'
  /** 阻塞的任务 ID 列表 */
  blocks: string[]
  /** 被阻塞的任务 ID 列表 */
  blockedBy: string[]
}

/** 解析后的收件箱消息 */
export interface ParsedMailboxMessage {
  /** 发送者名称 */
  from: string
  /** 消息文本 */
  text: string
  /** 摘要 */
  summary?: string
  /** 时间戳 */
  timestamp?: string
  /** 解析后的消息类型 */
  parsedType: 'idle_notification' | 'shutdown_request' | 'shutdown_approved' | 'task_assignment' | 'text'
}

/** Agent Team 聚合数据（IPC 返回） */
export interface AgentTeamData {
  /** 团队名称 */
  teamName: string
  /** 团队配置 */
  team: TeamConfig
  /** 任务列表 */
  tasks: TaskItem[]
  /** 收件箱消息（agent 名称 → 消息列表） */
  inboxes: Record<string, ParsedMailboxMessage[]>
}

// ===== IPC 通道常量 =====

/**
 * Agent 相关 IPC 通道常量
 */
export const AGENT_IPC_CHANNELS = {
  // 会话管理
  /** 获取会话列表 */
  LIST_SESSIONS: 'agent:list-sessions',
  /** 创建会话 */
  CREATE_SESSION: 'agent:create-session',
  /** 获取或创建工作区下的草稿会话（复用空会话，避免堆积） */
  GET_OR_CREATE_DRAFT_SESSION: 'agent:get-or-create-draft-session',
  /** 获取会话消息 */
  GET_MESSAGES: 'agent:get-messages',
  /** 获取会话 SDKMessage（Phase 4 新格式） */
  GET_SDK_MESSAGES: 'agent:get-sdk-messages',
  /** 更新会话标题 */
  UPDATE_TITLE: 'agent:update-title',
  /** 删除会话 */
  DELETE_SESSION: 'agent:delete-session',
  /** 迁移 Chat 对话记录到 Agent 会话 */
  MIGRATE_CHAT_TO_AGENT: 'agent:migrate-chat-to-agent',
  /** 切换会话置顶状态 */
  TOGGLE_PIN: 'agent:toggle-pin',
  /** 切换会话归档状态 */
  TOGGLE_ARCHIVE: 'agent:toggle-archive',
  /** 搜索会话消息内容 */
  SEARCH_MESSAGES: 'agent:search-messages',
  /** 分叉会话（从指定消息处创建新会话） */
  FORK_SESSION: 'agent:fork-session',
  /** 快照回退（同一会话内回退到指定点，恢复文件 + 截断对话） */
  REWIND_SESSION: 'agent:rewind-session',

  // 工作区管理
  /** 获取工作区列表 */
  LIST_WORKSPACES: 'agent:list-workspaces',
  /** 创建工作区 */
  CREATE_WORKSPACE: 'agent:create-workspace',
  /** 更新工作区 */
  UPDATE_WORKSPACE: 'agent:update-workspace',
  /** 删除工作区 */
  DELETE_WORKSPACE: 'agent:delete-workspace',
  /** 重排工作区顺序 */
  REORDER_WORKSPACES: 'agent:reorder-workspaces',

  // 消息发送
  /** 发送消息（触发 Agent 流式响应） */
  SEND_MESSAGE: 'agent:send-message',
  /** 中止 Agent 执行 */
  STOP_AGENT: 'agent:stop',

  // 后台任务管理
  /** 获取任务输出 */
  GET_TASK_OUTPUT: 'agent:get-task-output',
  /** 停止任务 */
  STOP_TASK: 'agent:stop-task',

  // 工作区能力（MCP + Skill）
  /** 获取工作区能力摘要 */
  GET_CAPABILITIES: 'agent:get-capabilities',
  /** 获取工作区 MCP 配置 */
  GET_MCP_CONFIG: 'agent:get-mcp-config',
  /** 保存工作区 MCP 配置 */
  SAVE_MCP_CONFIG: 'agent:save-mcp-config',
  /** 测试 MCP 服务器连接 */
  TEST_MCP_SERVER: 'agent:test-mcp-server',
  /** 获取工作区 Skill 列表 */
  GET_SKILLS: 'agent:get-skills',
  /** 获取工作区 Skills 目录绝对路径 */
  GET_SKILLS_DIR: 'agent:get-skills-dir',
  /** 删除工作区 Skill */
  DELETE_SKILL: 'agent:delete-skill',
  /** 切换工作区 Skill 启用/禁用 */
  TOGGLE_SKILL: 'agent:toggle-skill',
  /** 批量开关工作区 Skill（按 category 分类） */
  BATCH_TOGGLE_SKILL_BY_CATEGORY: 'agent:batch-toggle-skill-by-category',
  /** 获取其他工作区的 Skill 列表 */
  GET_OTHER_WORKSPACE_SKILLS: 'agent:get-other-workspace-skills',
  /** 从其他工作区导入 Skill 到当前工作区 */
  IMPORT_SKILL_FROM_WORKSPACE: 'agent:import-skill-from-workspace',
  /** 从源工作区同步更新已导入的 Skill */
  UPDATE_SKILL_FROM_SOURCE: 'agent:update-skill-from-source',

  // 论文检索记录
  /** 列出指定会话的论文检索记录（读取 agent-sessions-papers/{sessionId}.jsonl） */
  LIST_SESSION_PAPERS: 'agent:list-session-papers',
  /**
   * 主 → 渲染：session 论文集变化推送（替代渲染侧高频轮询）。
   * kind='live' 表示检索流式进度文件（{sessionId}.live.json）更新；
   * kind='canonical' 表示正式 JSONL（{sessionId}.jsonl）落盘（去重/打分后）。
   */
  SESSION_PAPERS_CHANGED: 'agent:session-papers-changed',
  /** 读取 session 的检索流式进度快照（{sessionId}.live.json；无/过期/损坏 → null） */
  GET_SESSION_PAPERS_LIVE: 'agent:get-session-papers-live',
  /**
   * 主 → 渲染：请求 SessionPapersPanel 打开"批量加入 Zotero"对话框，
   * 由 asci-zotero in-process MCP 工具触发，把对话内的导入意图收敛到既有 UI 链路。
   * 渲染侧须按 sessionId 过滤后再勾选 selectionKeys。
   */
  ZOTERO_OPEN_BATCH_IMPORT: 'agent:zotero:open-batch-import',

  // 流式事件（主进程 → 渲染进程推送）
  /** Agent 流式事件 */
  STREAM_EVENT: 'agent:stream:event',
  /** Agent 流式完成 */
  STREAM_COMPLETE: 'agent:stream:complete',
  /** Agent 流式错误 */
  STREAM_ERROR: 'agent:stream:error',

  // 附件
  /** 保存文件到 Agent session 工作目录 */
  SAVE_FILES_TO_SESSION: 'agent:save-files-to-session',
  /** 保存文件到工作区文件目录 */
  SAVE_FILES_TO_WORKSPACE: 'agent:save-files-to-workspace',
  /** 获取工作区文件目录路径 */
  GET_WORKSPACE_FILES_PATH: 'agent:get-workspace-files-path',
  /** 打开文件夹选择对话框 */
  OPEN_FOLDER_DIALOG: 'agent:open-folder-dialog',
  /** 附加外部目录到工作区（所有会话共享） */
  ATTACH_WORKSPACE_DIRECTORY: 'agent:attach-workspace-directory',
  /** 移除工作区的附加目录 */
  DETACH_WORKSPACE_DIRECTORY: 'agent:detach-workspace-directory',
  /** 获取工作区附加目录列表 */
  GET_WORKSPACE_DIRECTORIES: 'agent:get-workspace-directories',

  // 文件系统操作
  /** 获取 session 工作路径 */
  GET_SESSION_PATH: 'agent:get-session-path',
  /** 列出目录内容 */
  LIST_DIRECTORY: 'agent:list-directory',
  /** 删除文件/空目录 */
  DELETE_FILE: 'agent:delete-file',
  /** 用系统默认应用打开文件 */
  OPEN_FILE: 'agent:open-file',
  /** 在系统文件管理器中显示文件 */
  SHOW_IN_FOLDER: 'agent:show-in-folder',
  /** 在新窗口中预览文件 */
  PREVIEW_FILE: 'agent:preview-file',
  /** 重命名文件/目录 */
  RENAME_FILE: 'agent:rename-file',
  /** 移动文件/目录到目标目录 */
  MOVE_FILE: 'agent:move-file',
  /** 列出附加目录内容（无工作区路径限制） */
  LIST_ATTACHED_DIRECTORY: 'agent:list-attached-directory',
  /** 用系统默认应用打开附加目录文件（无工作区路径限制） */
  OPEN_ATTACHED_FILE: 'agent:open-attached-file',
  /** 在文件管理器中显示附加目录文件（无工作区路径限制） */
  SHOW_ATTACHED_IN_FOLDER: 'agent:show-attached-in-folder',
  /** 重命名附加目录文件/目录（无工作区路径限制） */
  RENAME_ATTACHED_FILE: 'agent:rename-attached-file',
  /** 移动附加目录文件/目录（无工作区路径限制） */
  MOVE_ATTACHED_FILE: 'agent:move-attached-file',
  /** 检查路径类型（文件 or 目录），用于拖拽检测 */
  CHECK_PATHS_TYPE: 'agent:check-paths-type',
  /** 搜索工作区文件（用于 @ 引用） */
  SEARCH_WORKSPACE_FILES: 'agent:search-workspace-files',
  /** 列出工作区最近 N 个文件（按 mtime 倒序），同时返回总数 */
  LIST_RECENT_WORKSPACE_FILES: 'agent:list-recent-workspace-files',

  // 标题自动生成通知（主进程 → 渲染进程推送）
  /** 标题已更新（首次对话完成后自动生成） */
  TITLE_UPDATED: 'agent:title-updated',

  // 工作区配置变化通知（主进程 → 渲染进程推送）
  /** 工作区能力变化（MCP/Skills 文件监听触发） */
  CAPABILITIES_CHANGED: 'agent:capabilities-changed',
  /** 全局 ~/.asci/mcp.json 文件变化（用户外部编辑或 IPC 写入后） */
  MCP_GLOBAL_CHANGED: 'agent:mcp-global-changed',
  /** 工作区文件变化（session 目录文件监听触发，用于文件浏览器刷新） */
  WORKSPACE_FILES_CHANGED: 'agent:workspace-files-changed',

  // 权限系统
  /** 权限响应（渲染进程 → 主进程） */
  PERMISSION_RESPOND: 'agent:permission:respond',
  /** 设置权限模式（渲染进程 → 主进程） */
  SET_PERMISSION_MODE: 'agent:set-permission-mode',
  /** 获取权限模式（渲染进程 → 主进程） */
  GET_PERMISSION_MODE: 'agent:get-permission-mode',
  /** 设置工作区推理深度（渲染进程 → 主进程） */
  SET_REASONING_EFFORT: 'agent:set-reasoning-effort',
  /** 获取工作区推理深度（渲染进程 → 主进程） */
  GET_REASONING_EFFORT: 'agent:get-reasoning-effort',

  // AskUserQuestion 交互式问答
  /** AskUser 响应（渲染进程 → 主进程） */
  ASK_USER_RESPOND: 'agent:ask-user:respond',

  // ExitPlanMode 计划审批
  /** ExitPlanMode 响应（渲染进程 → 主进程） */
  EXIT_PLAN_MODE_RESPOND: 'agent:exit-plan-mode:respond',

  // Agent Teams 数据
  /** 获取 Team 聚合数据（sdkSessionId → AgentTeamData | null） */
  GET_TEAM_DATA: 'agent:get-team-data',
  /** 读取 Teammate 输出文件（filePath → string） */
  GET_AGENT_OUTPUT: 'agent:get-agent-output',

  // 队列消息（Agent 运行中排队发送）
  /** 排队发送消息 */
  QUEUE_MESSAGE: 'agent:queue-message',
  /** 取消队列消息 */
  CANCEL_QUEUED_MESSAGE: 'agent:cancel-queued-message',
  /** 提升队列消息为立即发送 */
  PROMOTE_QUEUED_MESSAGE: 'agent:promote-queued-message',
  /** 队列消息状态变更通知（主进程 → 渲染进程推送） */
  QUEUED_MESSAGE_STATUS: 'agent:queued-message-status',

  // 待处理请求恢复（渲染进程重载后查询主进程状态）
  /** 获取所有待处理的交互请求快照 */
  GET_PENDING_REQUESTS: 'agent:get-pending-requests',

  // 文件预览（Inline Preview 系统）
  /** 获取文件元信息（大小、是否目录） */
  STAT_FILE: 'agent:stat-file',
  /** 读取文本文件（含大小上限） */
  PREVIEW_OPEN_HTML: 'agent:preview-open-html',
  PREVIEW_READ_TEXT: 'agent:preview-read-text',
  /** 读取二进制文件为 base64（供图片、PDF 备份路径使用） */
  PREVIEW_READ_BINARY: 'agent:preview-read-binary',
  /** 解析 Jupyter Notebook，返回 cells 结构 */
  PREVIEW_PARSE_NOTEBOOK: 'agent:preview-parse-notebook',
  /** 解析 Office 文档（docx/xlsx/pptx）为纯文本 */
  PREVIEW_PARSE_OFFICE: 'agent:preview-parse-office',
  /** 下载论文 PDF（按 url > arXiv > DOI 优先级），落应用缓存供右栏预览 */
  PREVIEW_DOWNLOAD_PDF: 'agent:preview-download-pdf',
  /** 下载论文 PDF 到系统下载文件夹（用户可见），并在访达/资源管理器中定位 */
  DOWNLOAD_PDF_LOCAL: 'agent:download-pdf-local',
  /** 解析综述 HTML 的 cite/q，落 evidence_refs / evidence_set（手动触发） */
  REVIEW_REPARSE_CITATIONS: 'agent:review-reparse-citations',
} as const

/** 工作区最近文件条目（相对路径 + mtime） */
export interface RecentFileEntry {
  /** 相对 workspace-files/ 的路径 */
  relPath: string
  /** 文件名（去路径） */
  name: string
  /** 修改时间毫秒戳 */
  mtimeMs: number
  /** 字节数 */
  size: number
}

/** LIST_RECENT_WORKSPACE_FILES 入参 */
export interface ListRecentWorkspaceFilesInput {
  workspaceSlug: string
  limit: number
}

/** LIST_RECENT_WORKSPACE_FILES 返回 */
export interface ListRecentWorkspaceFilesOutput {
  /** 按 mtime 倒序的前 N 个文件 */
  files: RecentFileEntry[]
  /** 实际扫到的文件总数（上限 MAX_SCAN_FILES，达到后提前返回） */
  totalCount: number
  /** true 表示扫描触发了 MAX_SCAN_FILES 上限 */
  capped: boolean
}

/**
 * 待处理交互请求快照（用于渲染进程重载后恢复状态）
 */
export interface PendingRequestsSnapshot {
  /** 待处理的权限请求 */
  permissions: PermissionRequest[]
  /** 待处理的 AskUser 请求 */
  askUsers: AskUserRequest[]
  /** 待处理的 ExitPlanMode 请求 */
  exitPlans: ExitPlanModeRequest[]
}


export interface ContextPin { id: string; label: string; text: string }
export interface ContextRecord {
  pins: ContextPin[]
  status?: 'working' | 'complete' | 'failed'
  error?: string
  report?: { summary: string; completedAt: number; trigger: 'manual' | 'auto'; beforeTokens?: number; afterTokens?: number }
}
