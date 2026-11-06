/**
 * AgentOrchestrator 工具函数集合
 *
 * 从 agent-orchestrator.ts 拆出的自包含纯工具函数（无 this / 实例状态依赖）：
 * - 错误解析与自动重试判定（extractApiError / isAutoRetryable* / isSessionNotFoundError / getRetryDelayMs）
 * - 可中断定时器（timerWithAbort）
 * - SDK 可执行文件与 native binary 路径解析（resolveSDKCliPath / getAgentExecutable 等）
 * - PDF document block capability 守门（shouldDenyReadForPdfDocumentBlock / isLikelyPdfDocumentBlockIncompatibility）
 * - 追加消息优先级（resolveQueuePriority）
 * - 历史上下文回填 prompt 构建（buildContextPrompt / extractSDKToolSummary）
 *
 * 保持行为与原实现字节级一致；被 agent-orchestrator.ts 同名 re-export 供测试引用。
 */

import { dirname, join } from 'node:path'
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { app } from 'electron'
import type { TypedError } from '@asci/shared'
import { getConfigDirName } from './config-paths.ts'
import { getAgentSessionSDKMessages } from './agent-session-manager'
import { getRuntimeProvisioner } from './runtime/runtime-provisioner.ts'

/**
 * 从 stderr 中提取 API 错误信息
 *
 * 解析类似这样的错误：
 * "401 {\"error\":{\"message\":\"...\"}}"
 * "API error: 400 Bad Request ..."
 */
export function extractApiError(stderr: string): { statusCode: number; message: string } | null {
  if (!stderr) return null

  // 模式 1：JSON 错误格式 - "401 {...}"
  const jsonMatch = stderr.match(/(\d{3})\s+(\{[^}]*"error"[^}]*\})/s)
  if (jsonMatch) {
    try {
      const statusCode = parseInt(jsonMatch[1]!)
      const errorObj = JSON.parse(jsonMatch[2]!)
      const message = errorObj.error?.message || errorObj.message || '未知错误'
      return { statusCode, message }
    } catch {
      // JSON 解析失败，继续尝试其他模式
    }
  }

  // 模式 2：API error 格式 - "API error (attempt X/Y): 401 401 {...}"
  const apiErrorMatch = stderr.match(/API error[^:]*:\s+(\d{3})\s+\d{3}\s+(\{.*?\})/s)
  if (apiErrorMatch) {
    try {
      const statusCode = parseInt(apiErrorMatch[1]!)
      const errorObj = JSON.parse(apiErrorMatch[2]!)
      const message = errorObj.error?.message || errorObj.message || '未知错误'
      return { statusCode, message }
    } catch {
      // JSON 解析失败
    }
  }

  // 模式 3：直接的状态码 + 消息
  const simpleMatch = stderr.match(/(\d{3})[:\s]+(.+?)(?:\n|$)/i)
  if (simpleMatch) {
    const statusCode = parseInt(simpleMatch[1]!)
    const message = simpleMatch[2]!.trim()
    if (statusCode >= 400 && statusCode < 600) {
      return { statusCode, message }
    }
  }

  return null
}

// ===== 自动重试工具函数 =====

/** 可自动重试的 TypedError 错误码 */
const AUTO_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'rate_limited',
  'provider_error',      // overloaded 映射为 provider_error
  'service_error',
  'service_unavailable',
  'network_error',
])

/** 判断 typed_error 事件是否可自动重试 */
export function isAutoRetryableTypedError(error: TypedError): boolean {
  return AUTO_RETRYABLE_ERROR_CODES.has(error.code)
}

/**
 * Read 工具对 PDF 路径的 capability 守门：当前渠道不支持 PDF document block 时
 * 拦截，让 Agent 通过 mcp__pdf_parser__pdf_parse_batch 改走文本路径
 * （写到 parsed-papers/{itemKey}.txt 再用 Read 读 txt）。issue #74
 */
export function shouldDenyReadForPdfDocumentBlock(args: {
  toolName: string
  input: Record<string, unknown>
  supportsPdfDocumentBlock: boolean
}): boolean {
  if (args.toolName !== 'Read') return false
  if (args.supportsPdfDocumentBlock) return false
  const filePath = args.input.file_path
  if (typeof filePath !== 'string') return false
  return filePath.toLowerCase().endsWith('.pdf')
}

/**
 * 判断 5xx 错误是否疑似由 PDF document block 兼容性问题触发（issue #74 安全网）。
 *
 * 启发式：HTTP 5xx + 当前渠道 provider 已知不兼容 PDF document block。
 * 不读 transcript 内容，避免 false positive 误伤其他 5xx 场景。
 *
 * 命中时上层会：
 * 1) 抑制自动重试（再发必再 500，transcript 已带 PDF block）
 * 2) 覆盖 userFacingError 为 i18n 化的"请切渠道"提示
 */
export function isLikelyPdfDocumentBlockIncompatibility(args: {
  statusCode: number | undefined
  providerSupportsPdfDocumentBlock: boolean
}): boolean {
  if (args.providerSupportsPdfDocumentBlock) return false
  if (typeof args.statusCode !== 'number') return false
  return args.statusCode >= 500 && args.statusCode < 600
}

/**
 * 追加消息的 SDK 优先级：打断抢占走 'now'，排队走 'next'（FIFO）。
 * 取值对应 SDK SDKUserMessage.priority（'now' | 'next' | 'later'）。
 */
export function resolveQueuePriority(interrupt: boolean | undefined): 'now' | 'next' {
  return interrupt ? 'now' : 'next'
}

/** 判断 catch 块中的 API 错误是否可自动重试（HTTP 429 / 5xx / 已知可恢复错误模式） */
export function isAutoRetryableCatchError(
  apiError: { statusCode: number; message: string } | null,
  rawErrorMessage?: string,
): boolean {
  if (apiError) {
    if (apiError.statusCode === 429 || apiError.statusCode >= 500) return true
  }
  // 已知的可恢复错误模式（无 HTTP 状态码但可重试）
  if (rawErrorMessage) {
    if (rawErrorMessage.includes('context_management')) return true
  }
  return false
}

/**
 * 判断错误是否为 SDK session 不存在（"No conversation found with session ID"）
 *
 * 当 resume 目标 session 已过期或被清理时，SDK 会抛出此错误。
 * 此类错误可通过清除 sdkSessionId 并切换到上下文回填模式来恢复。
 */
export function isSessionNotFoundError(errorMessage: string, stderr?: string): boolean {
  const pattern = /No conversation found.*with session/i
  return pattern.test(errorMessage) || (!!stderr && pattern.test(stderr))
}

/** 计算重试延迟（指数退避：1s, 2s, 4s） */
export function getRetryDelayMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), 8000)
}

/**
 * 可中断的定时器
 *
 * 等待指定毫秒，如果 signal 被中止则立即 resolve。
 */
export function timerWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return }
    const tid = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(tid); resolve() }, { once: true })
  })
}

let cachedIsLinuxMuslRuntime: boolean | undefined

export function isLinuxMuslRuntime(): boolean {
  if (process.platform !== 'linux') return false
  if (cachedIsLinuxMuslRuntime !== undefined) return cachedIsLinuxMuslRuntime

  try {
    const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string } } | undefined
    cachedIsLinuxMuslRuntime = !report?.header?.glibcVersionRuntime
  } catch {
    cachedIsLinuxMuslRuntime = false
  }

  return cachedIsLinuxMuslRuntime
}

export function getSdkNativePackageSuffixes(): string[] {
  const arch = process.arch
  if (arch !== 'x64' && arch !== 'arm64') return []

  if (process.platform === 'linux') {
    const glibc = `linux-${arch}`
    const musl = `linux-${arch}-musl`
    return isLinuxMuslRuntime() ? [musl, glibc] : [glibc, musl]
  }

  if (process.platform === 'darwin' || process.platform === 'win32') {
    return [`${process.platform}-${arch}`]
  }

  return []
}

export function toUnpackedPathIfNeeded(filePath: string): string {
  if (app.isPackaged && filePath.includes('.asar')) {
    const unpackedPath = filePath.replace(/\.asar([/\\])/, '.asar.unpacked$1')
    console.log(`[Agent 编排] 转换为 asar.unpacked 路径: ${unpackedPath}`)
    return unpackedPath
  }

  return filePath
}

/**
 * 解析 Claude Code 可执行文件路径。
 *
 * claude-agent-sdk 0.2.113+ 改为通过 per-platform optional dependency 分发 native binary；
 * 旧版本则使用主包内的 cli.js。这里优先解析 native binary，并保留 cli.js 降级路径，便于回滚/排查。
 */
export function resolveSDKCliPath(): string {
  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude'

  try {
    const cjsRequire = createRequire(__filename)
    const sdkEntryPath = cjsRequire.resolve('@anthropic-ai/claude-agent-sdk')
    const sdkRequire = createRequire(sdkEntryPath)
    const anthropicScopeDir = dirname(dirname(sdkEntryPath))

    for (const suffix of getSdkNativePackageSuffixes()) {
      const packageName = `@anthropic-ai/claude-agent-sdk-${suffix}`

      try {
        const resolvedBinaryPath = sdkRequire.resolve(`${packageName}/${binaryName}`)
        const executablePath = toUnpackedPathIfNeeded(resolvedBinaryPath)
        console.log(`[Agent 编排] Claude Code native binary 路径: ${executablePath}`)
        return executablePath
      } catch {
        // electron-builder may place optional dependencies either as siblings or under the SDK package.
      }

      const siblingBinaryPath = join(anthropicScopeDir, `claude-agent-sdk-${suffix}`, binaryName)
      if (existsSync(siblingBinaryPath)) {
        const executablePath = toUnpackedPathIfNeeded(siblingBinaryPath)
        console.log(`[Agent 编排] Claude Code native binary 路径: ${executablePath}`)
        return executablePath
      }
    }

    const legacyCliPath = join(dirname(sdkEntryPath), 'cli.js')
    if (existsSync(legacyCliPath)) {
      const executablePath = toUnpackedPathIfNeeded(legacyCliPath)
      console.log(`[Agent 编排] SDK legacy CLI 路径: ${executablePath}`)
      return executablePath
    }
  } catch (e) {
    console.warn('[Agent 编排] createRequire 解析 SDK 可执行文件失败:', e)
  }

  const fallbackSuffix = getSdkNativePackageSuffixes()[0]
  if (!fallbackSuffix) {
    throw new Error(`不支持的 Claude Agent SDK 平台: ${process.platform}/${process.arch}`)
  }

  const fallbackPath = join(
    process.cwd(),
    'node_modules',
    '@anthropic-ai',
    `claude-agent-sdk-${fallbackSuffix}`,
    binaryName,
  )
  console.log(`[Agent 编排] SDK 可执行文件路径 (手动): ${fallbackPath}`)
  return toUnpackedPathIfNeeded(fallbackPath)
}

/**
 * 获取 Agent SDK 运行时可执行文件
 *
 * 唯一来源：RuntimeProvisioner 管理的内置 Node 二进制。
 * RuntimeProvisioner.verify() 在应用启动时已完成校验，此处直接读取结果。
 */
export function getAgentExecutable(): { type: 'node'; path: string } {
  // RuntimeProvisioner 必须 ready，否则不该有 SDK 启动
  // 内置 Node 是 prod / dev 唯一来源（dev 经 setup-runtimes 拷贝到 ~/Library/Application Support/ASCI/runtimes/）
  const rp = getRuntimeProvisioner()
  if (rp.getStatus().phase !== 'ready') {
    throw new Error(
      'RuntimeProvisioner 未就绪。Agent 功能需要内置 Node 运行时。请重装 ASCI（.pkg installer）或在 dev 机上跑 bun run setup:runtimes',
    )
  }
  return { type: 'node', path: rp.getNodeBin() }
}

/**
 * 确保旧版 SDK cli.js 在打包环境下能找到 ripgrep。
 *
 * claude-agent-sdk 0.2.113+ 使用 native binary，不再需要 vendor/ripgrep 桥接。
 */
export function ensureRipgrepAvailable(cliPath: string): void {
  if (!app.isPackaged) return
  if (!cliPath.endsWith('cli.js')) return

  try {
    const sdkDir = dirname(cliPath)
    const arch = process.arch
    const platform = process.platform
    const expectedDir = join(sdkDir, 'vendor', 'ripgrep', `${arch}-${platform}`)
    const resourcesRipgrep = join(process.resourcesPath, 'vendor', 'ripgrep')

    if (existsSync(expectedDir)) return

    if (!existsSync(resourcesRipgrep)) {
      console.warn(`[Agent 编排] ripgrep 资源不存在: ${resourcesRipgrep}`)
      return
    }

    mkdirSync(join(sdkDir, 'vendor', 'ripgrep'), { recursive: true })
    symlinkSync(resourcesRipgrep, expectedDir, 'junction')
    console.log(`[Agent 编排] ripgrep symlink 创建成功: ${expectedDir} → ${resourcesRipgrep}`)
  } catch (error) {
    console.warn('[Agent 编排] ripgrep symlink 创建失败:', error)
  }
}

/** 最大回填消息条数 */
export const MAX_CONTEXT_MESSAGES = 20

/** 单条工具摘要最大字符数 */
const MAX_TOOL_SUMMARY_LENGTH = 200

/**
 * 从 SDKMessage assistant 消息的 content 中提取工具活动摘要
 *
 * 扫描 tool_use 块，提取工具名称和关键参数，帮助新 SDK 会话理解之前做过什么。
 */
export function extractSDKToolSummary(content: Array<{ type: string; name?: string; input?: Record<string, unknown> }>): string {
  const summaries: string[] = []
  for (const block of content) {
    if (block.type === 'tool_use' && block.name) {
      const input = block.input ?? {}
      const keyParam = input.file_path ?? input.command ?? input.path ?? input.query ?? ''
      const paramStr = keyParam ? `: ${String(keyParam).slice(0, 100)}` : ''
      summaries.push(`[tool: ${block.name}${paramStr}]`)
    }
  }
  if (summaries.length === 0) return ''
  const joined = summaries.join(' ')
  return joined.length > MAX_TOOL_SUMMARY_LENGTH
    ? joined.slice(0, MAX_TOOL_SUMMARY_LENGTH) + '...'
    : joined
}

/**
 * 构建带历史上下文的 prompt
 *
 * 当 resume 不可用时，将最近消息拼接为上下文注入 prompt，
 * 让新 SDK 会话保留对话记忆。包含文本内容和工具活动摘要。
 */
export function buildContextPrompt(sessionId: string, currentUserMessage: string, sessionHint?: { agentCwd: string }): string {
  const allMessages = getAgentSessionSDKMessages(sessionId)
  if (allMessages.length === 0) return currentUserMessage

  // 排除最后一条（当前用户消息，刚刚才 append 的）
  const history = allMessages.slice(0, -1)
  if (history.length === 0) return currentUserMessage

  const recent = history.slice(-MAX_CONTEXT_MESSAGES)
  const lines = recent
    .filter((m) => (m.type === 'user' || m.type === 'assistant'))
    .map((m) => {
      // 从 SDKMessage 的 message.content 中提取文本
      const content = (m as { message?: { content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }> } }).message?.content
      if (!Array.isArray(content)) return null

      const textParts = content
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text!)
      const text = textParts.join('\n')
      if (!text) return null

      let line = `[${m.type}]: ${text}`
      // assistant 消息附带工具活动摘要
      if (m.type === 'assistant') {
        const toolSummary = extractSDKToolSummary(content)
        if (toolSummary) {
          line += `\n  Tool activity: ${toolSummary}`
        }
      }
      return line
    })
    .filter(Boolean)

  if (lines.length === 0) return currentUserMessage

  // 注入 session 元信息，便于 Agent 在需要时读取完整历史
  const sessionInfoBlock = sessionHint
    ? `\n<session_info>\nSession ID: ${sessionId}\nSession CWD: ${sessionHint.agentCwd}\nNote: the block above is a recent-conversation summary. For more context, read ~/${getConfigDirName()}/agent-sessions/${sessionId}.jsonl for the full history.\n</session_info>\n`
    : ''

  console.log(`[Agent 编排] buildContextPrompt: 读取 ${allMessages.length} 条消息，注入 ${lines.length} 条历史${sessionHint ? '（含 session 元信息）' : ''}`)
  return `<conversation_history>${sessionInfoBlock}\n${lines.join('\n')}\n</conversation_history>\n\n${currentUserMessage}`
}
