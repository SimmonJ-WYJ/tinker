/**
 * Zotero PDF Diff → papers 表同步（管道 B）
 *
 * 每次 runZoteroPdfDiff 完成后，把 added + modified 的 PDF record 里的 parent
 * 元数据（title / authors / DOI / year / venue / url / abstract）同步进 `papers`
 * 表。
 *
 * 与 zotero-pdf-parser 平行的 diff 后置：
 *   - parser：负责入队解析 PDF → wiki/index.json
 *   - 本模块：负责把 Zotero 父条目元数据同步到 App 级稳定论文索引
 *
 * 失败语义：所有错误向上抛由调用方决定 warn / retry；本模块自身不做日志，
 * 由 wrapper（applyDiffToPapersSafe）打 warn 不阻塞 diff 主路径。
 *
 * 不做：
 *   - 不处理 deleted：Zotero 删 attachment 不联动删 `papers` 行（避免 evidence_refs
 *     悬空）；如需"取消关联"由用户显式操作走 paper-repository.softDeletePaper
 *   - 不处理 PDF 解析后的笔记 / 段落 —— 那是 wiki/index.json 的职责
 */

import type { ZoteroPdfDiffResult, ZoteroPdfRecord, ZoteroParentItemInfo } from '@asci/shared'
import { sanitizeText } from '@asci/shared'

import type { RepoDb } from './objects/internal/repo-db.ts'
import { syncPapers, type PaperSyncInput } from './objects/paper-sync-service.ts'

/**
 * 全量把 snapshot 中的 record 同步进 papers 表
 *
 * 设计理念变更（vs 旧 applyDiffToPapers）：
 *   - 旧实现只同步 diff result 的 added/modified；first-baseline 时跳过 →
 *     用户在 Pipeline B 部署之前就已经存在的 Zotero 条目永远不会进 papers 表
 *   - 新实现每次 diff 都做**全量幂等 reconcile**，保证 papers ⊇ snapshot
 *   - 性能：syncPapers 内部按 doi/zoteroKey 走 idx_papers_doi / idx_papers_zotero_key
 *     索引，N 条 record 是 N 次索引查找 + 0~少量写入，可接受
 *   - 不删除：snapshot 中删除的 record 不会触发 papers 软删（与 diff 的 deleted 一致）
 *
 * 仅处理有 parent 字段的 record（attachment 无父条目 = 散落 PDF，没元数据可同步）。
 */
export function applySnapshotToPapers(
  db: RepoDb,
  records: readonly ZoteroPdfRecord[],
): { created: number; updated: number; skipped: number } {
  const inputs: PaperSyncInput[] = []
  for (const rec of records) {
    const input = recordToPaperSyncInput(rec)
    if (input) inputs.push(input)
  }
  if (inputs.length === 0) {
    return { created: 0, updated: 0, skipped: 0 }
  }
  const r = syncPapers(db, inputs)
  return { created: r.created, updated: r.updated, skipped: r.skipped }
}

/**
 * @deprecated 用 applySnapshotToPapers + 完整 record 列表代替（全量幂等更可靠）。
 * 旧入口保留兼容期；新代码不应再调用。
 */
export function applyDiffToPapers(
  db: RepoDb,
  result: ZoteroPdfDiffResult,
): { created: number; updated: number; skipped: number } {
  if (result.status !== 'diff') {
    return { created: 0, updated: 0, skipped: 0 }
  }
  const records: ZoteroPdfRecord[] = []
  for (const rec of result.added) records.push(rec)
  for (const m of result.modified) records.push(m.now)
  return applySnapshotToPapers(db, records)
}

/**
 * ZoteroPdfRecord → PaperSyncInput
 *
 * record.parent 为 null（无父条目 / 上次拉父条目失败）→ 返回 null，本次跳过
 *   下次 diff 拉到父条目后会重试
 * title 缺失（父条目没标题）→ 也返回 null，避免落空 title 脏行
 *
 * zoteroKey 取**父条目** itemKey 而非 attachmentKey —— 父条目 itemKey 才是"论文级"
 * 标识，attachmentKey 是单个 PDF 文件。一篇论文可有多个 attachment（pdf + supplementary）。
 */
function recordToPaperSyncInput(rec: ZoteroPdfRecord): PaperSyncInput | null {
  const parent = rec.parent
  if (!parent) return null
  if (!parent.title || parent.title.trim().length === 0) return null
  return {
    source: 'zotero',
    title: parent.title.trim(),
    authors: creatorsToAuthors(parent.creators),
    // Zotero abstractNote 可能含 JATS / HTML 标签：入本地 papers 库前清洗
    abstract: sanitizeText(parent.abstractNote) || null,
    year: extractYearFromDate(parent.date),
    venue: parent.publicationTitle ?? null,
    doi: parent.DOI ?? null,
    url: parent.url ?? null,
    zoteroKey: parent.itemKey,
  }
}

/**
 * Zotero creators[] → string[]
 *
 * 单作者格式取 `firstName lastName`（中间名忽略），或纯 `name` 字段（机构作者）。
 * 仅包含作为 author/editor/translator 等记录在内的；creator type 不过滤（保留全部）。
 */
function creatorsToAuthors(creators: ZoteroParentItemInfo['creators']): string[] {
  const out: string[] = []
  for (const c of creators) {
    if (c.name && c.name.trim()) {
      out.push(c.name.trim())
      continue
    }
    const parts = [c.firstName, c.lastName].filter((s): s is string => !!s && s.trim().length > 0)
    if (parts.length > 0) out.push(parts.join(' ').trim())
  }
  return out
}

/**
 * Zotero date 字段提取 4 位年份
 *
 * Zotero date 是原始字符串，形如 `"2012"` / `"2012-05"` / `"May 2012"` / `"2012-05-15"`。
 * 取第一个 19xx / 20xx 子串作为年份；找不到返回 null。
 */
function extractYearFromDate(date: string | null): number | null {
  if (!date) return null
  const m = date.match(/(19|20)\d{2}/)
  if (!m) return null
  const y = Number.parseInt(m[0], 10)
  return Number.isInteger(y) ? y : null
}

/** 测试导出 */
export const __testing__ = {
  recordToPaperSyncInput,
  creatorsToAuthors,
  extractYearFromDate,
}
