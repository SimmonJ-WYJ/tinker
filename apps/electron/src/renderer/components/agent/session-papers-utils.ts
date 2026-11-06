/**
 * Session 检索结果共用纯函数：
 * - readCitedBy: 从 PaperRecord / WorkspacePaperEntry 的 extra 读引用数
 * - recordKey:   与主进程 buildRecordKey 等价的客户端版本，用于把 record 关联到 entry
 *
 * 历史上这两个 fn 写在 SessionPapersPanel.tsx 里；抽出来让 session-papers-filter.ts
 * 和 PaperDetailRenderer 等组件共用。
 */

import { sanitizeText, type PaperRecord } from '@asci/shared'

/**
 * 读引用数。canonical 字段是 paper-search MCP 写入的 extra.citedBy；
 * 兼容历史 JSONL 里旧字段名 extra.citations。0 视为"源未提供"（pydantic 默认值），不展示。
 */
export function readCitedBy(item: { extra?: Record<string, unknown> } | null | undefined): number | null {
  if (!item?.extra) return null
  const v = item.extra.citedBy ?? item.extra.citations
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

/**
 * 读七维评分对象。canonical 键是 paper_scoring 写入的 extra.score；
 * 兼容旧会话 JSONL 里的历史键名 extra.scoreV2（评分键由 scoreV2 重命名为 score）。
 * 返回原始对象（调用方按需取 finalScore / venueTier 等子字段，或断言为 PaperScore）。
 */
export function readScoreObject(
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  const s = extra?.score ?? extra?.scoreV2
  return s && typeof s === 'object' ? (s as Record<string, unknown>) : null
}

/** 与主进程 recordKey 保持等价（也供 PaperDetailRenderer 等组件复用） */
export function recordKey(r: PaperRecord): string | null {
  if (r.doi) return `doi:${r.doi.toLowerCase()}`
  const extra = (r.extra ?? {}) as Record<string, unknown>
  if (typeof extra.paperId === 'string') return `pid:${extra.paperId}`
  if (typeof extra.arxivId === 'string') return `arx:${extra.arxivId}`
  if (typeof extra.pmid === 'string') return `pmid:${extra.pmid}`
  if (typeof extra.openalexId === 'string') return `oa:${extra.openalexId}`
  if (r.title && r.title !== '(无标题)' && r.title !== '(DOI 片段)') {
    // title 键走 sanitizeText，与主进程 buildRecordKey 等价：旧脏标题与新净标题哈希一致
    return `t:${sanitizeText(r.title).toLowerCase()}|y:${r.year ?? ''}`
  }
  return null
}
