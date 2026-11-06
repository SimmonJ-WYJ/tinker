/**
 * EvidenceRef 仓储层
 *
 * 通用引用关系：来源对象的段落锚点 → 引用承载方。
 *
 * v0.2 重构后双侧多态（见 docs/superpowers/specs/2026-05-22-evidence-list-data-model-design.md）：
 *
 *   source 端：当前 kind 仅 'paper'，CHECK 锁死；FK 指向 papers(id) ON DELETE CASCADE
 *   target 端：kind ∈ {'review', 'evidence-set'}，**FK 不支持跨表** → 应用层 GC：
 *     - 删 reviews 行 → 必须先调用 deleteRefsByTarget(db, 'review', reviewId)
 *     - 删 evidence_sets 行 → 必须先调用 deleteRefsByTarget(db, 'evidence-set', setId)
 *
 * 创建时由 DB 的 CHECK + FK 校验：target_kind='review' → target_anchor 必填；
 * target_kind='evidence-set' → target_anchor 必空。
 *
 * anchor 列存 Anchor JSON（见 anchor-codec.ts）；老 `quote` 字段已删，
 * snapshotText 嵌在 source.anchor 内。
 */

import type {
  EvidenceRef,
  EvidenceRefSource,
  EvidenceRefSourceKind,
  EvidenceRefTarget,
  EvidenceRefTargetKind,
  ObjectId,
  Timestamp,
} from '@asci/shared'

import { workspaceEventBus } from '../../workspace-event-bus.ts'
import { serializeAnchor } from '../anchor-codec.ts'
import { nowIso, softDeleteRow } from '../internal/common.ts'
import { newObjectId } from '../internal/id.ts'
import { evidenceRefFromRow, type EvidenceRefRow } from '../internal/mappers.ts'
import type { RepoDb } from '../internal/repo-db.ts'

export interface CreateEvidenceRefInput {
  source: EvidenceRefSource
  target: EvidenceRefTarget
}

export function createEvidenceRef(db: RepoDb, input: CreateEvidenceRefInput): EvidenceRef {
  const id = newObjectId()
  const now: Timestamp = nowIso()
  const targetAnchorJson =
    input.target.kind === 'review' ? serializeAnchor(input.target.anchor) : null
  db.prepare(
    `INSERT INTO evidence_refs
       (id, source_kind, source_id, source_anchor,
        target_kind, target_id, target_anchor,
        visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'visible', ?, ?)`,
  ).run(
    id,
    input.source.kind,
    input.source.id,
    serializeAnchor(input.source.anchor),
    input.target.kind,
    input.target.id,
    targetAnchorJson,
    now,
    now,
  )
  const ref = getEvidenceRefByIdOrThrow(db, id)
  // emit 仅当 source=paper + target=review 时（0.2 重构后唯一携带 paperId↔reviewId 语义的组合）
  if (input.source.kind === 'paper' && input.target.kind === 'review') {
    workspaceEventBus.emit({
      kind: 'evidenceRef.created',
      evidenceRefId: ref.id,
      sourcePaperId: input.source.id,
      targetReviewId: input.target.id,
      at: now,
    })
  }
  return ref
}

export function getEvidenceRefById(db: RepoDb, id: ObjectId): EvidenceRef | null {
  const row = db.prepare(`SELECT * FROM evidence_refs WHERE id = ?`).get(id) as
    | EvidenceRefRow
    | undefined
  return row ? evidenceRefFromRow(row) : null
}

function getEvidenceRefByIdOrThrow(db: RepoDb, id: ObjectId): EvidenceRef {
  const r = getEvidenceRefById(db, id)
  if (!r) throw new Error(`[evidence-ref-repo] not found after write: ${id}`)
  return r
}

export function softDeleteEvidenceRef(db: RepoDb, id: ObjectId): void {
  softDeleteRow(db, 'evidence_refs', id, nowIso())
}

export function listEvidenceRefs(
  db: RepoDb,
  opts: { includeDeleted?: boolean } = {},
): EvidenceRef[] {
  const where = opts.includeDeleted ? '' : `WHERE visibility != 'deleted'`
  const rows = db
    .prepare(`SELECT * FROM evidence_refs ${where} ORDER BY created_at DESC`)
    .all() as EvidenceRefRow[]
  return rows.map(evidenceRefFromRow)
}

/** 按 target（review 或 evidence-set）反查 evidence_refs */
export function listEvidenceRefsByTarget(
  db: RepoDb,
  targetKind: EvidenceRefTargetKind,
  targetId: ObjectId,
): EvidenceRef[] {
  const rows = db
    .prepare(
      `SELECT * FROM evidence_refs
       WHERE target_kind = ? AND target_id = ? AND visibility != 'deleted'
       ORDER BY source_id, created_at`,
    )
    .all(targetKind, targetId) as EvidenceRefRow[]
  return rows.map(evidenceRefFromRow)
}

/** 按 review 反查 evidence_refs（薄壳；保留旧 API 名，调用方逐步迁移） */
export function listEvidenceRefsByReview(db: RepoDb, reviewId: ObjectId): EvidenceRef[] {
  return listEvidenceRefsByTarget(db, 'review', reviewId)
}

/**
 * 按 source paper 反查 evidence_refs。
 * 当前 source_kind 仅 'paper'，所以索引仅按 source_id 过滤即可命中
 * `idx_evidence_refs_source (source_kind, source_id)` 复合索引前缀。
 */
export function listEvidenceRefsBySourcePaper(db: RepoDb, paperId: ObjectId): EvidenceRef[] {
  const rows = db
    .prepare(
      `SELECT * FROM evidence_refs
       WHERE source_kind = 'paper' AND source_id = ? AND visibility != 'deleted'
       ORDER BY target_kind, created_at`,
    )
    .all(paperId) as EvidenceRefRow[]
  return rows.map(evidenceRefFromRow)
}

/**
 * **硬删** 指定 target 下的所有 evidence_refs（应用层 GC 入口）。
 *
 * target 端是多态（review / evidence-set），SQLite FK 不支持跨表 → 删除 reviews
 * 或 evidence_sets 行时**必须先**调用本函数清理悬空 refs。
 *
 * 调用方应在同一事务里：
 *   1) deleteRefsByTarget(db, kind, id)
 *   2) 实际 DELETE/softDelete 目标行
 *
 * 同时清理 evidence_set_refs 关联表（如果是 evidence-set 目标，
 * 关联表会随 set 主表 ON DELETE CASCADE 自动消失；如果是 review，
 * 关联表 ref_id 侧无 CASCADE → 这里也一并清理）。
 */
export function deleteRefsByTarget(
  db: RepoDb,
  targetKind: EvidenceRefTargetKind,
  targetId: ObjectId,
): number {
  const refIds = (
    db
      .prepare(`SELECT id FROM evidence_refs WHERE target_kind = ? AND target_id = ?`)
      .all(targetKind, targetId) as { id: string }[]
  ).map((r) => r.id)
  if (refIds.length === 0) return 0
  const placeholders = refIds.map(() => '?').join(',')
  db.prepare(`DELETE FROM evidence_set_refs WHERE ref_id IN (${placeholders})`).run(...refIds)
  db.prepare(`DELETE FROM evidence_refs WHERE id IN (${placeholders})`).run(...refIds)
  return refIds.length
}

/**
 * **硬删** 指定 source 下的所有 evidence_refs（应用层 GC 入口）。
 *
 * source 端也变成多态（paper / review）后，source_id 不再持硬 FK（曾经
 * paper-only 时是 papers(id) ON DELETE CASCADE）→ 删除 papers / reviews
 * 时调用方**必须**先调本函数清理悬空 refs。
 *
 * 同时清理 evidence_set_refs 关联表（保持与 deleteRefsByTarget 对称的行为）。
 */
export function deleteRefsBySource(
  db: RepoDb,
  sourceKind: EvidenceRefSourceKind,
  sourceId: ObjectId,
): number {
  const refIds = (
    db
      .prepare(`SELECT id FROM evidence_refs WHERE source_kind = ? AND source_id = ?`)
      .all(sourceKind, sourceId) as { id: string }[]
  ).map((r) => r.id)
  if (refIds.length === 0) return 0
  const placeholders = refIds.map(() => '?').join(',')
  db.prepare(`DELETE FROM evidence_set_refs WHERE ref_id IN (${placeholders})`).run(...refIds)
  db.prepare(`DELETE FROM evidence_refs WHERE id IN (${placeholders})`).run(...refIds)
  return refIds.length
}

