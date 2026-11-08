import { isScopedProjectEdit } from './scoped-edit-permission.ts'
/**
 * Agent 权限服务
 *
 * 核心职责：
 * - 实现 canUseTool 回调（供 SDK query 使用）
 * - 管理 pending 权限请求（Promise + Map 模式）
 * - 维护会话级白名单
 * - 工具/命令分类判断
 *
 * 参考 Craft Agents OSS 的 Promise + Map 异步等待模式。
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type {
  ASCIPermissionMode,
  PermissionRequest,
  DangerLevel,
  AskUserRequest,
  HardRuleContext,
  HardRuleDecision,
  ImageAuthorization,
} from '@asci/shared'
import type {
  HookCallback,
  PreToolUseHookSpecificOutput,
} from '@anthropic-ai/claude-agent-sdk'
import {
  SAFE_TOOLS,
  IMAGE_GENERATION_TOOL,
  imageRequestKey,
  isDangerousCommand,
  hasDangerousStructure,
  evaluateHardRule,
  normalizeBashCommandForPermission,
  isSubagentToolUse,
  redactTextWithMatches,
  redactDeepWithMatches,
} from '@asci/shared'
import { buildToolPreview } from './tool-preview.ts'

/** SDK PermissionBehavior */
type PermissionBehavior = 'allow' | 'deny'

/** SDK PermissionUpdateDestination */
type PermissionUpdateDestination = 'userSettings' | 'projectSettings' | 'localSettings' | 'session' | 'cliArg'

/** SDK 权限规则值 */
interface PermissionRuleValue {
  toolName: string
  ruleContent?: string
}

/** SDK PermissionUpdate（匹配 SDK 0.2.63） */
export type PermissionUpdate = {
  type: 'addRules' | 'replaceRules' | 'removeRules'
  rules: PermissionRuleValue[]
  behavior: PermissionBehavior
  destination: PermissionUpdateDestination
} | {
  type: 'setMode'
  mode: string
  destination: PermissionUpdateDestination
} | {
  type: 'addDirectories' | 'removeDirectories'
  directories: string[]
  destination: PermissionUpdateDestination
}

/** SDK PermissionResult（匹配 SDK 0.2.63） */
export type PermissionResult = {
  behavior: 'allow'
  updatedInput?: Record<string, unknown>
  updatedPermissions?: PermissionUpdate[]
  toolUseID?: string
} | {
  behavior: 'deny'
  message: string
  interrupt?: boolean
  toolUseID?: string
}

/** canUseTool 回调的 options 参数（匹配 SDK CanUseTool） */
export interface CanUseToolOptions {
  signal: AbortSignal
  suggestions?: PermissionUpdate[]
  blockedPath?: string
  decisionReason?: string
  toolUseID: string
  agentID?: string
}

interface PreToolUseHardRuleHookOptions {
  shouldAsk?: () => boolean
  imageGenerationAllowed?: () => boolean
  /** 在 SDK 自动/跳过模式之前完成付费授权，返回最终决定，避免重复确认。 */
  confirmPaidImage?: (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult>
}

/** 待处理的权限请求 */
interface PendingPermission {
  resolve: (result: PermissionResult) => void
  request: PermissionRequest
  /** #710：raw 工具输入仅留 main，供 approve 后 resume SDK / 白名单归一化（不下发 renderer） */
  rawInput: Record<string, unknown>
}

/** 会话级白名单 */
interface SessionWhitelist {
  /** 总是允许的工具名（如 'Write', 'Edit'） */
  allowedTools: Set<string>
  /** 总是允许的完整 normalized Bash 命令 */
  allowedBashCommands: Set<string>
}

/**
 * Agent 权限服务
 *
 * 单例模式，管理所有会话的权限状态。
 */
export class AgentPermissionService {
  /** 待处理的权限请求 Map（requestId → PendingPermission） */
  private pendingPermissions = new Map<string, PendingPermission>()

  /** 会话级白名单 Map（sessionId → SessionWhitelist） */
  private sessionWhitelists = new Map<string, SessionWhitelist>()

  /** 会话级 hard rule 上下文 */
  private sessionHardRuleContexts = new Map<string, HardRuleContext>()

  constructor(private hardRuleContext: HardRuleContext = {
    cwd: process.cwd(),
    workspaceRoot: process.cwd(),
    homeDir: homedir(),
  }) {}

  setSessionHardRuleContext(sessionId: string, ctx: HardRuleContext): void {
    this.sessionHardRuleContexts.set(sessionId, ctx)
  }

  clearSessionHardRuleContext(sessionId: string): void {
    this.sessionHardRuleContexts.delete(sessionId)
  }

  private getHardRuleContext(sessionId: string): HardRuleContext {
    return this.sessionHardRuleContexts.get(sessionId) ?? this.hardRuleContext
  }

  createPreToolUseHardRuleHookForSession(
    sessionId: string,
    hookOptions: PreToolUseHardRuleHookOptions = {},
  ): HookCallback {
    return async (hookInput, toolUseID, options) => {
      if (hookInput.hook_event_name !== 'PreToolUse' || !hookInput.tool_name) return {}

      const toolInput = hookInput.tool_input && typeof hookInput.tool_input === 'object' && !Array.isArray(hookInput.tool_input)
        ? hookInput.tool_input as Record<string, unknown>
        : {}
      // 明确只处理宿主付费生图工具；任何失败都拒绝，不把授权失败降级为自动执行。
      if (hookInput.tool_name === IMAGE_GENERATION_TOOL && hookOptions.imageGenerationAllowed?.() === false) return {hookSpecificOutput: {hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Image generation is unavailable in plan mode or an ended turn'}}
      if (hookInput.tool_name === IMAGE_GENERATION_TOOL && hookOptions.confirmPaidImage) {
        if (!toolUseID) return {hookSpecificOutput: {hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Paid image call is missing its tool identity'}}
        try {
          const result = await hookOptions.confirmPaidImage(hookInput.tool_name, toolInput, {signal: options.signal, toolUseID})
          return {hookSpecificOutput: {hookEventName: 'PreToolUse', permissionDecision: result.behavior, permissionDecisionReason: result.behavior === 'allow' ? 'User approved this paid image call' : 'Paid image call was not approved'}}
        } catch {
          return {hookSpecificOutput: {hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Paid image approval failed'}}
        }
      }
      const ctx = this.getHardRuleContext(sessionId)
      const hardRule = evaluateHardRule(hookInput.tool_name, toolInput, ctx)
      if (hardRule.action === 'defer' || hardRule.action === 'allow') return {}
      if (hardRule.action === 'ask' && hookOptions.shouldAsk && !hookOptions.shouldAsk()) return {}

      const hookSpecificOutput: PreToolUseHookSpecificOutput = {
        hookEventName: 'PreToolUse',
        permissionDecision: hardRule.action,
        permissionDecisionReason: `${hardRule.ruleId}: ${hardRule.reason}`,
      }

      return {
        hookSpecificOutput,
      }
    }
  }

  /**
   * 创建 canUseTool 回调（仅 acceptEdits 模式使用）
   *
   * SDK 的 acceptEdits 模式自动处理文件编辑允许，仅在 SDK 认为需要确认时调用此回调。
   * 返回的函数签名匹配 SDK 的 CanUseTool 类型。
   */
  createCanUseTool(
    sessionId: string,
    sendToRenderer: (request: PermissionRequest) => void,
    askUserHandler?: (sessionId: string, input: Record<string, unknown>, signal: AbortSignal, sendToRenderer: (request: AskUserRequest) => void) => Promise<PermissionResult>,
    sendAskUserToRenderer?: (request: AskUserRequest) => void,
    imageAuthorization?: ImageAuthorization,
  ): (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult> {
    const imageCalls = new Map<string, { key: string; promise: Promise<PermissionResult> }>()
    const imageDecisions = new Map<string, Promise<PermissionResult>>()
    return async (toolName, input, options) => {
      if (options.signal.aborted) return { behavior: 'deny', message: 'Operation aborted' }
      // AskUserQuestion 拦截：委托给交互式问答服务
      if (toolName === 'AskUserQuestion' && askUserHandler && sendAskUserToRenderer) {
        return askUserHandler(sessionId, input, options.signal, sendAskUserToRenderer)
      }

      const allow = (): PermissionResult => ({ behavior: 'allow' as const, updatedInput: input })

      // 生图只读取宿主本回合授权；不进入 worker 或会话白名单的快捷分支。
      if (toolName === IMAGE_GENERATION_TOOL && imageAuthorization) {
        const decision = imageAuthorization.authorize(toolName, input, options.toolUseID)
        if (decision.action === 'deny') return { behavior: 'deny', message: decision.reason }
        const key = `${imageAuthorization.getScopeId?.() ?? ''}:${imageRequestKey(input)}`
        const previous = imageCalls.get(options.toolUseID)
        if (previous && previous.key !== key) return { behavior: 'deny', message: 'Image call identity changed its parameters' }
        if (previous) return previous.promise
        if (decision.action === 'allow') return allow()
        const duplicate = imageDecisions.get(key)
        if (duplicate) {
          imageCalls.set(options.toolUseID, { key, promise: duplicate })
          return duplicate
        }
        const hardRule = evaluateHardRule(toolName, input, this.getHardRuleContext(sessionId))
        const promise = this.requestPermission(sessionId, toolName, input, options, sendToRenderer, hardRule).then(result => {
          if (result.behavior !== 'allow' || options.signal.aborted) return { behavior: 'deny' as const, message: 'Image call was not approved' }
          imageAuthorization.approve(toolName, input, options.toolUseID)
          const approved = imageAuthorization.authorize(toolName, input, options.toolUseID)
          return approved.action === 'allow' ? allow() : { behavior: 'deny' as const, message: approved.reason }
        })
        imageDecisions.set(key, promise)
        imageCalls.set(options.toolUseID, { key, promise })
        return promise
      }

      const hardRule = evaluateHardRule(toolName, input, this.getHardRuleContext(sessionId))
      if (hardRule.action === 'deny') {
        return {
          behavior: 'deny' as const,
          message: `${hardRule.ruleId}: ${hardRule.reason}`,
        }
      }
      if (hardRule.action === 'allow') {
        return allow()
      }
      if (hardRule.action === 'ask') {
        return this.requestPermission(sessionId, toolName, input, options, sendToRenderer, hardRule)
      }

      // 智能编辑模式：当前目录内普通文件编辑免询问；硬规则已在上方执行。
      if (isScopedProjectEdit(toolName, input, this.getHardRuleContext(sessionId).cwd)) return allow()

      // Worker（子代理）的工具调用自动批准，避免 UI 等待导致超时死锁
      if (options.agentID) {
        return allow()
      }

      // 会话白名单检查（用户之前选择了"始终允许"）
      if (this.isWhitelisted(sessionId, toolName, input)) return allow()

      return this.requestPermission(sessionId, toolName, input, options, sendToRenderer)
    }
  }

  /**
   * 响应权限请求（由 IPC handler 调用）
   *
   * @returns 对应的 sessionId，用于向渲染进程发送 resolved 事件；未找到请求时返回 null
   */
  respondToPermission(requestId: string, behavior: 'allow' | 'deny', alwaysAllow: boolean): string | null {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return null

    const sessionId = pending.request.sessionId

    // "总是允许"选项：加入会话白名单
    if (alwaysAllow && behavior === 'allow' && pending.request.canAlwaysAllow !== false) {
      this.addToWhitelist(sessionId, pending.request.toolName, pending.rawInput)
    }

    // #710：resume SDK 用 main 留存的 rawInput（renderer 拿不到 raw，但 SDK 续跑拿到完整 input）
    pending.resolve(
      behavior === 'allow'
        ? { behavior: 'allow' as const, updatedInput: pending.rawInput }
        : { behavior: 'deny' as const, message: 'User denied this operation' }
    )
    this.pendingPermissions.delete(requestId)
    return sessionId
  }

  /**
   * 清除指定会话的所有待处理请求（会话结束或中止时调用）
   */
  clearSessionPending(sessionId: string): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      if (pending.request.sessionId === sessionId) {
        pending.resolve({ behavior: 'deny' as const, message: 'Session ended' })
        this.pendingPermissions.delete(requestId)
      }
    }
  }

  /**
   * 获取当前所有待处理的权限请求（用于渲染进程重载后恢复状态）
   */
  getPendingRequests(): PermissionRequest[] {
    return [...this.pendingPermissions.values()].map((p) => p.request)
  }

  /**
   * 清除指定会话的白名单（会话结束时调用）
   */
  clearSessionWhitelist(sessionId: string): void {
    this.sessionWhitelists.delete(sessionId)
    this.clearSessionHardRuleContext(sessionId)
  }

  // ===== 工具分类判断 =====

  /**
   * 判断工具/命令是否在会话白名单中
   */
  private isWhitelisted(sessionId: string, toolName: string, input: Record<string, unknown>): boolean {
    const whitelist = this.sessionWhitelists.get(sessionId)
    if (!whitelist) return false

    // 非 Bash 工具：检查工具名是否在白名单中
    if (toolName !== 'Bash') {
      return whitelist.allowedTools.has(toolName)
    }

    // Bash 工具：hard rule 已在白名单前执行，这里只做精确 normalized 命中。
    const command = typeof input.command === 'string' ? input.command : ''
    const normalizedCommand = normalizeBashCommandForPermission(command)
    return whitelist.allowedBashCommands.has(normalizedCommand)
  }

  /**
   * 将工具/命令加入会话白名单
   */
  private addToWhitelist(sessionId: string, toolName: string, input: Record<string, unknown>): void {
    const whitelist = this.getOrCreateWhitelist(sessionId)

    if (toolName !== 'Bash') {
      whitelist.allowedTools.add(toolName)
    } else {
      const command = typeof input.command === 'string' ? input.command : ''
      const normalizedCommand = normalizeBashCommandForPermission(command)
      if (normalizedCommand) {
        whitelist.allowedBashCommands.add(normalizedCommand)
      }
    }
  }

  /**
   * 获取或创建会话白名单
   */
  private getOrCreateWhitelist(sessionId: string): SessionWhitelist {
    const existing = this.sessionWhitelists.get(sessionId)
    if (existing) return existing

    const whitelist: SessionWhitelist = {
      allowedTools: new Set(),
      allowedBashCommands: new Set(),
    }
    this.sessionWhitelists.set(sessionId, whitelist)
    return whitelist
  }

  private requestPermission(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
    sendToRenderer: (request: PermissionRequest) => void,
    hardRule?: HardRuleDecision,
  ): Promise<PermissionResult> {
    if (options.signal.aborted) return Promise.resolve({ behavior: 'deny', message: 'Operation aborted' })
    const request = this.buildPermissionRequest(sessionId, toolName, input, options, hardRule)

    return new Promise<PermissionResult>((resolve) => {
      this.pendingPermissions.set(request.requestId, { resolve, request, rawInput: input })

      // 如果 signal 被中止，自动拒绝
      options.signal.addEventListener('abort', () => {
        if (this.pendingPermissions.has(request.requestId)) {
          this.pendingPermissions.delete(request.requestId)
          resolve({ behavior: 'deny' as const, message: 'Operation aborted' })
        }
      }, { once: true })
      sendToRenderer(request)
    })
  }

  /**
   * 构建权限请求对象
   */
  private buildPermissionRequest(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
    hardRule?: HardRuleDecision,
  ): PermissionRequest {
    // #710：command/description/descriptionI18n 仍下发 renderer（动作摘要 L0/L1），但须脱敏内嵌的
    // 凭证/路径/邮箱（命令里可能有 Bearer token、路径含用户名）；raw toolInput 整体改为脱敏 toolPreview。
    const command = toolName === 'Bash' && typeof input.command === 'string'
      ? redactTextWithMatches(input.command).value
      : undefined

    return {
      requestId: randomUUID(),
      sessionId,
      toolName,
      toolPreview: buildToolPreview(toolName, input),
      description: redactTextWithMatches(this.buildDescription(toolName, input)).value,
      descriptionI18n: redactDeepWithMatches(this.buildDescriptionI18n(toolName, input)).value,
      command,
      dangerLevel: this.assessDangerLevel(toolName, input),
      decisionReason: options.decisionReason,
      hardRuleId: hardRule?.ruleId,
      hardRuleReason: hardRule?.reason,
      canAlwaysAllow: hardRule?.action !== 'ask',
    }
  }

  /**
   * 生成人类可读的操作描述（主进程默认中文，仅作 i18n 缺失时的兜底）
   */
  private buildDescription(toolName: string, input: Record<string, unknown>): string {
    switch (toolName) {
      case 'Bash':
        return typeof input.command === 'string'
          ? `Run command: ${input.command.slice(0, 200)}`
          : 'Run Bash command'
      case 'Write':
        return typeof input.file_path === 'string'
          ? `Write file: ${input.file_path}`
          : 'Write file'
      case 'Edit':
        return typeof input.file_path === 'string'
          ? `Edit file: ${input.file_path}`
          : 'Edit file'
      case 'NotebookEdit':
        return typeof input.notebook_path === 'string'
          ? `Edit notebook: ${input.notebook_path}`
          : 'Edit notebook'
      // A0b 派发语义：SDK v2.1.63 前后 tool_use.name 为 'Task'/'Agent'，双名匹配
      default:
        if (isSubagentToolUse({ name: toolName })) {
          return typeof input.description === 'string'
            ? `Start subtask: ${input.description}`
            : 'Start subtask'
        }
        return `Use tool: ${toolName}`
    }
  }

  /**
   * 生成 i18n 描述，对应 renderer 端 conversation.banner.description.* 系列 key。
   * Renderer 优先用此结构翻译，缺失时回退 description 字段。
   */
  private buildDescriptionI18n(
    toolName: string,
    input: Record<string, unknown>,
  ): { key: string; params?: Record<string, unknown> } {
    switch (toolName) {
      case 'Bash':
        return typeof input.command === 'string'
          ? { key: 'banner.description.bash', params: { command: input.command.slice(0, 200) } }
          : { key: 'banner.description.bashGeneric' }
      case 'Write':
        return typeof input.file_path === 'string'
          ? { key: 'banner.description.write', params: { path: input.file_path } }
          : { key: 'banner.description.writeGeneric' }
      case 'Edit':
        return typeof input.file_path === 'string'
          ? { key: 'banner.description.edit', params: { path: input.file_path } }
          : { key: 'banner.description.editGeneric' }
      case 'NotebookEdit':
        return typeof input.notebook_path === 'string'
          ? { key: 'banner.description.notebookEdit', params: { path: input.notebook_path } }
          : { key: 'banner.description.notebookEditGeneric' }
      // A0b 派发语义：SDK v2.1.63 前后 tool_use.name 为 'Task'/'Agent'，双名匹配
      default:
        if (isSubagentToolUse({ name: toolName })) {
          return typeof input.description === 'string'
            ? { key: 'banner.description.task', params: { description: input.description } }
            : { key: 'banner.description.taskGeneric' }
        }
        return { key: 'banner.description.generic', params: { tool: toolName } }
    }
  }

  /**
   * 评估操作的危险等级
   */
  private assessDangerLevel(toolName: string, input: Record<string, unknown>): DangerLevel {
    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      if (isDangerousCommand(command)) return 'dangerous'
      if (hasDangerousStructure(command)) return 'normal'
      return 'normal'
    }

    // 文件写入操作默认为 normal
    if (['Write', 'Edit', 'NotebookEdit'].includes(toolName)) return 'normal'

    // A0b 派发语义：SDK v2.1.63 前后 tool_use.name 为 'Task'/'Agent'，双名匹配
    if (isSubagentToolUse({ name: toolName })) return 'normal'

    return 'normal'
  }
}

/** 全局权限服务实例 */
export const permissionService = new AgentPermissionService()
