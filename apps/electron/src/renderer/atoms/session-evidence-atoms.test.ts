/**
 * session-evidence-atoms 测试（v0.2 证据列表数据模型重构后）
 *
 * - EvidenceSet 1:1 强绑定 Note（set.noteId UNIQUE）：notesByEvidenceSetIdAtom
 *   反查 set.noteId 命中的 note，最多 1 条
 * - paper 成员关系由 sessionEvidenceSetPapersAtom 副车存储（mock-only）
 */
import { test, expect, beforeEach } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import type { EvidenceSet, Note, ObjectId } from '@asci/shared'
import {
  sessionEvidenceSetsAtom,
  sessionEvidenceSetNotesAtom,
  sessionEvidenceSetPapersAtom,
  evidenceSetByIdAtom,
  notesByEvidenceSetIdAtom,
  memberPapersNotesByEvidenceSetIdAtom,
} from './session-evidence-atoms'

const baseMeta = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  visibility: 'visible' as const,
}

function buildSet(id: string, noteId: string): EvidenceSet {
  return {
    id: id as ObjectId,
    noteId: noteId as ObjectId,
    persisted: true,
    name: id,
    evidenceRefIds: [],
    savedAt: baseMeta.createdAt,
    ...baseMeta,
  }
}

beforeEach(() => {
  // atomFamily 是模块级缓存,测试间清理避免污染
  evidenceSetByIdAtom.remove('S1' as ObjectId)
  evidenceSetByIdAtom.remove('S2' as ObjectId)
  evidenceSetByIdAtom.remove(null)
  notesByEvidenceSetIdAtom.remove('S1' as ObjectId)
  notesByEvidenceSetIdAtom.remove('S2' as ObjectId)
  memberPapersNotesByEvidenceSetIdAtom.remove('S1' as ObjectId)
  memberPapersNotesByEvidenceSetIdAtom.remove('S2' as ObjectId)
  memberPapersNotesByEvidenceSetIdAtom.remove('NOPE' as ObjectId)
})

test('evidenceSetByIdAtom: id 命中返回 set,id null 返回 null', () => {
  const store = createStore()
  store.set(sessionEvidenceSetsAtom, [buildSet('S1', 'N1')])

  expect(store.get(evidenceSetByIdAtom('S1' as ObjectId))).not.toBeNull()
  expect(store.get(evidenceSetByIdAtom('S1' as ObjectId))?.id).toBe('S1' as ObjectId)
  expect(store.get(evidenceSetByIdAtom('S2' as ObjectId))).toBeNull()
  expect(store.get(evidenceSetByIdAtom(null))).toBeNull()
})

test('notesByEvidenceSetIdAtom: 1:1 反查 —— 命中 set.noteId 的 Note 唯一', () => {
  const store = createStore()
  const notes: Note[] = [
    { id: 'N1' as ObjectId, body: 'a', ...baseMeta },
    { id: 'N2' as ObjectId, body: 'b', ...baseMeta },
    { id: 'N_ORPHAN' as ObjectId, body: 'c', ...baseMeta },
  ]
  store.set(sessionEvidenceSetsAtom, [buildSet('S1', 'N1'), buildSet('S2', 'N2')])
  store.set(sessionEvidenceSetNotesAtom, notes)

  const r1 = store.get(notesByEvidenceSetIdAtom('S1' as ObjectId))
  expect(r1).toHaveLength(1)
  expect(r1[0]!.id).toBe('N1' as ObjectId)

  const r2 = store.get(notesByEvidenceSetIdAtom('S2' as ObjectId))
  expect(r2).toHaveLength(1)
  expect(r2[0]!.id).toBe('N2' as ObjectId)
})

test('notesByEvidenceSetIdAtom: set.noteId 指向不存在 note 时返回 []', () => {
  const store = createStore()
  store.set(sessionEvidenceSetsAtom, [buildSet('S1', 'N_MISSING')])
  store.set(sessionEvidenceSetNotesAtom, [])
  expect(store.get(notesByEvidenceSetIdAtom('S1' as ObjectId))).toEqual([])
})

test('memberPapersNotesByEvidenceSetIdAtom: 按副车 paperIds 顺序返回空 notes(mock 阶段)', () => {
  // mock 阶段未接 IPC notes.listByPaper,所有 paper 的 notes 暂时返回空数组
  const store = createStore()
  store.set(sessionEvidenceSetsAtom, [buildSet('S1', 'N1')])
  store.set(sessionEvidenceSetPapersAtom, {
    S1: ['P_A' as ObjectId, 'P_B' as ObjectId],
  })

  const result = store.get(memberPapersNotesByEvidenceSetIdAtom('S1' as ObjectId))
  expect(result).toHaveLength(2)
  expect(result[0]!.paperId).toBe('P_A' as ObjectId)
  expect(result[0]!.notes).toEqual([])
  expect(result[1]!.paperId).toBe('P_B' as ObjectId)
  expect(result[1]!.notes).toEqual([])
})

test('memberPapersNotesByEvidenceSetIdAtom: 不存在的 set id 返回 []', () => {
  const store = createStore()
  expect(store.get(memberPapersNotesByEvidenceSetIdAtom('NOPE' as ObjectId))).toEqual([])
})
