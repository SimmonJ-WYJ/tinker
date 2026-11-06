/**
 * EvidenceSet 仓储层（含 1 张关联表事务）
 *
 * 一个 EvidenceSet 由主表 + 一张关联表组成：
 *   - evidence_sets：主表元数据 + note_id 1:1 强绑定
 *   - evidence_set_refs：(set_id, ref_id, position) — 含顺序
 *
 * v0.2 重构后：
 *   - 新增 noteId 字段（NOT NULL UNIQUE FK → notes.id ON DELETE CASCADE）
 *   - 删除 paperIds（paper ↔ set 关系完全由 evidence_refs 表达）
 *   - 删除 evidence_set_papers 关联表
 *
 * persisted 字段的双语义：
 *   - persisted=true：用户显式保存的命名集合 → name + savedAt 必填
 *   - persisted=false：对话临时产物 / 划词建注默认形态 → name + savedAt 必空
 * schema CHECK 约束已守门；本仓储 createEvidenceSet 输入校验同样守门
 * （schema CHECK 抛错时上下文信息更难诊断，应用层先抛"清晰错"更友好）。
 *
 * --- 删除链 ---
 * 删 evidence_set 需要清理悬空的 evidence_refs(target='evidence-set')：
 *   - softDelete 路径：visibility 改 deleted，**不级联**；如需保持引用图整洁，
 *     由调用方决定是否同时软删 refs
 *   - hard delete 路径：DB CASCADE 自动清掉 evidence_set_refs；evidence_refs
 *     依赖应用层 deleteRefsByTarget('evidence-set', setId) 提前调用
 */

import type { EvidenceSet, EvidenceSetSource, ObjectId, Timestamp } from '@asci/shared'

import { nowIso, softDeleteRow } from '../internal/common.ts'
import { newObjectId } from '../internal/id.ts'
import {
  evidenceSetFromRow,
  type EvidenceSetRefRow,
  type EvidenceSetRow,
} from '../internal/mappers.ts'
import type { RepoDb } from '../internal/repo-db.ts'

export interface CreateEvidenceSetInput {
  /**
   * 与本 set 1:1 绑定的 Note id（DB UNIQUE 约束）。
   *
   * B2 之后可空：
   *   - source='user-highlight' 路径必传
   *   - source='agent-assembled' 路径必空（Agent 临时产物，promote 时再补 note）
   *   - source 留空（兼容历史）按调用方约定，DB CHECK 不强制
   */
  noteId?: ObjectId
  persisted: boolean
  /** persisted=true 时必填，persisted=false 时禁传 */
  name?: string
  /** persisted=true 时必填，persisted=false 时禁传 */
  savedAt?: Timestamp
  /** 初始关联的 EvidenceRef 列表（保序）；空数组合法 */
  evidenceRefIds: ObjectId[]
  /** 创建来源标记；可空（未标记） */
  source?: EvidenceSetSource
  /**
   * 所属 agent workspace id（issue #457）；必填、非空。
   * 证据集 scope 到 workspace —— 缺失即抛错，杜绝"NULL=全局可见"导致跨 workspace 串数据。
   */
  workspaceId: string
}

function validatePersisted(input: { persisted: boolean; name?: string; savedAt?: Timestamp }): void {
  if (input.persisted) {
    if (!input.name) {
      throw new Error(`[evidence-set-repo] persisted=true 时 name 必填`)
    }
    if (!input.savedAt) {
      throw new Error(`[evidence-set-repo] persisted=true 时 savedAt 必填`)
    }
  } else {
    if (input.name !== undefined) {
      throw new Error(`[evidence-set-repo] persisted=false 时 name 必空`)
    }
    if (input.savedAt !== undefined) {
      throw new Error(`[evidence-set-repo] persisted=false 时 savedAt 必空`)
    }
  }
}

/**
 * source 与 noteId 联动校验：
 *   - 'user-highlight'  → noteId 必传（划词建注一气呵成）
 *   - 'agent-assembled' → noteId 必空（待用户 promote 后再绑定 note）
 *   - undefined         → 不强制（兼容历史路径）
 *
 * 与 DB CHECK 约束镜像；先在应用层抛 Error 比 SQLite CHECK 触发抛错更易诊断。
 */
function validateSourceNoteBinding(input: { source?: EvidenceSetSource; noteId?: ObjectId }): void {
  if (input.source === 'user-highlight' && !input.noteId) {
    throw new Error(`[evidence-set-repo] source='user-highlight' 时 noteId 必传`)
  }
  if (input.source === 'agent-assembled' && input.noteId !== undefined) {
    throw new Error(`[evidence-set-repo] source='agent-assembled' 时 noteId 必空（promote 后再绑定）`)
  }
}

export function createEvidenceSet(db: RepoDb, input: CreateEvidenceSetInput): EvidenceSet {
  validatePersisted(input)
  validateSourceNoteBinding(input)
  if (!input.workspaceId || !input.workspaceId.trim()) {
    throw new Error(`[evidence-set-repo] workspaceId 必填且非空（issue #457：证据集必须 scope 到 workspace）`)
  }
  const id = newObjectId()
  const now: Timestamp = nowIso()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO evidence_sets
         (id, note_id, persisted, name, saved_at, source, workspace_id, visibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'visible', ?, ?)`,
    ).run(
      id,
      input.noteId ?? null,
      input.persisted ? 1 : 0,
      input.name ?? null,
      input.savedAt ?? null,
      input.source ?? null,
      input.workspaceId,
      now,
      now,
    )
    insertSetRefs(db, id, input.evidenceRefIds)
  })()
  return getEvidenceSetByIdOrThrow(db, id)
}

function insertSetRefs(db: RepoDb, setId: ObjectId, refIds: ObjectId[]): void {
  if (refIds.length === 0) return
  const stmt = db.prepare(
    `INSERT INTO evidence_set_refs (set_id, ref_id, position) VALUES (?, ?, ?)`,
  )
  for (let i = 0; i < refIds.length; i++) {
    stmt.run(setId, refIds[i] as ObjectId, i)
  }
}

export function getEvidenceSetById(db: RepoDb, id: ObjectId): EvidenceSet | null {
  const row = db.prepare(`SELECT * FROM evidence_sets WHERE id = ?`).get(id) as
    | EvidenceSetRow
    | undefined
  if (!row) return null
  const refIds = readRefIds(db, id)
  return evidenceSetFromRow(row, refIds)
}

/** 按 note_id 反查 EvidenceSet（1:1 强绑定，至多一条） */
export function getEvidenceSetByNoteId(db: RepoDb, noteId: ObjectId): EvidenceSet | null {
  const row = db.prepare(`SELECT * FROM evidence_sets WHERE note_id = ?`).get(noteId) as
    | EvidenceSetRow
    | undefined
  if (!row) return null
  const refIds = readRefIds(db, row.id as ObjectId)
  return evidenceSetFromRow(row, refIds)
}

function readRefIds(db: RepoDb, setId: ObjectId): ObjectId[] {
  return (
    db
      .prepare(
        `SELECT ref_id FROM evidence_set_refs WHERE set_id = ? ORDER BY position`,
      )
      .all(setId) as Array<Pick<EvidenceSetRefRow, 'ref_id'>>
  ).map((r) => r.ref_id as ObjectId)
}

function getEvidenceSetByIdOrThrow(db: RepoDb, id: ObjectId): EvidenceSet {
  const s = getEvidenceSetById(db, id)
  if (!s) throw new Error(`[evidence-set-repo] set not found after write: ${id}`)
  return s
}

/** 整体替换 EvidenceSet 的 EvidenceRef 列表（按传入顺序重排 position）；事务内 */
export function setEvidenceRefIds(db: RepoDb, id: ObjectId, refIds: ObjectId[]): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM evidence_set_refs WHERE set_id = ?`).run(id)
    insertSetRefs(db, id, refIds)
    db.prepare(`UPDATE evidence_sets SET updated_at = ? WHERE id = ?`).run(nowIso(), id)
  })()
}

/** 在集合尾部追加一条 ref；事务内（position = 当前 max + 1） */
export function appendEvidenceRefToSet(db: RepoDb, setId: ObjectId, refId: ObjectId): void {
  db.transaction(() => {
    const row = db
      .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM evidence_set_refs WHERE set_id = ?`)
      .get(setId) as { next_pos: number }
    db.prepare(
      `INSERT INTO evidence_set_refs (set_id, ref_id, position) VALUES (?, ?, ?)`,
    ).run(setId, refId, row.next_pos)
    db.prepare(`UPDATE evidence_sets SET updated_at = ? WHERE id = ?`).run(nowIso(), setId)
  })()
}

export function softDeleteEvidenceSet(db: RepoDb, id: ObjectId): void {
  softDeleteRow(db, 'evidence_sets', id, nowIso())
}

/** 从集合移除一条 ref 的 join 行（按 ref_id，不动 ref 本身）；刷新 set.updated_at。事务内。 */
export function removeEvidenceRefFromSet(db: RepoDb, setId: ObjectId, refId: ObjectId): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM evidence_set_refs WHERE set_id = ? AND ref_id = ?`).run(setId, refId)
    db.prepare(`UPDATE evidence_sets SET updated_at = ? WHERE id = ?`).run(nowIso(), setId)
  })()
}

/** 某条 ref 当前被多少个集合引用（用于"从本集移除"后的孤儿判定）。 */
export function countSetsForRef(db: RepoDb, refId: ObjectId): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM evidence_set_refs WHERE ref_id = ?`)
    .get(refId) as { n: number }
  return row.n
}

/**
 * 把临时 set（persisted=0）提升为正式 set（persisted=1，写 name + saved_at）。
 *
 * 业务场景（B5）：综述写盘后台路径自动建的 set 默认 persisted=0；用户在 Agent
 * 消息上点 BookmarkPlus + 输入名 → 调本方法升级。
 *
 * 前置校验：
 *   - set 存在（否则抛错）
 *   - 当前 persisted=0（已经是 1 抛错，让上层转 toast.info "已保存"）
 *   - name 非空（应用层 trim 后判定）
 *
 * 调用方负责传入 savedAt（一般 nowIso()）；本函数不自己生成时间戳，便于测试。
 */
export function promoteToPersisted(
  db: RepoDb,
  id: ObjectId,
  name: string,
  savedAt: Timestamp,
): EvidenceSet {
  if (!name.trim()) {
    throw new Error(`[evidence-set-repo] promoteToPersisted: name 不能为空`)
  }
  const row = db
    .prepare(`SELECT persisted FROM evidence_sets WHERE id = ?`)
    .get(id) as { persisted: number } | undefined
  if (!row) {
    throw new Error(`[evidence-set-repo] promoteToPersisted: set not found: ${id}`)
  }
  if (row.persisted === 1) {
    throw new Error(`[evidence-set-repo] promoteToPersisted: set ${id} 已是 persisted=1`)
  }
  const now = nowIso()
  db.prepare(
    `UPDATE evidence_sets
       SET persisted = 1, name = ?, saved_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(name, savedAt, now, id)
  const after = getEvidenceSetById(db, id)
  if (!after) throw new Error(`[evidence-set-repo] promoteToPersisted: set ${id} disappeared after update`)
  return after
}

/**
 * 重命名一个已 persisted=1 的正式 set。
 *
 * 业务场景：用户在已保存证据集的 popover 内继续修改名字。
 * 前置校验：set 存在 + persisted=1（临时 set 应走 promoteToPersisted）+ name 非空。
 * 副作用：刷新 updated_at；不动 saved_at（仅在首次 promote 时写入）。
 */
export function renameEvidenceSet(
  db: RepoDb,
  id: ObjectId,
  name: string,
): EvidenceSet {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error(`[evidence-set-repo] renameEvidenceSet: name 不能为空`)
  }
  const row = db
    .prepare(`SELECT persisted FROM evidence_sets WHERE id = ?`)
    .get(id) as { persisted: number } | undefined
  if (!row) {
    throw new Error(`[evidence-set-repo] renameEvidenceSet: set not found: ${id}`)
  }
  if (row.persisted !== 1) {
    throw new Error(
      `[evidence-set-repo] renameEvidenceSet: set ${id} 还未 persisted=1，请先 promote`,
    )
  }
  db.prepare(`UPDATE evidence_sets SET name = ?, updated_at = ? WHERE id = ?`).run(
    trimmed,
    nowIso(),
    id,
  )
  const after = getEvidenceSetById(db, id)
  if (!after) throw new Error(`[evidence-set-repo] renameEvidenceSet: set ${id} disappeared after update`)
  return after
}

/**
 * 把 note 绑定到一个原本无 note 的 set，并把 source 升级到 'user-highlight' 语义。
 *
 * 仅在 promote agent-assembled set 为正式笔记的流程中使用：
 *   - 前提：set.note_id 必须为空（否则违反 UNIQUE）
 *   - source 由 'agent-assembled' 改成 'user-highlight'（用户认可即视同主动提升）
 *
 * 不在事务内：调用方（evidence-set-service.promoteSetToNote）会包一层事务。
 */
export function bindNoteToSet(db: RepoDb, setId: ObjectId, noteId: ObjectId): void {
  const row = db
    .prepare(`SELECT note_id, source FROM evidence_sets WHERE id = ?`)
    .get(setId) as { note_id: string | null; source: string | null } | undefined
  if (!row) {
    throw new Error(`[evidence-set-repo] bindNoteToSet: set not found: ${setId}`)
  }
  if (row.note_id != null) {
    throw new Error(
      `[evidence-set-repo] bindNoteToSet: set ${setId} already bound to note ${row.note_id}`,
    )
  }
  db.prepare(
    `UPDATE evidence_sets SET note_id = ?, source = 'user-highlight', updated_at = ? WHERE id = ?`,
  ).run(noteId, nowIso(), setId)
}

export function listEvidenceSets(
  db: RepoDb,
  opts: { includeDeleted?: boolean } = {},
): EvidenceSet[] {
  const where = opts.includeDeleted ? '' : `WHERE visibility != 'deleted'`
  const rows = db
    .prepare(`SELECT * FROM evidence_sets ${where} ORDER BY created_at DESC`)
    .all() as EvidenceSetRow[]
  return rows.map((row) => evidenceSetFromRow(row, readRefIds(db, row.id as ObjectId)))
}

// ============================================================================
// 笔记 ↔ 集 M:N join（003 主题容器化）
//
// evidence_set_notes(set_id, note_id, position) 镜像 evidence_set_refs：容器内笔记
// 与证据并列为 co-member。读取一律走这张表（不再读 evidence_sets.note_id legacy 列）。
// ============================================================================

/** 容器内笔记 id 列表（按 position 保序） */
export function readNoteIds(db: RepoDb, setId: ObjectId): ObjectId[] {
  return (
    db
      .prepare(`SELECT note_id FROM evidence_set_notes WHERE set_id = ? ORDER BY position`)
      .all(setId) as Array<{ note_id: string }>
  ).map((r) => r.note_id as ObjectId)
}

/**
 * 在容器尾部追加一条笔记 join（position = 当前 max + 1）；事务内。
 * 幂等：该笔记已在集中（UNIQUE(set_id, note_id)）则直接返回，不抛错、不挪位。
 */
export function appendNoteToSet(db: RepoDb, setId: ObjectId, noteId: ObjectId): void {
  db.transaction(() => {
    const existing = db
      .prepare(`SELECT 1 FROM evidence_set_notes WHERE set_id = ? AND note_id = ?`)
      .get(setId, noteId)
    if (existing) return
    const row = db
      .prepare(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM evidence_set_notes WHERE set_id = ?`,
      )
      .get(setId) as { next_pos: number }
    db.prepare(
      `INSERT INTO evidence_set_notes (set_id, note_id, position) VALUES (?, ?, ?)`,
    ).run(setId, noteId, row.next_pos)
    db.prepare(`UPDATE evidence_sets SET updated_at = ? WHERE id = ?`).run(nowIso(), setId)
  })()
}

/** 从容器移除一条笔记 join 行（不动 note 本身，软删 note 由调用方另做）；事务内 */
export function removeNoteFromSet(db: RepoDb, setId: ObjectId, noteId: ObjectId): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM evidence_set_notes WHERE set_id = ? AND note_id = ?`).run(setId, noteId)
    db.prepare(`UPDATE evidence_sets SET updated_at = ? WHERE id = ?`).run(nowIso(), setId)
  })()
}

/** 反查：某笔记归属的所有未删容器 id（M:N，0.5 多归属用；本期单归属至多一条） */
export function listSetIdsByNote(db: RepoDb, noteId: ObjectId): ObjectId[] {
  return (
    db
      .prepare(
        `SELECT esn.set_id FROM evidence_set_notes esn
           JOIN evidence_sets es ON es.id = esn.set_id
          WHERE esn.note_id = ? AND es.visibility != 'deleted'
          ORDER BY esn.set_id`,
      )
      .all(noteId) as Array<{ set_id: string }>
  ).map((r) => r.set_id as ObjectId)
}

// ============================================================================
// 容器级标签（003）
// ============================================================================

/** 读容器的 tags（字典序） */
export function readTags(db: RepoDb, setId: ObjectId): string[] {
  return (
    db.prepare(`SELECT tag FROM evidence_set_tags WHERE set_id = ? ORDER BY tag`).all(setId) as Array<{
      tag: string
    }>
  ).map((r) => r.tag)
}

/**
 * 整体替换容器的 tags（DELETE + 重新 INSERT）；事务内。
 * 入参去空白 + 去重；空数组 = 清空所有标签。
 */
export function setTags(db: RepoDb, setId: ObjectId, tags: string[]): void {
  const cleaned = [...new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0))]
  db.transaction(() => {
    db.prepare(`DELETE FROM evidence_set_tags WHERE set_id = ?`).run(setId)
    const stmt = db.prepare(`INSERT INTO evidence_set_tags (set_id, tag) VALUES (?, ?)`)
    for (const tag of cleaned) stmt.run(setId, tag)
    db.prepare(`UPDATE evidence_sets SET updated_at = ? WHERE id = ?`).run(nowIso(), setId)
  })()
}

/** 列出某 workspace 内所有用过的 tag（DISTINCT，字典序）——给库列表筛选条的候选 chips */
export function listAllTags(db: RepoDb, workspaceId: string): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT t.tag FROM evidence_set_tags t
           JOIN evidence_sets es ON es.id = t.set_id
          WHERE es.workspace_id = ? AND es.visibility != 'deleted'
          ORDER BY t.tag`,
      )
      .all(workspaceId) as Array<{ tag: string }>
  ).map((r) => r.tag)
}
