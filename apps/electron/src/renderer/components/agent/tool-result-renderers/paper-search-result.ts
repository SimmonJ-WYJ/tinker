/**
 * mcp__paper-search__process_search_results 工具结果解析。
 *
 * 期望的 JSON 形状(由 paper-search MCP 决定):
 *   { "display_count": number, "sources": string[], ...其它字段忽略 }
 *
 * 任何字段缺失 / 类型不匹配 / 非 JSON / 顶层非对象 → 返回 null,
 * 调用方收到 null 时降级到 DefaultResultRenderer。
 */
export interface PaperSearchSummary {
  count: number
  sources: string[]
}

export function parsePaperSearchResult(text: string): PaperSearchSummary | null {
  if (!text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const obj = parsed as Record<string, unknown>
  const count = obj.display_count
  const sources = obj.sources

  if (typeof count !== 'number') return null
  if (!Array.isArray(sources)) return null
  if (!sources.every((s) => typeof s === 'string')) return null

  return { count, sources: sources as string[] }
}
