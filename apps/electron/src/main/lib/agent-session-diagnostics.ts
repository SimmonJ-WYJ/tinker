/**
 * Agent 会话诊断落盘（issue #587）
 *
 * 两类输出，都在 ~/.asci/agent-sessions-diagnostics/ 下：
 *  1. {sessionId}.jsonl — append-only 诊断事件（当前唯一事件：tool_not_found 哨兵，
 *     即工具调用返回 "No such tool available"）。作为常驻回归探测器：
 *     验收 / 回归时检查该目录无新增 tool_not_found 即可。
 *  2. {sessionId}.stderr.log — SDK 子进程（claude binary + 其拉起的 MCP server）
 *     stderr 原样落盘。此前 stderr 只进 console.error，进程退出即丢，
 *     偶发故障无法事后排查。
 *
 * 所有写入都是尽力而为：失败仅 warn，绝不阻塞 Agent 主流程。
 */
import { appendFileSync } from 'node:fs'
import { nowIso } from '@asci/shared'
import { getSessionDiagnosticsPath, getSessionStderrLogPath } from './config-paths.ts'
import type { McpInitSnapshot } from './mcp/mcp-init-status.ts'

// 路径解析含 existsSync + mkdir，stderr 回调在流式热路径上逐 chunk 触发，
// 按 sessionId 记忆化避免每次 append 都重复 syscall
const sessionPathCache = new Map<string, { jsonl: string; stderrLog: string }>()

function resolveSessionPaths(sessionId: string): { jsonl: string; stderrLog: string } {
  let paths = sessionPathCache.get(sessionId)
  if (!paths) {
    paths = {
      jsonl: getSessionDiagnosticsPath(sessionId),
      stderrLog: getSessionStderrLogPath(sessionId),
    }
    sessionPathCache.set(sessionId, paths)
  }
  return paths
}

/** "No such tool available" 哨兵事件（每命中一次落一行） */
export interface ToolNotFoundEvent {
  kind: 'tool_not_found'
  ts: string
  sessionId: string
  /** 报错的工具名（从错误文本中提取） */
  toolName: string
  /** 距本 turn init 消息的毫秒数（init 未捕获时为 null） */
  elapsedSinceInitMs: number | null
  /** 本 turn init 上报的 MCP server 状态摘要（init 未捕获时为 null） */
  mcpServers: Array<{ name: string; status: string }> | null
  /** 该工具是否出现在 init 工具表（init 未带 tools 字段时为 null） */
  toolInInitTable: boolean | null
}

/** 提取 tool_result block 的纯文本（content 可能是字符串或 text block 数组） */
export function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const text = (b as { text?: unknown } | null)?.text
        return typeof text === 'string' ? text : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/**
 * 匹配 SDK 的 tool not found 错误文本，提取工具名；不匹配返回 null。
 * 工具名只取 [\w-] 字符 —— 错误可能被 <tool_use_error> 标签包裹，\S+ 会把闭合标签也吞进来。
 */
export function extractToolNotFoundName(errorText: string): string | null {
  const m = errorText.match(/No such tool available:\s*([\w-]+)/)
  return m?.[1] ?? null
}

/** 构造哨兵事件（纯函数，便于单测） */
export function buildToolNotFoundEvent(input: {
  sessionId: string
  toolName: string
  nowMs: number
  snapshot: McpInitSnapshot | null
  toolInInitTable: boolean | null
}): ToolNotFoundEvent {
  return {
    kind: 'tool_not_found',
    ts: nowIso(),
    sessionId: input.sessionId,
    toolName: input.toolName,
    elapsedSinceInitMs: input.snapshot ? input.nowMs - input.snapshot.capturedAtMs : null,
    mcpServers: input.snapshot?.servers ?? null,
    toolInInitTable: input.toolInInitTable,
  }
}

/** 追加一条诊断事件到 {sessionId}.jsonl（失败仅 warn） */
export function appendSessionDiagnosticsEvent(sessionId: string, event: ToolNotFoundEvent): void {
  try {
    appendFileSync(resolveSessionPaths(sessionId).jsonl, JSON.stringify(event) + '\n', 'utf-8')
  } catch (err) {
    console.warn(`[会话诊断] 写诊断事件失败 (session=${sessionId})`, err)
  }
}

/** 追加 SDK stderr 块到 {sessionId}.stderr.log（失败静默，stderr 可能高频） */
export function appendSessionStderr(sessionId: string, chunk: string): void {
  try {
    appendFileSync(resolveSessionPaths(sessionId).stderrLog, chunk, 'utf-8')
  } catch {
    // 静默：stderr 落盘是 best-effort，不值得为它刷屏
  }
}
