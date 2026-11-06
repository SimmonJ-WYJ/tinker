/**
 * Tool input 人类化预览
 *
 * 把高频工具的 toolInput 解构成 banner 渲染所需的结构化 token，避免直接 JSON.stringify 形式的"裸 JSON"。
 * 未识别的工具返回 kind='json' 兜底，保持现状。
 *
 * 命中工具：Bash / Write / Edit / NotebookEdit / Read / Glob / Grep
 */

export type ToolPreview =
  | { kind: 'command'; command: string }
  | { kind: 'file'; path: string; meta?: string }
  | { kind: 'pattern'; pattern: string; path?: string }
  | { kind: 'json'; json: string }

/** 从 toolInput 提炼出对人类友好的预览 token */
export function formatToolPreview(
  toolName: string,
  input: Record<string, unknown>,
): ToolPreview {
  switch (toolName) {
    case 'Bash': {
      if (typeof input.command === 'string') {
        return { kind: 'command', command: input.command }
      }
      break
    }
    case 'Write':
    case 'Edit': {
      const path = typeof input.file_path === 'string' ? input.file_path : undefined
      if (path) {
        let meta: string | undefined
        if (toolName === 'Edit' && typeof input.old_string === 'string') {
          const lines = (input.old_string as string).split('\n').length
          meta = lines === 1 ? '1 line' : `${lines} lines`
        }
        return { kind: 'file', path, meta }
      }
      break
    }
    case 'NotebookEdit': {
      const path = typeof input.notebook_path === 'string' ? input.notebook_path : undefined
      if (path) return { kind: 'file', path }
      break
    }
    case 'Read': {
      const path = typeof input.file_path === 'string' ? input.file_path : undefined
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
      const pattern = typeof input.pattern === 'string' ? input.pattern : undefined
      const path = typeof input.path === 'string' ? input.path : undefined
      if (pattern) return { kind: 'pattern', pattern, path }
      break
    }
  }
  return { kind: 'json', json: JSON.stringify(input, null, 2) }
}
