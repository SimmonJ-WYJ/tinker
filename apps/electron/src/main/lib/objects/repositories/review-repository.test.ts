/**
 * Review repo 集成测试
 */

import { describe, expect, test } from 'bun:test'

import type { ObjectId } from '@asci/shared'

import { openTestDb } from './_helpers.test.ts'
import {
  createReview,
  getReviewByAgentSessionId,
  getReviewById,
  getReviewBySourceEvidenceSetId,
  listReviews,
  softDeleteReview,
  updateReview,
} from './review-repository.ts'

/** 建一个 1:1 绑 note 的 evidence_set（FK 要求），返回 set id */
function seedEvidenceSet(
  db: ReturnType<typeof openTestDb>['db'],
  setId: string,
  noteId: string,
): ObjectId {
  db.prepare(
    `INSERT INTO notes (id, body, created_at, updated_at)
     VALUES (?, 'b', '2026-05-19T10:00:00Z', '2026-05-19T10:00:00Z')`,
  ).run(noteId)
  db.prepare(
    `INSERT INTO evidence_sets (id, note_id, persisted, name, saved_at, created_at, updated_at, workspace_id)
     VALUES (?, ?, 1, 'n', '2026-05-19T10:00:00Z', '2026-05-19T10:00:00Z', '2026-05-19T10:00:00Z', 'ws-test')`,
  ).run(setId, noteId)
  return setId as ObjectId
}

describe('review-repository: create + read', () => {
  test('createReview 必填字段落库 + 默认 visibility=visible', () => {
    const { repo } = openTestDb()
    const r = createReview(repo, {
      title: 'RAG vs Long-context',
      intent: '调研 RAG 与长上下文权衡',
      sourceCapability: 'capability/review-synthesizer',
    })
    expect(r.id.length).toBeGreaterThan(0)
    expect(r.sourceEvidenceSetId).toBeUndefined()
    expect(r.visibility).toBe('visible')
  })

  test('createReview 携带 sourceEvidenceSetId 需对应 EvidenceSet 存在', () => {
    const { db, repo } = openTestDb()
    // v0.2 后 evidence_sets 必须 1:1 绑 note：先插 note 再插 set
    db.prepare(
      `INSERT INTO notes (id, body, created_at, updated_at)
       VALUES ('note-1', 'b', '2026-05-19T10:00:00Z', '2026-05-19T10:00:00Z')`,
    ).run()
    db.prepare(
      `INSERT INTO evidence_sets (id, note_id, persisted, name, saved_at, created_at, updated_at, workspace_id)
       VALUES ('s-1', 'note-1', 1, 'n', '2026-05-19T10:00:00Z', '2026-05-19T10:00:00Z', '2026-05-19T10:00:00Z', 'ws-test')`,
    ).run()
    const r = createReview(repo, {
      title: 't',
      intent: 'i',
      sourceCapability: 'cap',
      sourceEvidenceSetId: 's-1' as ObjectId,
    })
    expect(r.sourceEvidenceSetId).toBe('s-1' as ObjectId)
  })

  test('createReview 指向不存在的 EvidenceSet → FK 抛错', () => {
    const { repo } = openTestDb()
    expect(() =>
      createReview(repo, {
        title: 't',
        intent: 'i',
        sourceCapability: 'cap',
        sourceEvidenceSetId: 'ghost' as ObjectId,
      }),
    ).toThrow(/FOREIGN KEY/i)
  })

  test('getReviewById 找不到返回 null', () => {
    const { repo } = openTestDb()
    expect(getReviewById(repo, 'no' as ObjectId)).toBeNull()
  })
})

describe('review-repository: update + softDelete + list', () => {
  test('updateReview 改 title / intent；sourceEvidenceSetId 可清空', () => {
    const { db, repo } = openTestDb()
    db.prepare(
      `INSERT INTO notes (id, body, created_at, updated_at)
       VALUES ('note-1', 'b', '2026-05-19T10:00:00Z', '2026-05-19T10:00:00Z')`,
    ).run()
    db.prepare(
      `INSERT INTO evidence_sets (id, note_id, persisted, name, saved_at, created_at, updated_at, workspace_id)
       VALUES ('s-1', 'note-1', 1, 'n', '2026-05-19T10:00:00Z', '2026-05-19T10:00:00Z', '2026-05-19T10:00:00Z', 'ws-test')`,
    ).run()
    const r = createReview(repo, {
      title: 'orig',
      intent: 'orig intent',
      sourceCapability: 'cap',
      sourceEvidenceSetId: 's-1' as ObjectId,
    })
    const updated = updateReview(repo, r.id, {
      title: 'new title',
      sourceEvidenceSetId: null,
    })
    expect(updated.title).toBe('new title')
    expect(updated.intent).toBe('orig intent')
    expect(updated.sourceEvidenceSetId).toBeUndefined()
  })

  test('softDeleteReview 不级联清空 evidence_refs（仍存留；应用层 GC 在 hard delete 路径才清理）', () => {
    const { db, repo } = openTestDb()
    db.prepare(
      `INSERT INTO papers (id, title, authors_json, created_at, updated_at)
       VALUES ('p-1', 't', '[]', '2026-05-19T10:00:00Z', '2026-05-19T10:00:00Z')`,
    ).run()
    const r = createReview(repo, { title: 't', intent: 'i', sourceCapability: 'c' })
    db.prepare(
      `INSERT INTO evidence_refs
         (id, source_kind, source_id, source_anchor,
          target_kind, target_id, target_anchor,
          created_at, updated_at)
       VALUES ('r-1', 'paper', 'p-1', 'a', 'review', ?, 'b',
               '2026-05-19T10:00:00Z', '2026-05-19T10:00:00Z')`,
    ).run(r.id)
    softDeleteReview(repo, r.id)
    const count = (db.query('SELECT COUNT(*) AS n FROM evidence_refs').get() as { n: number }).n
    expect(count).toBe(1)
  })

  test('listReviews 默认排除 deleted', () => {
    const { repo } = openTestDb()
    const alive = createReview(repo, { title: 'a', intent: 'i', sourceCapability: 'c' })
    const dead = createReview(repo, { title: 'b', intent: 'i', sourceCapability: 'c' })
    softDeleteReview(repo, dead.id)
    const list = listReviews(repo)
    expect(list.map((r) => r.id)).toEqual([alive.id])
  })
})

describe('review-repository: topic + agent_session_id', () => {
  test('createReview 落 topic 与 agentSessionId 并 round-trip', () => {
    const { repo } = openTestDb()
    const r = createReview(repo, {
      title: 't',
      intent: 'i',
      sourceCapability: 'c',
      topic: 'RAG 综述',
      agentSessionId: 'sess-xyz',
    })
    expect(r.topic).toBe('RAG 综述')
    expect(r.agentSessionId).toBe('sess-xyz')

    const read = getReviewById(repo, r.id)
    expect(read?.topic).toBe('RAG 综述')
    expect(read?.agentSessionId).toBe('sess-xyz')
  })

  test('createReview 不传 topic / agentSessionId 时为 undefined', () => {
    const { repo } = openTestDb()
    const r = createReview(repo, { title: 't', intent: 'i', sourceCapability: 'c' })
    expect(r.topic).toBeUndefined()
    expect(r.agentSessionId).toBeUndefined()
  })

  test('updateReview 可改 topic、agentSessionId，也可清空', () => {
    const { repo } = openTestDb()
    const r = createReview(repo, {
      title: 't',
      intent: 'i',
      sourceCapability: 'c',
      topic: 'old topic',
      agentSessionId: 'sess-1',
    })
    const u1 = updateReview(repo, r.id, { topic: 'new topic' })
    expect(u1.topic).toBe('new topic')
    expect(u1.agentSessionId).toBe('sess-1')

    const u2 = updateReview(repo, r.id, { topic: null, agentSessionId: null })
    expect(u2.topic).toBeUndefined()
    expect(u2.agentSessionId).toBeUndefined()
  })

  test('getReviewByAgentSessionId 命中最新一条非删除记录', () => {
    const { repo } = openTestDb()
    const a = createReview(repo, {
      title: 'a',
      intent: 'i',
      sourceCapability: 'c',
      agentSessionId: 'sess-A',
    })
    expect(getReviewByAgentSessionId(repo, 'sess-A')?.id).toBe(a.id)
    expect(getReviewByAgentSessionId(repo, 'sess-missing')).toBeNull()
  })

  test('getReviewByAgentSessionId 跳过已软删的记录', () => {
    const { repo } = openTestDb()
    const r = createReview(repo, {
      title: 't',
      intent: 'i',
      sourceCapability: 'c',
      agentSessionId: 'sess-deleted',
    })
    softDeleteReview(repo, r.id)
    expect(getReviewByAgentSessionId(repo, 'sess-deleted')).toBeNull()
  })

  test('createReview 落 bodyPath 并 round-trip', () => {
    const { repo } = openTestDb()
    const r = createReview(repo, {
      title: 't',
      intent: 'i',
      sourceCapability: 'c',
      bodyPath: '/abs/path/to/reviews/2026-05-21.md',
    })
    expect(r.bodyPath).toBe('/abs/path/to/reviews/2026-05-21.md')
    expect(getReviewById(repo, r.id)?.bodyPath).toBe('/abs/path/to/reviews/2026-05-21.md')
  })

  test('updateReview 可改 bodyPath 也可清空', () => {
    const { repo } = openTestDb()
    const r = createReview(repo, {
      title: 't',
      intent: 'i',
      sourceCapability: 'c',
      bodyPath: '/old/path.md',
    })
    const u1 = updateReview(repo, r.id, { bodyPath: '/new/path.md' })
    expect(u1.bodyPath).toBe('/new/path.md')
    const u2 = updateReview(repo, r.id, { bodyPath: null })
    expect(u2.bodyPath).toBeUndefined()
  })
})

describe('review-repository: getReviewBySourceEvidenceSetId', () => {
  test('命中指向该 set 的 review', () => {
    const { db, repo } = openTestDb()
    const setId = seedEvidenceSet(db, 's-1', 'note-1')
    const r = createReview(repo, {
      title: '综述原文',
      intent: 'i',
      sourceCapability: 'cap',
      sourceEvidenceSetId: setId,
    })
    expect(getReviewBySourceEvidenceSetId(repo, setId)?.id).toBe(r.id)
  })

  test('无 review 指向该 set → null', () => {
    const { db, repo } = openTestDb()
    const setId = seedEvidenceSet(db, 's-1', 'note-1')
    expect(getReviewBySourceEvidenceSetId(repo, setId)).toBeNull()
  })

  test('跳过已软删的 review', () => {
    const { db, repo } = openTestDb()
    const setId = seedEvidenceSet(db, 's-1', 'note-1')
    const r = createReview(repo, {
      title: 't',
      intent: 'i',
      sourceCapability: 'cap',
      sourceEvidenceSetId: setId,
    })
    softDeleteReview(repo, r.id)
    expect(getReviewBySourceEvidenceSetId(repo, setId)).toBeNull()
  })
})
