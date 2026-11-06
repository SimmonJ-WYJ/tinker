/**
 * present_research_gap_table 工具结果的解析 + 从工具入参重建对照表。
 *
 * - parseResearchGapResult：从工具返回的 JSON 文本取 { tableId, title, 计数 }，供结果卡片渲染。
 * - buildTableFromInput：用工具入参（含整张表）+ result 里的 tableId 重建 ResearchGapTable，
 *   这样即便内存态被清空（如重启），点对话内结果卡片也能把表重新灌回 store 再打开 Tab。
 */
import type {
  ResearchGapTable,
  GapColumn,
  GapRow,
  ResearchGap,
  ConflictNote,
} from '@asci/shared'

export interface ResearchGapResultSummary {
  tableId: string
  title: string
  columns: number
  rows: number
  gaps: number
  conflicts: number
}

/** 解析工具返回 JSON；非预期结构返回 null（→ 卡片回退默认渲染） */
export function parseResearchGapResult(result: string): ResearchGapResultSummary | null {
  try {
    const parsed: unknown = JSON.parse(result)
    if (typeof parsed !== 'object' || parsed === null) return null
    const o = parsed as Record<string, unknown>
    if (o.ok !== true || typeof o.tableId !== 'string' || o.tableId.length === 0) return null
    const rendered = (o.rendered ?? {}) as Record<string, unknown>
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    return {
      tableId: o.tableId,
      title: typeof o.title === 'string' ? o.title : '',
      columns: num(rendered.columns),
      rows: num(rendered.rows),
      gaps: num(rendered.gaps),
      conflicts: num(rendered.conflicts),
    }
  } catch {
    return null
  }
}

/** 从工具入参（present_research_gap_table 的 args）重建整张表；结构不符返回 null */
export function buildTableFromInput(
  input: Record<string, unknown>,
  tableId: string,
): ResearchGapTable | null {
  const rows = input.rows
  const columns = input.columns
  if (!Array.isArray(rows) || !Array.isArray(columns)) return null
  return {
    id: tableId,
    title: typeof input.title === 'string' ? input.title : '',
    sourceSelection: {
      kind: 'papers',
      paperIds: rows.map((r) => (r as GapRow).paperId).filter((id): id is string => typeof id === 'string'),
    },
    scopeLabel: typeof input.scopeLabel === 'string' ? input.scopeLabel : '',
    columns: columns as GapColumn[],
    rows: rows as GapRow[],
    gaps: Array.isArray(input.gaps) ? (input.gaps as ResearchGap[]) : [],
    conflicts: Array.isArray(input.conflicts) ? (input.conflicts as ConflictNote[]) : [],
  } satisfies ResearchGapTable
}
