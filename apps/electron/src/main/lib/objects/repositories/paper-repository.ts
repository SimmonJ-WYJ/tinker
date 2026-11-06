/**
 * Paper 仓储层
 *
 * 0.2 北极星核心对象 Paper 的 CRUD + 软删 API；
 * 不持有 DB 连接，所有函数第一参数为 `RepoDb`，便于测试时换 driver。
 *
 * 协议铁律映射：
 *   - P1 追加不覆盖：本表无更新冲突场景；元数据 update 仅允许走 `updatePaper`
 *     的白名单字段（title / abstract / year 等），不会破坏关联对象
 *   - P2 引用语义：`softDeletePaper` 置 visibility='deleted' + deleted_at；
 *     反查 EvidenceRef 时由 query 层 LEFT JOIN 检测
 *     并映射为 ResolvedRef.removed
 *   - ID 必须主进程生成：`createPaper` 强制走 `newObjectId()`，调用方不传 ID
 *
 * 不做：
 *   - 不做 0.1 旧 JSON paper-store 的迁移（独立 issue）
 *   - 不做 Zotero 同步（zoteroKey 字段仅作软关联）
 *   - 不做硬删：只软删；硬删由后续 GC 策略处理
 */

import type { ObjectId, Paper, Timestamp } from '@asci/shared'

import { workspaceEventBus } from '../../workspace-event-bus.ts'
import { encodeJson, nowIso, softDeleteRow } from '../internal/common.ts'
import { newObjectId } from '../internal/id.ts'
import { paperFromRow, type PaperRow } from '../internal/mappers.ts'
import type { RepoDb } from '../internal/repo-db.ts'

/**
 * DOI 归一：DOI 按 ISO 26324 大小写无关，统一存小写、去 `https://doi.org/` /
 * `doi:` 前缀后入库；查询时同样归一，保证写入侧任意大小写、URL 形式都能命中
 * 同一行。仓储层做这件事比让每个调用方记得归一更安全。
 */
function normalizeDoiForStorage(doi: string | null | undefined): string | null {
  if (doi == null) return null
  let s = String(doi).trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
  s = s.replace(/^doi:\s*/, '')
  return s.length > 0 ? s : null
}

/** 创建 Paper 的输入；不含 id / createdAt / updatedAt / visibility（仓储侧填） */
export interface CreatePaperInput {
  title: string
  authors: string[]
  abstract?: string
  year?: number
  venue?: string
  doi?: string
  url?: string
  zoteroKey?: string
}

/** 可更新的字段白名单 —— 不让外部改 id / 时间戳 / visibility（后者走 softDelete） */
export interface UpdatePaperInput {
  title?: string
  authors?: string[]
  abstract?: string | null
  year?: number | null
  venue?: string | null
  doi?: string | null
  url?: string | null
  zoteroKey?: string | null
}

export function createPaper(db: RepoDb, input: CreatePaperInput): Paper {
  const id = newObjectId()
  const now: Timestamp = nowIso()
  db.prepare(
    `INSERT INTO papers
       (id, title, authors_json, abstract, year, venue, doi, url, zotero_key,
        visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', ?, ?)`,
  ).run(
    id,
    input.title,
    encodeJson(input.authors),
    input.abstract ?? null,
    input.year ?? null,
    input.venue ?? null,
    normalizeDoiForStorage(input.doi),
    input.url ?? null,
    input.zoteroKey ?? null,
    now,
    now,
  )
  const paper = getPaperByIdOrThrow(db, id)
  workspaceEventBus.emit({ kind: 'paper.created', paperId: paper.id, at: now })
  return paper
}

export function getPaperById(db: RepoDb, id: ObjectId): Paper | null {
  const row = db.prepare(`SELECT * FROM papers WHERE id = ?`).get(id) as PaperRow | undefined
  return row ? paperFromRow(row) : null
}

/**
 * 按 DOI 反查 Paper（精确匹配；命中 idx_papers_doi）。
 *
 * 排除软删（visibility='deleted'）。多条候选时取 created_at 最新一条 —— DOI
 * 理应唯一，但 schema 没加 UNIQUE 约束（容忍上游 dedupe 漏掉的边界），这里
 * 选最新即"上一次落库的版本"，与 getReviewByAgentSessionId 同语义。
 *
 * 查询前对 doi 走 normalizeDoiForStorage，匹配 createPaper / updatePaper 的写入
 * 归一，保证任意大小写 / URL 形式都能命中同一行。
 */
export function getPaperByDoi(db: RepoDb, doi: string): Paper | null {
  const normalized = normalizeDoiForStorage(doi)
  if (!normalized) return null
  const row = db
    .prepare(
      `SELECT * FROM papers
        WHERE doi = ? AND visibility != 'deleted'
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(normalized) as PaperRow | undefined
  return row ? paperFromRow(row) : null
}

/**
 * 按 Zotero item key 反查 Paper。命中 idx_papers_zotero_key 部分索引（zotero_key IS NOT NULL）。
 *
 * 多行命中视为数据失序：A-1 设计上 zotero_key 是软关联，不强 UNIQUE，但本仓的写入路径
 * （createPaper / findOrCreate）保证最多 1 行有同样的 zotero_key。若仍命中多行，取
 * createdAt 最新一行（DESC）—— 兜底但不静默：保留行为简单可观察。
 *
 * 默认排除 visibility='deleted'：上层 UI / Note 写入流程不应该把新 Note 挂到一个已软删的
 * Paper 上；若 zotero_key 之前指向的 paper 已删，调用方应当走 findOrCreate 重新建一行。
 */
export function findPaperByZoteroKey(db: RepoDb, zoteroKey: string): Paper | null {
  const row = db
    .prepare(
      `SELECT * FROM papers
        WHERE zotero_key = ? AND visibility != 'deleted'
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(zoteroKey) as PaperRow | undefined
  return row ? paperFromRow(row) : null
}

/**
 * 按 zoteroKey 懒创建 Paper：命中即返回（不更新元数据，避免与 Zotero 同步耦合 ——
 * 见本文件头注释"不做 Zotero 同步"），未命中即用 fallback 创建一行新 Paper。
 *
 * 用于 C-1：UI 侧用户为某 Zotero 论文划词建注时，由 notes-service 调用此函数
 * 拿到稳定的 ObjectId，再写到对应的 evidence_ref.source_id（v0.2 重构后改走
 * evidence_refs 表达 paper ↔ note 的关系，而非直接挂在 notes 上）。
 */
export function findOrCreatePaperByZoteroKey(
  db: RepoDb,
  zoteroKey: string,
  fallback: Omit<CreatePaperInput, 'zoteroKey'>,
): Paper {
  const existing = findPaperByZoteroKey(db, zoteroKey)
  if (existing) return existing
  return createPaper(db, { ...fallback, zoteroKey })
}

function getPaperByIdOrThrow(db: RepoDb, id: ObjectId): Paper {
  const p = getPaperById(db, id)
  if (!p) throw new Error(`[paper-repo] paper not found after write: ${id}`)
  return p
}

/**
 * 更新 Paper 字段；不影响 visibility，不改 created_at。
 *
 * 语义说明：本函数本质是对**同一对象**的字段修订，不属于 P1 协议禁止的
 * "覆盖关联对象"。P1 防的是"用一条 Note 覆盖另一条 Note"这种关系层
 * 覆盖；Paper 自身的元数据修订（标题改写、补 DOI 等）仍允许就地更新。
 */
export function updatePaper(db: RepoDb, id: ObjectId, patch: UpdatePaperInput): Paper {
  const existing = getPaperByIdOrThrow(db, id)
  const now: Timestamp = nowIso()
  // patch.doi 走归一（与 createPaper 一致）；null 显式清空，undefined 保持原值
  const nextDoi = patch.doi === null
    ? null
    : patch.doi === undefined
      ? existing.doi ?? null
      : normalizeDoiForStorage(patch.doi)
  const merged: Paper = {
    ...existing,
    title: patch.title ?? existing.title,
    authors: patch.authors ?? existing.authors,
    abstract: patch.abstract === null ? undefined : patch.abstract ?? existing.abstract,
    year: patch.year === null ? undefined : patch.year ?? existing.year,
    venue: patch.venue === null ? undefined : patch.venue ?? existing.venue,
    doi: nextDoi ?? undefined,
    url: patch.url === null ? undefined : patch.url ?? existing.url,
    zoteroKey: patch.zoteroKey === null ? undefined : patch.zoteroKey ?? existing.zoteroKey,
    updatedAt: now,
  }
  db.prepare(
    `UPDATE papers
       SET title = ?, authors_json = ?, abstract = ?, year = ?, venue = ?,
           doi = ?, url = ?, zotero_key = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    merged.title,
    encodeJson(merged.authors),
    merged.abstract ?? null,
    merged.year ?? null,
    merged.venue ?? null,
    nextDoi,
    merged.url ?? null,
    merged.zoteroKey ?? null,
    now,
    id,
  )
  return getPaperByIdOrThrow(db, id)
}

/**
 * 软删 Paper：保留行 + 置 visibility='deleted' + deleted_at。
 *
 * 不级联触发引用方处理：`evidence_refs`（及遗留 `citation_relations` 表）的外键约定是
 * **硬删时 CASCADE**；软删走 SQL UPDATE，不触发 CASCADE。引用方仍然能查到
 * 这条 paper 行，由 query 层 LEFT JOIN 检测 deleted_at 后包装为
 * ResolvedRef.removed（P2 协议）。
 */
export function softDeletePaper(db: RepoDb, id: ObjectId): void {
  const now = nowIso()
  softDeleteRow(db, 'papers', id, now)
  workspaceEventBus.emit({ kind: 'paper.deleted', paperId: id, at: now })
}

/**
 * 列出 Paper。
 *
 * @param opts.includeDeleted 默认 false（排除 visibility='deleted'）；
 *                            true 时返回所有（含 archived / deleted）。
 *                            archived 默认是否纳入：是 —— archived 是
 *                            "从默认视图隐去"语义，但列表 API 本身就是
 *                            主动浏览，由 UI 侧决定是否再过滤。
 */
export function listPapers(db: RepoDb, opts: { includeDeleted?: boolean } = {}): Paper[] {
  const where = opts.includeDeleted ? '' : `WHERE visibility != 'deleted'`
  const rows = db
    .prepare(`SELECT * FROM papers ${where} ORDER BY created_at DESC`)
    .all() as PaperRow[]
  return rows.map(paperFromRow)
}
