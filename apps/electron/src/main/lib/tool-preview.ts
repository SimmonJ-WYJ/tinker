/**
 * 权限弹窗工具参数预览（#710 PR2 · spec §4/§6 流 D）
 *
 * 把原 renderer 侧 PreviewFormatters.formatToolPreview 的逻辑**搬到 main**，并在出口前脱敏：
 * 高频工具（Bash/Write/Edit/Read/Glob/Grep）→ 结构化 token（path/command/pattern 经 redactTextWithMatches，
 * 凭证形态 + 路径用户名段均脱敏）；未知 / MCP 工具 → 'redacted'（深度脱敏后的预览 + hash + bytes，
 * **绝不下发 raw JSON**）。renderer 只读本函数产物（ToolPreview），不再接触 raw toolInput
 * （raw 留 main pending state 供 SDK resume）。
 */
import { redactTextWithMatches, redactDeepWithMatches } from '@asci/shared'
import type { ToolPreview } from '@asci/shared'
import { sha256Hex, byteLengthOf } from './telemetry/disclosure-fingerprint.ts'

/** 凭证 + 路径用户名段脱敏（取脱敏后的值）。 */
function red(text: string): string {
  return redactTextWithMatches(text).value
}

export function buildToolPreview(toolName: string, input: Record<string, unknown>): ToolPreview {
  switch (toolName) {
    case 'Bash': {
      if (typeof input.command === 'string') {
        return { kind: 'command', command: red(input.command) }
      }
      break
    }
    case 'Write':
    case 'Edit': {
      const path = typeof input.file_path === 'string' ? red(input.file_path) : undefined
      if (path) {
        let meta: string | undefined
        if (toolName === 'Edit' && typeof input.old_string === 'string') {
          const lines = input.old_string.split('\n').length
          meta = lines === 1 ? '1 line' : `${lines} lines`
        }
        return { kind: 'file', path, meta }
      }
      break
    }
    case 'NotebookEdit': {
      const path = typeof input.notebook_path === 'string' ? red(input.notebook_path) : undefined
      if (path) return { kind: 'file', path }
      break
    }
    case 'Read': {
      const path = typeof input.file_path === 'string' ? red(input.file_path) : undefined
      if (path) {
        const parts: string[] = []
        if (typeof input.offset === 'number') parts.push(`offset:${input.offset}`)
        if (typeof input.limit === 'number') parts.push(`limit:${input.limit}`)
        return { kind: 'file', path, meta: parts.length > 0 ? parts.join(' · ') : undefined }
      }
      break
    }
    case 'Glob':
    case 'Grep': {
      const pattern = typeof input.pattern === 'string' ? red(input.pattern) : undefined
      const path = typeof input.path === 'string' ? red(input.path) : undefined
      if (pattern) return { kind: 'pattern', pattern, path }
      break
    }
  }
  // 兜底（未知 / MCP 工具）：绝不下发 raw JSON。深度脱敏（凭证/路径/邮箱 → 占位符）后给 redacted 预览 + hash/bytes。
  const rawJson = JSON.stringify(input)
  const preview = JSON.stringify(redactDeepWithMatches(input).value, null, 2)
  return {
    kind: 'redacted',
    preview,
    hash: sha256Hex(rawJson),
    bytes: byteLengthOf(rawJson),
  }
}
