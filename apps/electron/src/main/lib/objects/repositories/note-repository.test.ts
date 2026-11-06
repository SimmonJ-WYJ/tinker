/**
 * Note repo 集成测试 —— B4 后：移除 hypothesis 概念，仅保留 body / 软删 / P1 追加不覆盖语义。
 */

import { describe, expect, test } from 'bun:test'

import type { ObjectId } from '@asci/shared'

import { openTestDb } from './_helpers.test.ts'
import {
  createNote,
  getNoteById,
  listNotes,
  softDeleteNote,
  updateNoteBody,
} from './note-repository.ts'

describe('note-repository: V5 / P1 追加不覆盖', () => {
  test('连续写 3 条 Note → 全部可见（P1 核心断言）', () => {
    const { repo } = openTestDb()
    const n1 = createNote(repo, { body: 'first' })
    const n2 = createNote(repo, { body: 'second' })
    const n3 = createNote(repo, { body: 'third' })
    const all = listNotes(repo)
    expect(all.length).toBe(3)
    expect(all.map((n) => n.id).sort()).toEqual([n1.id, n2.id, n3.id].sort())
    expect(all.map((n) => n.body).sort()).toEqual(['first', 'second', 'third'])
  })
})

describe('note-repository: update + softDelete', () => {
  test('updateNoteBody 改文本 + 推进 updated_at', async () => {
    const { repo } = openTestDb()
    const n = createNote(repo, { body: 'orig' })
    await new Promise((r) => setTimeout(r, 5))
    const updated = updateNoteBody(repo, n.id, 'new')
    expect(updated.body).toBe('new')
    expect(updated.updatedAt >= n.updatedAt).toBe(true)
    expect(updated.createdAt).toBe(n.createdAt)
  })

  test('softDeleteNote → listNotes 默认看不到', () => {
    const { repo } = openTestDb()
    const n = createNote(repo, { body: 'x' })
    softDeleteNote(repo, n.id)
    expect(listNotes(repo).length).toBe(0)
    expect(listNotes(repo, { includeDeleted: true }).length).toBe(1)
  })

  test('updateNoteBody 不存在的 id 抛错', () => {
    const { repo } = openTestDb()
    expect(() => updateNoteBody(repo, 'no' as ObjectId, 'x')).toThrow(/not found/)
  })

  test('getNoteById 找不到返回 null', () => {
    const { repo } = openTestDb()
    expect(getNoteById(repo, 'no' as ObjectId)).toBeNull()
  })
})
