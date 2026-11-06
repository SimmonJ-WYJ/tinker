/**
 * Review 仓储层
 *
 * 0.2 北极星核心对象 Review 的 CRUD + 软删 API。
 * 本仓储**只管元数据**；综述 HTML 正文存到 `~/.asci/reviews/{id}.html`
 * 文件，路径解析走 `config-paths.ts::getReviewBodyPath()`，由调用层
 * 直接 fs 读写（避免在主进程主路径上重复抽一层薄壳）。
 *
 * sourceEvidenceSetId 可空：用户从 Paper 列表直接综述时为 undefined；
 * FK ON DELETE SET NULL 在 schema 已配置。
 *
 * agentSessionId 可空：用于同会话二次完成的幂等去重 —— 见
 * getReviewByAgentSessionId / review-persistence-service。
 */

import type { ObjectId, Review, Timestamp } from '@asci/shared'

import { nowIso, softDeleteRow } from '../internal/common.ts'
import { newObjectId } from '../internal/id.ts'
import { reviewFromRow, type ReviewRow } from '../internal/mappers.ts'
import type { RepoDb } from '../internal/repo-db.ts'

export interface CreateReviewInput {
  title: string
  intent: string
  sourceCapability: string
  sourceEvidenceSetId?: ObjectId
  topic?: string
  agentSessionId?: string
  /** 正文文件绝对路径；cwd 模式必填，inline / 兜底可空（由 readReviewBody 推导） */
  bodyPath?: string
}

export interface UpdateReviewInput {
  title?: string
  intent?: string
  sourceEvidenceSetId?: ObjectId | null
  topic?: string | null
  agentSessionId?: string | null
  bodyPath?: string | null
}

export function createReview(db: RepoDb, input: CreateReviewInput): Review {
  const id = newObjectId()
  const now: Timestamp = nowIso()
  db.prepare(
    `INSERT INTO reviews
       (id, title, intent, source_capability, source_evidence_set_id,
        topic, agent_session_id, body_path,
        visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'visible', ?, ?)`,
  ).run(
    id,
    input.title,
    input.intent,
    input.sourceCapability,
    input.sourceEvidenceSetId ?? null,
    input.topic ?? null,
    input.agentSessionId ?? null,
    input.bodyPath ?? null,
    now,
    now,
  )
  return getReviewByIdOrThrow(db, id)
}

export function getReviewById(db: RepoDb, id: ObjectId): Review | null {
  const row = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(id) as ReviewRow | undefined
  return row ? reviewFromRow(row) : null
}

function getReviewByIdOrThrow(db: RepoDb, id: ObjectId): Review {
  const r = getReviewById(db, id)
  if (!r) throw new Error(`[review-repo] review not found after write: ${id}`)
  return r
}

/**
 * 按 agentSessionId 反查最新一条非删除的 Review，命中索引 idx_reviews_agent_session。
 *
 * 设计：同一会话最多落一条综述（业务约束，DB 无 UNIQUE 保护）；若历史上写过多条
 * （例如人工 SQL 介入），返回 created_at 最新的一条。null 表示该会话还没落过。
 */
export function getReviewByAgentSessionId(
  db: RepoDb,
  agentSessionId: string,
): Review | null {
  const row = db
    .prepare(
      `SELECT * FROM reviews
        WHERE agent_session_id = ? AND visibility != 'deleted'
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(agentSessionId) as ReviewRow | undefined
  return row ? reviewFromRow(row) : null
}

/**
 * 按 body_path（综述 HTML 文件绝对路径）反查 Review。
 *
 * 用途：UI 侧通过文件路径加载综述预览（ReviewHtmlPreviewRenderer），需要拿到
 * 对应的 review.id 才能进一步操作（如 Add note here）。同一 body_path 理应至多
 * 一条非 deleted 综述（业务约束，DB 无 UNIQUE）；若历史多条则返回 created_at 最新一条。
 *
 * 返回 null 表示该 path 对应的 review 行不存在（可能用户在看裸 HTML 文件，
 * 不是 DB 关联的综述）。
 */
export function getReviewByBodyPath(db: RepoDb, bodyPath: string): Review | null {
  const row = db
    .prepare(
      `SELECT * FROM reviews
        WHERE body_path = ? AND visibility != 'deleted'
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(bodyPath) as ReviewRow | undefined
  return row ? reviewFromRow(row) : null
}

/**
 * 按 source_evidence_set_id 反查最新一条非删除的 Review。
 *
 * 用途：证据集详情面板判定「本证据集是否由某篇综述派生而来」——综述落库时
 * parseAndAttachReviewCitations 会把抽出的 §7 References 建成 evidence_set 并把
 * review.source_evidence_set_id 指回它（见 review-persistence-service）。这里做反向
 * 查询，拿到那篇源综述用于展示「综述原文」入口。
 *
 * 业务约束：一个 evidence_set 至多被一篇 review 指向（DB 无 UNIQUE 保护）；若历史
 * 多条则返回 created_at 最新一条。null 表示该 set 不是任何综述派生出来的。
 */
export function getReviewBySourceEvidenceSetId(
  db: RepoDb,
  evidenceSetId: ObjectId,
): Review | null {
  const row = db
    .prepare(
      `SELECT * FROM reviews
        WHERE source_evidence_set_id = ? AND visibility != 'deleted'
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(evidenceSetId) as ReviewRow | undefined
  return row ? reviewFromRow(row) : null
}

export function updateReview(db: RepoDb, id: ObjectId, patch: UpdateReviewInput): Review {
  const existing = getReviewByIdOrThrow(db, id)
  const now: Timestamp = nowIso()
  const title = patch.title ?? existing.title
  const intent = patch.intent ?? existing.intent
  const sourceEvidenceSetId =
    patch.sourceEvidenceSetId === null
      ? null
      : patch.sourceEvidenceSetId ?? existing.sourceEvidenceSetId ?? null
  const topic =
    patch.topic === null ? null : patch.topic ?? existing.topic ?? null
  const agentSessionId =
    patch.agentSessionId === null
      ? null
      : patch.agentSessionId ?? existing.agentSessionId ?? null
  const bodyPath =
    patch.bodyPath === null
      ? null
      : patch.bodyPath ?? existing.bodyPath ?? null
  db.prepare(
    `UPDATE reviews
       SET title = ?, intent = ?, source_evidence_set_id = ?,
           topic = ?, agent_session_id = ?, body_path = ?,
           updated_at = ?
     WHERE id = ?`,
  ).run(title, intent, sourceEvidenceSetId, topic, agentSessionId, bodyPath, now, id)
  return getReviewByIdOrThrow(db, id)
}

export function softDeleteReview(db: RepoDb, id: ObjectId): void {
  softDeleteRow(db, 'reviews', id, nowIso())
}

export function listReviews(db: RepoDb, opts: { includeDeleted?: boolean } = {}): Review[] {
  const where = opts.includeDeleted ? '' : `WHERE visibility != 'deleted'`
  const rows = db
    .prepare(`SELECT * FROM reviews ${where} ORDER BY created_at DESC`)
    .all() as ReviewRow[]
  return rows.map(reviewFromRow)
}
