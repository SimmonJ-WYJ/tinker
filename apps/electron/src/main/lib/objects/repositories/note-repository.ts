/**
 * Note 仓储层
 *
 * 笔记的 CRUD + 软删。
 *
 * v0.2 重构后：notes 表不再带 target_kind / target_id —— note 是纯文本对象。
 * 与 paper / evidence-set 的关系由 evidence_sets.note_id 反向解析（B2 起 nullable，
 * agent-assembled 集合允许不绑定 note），与 paper 的段落级关系由 evidence_refs
 * (source=paper, target=set) 承载。
 *
 * B4 后：彻底移除 hypothesis 概念（kind / hypothesisStatus 字段已删）；与新数据
 * 模型设计稿一致，Note 单形态承载用户备注全文。
 *
 * 协议铁律：
 *   - P1 追加不覆盖：多次 createNote 不互相覆盖；DB 层 notes 没有任何 UNIQUE
 */

import type { Note, ObjectId, Timestamp } from '@asci/shared'

import { nowIso, softDeleteRow } from '../internal/common.ts'
import { newObjectId } from '../internal/id.ts'
import { noteFromRow, type NoteRow } from '../internal/mappers.ts'
import type { RepoDb } from '../internal/repo-db.ts'

export interface CreateNoteInput {
  body: string
}

export function createNote(db: RepoDb, input: CreateNoteInput): Note {
  const id = newObjectId()
  const now: Timestamp = nowIso()
  db.prepare(
    `INSERT INTO notes
       (id, body, visibility, created_at, updated_at)
     VALUES (?, ?, 'visible', ?, ?)`,
  ).run(id, input.body, now, now)
  return getNoteByIdOrThrow(db, id)
}

export function getNoteById(db: RepoDb, id: ObjectId): Note | null {
  const row = db.prepare(`SELECT * FROM notes WHERE id = ?`).get(id) as NoteRow | undefined
  return row ? noteFromRow(row) : null
}

function getNoteByIdOrThrow(db: RepoDb, id: ObjectId): Note {
  const n = getNoteById(db, id)
  if (!n) throw new Error(`[note-repo] note not found after write: ${id}`)
  return n
}

/**
 * 改 body：编辑既有 Note 文本，不影响其他 Note；与 P1 兼容
 *（P1 防的是"用新 Note 覆盖旧 Note"，不是"在同一条 Note 上改字"）。
 */
export function updateNoteBody(db: RepoDb, id: ObjectId, body: string): Note {
  const now = nowIso()
  const res = db
    .prepare(`UPDATE notes SET body = ?, updated_at = ? WHERE id = ?`)
    .run(body, now, id) as { changes: number }
  if (res.changes === 0) {
    throw new Error(`[note-repo] note not found: ${id}`)
  }
  return getNoteByIdOrThrow(db, id)
}

export function softDeleteNote(db: RepoDb, id: ObjectId): void {
  softDeleteRow(db, 'notes', id, nowIso())
}

/** 全工作区 Note 列表；默认排除 deleted；按 createdAt DESC */
export function listNotes(db: RepoDb, opts: { includeDeleted?: boolean } = {}): Note[] {
  const where = opts.includeDeleted ? '' : `WHERE visibility != 'deleted'`
  const rows = db
    .prepare(`SELECT * FROM notes ${where} ORDER BY created_at DESC`)
    .all() as NoteRow[]
  return rows.map(noteFromRow)
}
