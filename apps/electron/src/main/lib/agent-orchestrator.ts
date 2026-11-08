import { ImageTurnController, injectQueuedImageMessage } from '../mcp/image-turn-controller.ts'
import { createImageTurnFactory } from '../mcp/image-turn-factory.ts'
import { validateImageEditSelection } from '../mcp/image-edit-selection.ts'
import { createImageGenerationMcpServer } from '../mcp/image-generation-tool.ts'
import { getAgentTurnFailure, hasAgentOutput } from './agent-turn-outcome.ts'
import { getResponseFailureMessage } from './agent-response-failure.ts'
import { codingSandbox } from './coding-sandbox'
import { createProjectHtmlMcpServer } from '../mcp/project-html-tool'
import { denyLookupShellFallback, createLookupShellGuard, READ_ONLY_LOOKUP_REASON } from './public-web/fallback-policy.ts'
import { createPublicWebMcpServer } from '../mcp/public-web-tool.ts'
import { selectRuntimePolicy, buildLeanSystemPrompt, measureRequestContext } from '@asci/shared'
import { readContextRecord, writeContextRecord, retainedContextPrompt, compactCommand, measuredContextTokens } from './context-retention'
import { taskModePrompt } from './task-mode-prompt.ts'
/**
 * AgentOrchestrator — Agent 编排层
 *
 * 从 agent-service.ts 提取的核心业务逻辑，负责：
 * - 并发守卫（同一会话不允许并行请求）
 * - 渠道查找 + API Key 解密
 * - 环境变量构建 + SDK 路径解析
 * - 用户/助手消息持久化
 * - 事件流遍历 + 文本累积 + 事件持久化
 * - 错误处理 + 部分内容保存
 * - 自动标题生成
 *
 * 通过 EventBus 分发 AgentEvent，通过 SessionCallbacks 发送控制信号，
 * 完全解耦 Electron IPC，可独立测试（mock Adapter + EventBus）。
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { app } from 'electron'
import type { AgentSendInput, AgentMessage, AgentProviderAdapter, TypedError, RetryAttempt, SDKMessage, SDKAssistantMessage, AgentStreamPayload, RewindSessionResult, ThinkingConfig, ObjectId, UserImageEditReference } from '@asci/shared'
import { SAFE_TOOLS, DEFAULT_CLAUDE_MODEL_ID, DEFAULT_AGENT_MAX_TURNS, DEFAULT_AGENT_EFFORT, isModelEnabledInChannel, pickFallbackModel, inferModelContextWindow, AGENT_IPC_CHANNELS, TELEMETRY_EVENTS, toConversationType, nowMs } from '@asci/shared'
import { telemetryService } from './telemetry/telemetry-service.ts'
import { SelfEvolutionCollector } from './telemetry/self-evolution-hooks.ts'
import { getEffectiveCapabilities } from '@asci/core'
import type { PermissionRequest, ASCIPermissionMode, AskUserRequest, ExitPlanModeRequest, HardRuleContext } from '@asci/shared'
import type { ClaudeAgentQueryOptions } from './adapters/claude-agent-adapter'
import { isPromptTooLongError, friendlyErrorMessage, mapSDKErrorToTypedError, extractErrorDetails, sanitizeProviderDiagnostic, normalizeProviderAuthenticationMessage } from './adapters/claude-agent-adapter'
import { AgentEventBus } from './agent-event-bus'
import { buildZoteroContextBlock } from './zotero-context-block'
import { decryptApiKey, getChannelById } from './channel-manager'
import { getAdapter, normalizeAnthropicBaseUrlForSdk } from '@asci/core'
import { appendSDKMessages, updateAgentSessionMeta, getAgentSessionMeta, getAgentSessionMessages, getAgentSessionSDKMessages } from './agent-session-manager'
import { executeRewind } from './agent-rewind'
import { getAgentWorkspace, ensurePluginManifest, getWorkspacePermissionMode, setWorkspacePermissionMode, getAllWorkspaceSkills } from './agent-workspace-manager'
import { getAgentWorkspacePath, getAgentSessionWorkspacePath, getAgentDefaultSessionPath, getWorkspaceFilesDir, getConfigDir, getWorkspacePapersPath, getConversationAttachmentsDir } from './config-paths'
import { getWorkspaceAttachedDirectories } from './agent-workspace-manager'
import { getRuntimeStatus } from './runtime-init'
import { getSettings } from './settings-service'
import { buildSystemPrompt, buildDynamicContext } from './agent-prompt-builder'
import type { StickyCapabilityPackInfo, RegisteredScenarioAgent } from './agent-prompt-builder.ts'
import { getLanguage, t } from './i18n-main'
import { buildUserTurnLanguagePin, buildUserTurnLanguageTailAnchor, buildLanguageLockContext, detectOutputLanguage } from './detect-message-language'
import type { AppLocale } from './detect-message-language'
import { permissionService } from './agent-permission-service'
import type { PermissionResult, CanUseToolOptions } from './agent-permission-service'
import { askUserService, normalizeAskUserInput } from './agent-ask-user-service'
import { exitPlanService, type ExitPlanPermissionResult } from './agent-exit-plan-service'
import {
  findTeamLeadInboxPath,
  pollInboxWithRetry,
  markInboxAsRead,
  formatInboxPrompt,
  formatSummaryFallbackPrompt,
  areAllWorkersIdle,
  INBOX_RETRY_CONFIG,
  type TaskNotificationSummary,
} from './agent-team-reader'
import { validateToolInput } from './agent-tool-input-validator'
import { estimateTokenCount, WRITE_CONTENT_TOKEN_THRESHOLD } from './agent-tool-token-estimator'
import { broadcastWorkspaceFilesChanged } from './workspace-watcher'
import { getRuntimeProvisioner } from './runtime/runtime-provisioner.ts'
import { humanizeMessageForTitle } from './agent-title-humanize.ts'
import { composeMcpServers } from './mcp/global-config.ts'
import { createContextBudgetTracker, DEFAULT_CONTEXT_WINDOW_TOKENS } from './context-budget.ts'
import { PLAN_MODE_ALLOWED_TOOLS } from './agent-allowed-tools.ts'
import { resolveMasterAllowedTools } from './agent-orchestrator.master-tools.ts'
import { createInMemorySubagentRegistry } from './subagent-registry.ts'
import { seedBuiltinSubagents } from './subagent-registry-seed.ts'
import { seedSkillsToRegistry } from './skill-registry-seed.ts'
import { seedMcpServersToRegistry } from './mcp-registry-seed.ts'
import { loadCapabilityPacks } from './capability-pack-loader.ts'
import { loadPaperSearchEnv } from './paper-search-integration.ts'
import { emitFilesystemAgents } from './emit-filesystem-agents.ts'
import { emitMcpConfigFile } from './emit-mcp-config.ts'
import { markClaudeProjectTrusted } from './mark-claude-project-trusted.ts'
import {
  parseMcpInitSnapshot,
  listUnhealthyMcpServers,
  formatMcpSnapshotSummary,
  snapshotHasTool,
  type McpInitSnapshot,
} from './mcp/mcp-init-status.ts'
import {
  appendSessionDiagnosticsEvent,
  appendSessionStderr,
  buildToolNotFoundEvent,
  extractToolNotFoundName,
  extractToolResultText,
} from './agent-session-diagnostics.ts'
import { runOrchestratorQuery } from './run-orchestrator-query.ts'
import {
  extractTopLevelAssistantText,
  shouldSkipRedundantAutoResume,
} from './agent-orchestrator.auto-resume-guard.ts'
import type { SpanSink } from './subagent-spans-hook.ts'
import { createBatchedSpansSink, type SpansSinkStorage, type BatchedSpansSink } from './agent-orchestrator-spans-sink.ts'
import { getDb } from './objects/object-store.ts'
import { queryEvidenceSetDetail } from './objects/query-service.ts'
import { buildEvidenceSetContextBlock } from './evidence-set-context-block.ts'
import {
  maybePersistReviewFromMessages,
  persistReviewsFromSessionCwd,
} from './objects/review-persistence-service.ts'
import { wrapSearchReportsInCwd } from './objects/review-html-wrapper.ts'
import type { AuthService } from './auth-service.ts'
import {
  extractApiError,
  isAutoRetryableTypedError,
  isAutoRetryableCatchError,
  isSessionNotFoundError,
  getRetryDelayMs,
  timerWithAbort,
  resolveSDKCliPath,
  getAgentExecutable,
  ensureRipgrepAvailable,
  buildContextPrompt,
  MAX_CONTEXT_MESSAGES,
  shouldDenyReadForPdfDocumentBlock,
  isLikelyPdfDocumentBlockIncompatibility,
  resolveQueuePriority,
} from './agent-orchestrator-helpers.ts'
import { resolveChannelEndpoint } from './channel-endpoint.ts'
import { buildSdkEnv } from './agent-orchestrator-sdk-env.ts'
import { buildMcpServers } from './agent-orchestrator-mcp.ts'

// PDF 守门 / 追加优先级守门函数已迁至 agent-orchestrator-helpers.ts；
// 为保持既有测试（agent-orchestrator.pdf-guard.test.ts / .queue-priority.test.ts）
// 从本文件导入不变，这里同名 re-export（不改名，符合 CLAUDE.md barrel 例外）。
export { shouldDenyReadForPdfDocumentBlock, isLikelyPdfDocumentBlockIncompatibility, resolveQueuePriority }
export { PLAN_MODE_ALLOWED_TOOLS }

/**
 * ASCI 'acceptEdits' 在 SDK 侧映射为 'auto'：低风险工具由 SDK 内置分类器放行，
 * 高危请求才进入 canUseTool / 弹窗，以减少不必要的人工审批。
 */
const toSdkPermissionMode = (mode: ASCIPermissionMode): ClaudeAgentQueryOptions['sdkPermissionMode'] =>
  mode === 'acceptEdits' ? 'auto' : mode

// ===== 类型定义 =====

/**
 * 会话控制信号回调
 *
 * 解耦 Electron webContents，使 Orchestrator 可独立测试。
 * agent-service.ts 负责将这些回调绑定到 webContents.send()。
 */
export interface SessionCallbacks {
  /** 发送流式错误 */
  onError: (error: string) => void
  /** 发送流式完成（携带已持久化的消息列表） */
  onComplete: (messages?: AgentMessage[], opts?: { stoppedByUser?: boolean; startedAt?: number; resultSubtype?: string }) => void
  /** 发送标题更新 */
  onTitleUpdated: (title: string) => void
}

// ===== 工具函数 =====
// 自包含纯工具函数已拆分至 agent-orchestrator-helpers.ts；
// SDK env 构建拆至 agent-orchestrator-sdk-env.ts；MCP 组装拆至 agent-orchestrator-mcp.ts。
// 均在文件顶部 import；PDF 守门 / resolveQueuePriority 由本文件同名 re-export 供测试引用。

/** 最大自动重试次数 */
const MAX_AUTO_RETRIES = 3

/**
 * 标题最大长度（按字符数截断用户首条消息）
 */
const MAX_TITLE_LENGTH = 20

/** 默认会话标题（用于判断是否需要自动生成） */
const DEFAULT_SESSION_TITLE = '新 Agent 会话'

// ===== AgentOrchestrator =====

export class AgentOrchestrator {
  private adapter: AgentProviderAdapter
  private eventBus: AgentEventBus
  private activeSessions = new Map<string, number>()
  private imageAuthorizations = new Map<string, ImageTurnController>()

  /** 队列消息本地记录（sessionId → UUID 集合，用于防重） */
  private queuedMessageUuids = new Map<string, Set<string>>()

  /** 被用户手动中止的会话集合（在 stop 中标记，catch block 中消费） */
  private stoppedBySessions = new Set<string>()

  /** 运行中会话的当前权限模式（支持运行时动态切换） */
  private sessionPermissionModes = new Map<string, ASCIPermissionMode>()

  /**
   * 上一轮已解析的用户输入语言（per-session）。
   *
   * 用于"语言中立"输入（纯数字 / 数字+分隔符 / 列表序号，如 "2024"、"1, 2"、"1."）
   * 沿用上一轮语言，避免本轮被默认回退到 UI 语言导致中英抖动。
   * 生命周期与 sessionPermissionModes 对齐：sendMessage finally / stop() 清理。
   */
  private lastResolvedUserLang = new Map<string, AppLocale>()

  /**
   * 子 Agent 注册中心（A0 ③）—— 每次 runAgent 内部按当时 claudeAvailable + language 重新 seed builtin
   * 项；capability-pack / user-config 来源（Phase 2 接入）持久挂载，不被 reseed 清掉。
   */
  private readonly subagentRegistry = createInMemorySubagentRegistry()

  /**
   * 子 Agent 派发 span 的 sink（A0a）—— in-memory cache + debounced flush。
   *
   * Phase 2 实现：500ms debounce 内合并多次 hook 触发为一次磁盘写盘，避免
   * Phase 1 形态"每 dispatch 4 次同步 I/O"的开销。0.2 dogfood 接受 debounce
   * 窗口内崩溃丢 spans 的风险；0.3 telemetry consumer 接入时再考虑 durable write。
   *
   * cleanup 路径（runAgent 结束 / orchestrator dispose）必须调 .flush() 保兜底。
   */
  private readonly subagentSpansSink: BatchedSpansSink = createBatchedSpansSink({
    read: (sessionId) => getAgentSessionMeta(sessionId) ?? null,
    write: (sessionId, spans) => {
      try {
        updateAgentSessionMeta(sessionId, { subagentSpans: spans })
      } catch (err) {
        console.warn('[SubagentSpansSink] flush failed:', err)
      }
    },
  } satisfies SpansSinkStorage)

  constructor(adapter: AgentProviderAdapter, eventBus: AgentEventBus) {
    this.adapter = adapter
    this.eventBus = eventBus
  }

  /** 主进程登录态服务；由 main 在构造后注入（agent-service.bindAuthServiceToOrchestrator）。 */
  private authService: AuthService | null = null

  /** 接线 AuthService（journal 检索源需要其 access token）；传 null 解除绑定。 */
  setAuthService(svc: AuthService | null): void {
    this.authService = svc
  }

  /** 检查 Python runtime 是否已就绪（用于决定是否注入 asci-python） */
  private isPythonRuntimeReady(): boolean {
    try {
      return getRuntimeProvisioner().getStatus().phase === 'ready'
    } catch {
      return false
    }
  }

  /**
   * 首轮自动命名会话
   *
   * 直接取用户第一条消息，做空白折叠 + 字符截断，作为标题。
   * 之前用 LLM 生成标题的方案被 MiniMax/Anthropic 兼容端点的 CoT 絮叨 + 529 过载
   * 搅得不稳定（详见 git log），改为确定性规则，UI 里仍有铅笔图标可手动改。
   *
   * 截断之前先把 @file: / /skill: / #mcp: / @zotero-item: / @zotero-col: 替换成
   * 可读形式（path 取 basename，zotero 取解码后的 |label），否则像
   * "@zotero-col:KEY|encoded..." 这样长度恰好 = MAX_TITLE_LENGTH 的 mention 会被
   * slice 切掉 |label 部分，留下纯 ID 显示在侧边栏。
   */
  private autoGenerateTitle(
    sessionId: string,
    userMessage: string,
    callbacks: SessionCallbacks,
  ): void {
    try {
      const meta = getAgentSessionMeta(sessionId)
      if (!meta || meta.title !== DEFAULT_SESSION_TITLE) return

      const humanized = humanizeMessageForTitle(userMessage)
      const title = humanized.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE_LENGTH)
      if (!title) return

      updateAgentSessionMeta(sessionId, { title })
      callbacks.onTitleUpdated(title)
      console.log(`[Agent 编排] 自动标题: "${title}"`)
    } catch (error) {
      console.warn('[Agent 编排] 自动标题设置失败:', error)
    }
  }

  /**
   * Session-not-found 恢复：清除失效的 sdkSessionId，切换到上下文回填模式
   *
   * 当 resume 的目标 session 已过期/被清理时，SDK 会抛出 "No conversation found" 错误。
   * 此方法执行恢复的公共逻辑，调用方负责设置 existingSdkSessionId = undefined 和流程控制（break/continue）。
   *
   * @returns lastRetryableError 描述字符串
   */
  private prepareSessionNotFoundRecovery(
    sessionId: string,
    queryOptions: ClaudeAgentQueryOptions,
    contextualMessage: string,
    agentCwd: string,
    accumulatedMessages: SDKMessage[],
    queryStartedAt: number,
  ): string {
    console.log(`[Agent 编排] 检测到 session-not-found 错误，清除 sdkSessionId 并切换到上下文回填模式`)
    try { updateAgentSessionMeta(sessionId, { sdkSessionId: undefined }) } catch { /* 忽略 */ }
    queryOptions.resumeSessionId = undefined
    // 同步清除 resumeSessionAt：SDK 契约要求两者绑定使用，孤立 resumeSessionAt 重试一定失败
    queryOptions.resumeSessionAt = undefined
    queryOptions.prompt = buildContextPrompt(sessionId, contextualMessage, { agentCwd })
    this.persistSDKMessages(sessionId, accumulatedMessages, nowMs() - queryStartedAt)
    accumulatedMessages.length = 0
    return 'Session 已失效，切换到上下文回填模式'
  }

  /**
   * 持久化累积的 SDKMessage（Phase 4: 直接存储原始 SDKMessage）
   *
   * 只持久化 assistant、user、result 和 compact_boundary system 消息
   * （跳过 tool_progress、compacting 等临时消息）。
   */
  private persistSDKMessages(
    sessionId: string,
    accumulatedMessages: SDKMessage[],
    durationMs?: number,
  ): void {
    if (accumulatedMessages.length === 0) return

    const toPersist = accumulatedMessages.filter(
      (m) => m.type === 'assistant' || m.type === 'user' || m.type === 'result'
        || (m.type === 'system' && (m as import('@asci/shared').SDKSystemMessage).subtype === 'compact_boundary')
    ).filter((m) => {
      // 过滤 SDK 内部生成的 user 文本消息（如 Skill 展开 prompt），与实时流过滤逻辑一致
      if (m.type === 'user') {
        const content = (m as { message?: { content?: Array<{ type: string }> } }).message?.content
        const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
        if (!hasToolResult) return false
      }
      return true
    })

    if (toPersist.length === 0) return

    // 为没有 _createdAt 的消息补上时间戳（assistant 消息来自 SDK 原始输出，不含时间）
    const now = nowMs()
    const withTimestamps = toPersist.map((m) => {
      const msg = m as Record<string, unknown>
      if (typeof msg._createdAt === 'number') return m
      // 为 result 消息附加 _durationMs
      if (m.type === 'result' && durationMs != null) {
        return { ...m, _createdAt: now, _durationMs: durationMs } as unknown as SDKMessage
      }
      return { ...m, _createdAt: now } as unknown as SDKMessage
    })

    appendSDKMessages(sessionId, withTimestamps)
  }

  /**
   * 发送消息并流式推送事件
   *
   * 核心编排方法，从 agent-service.ts 的 runAgent 提取。
   * 通过 EventBus 分发 AgentEvent，通过 callbacks 发送控制信号。
   */
  async sendMessage(input: AgentSendInput, callbacks: SessionCallbacks): Promise<void> {
    const { sessionId, userMessage, channelId, modelId, workspaceId, additionalDirectories, customMcpServers, permissionModeOverride, effort, mentionedSkills, mentionedMcpServers, mentionedZoteroItems, mentionedZoteroCollections, zoteroAttachments, mentionedEvidenceSets } = input
    const stderrChunks: string[] = []

    // 0. 并发保护
    if (this.activeSessions.has(sessionId)) {
      console.warn(`[Agent 编排] 会话 ${sessionId} 正在处理中，拒绝新请求`)
      // 仅回 onError，不发 onComplete：拒绝并未结束真正在跑的那次 session，
      // 若发 onComplete([]) 会让渲染层把"被拒绝的这次"误判为正常结束，触发
      // bumpRefresh 从 JSONL 重读 messages → 抹掉行 949 的乐观 tempUserMsg，
      // 同时还会误发"任务完成"桌面通知。
      callbacks.onError('上一条消息仍在处理中，请稍候再试')
      return
    }

    // 0.5 清除上一轮中断标记
    try { updateAgentSessionMeta(sessionId, { stoppedByUser: false }) } catch { /* 会话可能已删除 */ }

    // 1. Windows 平台：检查 Shell 环境可用性
    if (process.platform === 'win32') {
      const runtimeStatus = getRuntimeStatus()
      const shellStatus = runtimeStatus?.shell

      if (shellStatus && !shellStatus.gitBash?.available && !shellStatus.wsl?.available) {
        const errorMsg = `Windows 平台需要 Git Bash 或 WSL 环境才能运行 Agent。

当前状态：
- Git Bash: ${shellStatus.gitBash?.error || '未检测到'}
- WSL: ${shellStatus.wsl?.error || '未检测到'}

解决方案：
1. 安装 Git for Windows（推荐）: https://git-scm.com/download/win
2. 或启用 WSL: https://learn.microsoft.com/zh-cn/windows/wsl/install

安装完成后请重启应用。`

        callbacks.onError(errorMsg)
        callbacks.onComplete([], { startedAt: input.startedAt })
        return
      }
    }

    // 明确图片引用在调用语言模型前校验，避免文件已删除时产生无效付费请求。
    let imageEditReference: UserImageEditReference | undefined
    if (input.imageEditReferenceId !== undefined) {
      try {
        imageEditReference = validateImageEditSelection(getConversationAttachmentsDir(sessionId), input.imageEditReferenceId)
      } catch {
        callbacks.onError(t('common.imageVersion.missing'))
        callbacks.onComplete([], { startedAt: input.startedAt })
        return
      }
    }

    // 2. 获取渠道信息并解密 API Key
    const channel = getChannelById(channelId)
    if (!channel || channel.provider === 'custom-image') {
      callbacks.onError(t('errors.channelTest.imageChatUnsupported'))
      callbacks.onComplete([], { startedAt: input.startedAt })
      return
    }

    // 2.0 计算当前渠道的有效能力（capabilities + override）
    // 该值在 canUseTool（PDF Read 拦截）和 buildSystemPrompt（PDF compatibility 指令注入）
    // 两个位置都需要使用，所以提升到外层作用域复用同一个对象。issue #74
    const effectiveCapabilities = getEffectiveCapabilities(channel)

    let apiKey: string
    try {
      apiKey = decryptApiKey(channelId)
    } catch {
      callbacks.onError('解密 API Key 失败')
      callbacks.onComplete([], { startedAt: input.startedAt })
      return
    }

    // 2.1 立即抢占会话槽位（在所有同步检查通过后、第一个 await 之前）
    // 防止 buildSdkEnv 等 await 期间并发调用绕过上方的检查，导致多条重复消息写入 JSONL
    // finally 块会通过 generation 匹配来安全清理，不影响正常流程
    const runGeneration = nowMs()
    // 优先使用渲染进程传来的 startedAt（确保 STREAM_COMPLETE 竞态保护比较的是同一个值），
    // 否则用本地 runGeneration 作为回退（headless 模式等无渲染进程场景）
    const streamStartedAt = input.startedAt ?? runGeneration
    this.activeSessions.set(sessionId, runGeneration)

    let endpoint: { baseUrl: string; apiKey: string }
    try { endpoint = await resolveChannelEndpoint(channel, apiKey) } catch {
      this.activeSessions.delete(sessionId)
      callbacks.onError(t('errors.channelTest.customBridgeFailed'))
      callbacks.onComplete([], { startedAt: input.startedAt })
      return
    }

    // 3. 构建环境变量
    // 同步凭证到 process.env（SDK in-process 代码可能直接读取 process.env）
    // 先清理再注入，确保 SDK 无论从 env 选项还是 process.env 都拿到正确值
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.ANTHROPIC_BASE_URL
    process.env.ANTHROPIC_API_KEY = endpoint.apiKey
    // 使用与 buildSdkEnv 相同的规范化逻辑，确保 process.env 和 sdkEnv 中的 URL 一致
    if (endpoint.baseUrl && endpoint.baseUrl !== 'https://api.anthropic.com') {
      process.env.ANTHROPIC_BASE_URL = normalizeAnthropicBaseUrlForSdk(endpoint.baseUrl)
      // 第三方端点同时注入 Bearer token（与 sdkEnv 对齐）
      process.env.ANTHROPIC_AUTH_TOKEN = endpoint.apiKey
    }

    const sdkEnv = await buildSdkEnv(endpoint.apiKey, endpoint.baseUrl)
    if (channel.provider === 'custom-openai') {
      sdkEnv.NO_PROXY = [sdkEnv.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',')
      sdkEnv.no_proxy = sdkEnv.NO_PROXY
    }

    // 4. 读取已有的 SDK session ID（用于 resume）
    const sessionMeta = getAgentSessionMeta(sessionId)
    let existingSdkSessionId = sessionMeta?.sdkSessionId

    // 4.1 检测回退后的 resume 截断点（快照回退功能）
    let rewindResumeAt: string | undefined
    if (sessionMeta?.resumeAtMessageUuid) {
      rewindResumeAt = sessionMeta.resumeAtMessageUuid
      // 消费一次后清除
      updateAgentSessionMeta(sessionId, { resumeAtMessageUuid: undefined })
      console.log(`[Agent 编排] 检测到回退 resume: resumeSessionAt=${rewindResumeAt}`)
    }

    console.log(`[Agent 编排] Resume 状态: sdkSessionId=${existingSdkSessionId || '无'}, asci sessionId=${sessionId}`)

    // 5. 持久化用户消息（SDKMessage 格式）
    const imageUserHistory = getAgentSessionSDKMessages(sessionId)
    const inputMessageUuid = randomUUID()
    const userSDKMsg: SDKMessage = {
      type: 'user',
      uuid: inputMessageUuid,
      ...(imageEditReference && { imageEditReference }),
      message: {
        content: [{ type: 'text', text: userMessage }],
      },
      parent_tool_use_id: null,
      _createdAt: nowMs(),
    } as unknown as SDKMessage
    appendSDKMessages(sessionId, [userSDKMsg])

    // 6. 状态初始化
    // 防御性 reconcile（issue #62 兜底）：渲染端正常情况下已把 modelId 写成 channel 启用列表里的值，
    // 这里再校一遍，避免 settings.json 与 channels.json 因竞态短暂不一致时直接把无效 modelId 送给 SDK。
    let effectiveModelId = modelId
    if (modelId && !isModelEnabledInChannel(channel, modelId)) {
      const fallback = pickFallbackModel(channel)
      if (fallback) {
        console.warn(
          `[Agent 编排] 请求的 modelId="${modelId}" 不在 channel "${channel.name}" 启用模型列表中，回退到 "${fallback.id}"`,
        )
        effectiveModelId = fallback.id
      } else {
        console.warn(
          `[Agent 编排] 请求的 modelId="${modelId}" 不可用，且 channel "${channel.name}" 无任何启用模型，将使用 SDK 默认模型`,
        )
        effectiveModelId = undefined
      }
    }

    const accumulatedMessages: SDKMessage[] = []
    let resolvedModel = effectiveModelId || DEFAULT_CLAUDE_MODEL_ID
    let titleGenerationStarted = false

    // 让 CLI 的 auto-compact 按模型**真实**上下文窗口触发，而非默认 200k。
    // CLI（claude 二进制）内部窗口解析：window = min(模型内置窗口, CLAUDE_CODE_AUTO_COMPACT_WINDOW)，
    // env 取值范围 [100k, 1M]（超出 1M 会被 CLI 判非法而忽略，故此处 clamp 到 1M）。third-party
    // Anthropic-compat 模型（如 DeepSeek 1M）CLI 认不出、默认按 200k 算，导致 ~168k（84%×200k）就压缩；
    // 这里用项目已知的窗口（inferModelContextWindow）注入，让压缩边界跟上真实窗口。
    // ⚠ 注意 min() 上限：若 CLI 对该模型仍认成 200k，min 会夹回 200k（需真实 run 看 compact_boundary
    // 是否后移来确认是否生效）；对 Anthropic native 1M（需 beta 才真正 1M）此处天然被夹回，无副作用。
    const realContextWindow = inferModelContextWindow(resolvedModel, channel.provider)
    if (realContextWindow > DEFAULT_CONTEXT_WINDOW_TOKENS) {
      sdkEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(Math.min(realContextWindow, 1_000_000))
      console.log(
        `[Agent 编排] 注入 auto-compact 窗口: ${sdkEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW}（模型 ${resolvedModel} 真实窗口 ${realContextWindow}, provider=${channel.provider}）`,
      )
    }
    let agentExec: { type: 'node'; path: string } | undefined
    let agentCwd: string | undefined
    let workspaceSlug: string | undefined
    let workspace: import('@asci/shared').AgentWorkspace | undefined
    // 自进化信号采集器（#427）：旁路采集，consent 闸门在 telemetry-service 内
    let evoCollector: SelfEvolutionCollector | undefined

    try {
      // 8. 动态导入 SDK
      const sdk = await import('@anthropic-ai/claude-agent-sdk')

      // 9. 构建 SDK query
      const cliPath = resolveSDKCliPath()
      agentExec = getAgentExecutable()

      if (!existsSync(cliPath)) {
        const errMsg = `SDK 可执行文件不存在: ${cliPath}`
        console.error(`[Agent 编排] ${errMsg}`)
        callbacks.onError(errMsg)
        callbacks.onComplete([], { startedAt: streamStartedAt })
        return
      }

      ensureRipgrepAvailable(cliPath)

      console.log(
        `[Agent 编排] 启动 SDK — executable: ${cliPath}, 运行时: ${agentExec.type} (${agentExec.path}), 模型: ${effectiveModelId || DEFAULT_CLAUDE_MODEL_ID}, resume: ${existingSdkSessionId ?? '无'}`,
      )

      const executableArgs: string[] = []

      // 确定 Agent 工作目录
      // 兜底用 ASCI 自有沙箱（~/.asci/agent-workspaces/_no-workspace/<sessionId>/），
      // 不再用 homedir() —— 防止 SDK 读取用户的 ~/CLAUDE.md / 写入 ~/.claude/settings.json。
      // 该沙箱会自动落 ASCI 身份 CLAUDE.md（详见 config-paths.ts ASCI_WORKSPACE_CLAUDE_MD）。
      agentCwd = getAgentDefaultSessionPath(sessionId)
      workspaceSlug = undefined
      workspace = undefined
      if (workspaceId) {
        const ws = getAgentWorkspace(workspaceId)
        if (ws) {
          agentCwd = getAgentSessionWorkspacePath(ws.slug, sessionId)
          workspaceSlug = ws.slug
          workspace = ws
          console.log(`[Agent 编排] 使用 session 级别 cwd: ${agentCwd} (${ws.name}/${sessionId})`)

          ensurePluginManifest(ws.slug, ws.name)

          if (existingSdkSessionId) {
            console.log(`[Agent 编排] 将尝试 resume: ${existingSdkSessionId}`)
          } else {
            console.log(`[Agent 编排] 无 sdkSessionId，将作为新会话启动（回填历史上下文）`)
          }
        }
      }

      // 自进化信号采集器初始化 + 任务开始信号（model_choice / workspace_structure）。
      // paperCount 从工作区 papers.jsonl 行数轻量获取，避免重 I/O。
      {
        let paperCount: number | undefined
        if (workspaceSlug) {
          try {
            const papersPath = getWorkspacePapersPath(workspaceSlug)
            if (existsSync(papersPath)) {
              paperCount = readFileSync(papersPath, 'utf-8').split('\n').filter(Boolean).length
            }
          } catch { /* 计数失败不影响主流程 */ }
        }
        evoCollector = new SelfEvolutionCollector({
          sessionId,
          promptChars: userMessage.length,
          attachmentCount: zoteroAttachments?.length ?? 0,
          mentionedSkillCount: mentionedSkills?.length ?? 0,
          modelId: effectiveModelId,
          channelType: channel.provider,
          workspaceSlug,
          paperCount,
        })
        evoCollector.emitRunStart()
      }

      // 9.4.1 Fork session JSONL 迁移已在 forkAgentSession 中完成，
      // fork 后的会话直接使用自己的 cwd，无需回退到源目录。
      // forkSourceDir 仅作为备用参考字段保留，不再影响 agentCwd。

      // 9.5 确保 SDK 项目设置（plansDirectory → .context）
      {
        const claudeSettingsDir = join(agentCwd, '.claude')
        if (!existsSync(claudeSettingsDir)) mkdirSync(claudeSettingsDir, { recursive: true })
        const settingsPath = join(claudeSettingsDir, 'settings.json')
        let sdkProjectSettings: Record<string, unknown> = {}
        try {
          sdkProjectSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
        } catch { /* 文件不存在或解析失败 */ }
        let needsWrite = false
        if (sdkProjectSettings.plansDirectory !== '.context') {
          sdkProjectSettings.plansDirectory = '.context'
          needsWrite = true
        }
        if (sdkProjectSettings.skipWebFetchPreflight !== true) {
          sdkProjectSettings.skipWebFetchPreflight = true
          needsWrite = true
        }
        if (needsWrite) {
          writeFileSync(settingsPath, JSON.stringify(sdkProjectSettings, null, 2))
          console.log(`[Agent 编排] 已设置 SDK settings (plansDirectory, skipWebFetchPreflight)`)
        }
      }

      // 9.6 直接信任已保存的 sdkSessionId，跳过 listSessions 预验证
      // 原因：listSessions({ dir }) 基于 cwd 路径哈希查找，但 session 级别的 cwd
      // （如 ~/.asci/agent-workspaces/workspace-xxx/sessionId）与 SDK 内部存储的路径哈希可能不匹配，
      // 导致 listSessions 始终返回 0 个会话，误杀有效的 resume。
      // SDK 本身会优雅处理无效的 resume ID（回退为新会话），无需预验证。
      if (existingSdkSessionId) {
        console.log(`[Agent 编排] 将直接使用已保存的 sdkSessionId 进行 resume: ${existingSdkSessionId}`)
      }

      const runtimePolicy = selectRuntimePolicy({
        message: userMessage,
        mode: input.taskMode,
        hasHistory: Boolean(existingSdkSessionId),
        previousProfile: sessionMeta?.runtimeProfile,
        hasReferences: Boolean(input.imageEditReferenceId || mentionedSkills?.length || mentionedMcpServers?.length || customMcpServers && Object.keys(customMcpServers).length),
        hasScientificReferences: Boolean(mentionedMcpServers?.some(name => ['paper-search', 'zotero', 'papers-rg'].includes(name)) || mentionedZoteroItems?.length || mentionedZoteroCollections?.length || zoteroAttachments?.length || mentionedEvidenceSets?.length),
        hasStickyWorkflow: Boolean(sessionMeta?.stickyCapabilityPackId),
      })

      let savedRuntimeProfile = sessionMeta?.runtimeProfile

      // 10. 构建 MCP 服务器配置 + 自定义工具
      // 注：OCR 走本机 PaddleOCR，不再需要往 Zotero MCP env 注入渠道凭据
      const mcpServers = runtimePolicy.includeWorkspaceContext ? await buildMcpServers(
        {
          eventBus: this.eventBus,
          authService: this.authService,
          isPythonRuntimeReady: this.isPythonRuntimeReady(),
          includeScientificServices: runtimePolicy.profile === 'research',
        },
        workspaceSlug,
        sessionId,
        {
          model: resolvedModel,
          baseUrl: endpoint.baseUrl,
          apiKey: endpoint.apiKey,
        },
      ) : {}

      // 合并外部注入的自定义 MCP 服务器（如飞书群聊工具）
      if (customMcpServers) {
        Object.assign(mcpServers, customMcpServers)
        console.log(`[Agent 编排] 已合并 ${Object.keys(customMcpServers).length} 个自定义 MCP 服务器`)
      }

      // Register after user/custom servers: these auto-allowed names must always
      // refer to our constrained host implementation, never a user-controlled server.
      const createImageTurn = createImageTurnFactory(sessionId, getConversationAttachmentsDir(sessionId), agentCwd, imageUserHistory)
      const imageAuthorization = new ImageTurnController(
        createImageTurn(inputMessageUuid, userMessage, input.imageEditReferenceId), createImageTurn,
        getAgentSessionSDKMessages(sessionId).flatMap(message => message.type === 'user' && 'uuid' in message && typeof message.uuid === 'string' ? [message.uuid] : []),
      )
      this.imageAuthorizations.set(sessionId, imageAuthorization)
      const imageGenerationAllowed = () => this.activeSessions.get(sessionId) === runGeneration && !planModeEntered && getPermissionMode() !== 'plan'
      // 自定义 MCP 不得占用宿主受限工具命名空间（未配置生图渠道时也清除）。
      delete mcpServers['asci-image']
      const imageServer = runtimePolicy.profile !== 'conversation' ? createImageGenerationMcpServer(sessionId, agentCwd, String(streamStartedAt), input.imageEditReferenceId, {
        getTurn: () => imageAuthorization.current,
        isExecutionAllowed: imageGenerationAllowed,
      }) : undefined
      if (imageServer) mcpServers['asci-image'] = imageServer as unknown as Record<string, unknown>
      if (runtimePolicy.profile !== 'conversation') mcpServers['asci-web'] = createPublicWebMcpServer() as unknown as Record<string, unknown>
      if (runtimePolicy.profile === 'coding') mcpServers['asci-project'] = createProjectHtmlMcpServer(agentCwd) as unknown as Record<string, unknown>

      // 11. 构建动态上下文和最终 prompt
      // 传入 sessionId 让 buildDynamicContext 注入 <session_paper_index>，
      // 支持 issue #90 同会话多轮检索增量补充。
      const dynamicCtx = runtimePolicy.includeWorkspaceContext ? buildDynamicContext({
        workspaceName: workspace?.name,
        workspaceSlug,
        agentCwd,
        sessionId,
      }) : ''

      // 11.5 注入 mention 引用指令（Skill/MCP）— 仅影响 prompt，不影响持久化
      let enrichedMessage = userMessage
      if (mentionedSkills?.length || mentionedMcpServers?.length) {
        const toolLines: string[] = ['用户在消息中明确引用了以下工具，请在本次回复中主动调用：']
        for (const slug of mentionedSkills ?? []) {
          const qualifiedName = workspaceSlug
            ? `asci-workspace-${workspaceSlug}:${slug}`
            : slug
          toolLines.push(`- Skill: ${qualifiedName}（请立即调用此 Skill）`)
        }
        for (const name of mentionedMcpServers ?? []) {
          toolLines.push(`- MCP 服务器: ${name}（请使用此 MCP 服务器的工具来完成任务）`)
        }
        enrichedMessage = `<mentioned_tools>\n${toolLines.join('\n')}\n</mentioned_tools>\n\n${userMessage}`
        console.log(`[Agent 编排] 注入 mentioned_tools: ${mentionedSkills?.length ?? 0} skills, ${mentionedMcpServers?.length ?? 0} MCP`)
      }

      // 11.6 注入 <zotero_attachments>（PDF 绝对路径，Agent 通过 Read 工具访问；
      //       先注入，让下一步 <zotero-context> 的指令包裹在外面，阅读顺序上下文在前）
      if (zoteroAttachments && zoteroAttachments.length > 0) {
        const refs = zoteroAttachments
          .map((a) => `- key=${a.itemKey} · 文件: ${a.filename} · 路径: ${a.path}`)
          .join('\n')
        const hint = '以上 key 对应 <zotero-context> 中同 key 的条目；如需全文，优先用 Read 读 PDF 路径，不必再通过 MCP 拉全文。'
        enrichedMessage = `<zotero_attachments>\n${refs}\n${hint}\n</zotero_attachments>\n\n${enrichedMessage}`
        console.log(`[Agent 编排] 注入 zotero_attachments: ${zoteroAttachments.length} 个（引用 Zotero storage 原路径，不复制）`)
      }

      // 11.7 注入 <zotero-context>（条目 + 类目引用；包裹在 zotero_attachments 外层）
      const zoteroBlock = buildZoteroContextBlock(mentionedZoteroItems, mentionedZoteroCollections)
      if (zoteroBlock) {
        enrichedMessage = `${zoteroBlock}\n\n${enrichedMessage}`
        console.log(`[Agent 编排] 注入 zotero-context: ${mentionedZoteroItems?.length ?? 0} items, ${mentionedZoteroCollections?.length ?? 0} collections`)
      }

      // 11.7.1 注入 <evidence-set-context>（证据集内容 inline 序列化）
      //   证据集没有 Agent 可调的工具，必须把内容（动机 / 成员 / 逐字引文）直接 inline，
      //   按 id 查 detail（过滤查不到的）后交给纯函数序列化（issue #449）。
      if (mentionedEvidenceSets && mentionedEvidenceSets.length > 0) {
        const objectsDb = getDb()
        const details = mentionedEvidenceSets
          .map((m) => queryEvidenceSetDetail(objectsDb, m.id as ObjectId))
          .filter((d): d is NonNullable<typeof d> => d !== null)
        const evidenceBlock = buildEvidenceSetContextBlock(details)
        if (evidenceBlock) {
          enrichedMessage = `${evidenceBlock}\n\n${enrichedMessage}`
          console.log(`[Agent 编排] 注入 evidence-set-context: ${details.length}/${mentionedEvidenceSets.length} 个证据集`)
        }
      }

      // 11.8 注入 user turn 前置语言锁（除 anthropic native 外的所有 Anthropic-compat provider 生效）
      // anthropic 渠道豁免：Claude 服从 system prompt Output Language directive，无需注入，避免 prompt cache 失效。
      // 其他 provider（DeepSeek / Kimi / Moonshot / MiniMax / OpenRouter / 未来新增）均默认注入。
      // Forward-compat 黑名单语义详见 detect-message-language.ts。
      // 必须基于原始 userMessage 检测，避免被前面注入的英文 context 块污染。
      // 传入 lastResolvedUserLang 缓存，让"语言中立"输入（纯数字 / 列表序号）沿用上轮语言。
      // 注意：pin 不并入 enrichedMessage，而是在下方 contextualMessage 装配时置于绝对最前
      // （dynamicCtx 之前）——reasoning 语言强烈受 turn 最前部文字影响，英文 dynamicCtx
      // 挡在 pin 前面会让第一段 thinking 漂回英文（详见 docs/agent-sdk-integration.md Prompt 语言策略）。
      const cachedUserLang = this.lastResolvedUserLang.get(sessionId)
      const resolvedOutputLang = detectOutputLanguage(userMessage, getLanguage(), cachedUserLang)
      this.lastResolvedUserLang.set(sessionId, resolvedOutputLang)
      const languagePin = buildUserTurnLanguagePin(channel?.provider, resolvedOutputLang)
      // 尾部贴脸锚：放在用户消息之后、离第一段 thinking 生成点最近的位置（compat provider
      // 只对最近一次锚点稳定服从；第一段 thinking 在所有 tool_result 之前，PostToolUse 保护不到）。
      const languageTailAnchor = buildUserTurnLanguageTailAnchor(channel?.provider, resolvedOutputLang)
      if (languagePin) {
        console.log(`[Agent 编排] 注入 user turn 语言锁（前置 pin + 尾部锚）: provider=${channel?.provider}, lang=${resolvedOutputLang}`)
      }

      // 11.8.1 向 UI 发布本轮已解析的输出语言（H3：渲染端语言锁徽标 / 漂移检测）
      // 即使没注入 pin，UI 也需要知道当前 turn 的 expectedLanguage 才能识别漂移。
      this.eventBus.emit(sessionId, {
        kind: 'asci_event',
        event: { type: 'resolved_language', language: resolvedOutputLang },
      })

      // 语言锁三明治：前置 pin 在 turn 绝对最前，尾部锚在用户消息之后（最贴近生成点）；
      // session-not-found 恢复路径（prepareSessionNotFoundRecovery）用 contextualMessage
      // 重建 prompt，两道锚在此装配即自动随之保留。
      const retained = readContextRecord(sessionId)
      if (input.imageEditReferenceId) enrichedMessage = `The user selected this exact image version for editing: ${JSON.stringify(input.imageEditReferenceId)}. Use it as baseImageId; do not substitute latest or another version. Only generate after the user's edit request.\n\n${enrichedMessage}`
      const contextualMessage = [languagePin, dynamicCtx, retainedContextPrompt(retained.pins), enrichedMessage, languageTailAnchor]
        .filter((part): part is string => Boolean(part))
        .join('\n\n')

      const isCompactCommand = userMessage.trim() === '/compact'
      const finalPrompt = isCompactCommand
        ? compactCommand(retained.pins)
        : existingSdkSessionId
          ? contextualMessage
          : buildContextPrompt(sessionId, contextualMessage, { agentCwd })

      if (existingSdkSessionId) {
        console.log(`[Agent 编排] 使用 resume 模式，SDK session ID: ${existingSdkSessionId}`)
      } else if (finalPrompt !== contextualMessage) {
        console.log(`[Agent 编排] 无 resume，已回填历史上下文（最近 ${MAX_CONTEXT_MESSAGES} 条消息）`)
      }

      // 12. 读取应用设置 + 获取权限模式
      const appSettings = getSettings()
      const initialPermissionMode: ASCIPermissionMode = permissionModeOverride
        ?? (workspaceSlug
          ? getWorkspacePermissionMode(workspaceSlug)
          : (appSettings.agentPermissionMode ?? 'acceptEdits'))
      // 注册到 Map，支持运行中动态切换
      this.sessionPermissionModes.set(sessionId, initialPermissionMode)
      console.log(`[Agent 编排] 权限模式: ${initialPermissionMode}${permissionModeOverride ? '（外部覆盖）' : ''}`)

      /** 读取当前会话的实时权限模式（支持运行中切换） */
      const getPermissionMode = (): ASCIPermissionMode =>
        this.sessionPermissionModes.get(sessionId) ?? initialPermissionMode
      const hardRuleContext: HardRuleContext = {
        cwd: agentCwd,
        workspaceRoot: workspaceSlug ? getAgentWorkspacePath(workspaceSlug) : agentCwd,
        homeDir: homedir(),
      }
      permissionService.setSessionHardRuleContext(sessionId, hardRuleContext)

      // ExitPlanMode 拦截器：plan 模式下走 UI 审批流程
      const handleExitPlanMode = (toolInput: Record<string, unknown>, signal: AbortSignal): Promise<ExitPlanPermissionResult> => {
        return exitPlanService.handleExitPlanMode(
          sessionId,
          toolInput,
          signal,
          (request: ExitPlanModeRequest) => {
            this.eventBus.emit(sessionId, { kind: 'asci_event', event: { type: 'exit_plan_mode_request', request } })
          },
        )
      }

      // 始终创建 acceptEdits 权限回调（运行中可能切换到 acceptEdits）
      const acceptEditsCanUseTool = permissionService.createCanUseTool(
        sessionId,
        (request: PermissionRequest) => {
          this.eventBus.emit(sessionId, { kind: 'asci_event', event: { type: 'permission_request', request } })
        },
        (sid, toolInput, signal, sendAskUser) => askUserService.handleAskUserQuestion(sid, toolInput, signal, sendAskUser),
        (request: AskUserRequest) => {
          this.eventBus.emit(sessionId, { kind: 'asci_event', event: { type: 'ask_user_request', request } })
        },
        imageAuthorization,
      )

      /**
       * 判断 Bash 命令是否是只读的（计划模式下安全可执行）
       * 检测写操作特征：文件重定向、破坏性命令、包管理写操作、git 写操作等
       */
      const isBashCommandReadOnly = (command: string): boolean => {
        // 输出重定向：匹配未被数字或 & 前置的 > 符号（排除 2>/dev/null、&> 等 fd 重定向）
        if (/(?<![0-9&])>/.test(command)) return false
        // 破坏性文件操作
        if (/\b(rm|rmdir)\s/.test(command)) return false
        if (/\bsed\s+[^|&;]*-i/.test(command)) return false  // sed -i 原地编辑
        if (/\b(chmod|chown|chattr|truncate)\s/.test(command)) return false
        if (/\b(mv|cp)\s/.test(command)) return false
        if (/\b(mkdir|touch|mktemp)\s/.test(command)) return false
        // 包管理器写操作
        if (/\b(npm|pnpm|yarn|bun)\s+(install|i\b|add|remove|uninstall|update|upgrade|link|unlink)\b/.test(command)) return false
        if (/\bpip[23]?\s+(install|uninstall|upgrade)\b/.test(command)) return false
        if (/\b(apt|apt-get|brew|yum|dnf)\s+(install|remove|purge|uninstall|upgrade)\b/.test(command)) return false
        // Git 写操作
        if (/\bgit\s+(commit|push|checkout\s+-[bB]|branch\s+-[mMdD]|merge\b|rebase\b|reset\b|stash\s+(drop|pop)\b|add\b|apply\b|cherry-pick\b)/.test(command)) return false
        // 进程控制
        if (/\b(kill|killall|pkill)\s/.test(command)) return false
        // 脚本执行（具有潜在副作用，如 node script.js / python main.py）
        if (/\b(node|python[23]?|ruby|perl|php)\s+[^-]/.test(command)) return false
        return true
      }

      /** Plan 模式是否已被 Agent 进入（初始 plan 模式时天然为 true，其他模式需 EnterPlanMode 触发） */
      let planModeEntered = initialPermissionMode === 'plan'

      const selectedTaskMode = input.taskMode
      // 动态 canUseTool：每次调用读取当前权限模式，支持运行中切换
      const canUseTool = async (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions): Promise<PermissionResult> => {
        const currentMode = getPermissionMode()
        const normalizedInput = toolName === 'AskUserQuestion' ? normalizeAskUserInput(input) : input

        if (denyLookupShellFallback(userMessage, selectedTaskMode, toolName, normalizedInput)) return { behavior: 'deny' as const, message: READ_ONLY_LOOKUP_REASON }

        // ── 参数校验守卫（所有模式、所有工具，优先于权限检查） ──
        const validationFailure = validateToolInput(toolName, normalizedInput)
        if (validationFailure) {
          console.warn(`[Agent 工具验证] 参数缺失: tool=${toolName}, mode=${currentMode}`)
          return validationFailure
        }

        // ── PDF document block 渠道兼容守卫（issue #74）──
        // 当前渠道（如 Moonshot / Kimi）不支持 SDK 把 PDF 注入为 type:"document" 块时，
        // Read .pdf 必发上游 500。拦截后让 Agent 走 mcp__pdf_parser__pdf_parse_batch
        // 解析为 parsed-papers/{itemKey}.txt，再用 Read 读 txt。
        // effectiveCapabilities 已在 runAgent 外层作用域提升，闭包捕获复用。
        if (
          shouldDenyReadForPdfDocumentBlock({
            toolName,
            input: normalizedInput,
            supportsPdfDocumentBlock: effectiveCapabilities.supportsPdfDocumentBlock,
          })
        ) {
          console.warn(
            `[canUseTool] Read on PDF denied: channel="${channel.name}" provider=${channel.provider}, file=${String(normalizedInput.file_path)}`,
          )
          return {
            behavior: 'deny' as const,
            message:
              `Reading PDF files via the Read tool is not supported on the current channel ` +
              `(provider=${channel.provider}). The upstream endpoint rejects PDF document content blocks (HTTP 500). ` +
              `Use the \`mcp__pdf_parser__pdf_parse_batch\` MCP tool instead. ` +
              `Call shape: \`{ items: [{ itemKey: "<unique-string-for-this-pdf>", pdfPath: "${String(normalizedInput.file_path)}" }] }\`. ` +
              `The tool writes parsed text to \`parsed-papers/{itemKey}.txt\` inside the workspace and returns each result's textPath; ` +
              `after it returns, call \`Read\` on the returned textPath to read the extracted text. ` +
              `For non-PDF files, Read works normally.`,
          }
        }

        // ── Write 大文件 token 截断防护 ──
        if (toolName === 'Write' && typeof normalizedInput.content === 'string') {
          const estimatedTokens = estimateTokenCount(normalizedInput.content)
          if (estimatedTokens > WRITE_CONTENT_TOKEN_THRESHOLD) {
            console.warn(
              `[Agent 工具验证] Write 内容过大: tokens≈${estimatedTokens}, chars=${normalizedInput.content.length}, file=${String(normalizedInput.file_path)}`,
            )
            return {
              behavior: 'deny' as const,
              message:
                `The content for Write tool (~${estimatedTokens} estimated tokens, ${normalizedInput.content.length} chars) is too large and may be truncated. ` +
                `Please split the write into smaller sequential steps: write the first portion of the file now, then use Edit tool to append remaining sections incrementally.`,
            }
          }
        }

        // ── EnterPlanMode / ExitPlanMode 处理 ──

        // 完全自动模式：透明化（用户选择了完全信任 Agent）
        if (currentMode === 'bypassPermissions' && (toolName === 'EnterPlanMode' || toolName === 'ExitPlanMode')) {
          return { behavior: 'allow' as const, updatedInput: normalizedInput }
        }

        // ExitPlanMode：只有 Agent 确实进入过 Plan 模式才走审批，否则静默放行
        if (toolName === 'ExitPlanMode') {
          console.log(`[canUseTool] ExitPlanMode: signal.aborted=${options.signal.aborted}, planModeEntered=${planModeEntered}, mode=${currentMode}`)
          if (!planModeEntered) {
            return { behavior: 'allow' as const, updatedInput: normalizedInput }
          }
          const result = await handleExitPlanMode(normalizedInput, options.signal)
          if (result.behavior === 'allow' && 'targetMode' in result && result.targetMode) {
            // 更新 Map，后续 canUseTool 调用使用新模式
            this.sessionPermissionModes.set(sessionId, result.targetMode)
            planModeEntered = false
            // 同步通知 SDK 侧切换权限模式
            if (this.adapter.setPermissionMode) {
              this.adapter.setPermissionMode(sessionId, toSdkPermissionMode(result.targetMode)).catch((err: unknown) => {
                console.warn(`[Agent 编排] SDK 权限模式切换失败:`, err)
              })
            }
          }
          return result
        }

        // EnterPlanMode：标记进入状态，通知渲染进程
        if (toolName === 'EnterPlanMode') {
          planModeEntered = true
          this.eventBus.emit(sessionId, { kind: 'asci_event', event: { type: 'enter_plan_mode', sessionId } })
          return { behavior: 'allow' as const, updatedInput: normalizedInput }
        }

        // AskUserQuestion：始终走交互式问答流程，不受权限模式影响
        if (toolName === 'AskUserQuestion') {
          return askUserService.handleAskUserQuestion(
            sessionId, normalizedInput, options.signal,
            (request: AskUserRequest) => {
              this.eventBus.emit(sessionId, { kind: 'asci_event', event: { type: 'ask_user_request', request } })
            },
          )
        }

        // 生图在所有权限模式下保持当前回合作用域，计划模式不可提前执行。
        if (toolName === 'mcp__asci-image__generate_image' && !imageGenerationAllowed()) return { behavior: 'deny', message: 'Image generation is unavailable in plan mode or an ended turn' }
        if (toolName === 'mcp__asci-image__generate_image' || toolName === 'mcp__asci-image__inspect_image' || toolName === 'mcp__asci-image__list_images') {
          return acceptEditsCanUseTool(toolName, normalizedInput, options)
        }

        // ── 普通工具的权限分派 ──

        switch (currentMode) {
          case 'bypassPermissions':
            return { behavior: 'allow' as const, updatedInput: normalizedInput }

          case 'plan': {
            // Plan 模式：只允许只读工具 + Write 到 .context/plan/ 目录
            if (PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
              return { behavior: 'allow' as const, updatedInput: normalizedInput }
            }
            // 允许 Write 到 .context/plan/ 目录（ASCI 自定义路径）
            // 以及 .context/ 下直接子文件 .md（SDK 生成的 plan 文件如 .context/<slug>.md）
            if (toolName === 'Write') {
              const filePath = typeof normalizedInput.file_path === 'string' ? normalizedInput.file_path : ''
              if (filePath.includes('.context/plan/')) {
                return { behavior: 'allow' as const, updatedInput: normalizedInput }
              }
              // SDK plan 文件：.context/<slug>.md — 仅允许直接子文件，防止 path traversal
              const ctxIdx = filePath.lastIndexOf('.context/')
              if (ctxIdx !== -1) {
                const afterCtx = filePath.substring(ctxIdx + '.context/'.length)
                if (afterCtx.endsWith('.md') && !afterCtx.includes('/') && !afterCtx.includes('..')) {
                  return { behavior: 'allow' as const, updatedInput: normalizedInput }
                }
              }
            }
            // Bash 工具：只读命令（find、grep、cat 等）允许执行，写操作拒绝
            if (toolName === 'Bash') {
              const command = typeof normalizedInput.command === 'string' ? normalizedInput.command : ''
              if (isBashCommandReadOnly(command)) {
                return { behavior: 'allow' as const, updatedInput: normalizedInput }
              }
              return { behavior: 'deny' as const, message: '计划模式下不允许执行写操作，请在计划审批通过后再执行' }
            }
            // MCP 工具（以 mcp__ 开头）允许调用（调研用）
            if (toolName.startsWith('mcp__')) {
              return { behavior: 'allow' as const, updatedInput: normalizedInput }
            }
            // 其余工具拒绝
            return { behavior: 'deny' as const, message: '计划模式下不允许执行写操作，请在计划审批通过后再执行' }
          }

          case 'acceptEdits':
            return acceptEditsCanUseTool(toolName, normalizedInput, options)

          default:
            return { behavior: 'allow' as const, updatedInput: normalizedInput }
        }
      }

      // 13. 构建 Adapter 查询选项
      // 检测用户选用的模型是否为 Claude 系列，决定 SubAgent 是否使用独立模型分层
      const claudeAvailable = (effectiveModelId || DEFAULT_CLAUDE_MODEL_ID).toLowerCase().includes('claude')
      // 用户未配置或配为 0 → 强制使用 DEFAULT_AGENT_MAX_TURNS 防止 SDK 默认无上限的循环调用
      // （参考 issue #140 #1 — skill 循环调用导致 token 损耗）
      const maxTurns = appSettings.agentMaxTurns && appSettings.agentMaxTurns > 0
        ? appSettings.agentMaxTurns
        : DEFAULT_AGENT_MAX_TURNS
      // resolvedOutputLang 已在 11.8 注入语言锁时计算（基于原始 userMessage）
      // Phase 3 A3: 在 builtin/skill/mcp seed 之前加载用户安装的 capability packs（reseed 模式）
      // 原因：builtin seed（优先级 0）可在 Registry 冲突策略中覆盖 pack 注册的同名 entry（优先级 2）
      //       Pack 内 skillRefs / mcpRefs 与 user-config 同名时，按优先级（user-config 1 > capability-pack 2）被覆盖
      // 普通聊天、Coding 和通用附件引用不加载科研子 Agent。
      if (!runtimePolicy.includeSubagents) {
        this.subagentRegistry.unregister(e => e.source === 'capability-pack' || e.source === 'builtin')
      }
      const modelNotices: Array<{agentName:string;alias:string;fallbackModelId:string;noClaudeActivated?:boolean}> = []
      if (runtimePolicy.includeSubagents) await loadCapabilityPacks(this.subagentRegistry, {
        language: resolvedOutputLang,
        // 非 Claude lead（deepseek/kimi 等）下丢弃 manifest 的 Claude model 别名，
        // 让 scenario / worker 子 Agent 继承 lead 模型（否则空参数 tool call，如 retrieve({})）。
        claudeAvailable,
        // Claude lead 下校验子 Agent model 别名家族是否在 channel 激活；未激活回退到 lead 具体 id
        // （effectiveModelId 已 reconcile，必为激活模型），并发 model_fallback_notice 提示用户。
        channel,
        leadModelId: effectiveModelId,
        onModelNotice: ({ agentName, alias, fallbackModelId, reason }) => {
          const noClaudeActivated = reason === 'no-claude-activated'
          console.warn(
            noClaudeActivated
              ? `[Agent 编排] channel "${channel?.name}" 无任何激活 Claude 模型（子 Agent "${agentName}" 需要 "${alias}"）`
              : `[Agent 编排] 子 Agent "${agentName}" 别名 "${alias}" 家族无激活模型，回退到 lead "${fallbackModelId}"`,
          )
          modelNotices.push({agentName,alias,fallbackModelId,...(noClaudeActivated?{noClaudeActivated:true}:{})})
        },
        // 把 master 已合成的全局 MCP dict 传给 loader，让它把 manifest.mcpRefs 内的 string
        // 名展开成完整 `{ [name]: McpServerConfig }` 形态注入 scenarioAgent.def.mcpServers，
        // 规避 SDK 对 sub-agent.mcpServers string-form lookup 的不确定性（F1 跟进，G1 修复）。
        globalMcpServers: mcpServers,
        // paper-search key 配置 → loader 为检索类 pack 注入"运行时数据源可用性"块，
        // 让 lit-search planner 知道 semantic key 配没配，从而能执行条件化选源规则。
        paperSearchEnv: loadPaperSearchEnv(),
      })

      if (modelNotices.length) {
        const first=modelNotices[0]!
        this.eventBus.emit(sessionId, {kind:'asci_event',event:{
          type:'model_fallback_notice',agentName:first.agentName,
          requestedFamily:[...new Set(modelNotices.map(n=>n.alias))].join(' / '),
          fallbackModelId:first.fallbackModelId,agentCount:modelNotices.length,
          ...(modelNotices.some(n=>n.noClaudeActivated)?{noClaudeActivated:true}:{}),
        }})
      }

      // G3 文件式同步：把 registry 的 scenario Agent 同时写到 `<cwd>/.claude/agents/<name>.md`。
      // SDK npm options.agents 被 claude binary CLI 在 Agent tool dispatch 路径里忽略；
      // claude binary 只查文件式 `.claude/agents/`，必须双轨写入才能让 master 派发命中。
      // 详见 emit-filesystem-agents.ts 顶部 doc。
      //
      // G5 修复：sub-agent dispatch 时是另一个 claude subprocess 不继承父级 master mcpServers，
      // 文件式 frontmatter 又不支持 mcpServers 字段。按 Claude Code 项目级 MCP 约定写一份
      // `<cwd>/.mcp.json`，让 sub-agent subprocess 从 cwd 自动 load，scenario 子上下文也能
      // 调到 mcp__paper-search__* 等工具。详见 emit-mcp-config.ts 顶部 doc。
      if (agentCwd && runtimePolicy.includeSubagents) {
        const scenariosForFs = this.subagentRegistry
          .list({ kind: 'subagent' })
          .filter((e): e is typeof e & { kind: 'subagent' } => e.kind === 'subagent')
          .map((e) => ({ name: e.name, def: e.def }))
        emitFilesystemAgents(scenariosForFs, agentCwd)
        emitMcpConfigFile(mcpServers, agentCwd)
        // G5 修复 v2：claude binary 默认不信任项目级 `.mcp.json`，trust dialog 在 SDK
        // 非交互模式下弹不出来。直接 patch ~/.claude.json 模拟用户已 trust，让
        // sub-agent subprocess 启动时能 load .mcp.json 里的 MCP server。
        markClaudeProjectTrusted({
          cwd: agentCwd,
          mcpServerNames: Object.keys(mcpServers),
        })
      }

      // A4 phase4：解析当前 session 的粘滞能力包信息，注入到 master system prompt 作为路由优先信号。
      // 顺序约束：必须在 loadCapabilityPacks 之后，registry 才能查到 pack 注册的 scenarioAgent。
      // sessionMeta.stickyCapabilityPackId 由 IPC 层在意图切换时清空；本处仅读不写。
      let stickyCapabilityPack: StickyCapabilityPackInfo | undefined
      const stickyPackId = sessionMeta?.stickyCapabilityPackId
      if (stickyPackId) {
        const packEntries = this.subagentRegistry.list({
          kind: 'subagent',
          source: 'capability-pack',
          packId: stickyPackId,
        })
        const scenarioEntry = packEntries[0]
        if (scenarioEntry && scenarioEntry.kind === 'subagent') {
          stickyCapabilityPack = {
            packId: stickyPackId,
            scenarioAgentName: scenarioEntry.name,
            scenarioAgentDescription: scenarioEntry.def.description ?? '',
          }
        } else {
          console.warn(`[Agent 编排] stickyCapabilityPackId=${stickyPackId} 在 registry 中找不到对应 scenario Agent；跳过注入`)
        }
      }

      // 先决议 master allowedTools（A0 ② Phase 1：仅 acceptEdits / plan 模式设置；其他模式 SDK 默认全开）
      const masterAllowedTools = resolveMasterAllowedTools({ permissionMode: initialPermissionMode })

      // 上下文预算追踪：主循环 usage 跨阈值时经 PostToolUse additionalContext 注入
      // 省上下文提醒（检索优先 / 禁全文精读）；见 context-budget.ts 头注释。
      // 种子窗口按模型推断（与渲染层 ContextUsageBadge 同源）——非 Anthropic 渠道 SDK 不回传
      // contextWindow，缺省会被当成 200k，使 1M 窗口模型的阈值与 dev 用量分母都失真。
      const contextBudget = createContextBudgetTracker(inferModelContextWindow(resolvedModel, channel.provider))

      let retentionNeedsReinjection = false
      const queryOptions: ClaudeAgentQueryOptions = {
        sessionId,
        inputMessageUuid,
        onUserMessageConsumed: message => {
          if (imageAuthorization.consume(message)) permissionService.clearSessionPending(sessionId)
        },
        prompt: finalPrompt,
        model: effectiveModelId || DEFAULT_CLAUDE_MODEL_ID,
        cwd: agentCwd,
        sdkCliPath: cliPath,
        executable: agentExec,
        executableArgs,
        env: sdkEnv,
        maxTurns,
        sdkPermissionMode: runtimePolicy.profile === 'coding' && initialPermissionMode === 'acceptEdits'
          ? 'acceptEdits' : toSdkPermissionMode(initialPermissionMode),
        ...(runtimePolicy.profile === 'coding' && initialPermissionMode === 'acceptEdits' ? { sandbox: codingSandbox(agentCwd) } : {}),
        // 当提供 canUseTool 回调时必须为 false，否则 CLI 同时收到
        // --allow-dangerously-skip-permissions 和 --permission-prompt-tool stdio
        // 两个矛盾的指令，导致 ExitPlanMode/AskUserQuestion 等交互式工具失败。
        // canUseTool 已完整处理所有权限模式（plan/acceptEdits/bypassPermissions），
        // Worker 子代理在 bypassPermissions 模式下也会被自动放行。
        allowDangerouslySkipPermissions: !canUseTool,
        canUseTool,
        hooks: {
          PostCompact: [{ hooks: [async (hookInput) => {
            if (hookInput.hook_event_name !== 'PostCompact') return {}
            retentionNeedsReinjection = true
            const record = readContextRecord(sessionId)
            writeContextRecord(sessionId, { ...record, status: 'complete', error: undefined, report: {
              summary: hookInput.compact_summary, completedAt: Date.now(), trigger: hookInput.trigger, beforeTokens: input.contextBeforeTokens,
            } })
            return {}
          }] }],
          PreCompact: [{ hooks: [async () => {
            const record = readContextRecord(sessionId)
            writeContextRecord(sessionId, { ...record, status: 'working', error: undefined })
            return {}
          }] }],
          PreToolUse: [{
            matcher: '*',
            hooks: [
              createLookupShellGuard(userMessage, selectedTaskMode),
              async hookInput => {
                if (hookInput.hook_event_name === 'PreToolUse' && hookInput.tool_name === 'EnterPlanMode') planModeEntered = true
                return {}
              },
              permissionService.createPreToolUseHardRuleHookForSession(sessionId, {
                shouldAsk: () => getPermissionMode() !== 'bypassPermissions',
                confirmPaidImage: acceptEditsCanUseTool,
                imageGenerationAllowed,
              }),
            ],
          }],
          // PostToolUse：在每个 tool_result 之后追加 additionalContext，承载两类锚点：
          // ① 语言锁（H1）——对除 anthropic native 外的 Anthropic-compat provider 生效，
          //    anthropic 豁免（Claude 服从 system directive，避免 prompt cache 失效）；
          // ② 上下文预算提醒——主循环 usage 跨过 60%/80% 阈值时注入一次"检索优先 /
          //    禁全文精读"指令（所有 provider 生效，模型自身感知不到窗口余量）。
          // SDK 会把 additionalContext 拼接到 tool_result 之后，使其在模型继续生成
          // assistant text 前成为最近上下文锚点。两者皆空时返回空对象不产生噪声。
          PostToolUse: [{
            matcher: '*',
            hooks: [
              async (hookInput) => {
                if (hookInput.hook_event_name !== 'PostToolUse') return {}
                const languageLock = buildLanguageLockContext(channel?.provider, resolvedOutputLang)
                const budgetReminder = contextBudget.consumeReminder()
                if (budgetReminder) console.log(`[Agent 编排] 注入上下文预算提醒: ${budgetReminder.slice(0, 60)}...`)
                const pinnedContext = retentionNeedsReinjection ? retainedContextPrompt(readContextRecord(sessionId).pins) : ''
                retentionNeedsReinjection = false
                const additionalContext = [languageLock, budgetReminder, pinnedContext].filter(Boolean).join('\n\n')
                if (!additionalContext) return {}
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PostToolUse' as const,
                    additionalContext,
                  },
                }
              },
            ],
          }],
        },
        // A0 ② Phase 1：仅 acceptEdits / plan 模式显式设置 allowedTools；
        // default / bypassPermissions 返回 undefined，由 SDK 默认全开（保留 Phase 1 之前行为）。
        ...(masterAllowedTools !== undefined && { allowedTools: masterAllowedTools }),
        // claude_code preset 提供基础环境信息（platform/shell/OS/git/model/知识截止日期等）
        // buildSystemPrompt 追加 ASCI 特有指令（角色定义、SubAgent 策略、工作区信息、
        // Capability Pack Routing 含 live scenario agents 清单）
        runtimeProfile: runtimePolicy.profile,
        tools: runtimePolicy.tools,
        // Relay logs show unsupported server-side web_search_20250305. Host MCP
        // tools do not depend on a model vendor's server-tool implementation.
        ...(endpoint.baseUrl && !/^https:\/\/api\.anthropic\.com(?:\/|$)/i.test(endpoint.baseUrl ?? '') && { disallowedTools: ['WebSearch', 'WebFetch'] }),
        settingSources: runtimePolicy.includeWorkspaceContext ? ['project'] : [],
        systemPrompt: !runtimePolicy.includeWorkspaceContext && runtimePolicy.profile !== 'research'
          ? buildLeanSystemPrompt(runtimePolicy.profile, resolvedOutputLang, agentCwd)
          : {
          type: 'preset' as const,
          preset: 'claude_code' as const,
          append: buildSystemPrompt({
            workspaceName: workspace?.name,
            workspaceSlug,
            sessionId,
            permissionMode: initialPermissionMode,
            claudeAvailable,
            language: resolvedOutputLang,
            pdfDocumentBlockSupported: effectiveCapabilities.supportsPdfDocumentBlock,
            stickyCapabilityPack,
            registeredScenarioAgents: this.subagentRegistry
              .list({ kind: 'subagent' })
              .filter((e): e is typeof e & { kind: 'subagent' } => e.kind === 'subagent')
              .map<RegisteredScenarioAgent>((e) => ({
                name: e.name,
                description: e.def.description ?? '',
                source: e.source,
                ...(e.packId && { packId: e.packId }),
                ...(e.subAgentRefs && e.subAgentRefs.length > 0 && { subAgentRefs: e.subAgentRefs }),
              })),
          }) + taskModePrompt(input.taskMode),
        },
        resumeSessionId: existingSdkSessionId,
        // 回退后 resume：从指定消息处继续（SDK 在同一 JSONL 内创建分支）
        ...(rewindResumeAt && { resumeSessionAt: rewindResumeAt }),
        ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
        ...(workspaceSlug && runtimePolicy.includeWorkspaceContext && { plugins: [{ type: 'local' as const, path: getAgentWorkspacePath(workspaceSlug) }] }),
        // 合并用户附加目录 + 工作区附加目录 + 工作区文件目录 + Zotero storage 根
        ...(() => {
          // 隔离命令只写当前项目；引用目录不自动升级成额外可写目录。
          if (runtimePolicy.profile === 'coding' && initialPermissionMode === 'acceptEdits') return {}
          const allDirs = [...(additionalDirectories || [])]
          if (workspaceSlug) {
            // 工作区级附加目录
            const workspaceDirs = getWorkspaceAttachedDirectories(workspaceSlug)
            for (const dir of workspaceDirs) {
              if (!allDirs.includes(dir)) allDirs.push(dir)
            }
            // 工作区文件目录
            const wsFilesDir = getWorkspaceFilesDir(workspaceSlug)
            if (!allDirs.includes(wsFilesDir)) {
              allDirs.push(wsFilesDir)
            }
          }
          // 有 Zotero 附件时，按 attachment 的父目录（storage/{itemKey}）逐条加入白名单
          // ——只暴露本次 @ 的条目，不暴露整个 Zotero storage 根，缩小 Agent 访问面
          if (zoteroAttachments && zoteroAttachments.length > 0) {
            for (const a of zoteroAttachments) {
              const parent = dirname(a.path)
              if (!allDirs.includes(parent)) {
                allDirs.push(parent)
              }
            }
          }
          return allDirs.length > 0 ? { additionalDirectories: allDirs } : {}
        })(),
        // 启用文件检查点，支持 rewindFiles 回退
        enableFileCheckpointing: true,
        // SDK 0.2.52+ 固定使用 adaptive 思考模式
        thinking: { type: 'adaptive' } satisfies ThinkingConfig,
        // 会话透传优先 → 旧全局设置 → 兜底默认
        effort: effort ?? appSettings.agentEffort ?? DEFAULT_AGENT_EFFORT,
        ...(appSettings.agentMaxBudgetUsd != null && appSettings.agentMaxBudgetUsd > 0 && {
          maxBudgetUsd: appSettings.agentMaxBudgetUsd,
        }),
        // agents 由 SubagentRegistry 注入（A0 ③）；本次 runAgent 前先重新 seed builtin
        // 以反映当前 claudeAvailable 与 resolvedOutputLang —— 是否每次 reseed 由 Phase 2 的
        // A4 阶段重新审视（届时 language 切换走 master prompt 动态注入而非 reseed）
        agents: (() => {
          // 清掉所有 builtin entry（其他 source 不动）
          this.subagentRegistry.unregister((e) => e.source === 'builtin')
          if (runtimePolicy.includeSubagents) seedBuiltinSubagents(this.subagentRegistry, {
            claudeAvailable,
            language: resolvedOutputLang,
          })
          // Phase 2 A2: Skill metadata 镜像到 Registry，供 list({ kind: 'skill' }) 枚举
          if (workspaceSlug) {
            seedSkillsToRegistry(this.subagentRegistry, getAllWorkspaceSkills(workspaceSlug))
          }
          // Phase 2 A2: MCP metadata 镜像到 Registry，供 list({ kind: 'mcp' }) 枚举
          seedMcpServersToRegistry(this.subagentRegistry, composeMcpServers())
          return this.subagentRegistry.snapshot().agents
        })(),
        onStderr: (data: string) => {
          stderrChunks.push(data)
          // 分块可能切开凭据；本轮结束时聚合脱敏，再写日志和诊断文件。
        },
        onSessionId: (sdkSessionId: string) => {
          const sessionChanged = capturedSdkSessionId !== sdkSessionId
          capturedSdkSessionId = sdkSessionId
          if (sessionChanged || savedRuntimeProfile !== runtimePolicy.profile) {
            try {
              updateAgentSessionMeta(sessionId, { sdkSessionId, runtimeProfile: runtimePolicy.profile })
              savedRuntimeProfile = runtimePolicy.profile
              console.log(`[Agent 编排] 已保存 SDK session_id: ${sdkSessionId}`)
              // 验证保存是否成功
              const verifyMeta = getAgentSessionMeta(sessionId)
              console.log(`[Agent 编排] 验证读回: sdkSessionId=${verifyMeta?.sdkSessionId || '空'}`)
            } catch (err) {
              console.error(`[Agent 编排] 保存 SDK session_id 失败:`, err)
            }
          }

          // SDK 初始化完成后立即命名会话，使多会话并发时用户能快速区分
          if (!titleGenerationStarted) {
            titleGenerationStarted = true
            this.autoGenerateTitle(sessionId, userMessage, callbacks)
          }
        },
        onModelResolved: (model: string) => {
          resolvedModel = model
          console.log(`[Agent 编排] SDK 确认模型: ${resolvedModel}`)
          // 通知渲染进程更新流式状态中的模型信息
          this.eventBus.emit(sessionId, { kind: 'asci_event', event: { type: 'model_resolved', model } })
        },
        onContextWindow: (cw: number) => {
          console.log(`[Agent 编排] 缓存 contextWindow: ${cw}`)
          contextBudget.noteContextWindow(cw)
        },
      }

      console.log(`[Agent 编排] 开始通过 Adapter 遍历事件流...`)

      // 14. 遍历 Adapter 产出的 AgentEvent 流（含自动重试 + Watchdog 死锁检测）
      let lastRetryableError: string | undefined
      let retrySucceeded = false

      // Agent Teams 追踪
      const startedTaskIds = new Set<string>()
      const completedTaskIds = new Set<string>()
      const taskNotificationSummaries: TaskNotificationSummary[] = []
      /** 捕获到的 SDK session ID（用于 auto-resume 的 inbox 查找） */
      let capturedSdkSessionId = existingSdkSessionId
      /** Watchdog 触发标记（死锁被检测到时设为 true） */
      let abortedByWatchdog = false

      const queryStartedAt = nowMs()

      for (let attempt = 1; attempt <= MAX_AUTO_RETRIES + 1; attempt++) {
        // 非首次尝试：等待 + 发送重试事件到 UI
        if (attempt > 1) {
          const delayMs = getRetryDelayMs(attempt - 1)
          const delaySec = delayMs / 1000
          const attemptData: RetryAttempt = {
            attempt: attempt - 1,
            timestamp: nowMs(),
            reason: lastRetryableError ?? '未知错误',
            errorMessage: lastRetryableError ?? '',
            delaySeconds: delaySec,
          }

          this.eventBus.emit(sessionId, {
            kind: 'asci_event',
            event: { type: 'retry', status: 'starting', attempt: attempt - 1, maxAttempts: MAX_AUTO_RETRIES, delaySeconds: delaySec, reason: lastRetryableError ?? '未知错误' },
          })
          this.eventBus.emit(sessionId, {
            kind: 'asci_event',
            event: { type: 'retry', status: 'attempt', attemptData },
          })

          console.log(`[Agent 编排] 第 ${attempt - 1} 次重试，等待 ${delaySec}s...`)
          await new Promise((r) => setTimeout(r, delayMs))

          // 等待期间如果会话被中止，退出
          if (!this.activeSessions.has(sessionId)) {
            this.persistSDKMessages(sessionId, accumulatedMessages, nowMs() - queryStartedAt)
            callbacks.onComplete(getAgentSessionMessages(sessionId), { startedAt: streamStartedAt })
            return
          }
        }

        let shouldRetryFromError = false

        try {
          // 获取异步迭代器（手动 .next() 以支持 Promise.race 中断）
          // A0 ①：所有 SDK query 调用必须走 runOrchestratorQuery
          // agents 字段由 wrapper 从 subagentRegistry.snapshot() 注入（Step 7.2 已 reseed），
          // 这里显式剥离 queryOptions.agents 以满足 baseOptions: Omit<..., 'agents'> 类型约束
          if (attempt > 1) {
            queryOptions.inputMessageUuid = randomUUID()
            imageAuthorization.registerInputIdentity(queryOptions.inputMessageUuid)
          }
          const { agents: _agentsField, ...baseQueryOptions } = queryOptions
          console.log('[Agent 上下文]', JSON.stringify({
            profile: runtimePolicy.profile,
            ...measureRequestContext(
              typeof queryOptions.systemPrompt === 'string' ? queryOptions.systemPrompt : queryOptions.systemPrompt.append ?? '',
              String(queryOptions.prompt), Object.keys(mcpServers),
              runtimePolicy.includeSubagents ? Object.keys(this.subagentRegistry.snapshot().agents).length : 0,
            ),
          }))
          const queryIterable = runOrchestratorQuery({
            sessionId,
            registry: this.subagentRegistry,
            sink: this.subagentSpansSink,
            baseOptions: baseQueryOptions,
            adapter: this.adapter,
          })
          const queryIterator = queryIterable[Symbol.asyncIterator]()

          // Watchdog 控制器（用于死锁检测后中断事件循环）
          const loopAbort = new AbortController()
          abortedByWatchdog = false

          // 启动 Watchdog（每 5 秒检查是否所有 Worker 已 idle 但 Task 工具仍在等待）
          const WATCHDOG_INTERVAL_MS = 5_000
          const watchdogDone = (async () => {
            while (!loopAbort.signal.aborted) {
              await timerWithAbort(WATCHDOG_INTERVAL_MS, loopAbort.signal)
              if (loopAbort.signal.aborted) break

              // 仅在有 Worker 启动且未全部完成时检查
              if (
                startedTaskIds.size > 0 &&
                completedTaskIds.size < startedTaskIds.size &&
                capturedSdkSessionId
              ) {
                const allIdle = await areAllWorkersIdle(capturedSdkSessionId, startedTaskIds.size)
                if (allIdle) {
                  console.log(
                    `[Agent 编排] Watchdog: 所有 ${startedTaskIds.size} 个 Worker 已 idle，` +
                    `Task 工具仍在等待 — 中断以触发 auto-resume`,
                  )
                  abortedByWatchdog = true
                  loopAbort.abort()
                  break
                }
              }
            }
          })()

          // 手动事件循环：Promise.race（SDKMessage vs Watchdog 中断）
          let pendingNext: Promise<IteratorResult<SDKMessage>> | null = null
          // Teams 活跃时延迟 result 消息，避免前端提前标记 teammates 为 stopped
          let deferredResultMessage: SDKMessage | null = null
          // 本 turn 主 Agent 顶层 assistant 正文累积（issue #566 冗余 auto-resume 守门用）。
          // 必须在循环里实时累积：result 到达时 accumulatedMessages 会被持久化并清空。
          let topLevelAssistantText = ''
          let hasTopLevelOutput = false
          // 捕获 result.subtype 以传递给前端（用于区分 success/error_max_turns/error_max_budget_usd）
          let capturedResultSubtype: string | undefined
          let interruptedTurn = false
          // result 收到后的安全超时：adapter 层 channel.close() 应让 iterator 自然关闭，
          // 此 timeout 仅作安全网，防止极端情况下 iterator 仍未关闭
          let drainTimeoutPromise: Promise<'drain_timeout'> | null = null
          const RESULT_DRAIN_TIMEOUT_MS = 2_000

          // 工具事件兜底刷新：Agent 触发 Write/Edit/MultiEdit/NotebookEdit 或 Bash 时
          // 主动广播 WORKSPACE_FILES_CHANGED，独立于底层 chokidar，避免 watcher 漏事件
          // (issue #148)。本 Map 记录 tool_use_id → toolName，以便在收到对应 tool_result 时
          // 判断是否为 Bash（命令字符串解析过于脆弱，采取全量广播 + 200ms debounce 策略）
          const toolUseNameMap = new Map<string, string>()
          const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

          // issue #587 诊断：本 turn 最近一次 init 消息的 MCP 状态快照，
          // 供 "No such tool available" 哨兵命中时附带上下文落诊断 JSONL
          let mcpInitSnapshot: McpInitSnapshot | null = null

          while (!loopAbort.signal.aborted) {
            if (!pendingNext) {
              pendingNext = queryIterator.next()
            }

            const abortPromise = new Promise<null>((resolve) => {
              if (loopAbort.signal.aborted) { resolve(null); return }
              loopAbort.signal.addEventListener('abort', () => resolve(null), { once: true })
            })

            const racePromises: Array<Promise<{ kind: string; result: IteratorResult<SDKMessage> | null }>> = [
              pendingNext.then((r) => ({ kind: 'event' as const, result: r })),
              abortPromise.then(() => ({ kind: 'abort' as const, result: null })),
            ]
            if (drainTimeoutPromise) {
              racePromises.push(drainTimeoutPromise.then(() => ({ kind: 'drain_timeout' as const, result: null })))
            }

            const raceResult = await Promise.race(racePromises)

            if (raceResult.kind === 'drain_timeout') {
              // 安全网：channel.close() 后 SDK 仍未在超时内关闭 iterator，强制退出
              console.warn(`[Agent 编排] drain timeout: SDK iterator 在 result 后 ${RESULT_DRAIN_TIMEOUT_MS}ms 内未关闭，强制退出`)
              pendingNext?.catch(() => {})
              pendingNext = null
              queryIterator.return?.(undefined as never).catch(() => {})
              break
            }

            if (raceResult.kind === 'abort') {
              // Watchdog 触发：终止事件循环，但不中止 SDK 会话
              pendingNext?.catch(() => {})
              pendingNext = null
              const returnPromise = queryIterator.return?.(undefined as never).catch(() => {})
              await Promise.race([
                returnPromise,
                new Promise<void>((r) => setTimeout(r, 1000)),
              ])
              console.log(`[Agent 编排] Watchdog 中断：已退出事件循环`)
              break
            }

            const iterResult = raceResult.result
            if (!iterResult || iterResult.done) break

            pendingNext = null
            const msg = iterResult.value
            hasTopLevelOutput ||= hasAgentOutput(msg)

            // 上下文预算：喂入每条消息（内部只取主循环 assistant 的 usage；
            // compact_boundary 触发重置），供 PostToolUse hook 决定是否注入提醒
            contextBudget.observe(msg)
            if (msg.type === 'assistant') {
              const usage = (msg as { message?: { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } }).message?.usage
              const measuredTokens = measuredContextTokens(usage)
              const reportRecord = readContextRecord(sessionId)
              if (reportRecord.status === 'complete' && reportRecord.report && reportRecord.report.afterTokens === undefined && reportRecord.report.completedAt < streamStartedAt && !(msg as { isReplay?: boolean }).isReplay && !(msg as { parent_tool_use_id?: string }).parent_tool_use_id && measuredTokens !== undefined) {
                writeContextRecord(sessionId, { ...reportRecord, report: { ...reportRecord.report, afterTokens: measuredTokens } })
              }
            }


            // dev 观测：压缩边界上标记当前 contextWindow（分母）。
            // 分子 compact_metadata.pre_tokens 由 SDK 自带；渲染层 dev-only 显示 used/total 用量。
            // 在此处（emit / accumulate 之前）按引用标记，使实时与持久化两条路径都带上该值。
            if (msg.type === 'system' && (msg as { subtype?: string }).subtype === 'compact_boundary') {
              (msg as Record<string, unknown>)._contextWindow = contextBudget.getContextWindow()
            }

            // 检测 assistant 消息中的 SDK 错误
            if (msg.type === 'assistant') {
              const assistantMsg = msg as SDKAssistantMessage
              if (assistantMsg.error) {
                const { detailedMessage, originalError } = extractErrorDetails(assistantMsg as unknown as Parameters<typeof extractErrorDetails>[0])
                let errorCode = assistantMsg.error.errorType || 'unknown_error'
                if (isPromptTooLongError(detailedMessage, originalError)) {
                  errorCode = 'prompt_too_long'
                }
                const typedError = mapSDKErrorToTypedError(errorCode, friendlyErrorMessage(detailedMessage), originalError)

                // Session 不存在错误：清除 sdkSessionId，切换到上下文回填模式重试
                if (isSessionNotFoundError(detailedMessage, originalError) && existingSdkSessionId && attempt <= MAX_AUTO_RETRIES) {
                  existingSdkSessionId = undefined
                  lastRetryableError = this.prepareSessionNotFoundRecovery(sessionId, queryOptions, contextualMessage, agentCwd, accumulatedMessages, queryStartedAt)
                  shouldRetryFromError = true
                  break
                }

                // 判断是否可自动重试
                if (isAutoRetryableTypedError(typedError) && attempt <= MAX_AUTO_RETRIES) {
                  lastRetryableError = typedError.title
                    ? `${typedError.title}: ${typedError.message}`
                    : typedError.message
                  console.log(`[Agent 编排] 可重试错误 (assistant error): ${typedError.code} - ${lastRetryableError}`)
                  this.persistSDKMessages(sessionId, accumulatedMessages, nowMs() - queryStartedAt)
                  accumulatedMessages.length = 0
                  shouldRetryFromError = true
                  break
                }

                // 不可重试 → 终止
                this.persistSDKMessages(sessionId, accumulatedMessages, nowMs() - queryStartedAt)

                const errorContent = typedError.title
                    ? `${typedError.title}: ${typedError.message}`
                    : typedError.message
                const errorSDKMsg: SDKMessage = {
                  type: 'assistant',
                  message: {
                    content: [{ type: 'text', text: errorContent }],
                  },
                  parent_tool_use_id: null,
                  error: { message: typedError.message, errorType: typedError.code },
                  _createdAt: nowMs(),
                  _errorCode: typedError.code,
                  _errorTitle: typedError.title,
                  _errorDetails: typedError.details,
                  _errorCanRetry: typedError.canRetry,
                  _errorActions: typedError.actions,
                } as unknown as SDKMessage
                appendSDKMessages(sessionId, [errorSDKMsg])
                console.log(`[Agent 编排] 已保存 TypedError 消息: ${typedError.code} - ${typedError.title}`)
                console.log(`[Agent 编排] 错误详情: detailedMessage=${sanitizeProviderDiagnostic(detailedMessage, [apiKey, endpoint.apiKey])}`)
                console.log(`[Agent 编排] 原始错误: originalError=${sanitizeProviderDiagnostic(originalError, [apiKey, endpoint.apiKey])}`)

                // 如果之前有重试记录，发送 retry_failed
                if (attempt > 1 && lastRetryableError) {
                  this.eventBus.emit(sessionId, {
                    kind: 'asci_event',
                    event: { type: 'retry', status: 'failed', attemptData: { attempt: attempt - 1, timestamp: nowMs(), reason: lastRetryableError, errorMessage: typedError.message, delaySeconds: 0 } },
                  })
                }

                // 透传错误消息到前端
                this.eventBus.emit(sessionId, { kind: 'sdk_message', message: errorSDKMsg })
                // 清理 Watchdog
                if (!loopAbort.signal.aborted) loopAbort.abort()
                await watchdogDone
                try { updateAgentSessionMeta(sessionId, {}) } catch { /* 忽略 */ }
                callbacks.onComplete(getAgentSessionMessages(sessionId), { startedAt: streamStartedAt })
                return
              }
            }

            // 累积 assistant 和 user 消息用于持久化
            // - 跳过 replay 消息，避免 resume 时重复写入
            // - 对 user 消息，仅累积含 tool_result 的（初始用户消息已在步骤 5 手动持久化）
            // - 对 system 消息，仅累积 compact_boundary（上下文压缩分界线需要持久化显示）
            if (msg.type === 'assistant' || msg.type === 'user' || msg.type === 'result') {
              const msgRecord = msg as Record<string, unknown>
              if (!msgRecord.isReplay) {
                if (msg.type === 'user') {
                  // 仅累积包含 tool_result 的 user 消息（跳过 SDK 重新发出的初始用户消息）
                  const content = (msg as { message?: { content?: Array<{ type: string }> } }).message?.content
                  const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
                  if (hasToolResult) {
                    accumulatedMessages.push(msg)
                  }
                } else {
                  // 为 assistant 消息注入渠道 modelId，确保持久化后能正确匹配模型显示名
                  // 使用 effectiveModelId（已被 reconcile）而非原始 modelId，否则失效模型名仍会被持久化
                  if (msg.type === 'assistant' && effectiveModelId) {
                    (msg as Record<string, unknown>)._channelModelId = effectiveModelId
                  }
                  accumulatedMessages.push(msg)
                  // 累积主 Agent 顶层正文（子 Agent / replay 由 helper 过滤为空串）
                  topLevelAssistantText += extractTopLevelAssistantText(msg)
                }
              }
            } else if (msg.type === 'system') {
              const sysMsg = msg as import('@asci/shared').SDKSystemMessage
              if (sysMsg.subtype === 'compact_boundary') {
                accumulatedMessages.push(msg)
              } else if (sysMsg.subtype === 'init') {
                // issue #587 诊断：解析每 turn 的 MCP server 连接状态 + 工具表。
                // 此前该信息被完全忽略，server 连接失败只能靠下游
                // "No such tool available" 症状反推。
                const snapshot = parseMcpInitSnapshot(sysMsg, nowMs())
                if (snapshot) {
                  mcpInitSnapshot = snapshot
                  console.log(`[Agent 编排] MCP init 状态 (session=${sessionId}): ${formatMcpSnapshotSummary(snapshot)}`)
                  const unhealthy = listUnhealthyMcpServers(snapshot)
                  if (unhealthy.length > 0) {
                    console.warn(
                      `[Agent 编排] MCP server 非 connected (session=${sessionId}): ${unhealthy.map((s) => `${s.name}=${s.status}`).join(', ')}`,
                    )
                  }
                }
              }
            }

            // Turn 结束时：持久化累积消息
            if (msg.type === 'result') {
              capturedResultSubtype = (msg as { subtype?: string }).subtype
              this.persistSDKMessages(sessionId, accumulatedMessages, nowMs() - queryStartedAt)
              accumulatedMessages.length = 0
              // 遥测（#426 #427）：agent_task_completed 行为事件 + task_structure 信号。
              // 两路各自的 consent 闸门在 telemetry-service 内，关了对应 toggle 即全停。
              {
                const resultMsg = msg as {
                  subtype?: string
                  num_turns?: number
                  modelUsage?: Record<
                    string,
                    {
                      inputTokens?: number
                      outputTokens?: number
                      cacheReadInputTokens?: number
                      cacheCreationInputTokens?: number
                    }
                  >
                }
                const taskSucceeded = resultMsg.subtype === 'success'
                const taskDurationMs = Date.now() - streamStartedAt
                // token 总数取 modelUsage 按模型聚合后求和：含主 Agent 与所有子 Agent（Task 工具）
                const modelUsage = resultMsg.modelUsage
                const totalTokens =
                  modelUsage && Object.keys(modelUsage).length > 0
                    ? Object.values(modelUsage).reduce(
                        (sum, m) =>
                          sum +
                          (m.inputTokens ?? 0) +
                          (m.outputTokens ?? 0) +
                          (m.cacheReadInputTokens ?? 0) +
                          (m.cacheCreationInputTokens ?? 0),
                        0,
                      )
                    : undefined
                // 对话类型：重读最新粘滞能力包（本轮场景 Agent 收口写盘可能晚于 turn 起始快照），
                // 映射为受控枚举 search / review / other（详见 toConversationType）。
                const latestStickyPackId = getAgentSessionMeta(sessionId)?.stickyCapabilityPackId
                telemetryService.track({
                  event: TELEMETRY_EVENTS.AGENT_TASK_COMPLETED,
                  props: {
                    success: taskSucceeded,
                    durationMs: taskDurationMs,
                    numTurns: resultMsg.num_turns,
                    resultSubtype: resultMsg.subtype,
                    modelId: effectiveModelId,
                    channelType: channel.provider,
                    totalTokens,
                    conversationType: toConversationType(latestStickyPackId),
                  },
                })
                evoCollector?.emitTaskResult({
                  numTurns: resultMsg.num_turns,
                  durationMs: taskDurationMs,
                  success: taskSucceeded,
                })
              }
              // 软中断（aborted_streaming / aborted_tools）场景下，adapter 保留 channel
              // 等待队列中的后续用户消息继续 drive Query，此处跳过 drain 超时以免误关闭事件循环
              const resultTerminalReason = (msg as { terminal_reason?: string }).terminal_reason
              const isAbortedByInterrupt =
                resultTerminalReason === 'aborted_streaming' ||
                resultTerminalReason === 'aborted_tools'
              interruptedTurn ||= isAbortedByInterrupt
              if (!isAbortedByInterrupt && !drainTimeoutPromise) {
                // 启动 drain 超时安全网：adapter 层 channel.close() 应让 iterator 自然关闭，
                // 此处仅在极端情况下（如 SDK 版本不兼容）保护事件循环不无限挂起
                drainTimeoutPromise = new Promise((resolve) =>
                  setTimeout(() => resolve('drain_timeout'), RESULT_DRAIN_TIMEOUT_MS),
                )
              }
            }

            // 过滤 SDK 内部生成的 user 消息（如 Skill 展开文本），避免在前端渲染为用户消息
            // 仅允许含 tool_result 的 user 消息通过（这些是工具调用的响应，需要展示）
            // 初始用户消息已通过前端乐观注入显示，无需 SDK 重复推送
            let shouldEmit = true
            if (msg.type === 'user') {
              const content = (msg as { message?: { content?: Array<{ type: string }> } }).message?.content
              const hasToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result')
              if (!hasToolResult) {
                shouldEmit = false
              }
            }

            // 工具事件兜底刷新（issue #148）：扫描 tool_use / tool_result，
            // 命中写文件类工具或 Bash 时主动广播 WORKSPACE_FILES_CHANGED。
            // 跳过 replay（resume 重放历史消息）以避免误刷新。
            {
              const msgRecord = msg as Record<string, unknown>
              if (!msgRecord.isReplay) {
                if (msg.type === 'assistant') {
                  const content = (msg as { message?: { content?: Array<Record<string, unknown>> } }).message?.content
                  if (Array.isArray(content)) {
                    let shouldBroadcast = false
                    for (const block of content) {
                      if (block.type === 'tool_use' && typeof block.name === 'string') {
                        // 记录 id → name 以便后续 tool_result 判断
                        if (typeof block.id === 'string') {
                          toolUseNameMap.set(block.id, block.name)
                        }
                        if (FILE_WRITE_TOOLS.has(block.name)) {
                          shouldBroadcast = true
                        }
                      }
                    }
                    if (shouldBroadcast) {
                      broadcastWorkspaceFilesChanged()
                    }
                  }
                } else if (msg.type === 'user') {
                  const content = (msg as { message?: { content?: Array<Record<string, unknown>> } }).message?.content
                  if (Array.isArray(content)) {
                    let bashBroadcasted = false
                    for (const block of content) {
                      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
                        const toolName = toolUseNameMap.get(block.tool_use_id)
                        // 自进化 tool_usage 信号（#427）：只采工具名 + 成败，不采 input/output
                        if (toolName) {
                          evoCollector?.emitToolResult(toolName, block.is_error !== true)
                        }
                        if (toolName === 'Bash' && !bashBroadcasted) {
                          bashBroadcasted = true
                          broadcastWorkspaceFilesChanged()
                        }
                        // issue #587 哨兵：工具调用报 "No such tool available" →
                        // 连同本 turn MCP init 快照落诊断 JSONL（常驻回归探测器）
                        if (block.is_error === true) {
                          const missingTool = extractToolNotFoundName(extractToolResultText(block.content))
                          if (missingTool) {
                            const event = buildToolNotFoundEvent({
                              sessionId,
                              toolName: missingTool,
                              nowMs: nowMs(),
                              snapshot: mcpInitSnapshot,
                              toolInInitTable: mcpInitSnapshot ? snapshotHasTool(mcpInitSnapshot, missingTool) : null,
                            })
                            console.warn(
                              `[Agent 编排] 工具不可用哨兵命中 (session=${sessionId}): ${missingTool}，距 init ${event.elapsedSinceInitMs ?? '?'}ms，init 工具表含该工具=${event.toolInInitTable ?? '未知'}`,
                            )
                            appendSessionDiagnosticsEvent(sessionId, event)
                          }
                        }
                      }
                    }
                  }
                }
              }
            }

            // Agent Teams: 当有 teammate 活跃时，延迟 result 消息
            if (!shouldEmit) {
              // 跳过 SDK 内部 user 消息的前端推送
            } else if (msg.type === 'result' && startedTaskIds.size > 0) {
              console.log(`[Agent 编排] 延迟 result 消息（${startedTaskIds.size} 个 teammate 活跃）`)
              deferredResultMessage = msg
            } else {
              this.eventBus.emit(sessionId, { kind: 'sdk_message', message: msg })
            }

            // Agent Teams: 追踪 teammate 任务状态（从 system 消息中）
            if (msg.type === 'system') {
              const sysMsg = msg as import('@asci/shared').SDKSystemMessage
              if (
                sysMsg.subtype === 'task_started' &&
                sysMsg.task_id &&
                (sysMsg.task_type === 'local_agent' || sysMsg.task_type === 'remote_agent')
              ) {
                startedTaskIds.add(sysMsg.task_id)
              } else if (sysMsg.subtype === 'task_notification' && sysMsg.task_id) {
                completedTaskIds.add(sysMsg.task_id)
                if (sysMsg.summary) {
                  taskNotificationSummaries.push({
                    taskId: sysMsg.task_id,
                    status: (sysMsg.status as 'completed' | 'failed' | 'stopped') || 'completed',
                    summary: sysMsg.summary,
                    outputFile: sysMsg.output_file,
                  })
                }
              }
            }
          }

          // 清理 Watchdog（事件循环正常结束或被 Watchdog 中断）
          if (!loopAbort.signal.aborted) loopAbort.abort()
          await watchdogDone

          if (abortedByWatchdog) {
            console.log(`[Agent 编排] Watchdog 中断了事件循环，将触发 auto-resume`)
          }

          // 错误 break 触发了 → 继续循环
          if (shouldRetryFromError) {
            continue
          }

          // 用户中止和watchdog有各自收尾；正常流必须交付终态，不能默默恢复输入框。
          if (!abortedByWatchdog && this.activeSessions.has(sessionId)) {
            const failure = getAgentTurnFailure(capturedResultSubtype, hasTopLevelOutput, interruptedTurn)
            if (failure) throw new Error(failure)
          }

          // 正常完成 — 如果之前有重试，发送 retry_cleared
          if (attempt > 1) {
            this.eventBus.emit(sessionId, { kind: 'asci_event', event: { type: 'retry', status: 'cleared' } })
            console.log(`[Agent 编排] 重试成功，已在第 ${attempt} 次尝试后恢复`)
          }
          retrySucceeded = true

          // 15. 持久化 assistant 消息
          this.persistSDKMessages(sessionId, accumulatedMessages, nowMs() - queryStartedAt)

          // 16. Agent Teams Auto-Resume：teammates 完成后自动收集结果并汇总
          // issue #566：主 Agent 本 turn 已把最终回答作为顶层正文交付，且自然结束的
          // result.result 已包含它时，跳过这次「worker 完成后补总结」的冗余 auto-resume——
          // 否则会再补一条重复的短确认。watchdog 中断路径无自然 result（deferredResultMessage
          // 为 null）、非成功 result、本 turn 无顶层正文，均不跳过，不影响需 worker 完成后再汇总的任务。
          const skipRedundantResume = shouldSkipRedundantAutoResume({
            resultMessage: deferredResultMessage,
            topLevelText: topLevelAssistantText,
          })
          console.log(`[Agent 编排] Auto-resume 条件检查: startedTasks=${startedTaskIds.size}, sdkSession=${!!capturedSdkSessionId}, active=${this.activeSessions.has(sessionId)}, skipRedundant=${skipRedundantResume}`)
          if (skipRedundantResume) {
            console.log('[Agent 编排] 最终回答已作为顶层正文交付，跳过冗余 auto-resume（issue #566）')
          }
          if (!skipRedundantResume && startedTaskIds.size > 0 && capturedSdkSessionId && this.activeSessions.has(sessionId)) {
            console.log(`[Agent 编排] Agent Teams 检测到 ${startedTaskIds.size} 个 teammate，启动 auto-resume`)

            // 通知前端：正在收集 teammate 结果
            this.eventBus.emit(sessionId, {
              kind: 'asci_event',
              event: { type: 'waiting_resume', message: '正在收集 teammate 工作结果...' },
            })

            // 构造 resume prompt（优先 inbox，fallback 到 summaries）
            let resumePrompt: string | null = null

            const inboxInfo = await findTeamLeadInboxPath(capturedSdkSessionId)
            console.log(`[Agent 编排] Inbox 查找结果: ${inboxInfo ? `team=${inboxInfo.teamName}` : '未找到 team'}`)
            if (inboxInfo) {
              const unreadMessages = await pollInboxWithRetry(
                inboxInfo.inboxPath,
                INBOX_RETRY_CONFIG,
              )
              if (unreadMessages.length > 0) {
                await markInboxAsRead(inboxInfo.inboxPath)
                resumePrompt = formatInboxPrompt(unreadMessages)
                console.log(`[Agent 编排] 使用 ${unreadMessages.length} 条 inbox 消息构建 resume prompt`)
              }
            }

            // Fallback：用 task_notification summaries
            if (!resumePrompt && taskNotificationSummaries.length > 0) {
              console.log(`[Agent 编排] Inbox 为空，使用 ${taskNotificationSummaries.length} 条 task summaries 作为 fallback`)
              resumePrompt = formatSummaryFallbackPrompt(taskNotificationSummaries)
            }

            if (resumePrompt && this.activeSessions.has(sessionId)) {
              const resumeMessageId = randomUUID()
              this.eventBus.emit(sessionId, { kind: 'asci_event', event: { type: 'resume_start', messageId: resumeMessageId } })

              // 创建 resume 查询（使用相同的 SDK session ID）
              const resumeMessages: SDKMessage[] = []

              try {
                const resumeInputUuid = randomUUID()
                imageAuthorization.registerInputIdentity(resumeInputUuid)
                const { agents: _resumeAgentsField, ...baseResumeQueryOptions } = queryOptions
                const resumeOptions: Omit<ClaudeAgentQueryOptions, 'agents'> = {
                  ...baseResumeQueryOptions,
                  prompt: resumePrompt,
                  inputMessageUuid: resumeInputUuid,
                  resumeSessionId: capturedSdkSessionId,
                }

                // A0 ①：resume 路径也走 runOrchestratorQuery
                const resumeIterable = runOrchestratorQuery({
                  sessionId,
                  registry: this.subagentRegistry,
                  sink: this.subagentSpansSink,
                  baseOptions: resumeOptions,
                  adapter: this.adapter,
                })
                for await (const rawResumeMsg of resumeIterable) {
                  if (!this.activeSessions.has(sessionId)) break

                  const resumeMsg = normalizeProviderAuthenticationMessage(rawResumeMsg)
                  // 跳过 replay 消息，仅累积新产生的消息
                  const resumeMsgRecord = resumeMsg as Record<string, unknown>
                  if ((resumeMsg.type === 'assistant' || resumeMsg.type === 'user') && !resumeMsgRecord.isReplay) {
                    resumeMessages.push(resumeMsg)
                  } else if (resumeMsg.type === 'system' && (resumeMsg as import('@asci/shared').SDKSystemMessage).subtype === 'compact_boundary') {
                    resumeMessages.push(resumeMsg)
                  }
                  this.eventBus.emit(sessionId, { kind: 'sdk_message', message: resumeMsg })
                }

                // 持久化 resume 助手消息
                if (resumeMessages.length > 0) {
                  this.persistSDKMessages(sessionId, resumeMessages, nowMs() - queryStartedAt)
                }

                console.log(`[Agent 编排] Auto-resume 完成`)
              } catch (resumeError) {
                console.error('[Agent 编排] Auto-resume 失败:', sanitizeProviderDiagnostic(resumeError instanceof Error ? resumeError.message : String(resumeError), [apiKey, endpoint.apiKey]))
              }
            } else if (!resumePrompt) {
              console.log('[Agent 编排] 无可用的 resume 内容（inbox 和 summaries 均为空）')
            }
          }
          try { updateAgentSessionMeta(sessionId, {}) } catch { /* 忽略 */ }

          // 发射延迟的 result 消息（auto-resume 已完成，前端可安全处理）
          if (deferredResultMessage) {
            console.log(`[Agent 编排] 发射延迟的 result 消息`)
            this.eventBus.emit(sessionId, { kind: 'sdk_message', message: deferredResultMessage })
          }

          // Plan 模式：Agent 完成规划后注入"接受计划"建议
          if (initialPermissionMode === 'plan' && planModeEntered && this.activeSessions.has(sessionId)) {
            this.eventBus.emit(sessionId, {
              kind: 'sdk_message',
              message: { type: 'prompt_suggestion', suggestion: '请执行该计划' } as unknown as SDKMessage,
            })
            console.log(`[Agent 编排] Plan 模式：已注入计划确认建议`)
          }

          // 综述实体化 hook：
          //   1) cwd 模式（生产链路）：扫 session cwd 下 reviews/*.html，把本轮
          //      新增的 html 落到 reviews 表（body_path 直接指向 skill 原文件）。
          //      literature-review-result skill (v0.19.0+) 用 Write 工具落 html
          //      fragment 文件 → 这里捞。
          //   2) inline 模式（**扩展点 / 死代码兜底**）：扫 assistant 文本里
          //      的 <asci-review-artifact> 块。synthesizer SubAgent 的 contract
          //      已撤，当前无生产链路会触发它返回非 null；保留入口供未来某条
          //      新链路复用，开销近零。
          // 双通道并列触发；任意一边失败仅 warn 不影响 Agent 主路径，UI 仍走
          // mockup atom（本版 UI 零侵入）。
          console.log(
            `[review-persistence] orchestrator hook 触发: session=${sessionId} cwd=${agentCwd ?? '(none)'} userMessage="${userMessage.slice(0, 60)}${userMessage.length > 60 ? '…' : ''}"`,
          )
          // 1) cwd 模式
          if (agentCwd) {
            try {
              const cwdResults = persistReviewsFromSessionCwd(getDb(), {
                agentSessionId: sessionId,
                intent: userMessage,
                sessionCwd: agentCwd,
                runStartedAtMs: streamStartedAt,
              })
              for (const r of cwdResults) {
                console.log(
                  `[review-persistence] 🎉 cwd 模式 ${r.mode} review ${r.review.id} (title="${r.review.title}", session=${sessionId})`,
                )
                // review_generated 埋点（#426）：只采耗时与成功标记，不采标题/正文
                telemetryService.track({
                  event: TELEMETRY_EVENTS.REVIEW_GENERATED,
                  props: { success: true, durationMs: Date.now() - streamStartedAt },
                })
              }
            } catch (err) {
              console.warn(`[review-persistence] cwd 模式失败（不影响 Agent 主路径）:`, err)
            }
          } else {
            console.log(`[review-persistence] 跳过 cwd 模式：本 run 没有 agentCwd`)
          }
          // 1.5) searches/*.html 兜底包装：lit-search skill 直接 Write 裸 fragment，无
          //      persistence 链路 → 「用默认应用打开」/ Finder 双击 / 应用内另开窗口都丢 CSS。
          //      就地包成 self-contained 文档（与 reviews 共用 wrapper），幂等不重写。
          if (agentCwd) {
            try {
              wrapSearchReportsInCwd(agentCwd, streamStartedAt)
            } catch (err) {
              console.warn(`[search-html-wrapper] cwd 包装失败（不影响 Agent 主路径）:`, err)
            }
          }
          // 2) inline artifact 模式
          try {
            const finalMessages = getAgentSessionMessages(sessionId)
            const result = maybePersistReviewFromMessages(getDb(), {
              agentSessionId: sessionId,
              intent: userMessage,
              messages: finalMessages,
            })
            if (result) {
              console.log(
                `[review-persistence] 🎉 inline 模式 ${result.mode} review ${result.review.id} (title="${result.review.title}", session=${sessionId})`,
              )
            }
          } catch (err) {
            console.warn(`[review-persistence] inline 模式失败（不影响 Agent 主路径）:`, err)
          }

          // 发送完成信号
          callbacks.onComplete(getAgentSessionMessages(sessionId), { startedAt: streamStartedAt, resultSubtype: capturedResultSubtype })

          break  // 成功完成，退出重试循环

        } catch (error) {
          // 用户主动中止
          if (!this.activeSessions.has(sessionId)) {
            const wasStoppedByUser = this.stoppedBySessions.delete(sessionId)
            console.log(`[Agent 编排] 会话 ${sessionId} 已被用户中止`)
            this.persistSDKMessages(sessionId, accumulatedMessages, nowMs() - queryStartedAt)
            // 持久化中断状态到会话 meta
            try { updateAgentSessionMeta(sessionId, { stoppedByUser: wasStoppedByUser }) } catch { /* 会话可能已删除 */ }
            callbacks.onComplete(getAgentSessionMessages(sessionId), { stoppedByUser: wasStoppedByUser, startedAt: streamStartedAt })
            return
          }

          // 从 stderr 提取 API 错误
          const stderrOutput = stderrChunks.join('').trim()
          const apiError = extractApiError(stderrOutput)
          const rawErrorMessage = error instanceof Error ? error.message : ''
          const authenticationRejected = apiError?.statusCode === 401 || /\b401\b|authentication_error|unauthorized/i.test(`${stderrOutput} ${rawErrorMessage}`)

          // issue #74 安全网：5xx + 当前渠道不兼容 PDF document block → 抑制重试 + 友好提示
          const pdfBlockMisfire = isLikelyPdfDocumentBlockIncompatibility({
            statusCode: apiError?.statusCode,
            providerSupportsPdfDocumentBlock: effectiveCapabilities.supportsPdfDocumentBlock,
          })
          const pdfBlockMisfireUserMessage = pdfBlockMisfire
            ? t('errors.agentOrchestrator.pdfDocumentBlockRefused', {
                provider: channel.provider,
                statusCode: String(apiError?.statusCode ?? ''),
              })
            : undefined
          if (pdfBlockMisfire) {
            console.warn(
              `[Agent 编排] #74 安全网命中：provider=${channel.provider}, statusCode=${apiError?.statusCode}`,
            )
          }

          // Session 不存在错误：清除 sdkSessionId，切换到上下文回填模式重试
          if (isSessionNotFoundError(rawErrorMessage, stderrOutput) && existingSdkSessionId && attempt <= MAX_AUTO_RETRIES) {
            existingSdkSessionId = undefined
            lastRetryableError = this.prepareSessionNotFoundRecovery(sessionId, queryOptions, contextualMessage, agentCwd, accumulatedMessages, queryStartedAt)
            stderrChunks.length = 0
            continue  // 进入下一次 retry 循环
          }

          // 判断是否可重试（issue #74 安全网：misfire 时禁重试 — transcript 内仍含 PDF block，再发必再 500）
          if (!authenticationRejected && !pdfBlockMisfire && isAutoRetryableCatchError(apiError, rawErrorMessage) && attempt <= MAX_AUTO_RETRIES) {
            lastRetryableError = apiError
              ? `API Error ${apiError.statusCode}: ${apiError.message}`
              : (error instanceof Error ? error.message : '未知错误')
            console.log(`[Agent 编排] 可重试错误 (catch): ${lastRetryableError}`)
            // 自进化 error_event 信号（#427）：message 由 service 层脱敏 + 截断
            evoCollector?.emitError('agent_run', lastRetryableError, true)
            // 保存部分内容
            this.persistSDKMessages(sessionId, accumulatedMessages, nowMs() - queryStartedAt)
            accumulatedMessages.length = 0
            stderrChunks.length = 0
            continue  // 进入下一次 retry 循环
          }

          // 不可重试 — 走原有终止逻辑
          const errorMessage = authenticationRejected ? friendlyErrorMessage('HTTP 401') : error instanceof Error ? error.message : '未知错误'
          console.error(`[Agent 编排] 执行失败:`, authenticationRejected ? {code: 'provider_authentication', provider: channel.provider, status: 401} : sanitizeProviderDiagnostic(error instanceof Error ? error.message : String(error), [apiKey, endpoint.apiKey]))
          // 自进化 error_event 信号（#427）：不可重试错误形态
          evoCollector?.emitError('agent_run', errorMessage, false)

          // 保存已累积的部分内容
          if (accumulatedMessages.length > 0) {
            try {
              this.persistSDKMessages(sessionId, accumulatedMessages, nowMs() - queryStartedAt)
              console.log(`[Agent 编排] 已保存部分执行结果 (${accumulatedMessages.length} 条消息)`)
            } catch (saveError) {
              console.error('[Agent 编排] 保存部分内容失败:', saveError)
            }
          }

          console.log(`[Agent 编排] stderr 输出: ${sanitizeProviderDiagnostic(stderrOutput, [apiKey, endpoint.apiKey]) || '(空)'}`)
          if (apiError && !authenticationRejected) {
            console.log(`[Agent 编排] API 错误: statusCode=${apiError.statusCode}, message=${sanitizeProviderDiagnostic(apiError.message, [apiKey, endpoint.apiKey])}`)
          }

          let userFacingError: string
          if (authenticationRejected) {
            userFacingError = friendlyErrorMessage('HTTP 401')
          } else if (pdfBlockMisfireUserMessage) {
            userFacingError = pdfBlockMisfireUserMessage
          } else if (apiError) {
            userFacingError = friendlyErrorMessage(`API 错误 (${apiError.statusCode}):\n${sanitizeProviderDiagnostic(apiError.message, [apiKey, endpoint.apiKey])}`)
          } else {
            userFacingError = friendlyErrorMessage(errorMessage)
          }

          // 保存错误消息到 JSONL
          try {
            // 检测是否为 prompt too long 错误
            const isPromptTooLong = isPromptTooLongError(
              userFacingError,
              error instanceof Error ? (error.stack ?? error.message) : String(error),
              stderrOutput,
            )

            const errMsg: SDKMessage = {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: isPromptTooLong
                  ? '上下文过长：当前对话的上下文已超出模型限制，请压缩上下文或开启新会话'
                  : userFacingError }],
              },
              parent_tool_use_id: null,
              error: { message: userFacingError, errorType: isPromptTooLong ? 'prompt_too_long' : 'unknown_error' },
              _createdAt: nowMs(),
              _errorCode: isPromptTooLong ? 'prompt_too_long' : 'unknown_error',
              _errorTitle: isPromptTooLong ? '上下文过长' : '执行错误',
              _errorCanRetry: getResponseFailureMessage(errorMessage) !== null,
            } as unknown as SDKMessage
            appendSDKMessages(sessionId, [errMsg])
            console.log(`[Agent 编排] 已保存错误消息到 JSONL`)
          } catch (saveError) {
            console.error('[Agent 编排] 保存错误消息失败:', saveError)
          }

          // 如果之前有重试记录，发送 retry_failed
          if (attempt > 1 && lastRetryableError) {
            this.eventBus.emit(sessionId, {
              kind: 'asci_event',
              event: { type: 'retry', status: 'failed', attemptData: { attempt: attempt - 1, timestamp: nowMs(), reason: lastRetryableError, errorMessage: userFacingError, delaySeconds: 0 } },
            })
          }

          callbacks.onError(userFacingError)
          callbacks.onComplete(getAgentSessionMessages(sessionId), { startedAt: streamStartedAt })

          // 根据错误类型决定是否保留 sdkSessionId
          const shouldClearSession = !apiError || apiError.statusCode >= 500
          if (existingSdkSessionId && shouldClearSession) {
            try {
              updateAgentSessionMeta(sessionId, { sdkSessionId: undefined })
              console.log(`[Agent 编排] 已清除失效的 sdkSessionId`)
            } catch { /* 忽略 */ }
          } else if (existingSdkSessionId && !shouldClearSession) {
            console.log(`[Agent 编排] 保留 sdkSessionId (API 错误 ${apiError?.statusCode})`)
          }

          // IPC rejection 也只能携带友好认证提示，不能重新暴露原错误。
          throw authenticationRejected ? new Error(userFacingError) : error
        } finally {
          const safeDiagnostic = sanitizeProviderDiagnostic(stderrChunks.join(''), [apiKey, endpoint.apiKey])
          if (safeDiagnostic) {
            console.error(`[Agent SDK stderr] ${safeDiagnostic}`)
            appendSessionStderr(sessionId, safeDiagnostic)
          }
        }
      }

      // 重试循环结束（达到最大次数仍失败）
      if (!retrySucceeded && lastRetryableError) {
        this.eventBus.emit(sessionId, {
          kind: 'asci_event',
          event: { type: 'retry', status: 'failed', attemptData: { attempt: MAX_AUTO_RETRIES, timestamp: nowMs(), reason: lastRetryableError, errorMessage: `重试 ${MAX_AUTO_RETRIES} 次后仍然失败`, delaySeconds: 0 } },
        })

        // 保存错误消息
        const retryErrorContent = `重试 ${MAX_AUTO_RETRIES} 次后仍然失败: ${lastRetryableError}`
        const retryErrorSDKMsg: SDKMessage = {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: retryErrorContent }],
          },
          parent_tool_use_id: null,
          error: { message: retryErrorContent, errorType: 'unknown_error' },
          _createdAt: nowMs(),
          _errorCode: 'unknown_error',
          _errorTitle: '重试失败',
        } as unknown as SDKMessage
        appendSDKMessages(sessionId, [retryErrorSDKMsg])

        callbacks.onError(`重试 ${MAX_AUTO_RETRIES} 次后仍然失败: ${lastRetryableError}`)
        callbacks.onComplete(getAgentSessionMessages(sessionId), { startedAt: streamStartedAt })
      }

    } finally {
      // 兜底：将 debounce 窗口内未落盘的 subagent spans 强制写盘
      this.subagentSpansSink.flush()
      // 只在 generation 匹配时才清理，防止旧流的 finally 误删新流的注册
      if (this.activeSessions.get(sessionId) === runGeneration) {
        this.imageAuthorizations.get(sessionId)?.cancel()
        this.imageAuthorizations.delete(sessionId)
        this.activeSessions.delete(sessionId)
        this.sessionPermissionModes.delete(sessionId)
        this.queuedMessageUuids.delete(sessionId)
      }
      permissionService.clearSessionPending(sessionId)
      askUserService.clearSessionPending(sessionId)
      exitPlanService.clearSessionPending(sessionId)
    }
  }

  /**
   * 中止指定会话的 Agent 执行
   *
   * 先从 activeSessions 移除（供 sendMessage catch 块检测用户中止），
   * 再调用 adapter.abort() 中止底层 SDK 进程。
   */
  stop(sessionId: string): void {
    this.imageAuthorizations.get(sessionId)?.cancel()
    this.imageAuthorizations.delete(sessionId)
    permissionService.clearSessionPending(sessionId)
    this.activeSessions.delete(sessionId)
    this.sessionPermissionModes.delete(sessionId)
    this.lastResolvedUserLang.delete(sessionId)
    this.stoppedBySessions.add(sessionId)
    this.queuedMessageUuids.delete(sessionId)
    this.adapter.abort(sessionId)
    console.log(`[Agent 编排] 已中止会话: ${sessionId}`)
  }

  /** 检查指定会话是否正在处理中 */
  isActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId)
  }

  /**
   * 运行中动态切换会话的权限模式
   *
   * 同时更新 ASCI 侧（canUseTool 闭包读取的 Map）和 SDK 侧（query.setPermissionMode）。
   * 典型场景：用户在 Agent 运行中通过 PermissionModeSelector 切换模式。
   */
  async updateSessionPermissionMode(sessionId: string, mode: ASCIPermissionMode): Promise<void> {
    if (!this.activeSessions.has(sessionId)) return
    this.sessionPermissionModes.set(sessionId, mode)
    // 同步通知 SDK 侧
    if (this.adapter.setPermissionMode) {
      await this.adapter.setPermissionMode(sessionId, toSdkPermissionMode(mode))
    }
    console.log(`[Agent 编排] 运行中权限模式已切换: sessionId=${sessionId}, mode=${mode}`)
  }

  // ===== 快照回退 =====

  /**
   * 会话快照回退：薄包装，并发保护后委托给 executeRewind
   *
   * 主体逻辑见 agent-rewind.ts，独立模块便于无 electron 依赖单测。
   */
  async rewindSession(
    sessionId: string,
    assistantMessageUuid: string,
  ): Promise<RewindSessionResult> {
    if (this.activeSessions.has(sessionId)) {
      throw new Error('会话正在运行中，请停止后再回退')
    }
    return executeRewind(sessionId, assistantMessageUuid)
  }

  /** 中止所有活跃的 Agent 会话（应用退出时调用） */
  stopAll(): void {
    if (this.activeSessions.size === 0) return
    console.log(`[Agent 编排] 正在中止所有活跃会话 (${this.activeSessions.size} 个)...`)
    for (const [sessionId, authorization] of this.imageAuthorizations) {
      authorization.cancel()
      permissionService.clearSessionPending(sessionId)
    }
    this.imageAuthorizations.clear()
    this.adapter.dispose()
    this.activeSessions.clear()
    this.sessionPermissionModes.clear()
    this.lastResolvedUserLang.clear()
    this.queuedMessageUuids.clear()
  }

  // ===== 队列消息管理 =====

  /**
   * 流式追加消息
   *
   * 在 Agent 运行中注入用户消息到 SDK：打断（opts.interrupt）走 'now' 抢占，
   * 排队走 'next'（FIFO，当前 turn 结束后按序消费）。消息立即持久化到 JSONL。
   *
   * @returns 消息 UUID
   */
  async queueMessage(
    sessionId: string,
    text: string,
    _priority?: string,
    presetUuid?: string,
    opts?: { interrupt?: boolean },
  ): Promise<string> {
    if (!this.activeSessions.has(sessionId)) {
      throw new Error(`[Agent 编排] 会话未运行，无法追加消息: ${sessionId}`)
    }

    if (!this.adapter.sendQueuedMessage) {
      throw new Error('[Agent 编排] 当前适配器不支持流式追加消息')
    }

    const uuid = presetUuid || randomUUID()

    // 防重记录
    const uuids = this.queuedMessageUuids.get(sessionId) ?? new Set<string>()
    uuids.add(uuid)
    this.queuedMessageUuids.set(sessionId, uuids)

    // 构造 SDKUserMessage 并注入：打断走 'now' 抢占，排队走 'next'（FIFO）
    const sdkMessage = {
      type: 'user' as const,
      message: { role: 'user' as const, content: text },
      parent_tool_use_id: null,
      priority: resolveQueuePriority(opts?.interrupt),
      uuid,
      session_id: sessionId,
    }

    try {
      await injectQueuedImageMessage({
        controller: this.imageAuthorizations.get(sessionId), id: uuid, text,
        send: () => this.adapter.sendQueuedMessage!(sessionId, sdkMessage),
        interrupt: opts?.interrupt && this.adapter.interruptQuery ? async () => {
          try { await this.adapter.interruptQuery!(sessionId); return true }
          catch (error) { console.warn('[Agent 编排] 软中断失败（将继续追加消息）:', error); return false }
        } : undefined,
        onInterrupted: () => permissionService.clearSessionPending(sessionId),
      })
      console.log(`[Agent 编排] 追加消息已注入: sessionId=${sessionId}, uuid=${uuid}, interrupt=${!!opts?.interrupt}`)

      // 立即持久化到 JSONL
      const persistMsg: SDKMessage = {
        type: 'user',
        _imageQueued: true,
        uuid,
        message: {
          content: [{ type: 'text', text }],
        },
        parent_tool_use_id: null,
        _createdAt: nowMs(),
      } as unknown as SDKMessage
      appendSDKMessages(sessionId, [persistMsg])
    } catch (error) {
      uuids.delete(uuid)
      throw error
    }

    return uuid
  }
}
