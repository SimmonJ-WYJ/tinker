/**
 * Query 层集成测试（v0.2 证据列表重构后）
 *
 * 覆盖：
 *   - V5（P1 追加不覆盖）：同 paper 多条 Note 全返回，经 evidence_refs 三跳反查
 *   - V3（P2 源已移除）：软删 Paper 后 Review 视角下 EvidenceRef 反查的对端 state='removed'
 *   - 索引契约：EXPLAIN QUERY PLAN 抓取关键 SQL 的执行计划，断言走 idx_*
 *     而非 SCAN —— V6e 100+/1k+ Note 恒定时间反查的硬要求
 */

import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { buildConversationAnchor, buildHtmlAnchor, buildMdAnchor, buildPdfAnchor } from './anchor-codec.ts'

import { nowIso, type Anchor, type ObjectId, type Timestamp } from '@asci/shared'

import {
  queryAllNotesWithPaper,
  queryEvidenceRefsByPaper,
  queryEvidenceRefsByReview,
  queryEvidenceSetDetail,
  queryEvidenceSetSummaries,
  queryEvidenceSetSummariesByPaper,
  queryLatestReviewSetByAgentSession,
  queryNotesByEvidenceSet,
  queryNotesByPaper,
  sanitizeQuote,
} from './query-service.ts'
import { updateReview } from './repositories/review-repository.ts'
import { openTestDb } from './repositories/_helpers.test.ts'
import {
  createEvidenceRef,
  softDeleteEvidenceRef,
} from './repositories/evidence-ref-repository.ts'
import {
  appendEvidenceRefToSet,
  appendNoteToSet,
  createEvidenceSet,
  setTags,
  softDeleteEvidenceSet,
} from './repositories/evidence-set-repository.ts'
import { createNote, softDeleteNote } from './repositories/note-repository.ts'
import { createPaper, softDeletePaper } from './repositories/paper-repository.ts'
import { createReview } from './repositories/review-repository.ts'
import type { RepoDb } from './internal/repo-db.ts'

/**
 * 测试辅助：在新模型下"为 paper 建 note" = note + set + ref + setRef 4 步。
 * 各场景的差异（workspace / persisted 命名集合 / 自定义 anchor snapshot）走 opts，
 * 避免同一套 seed 流程散落多份变体。
 */
function attachNoteToPaper(
  repo: RepoDb,
  paperId: ObjectId,
  body: string,
  opts: {
    workspaceId?: string
    /** true = persisted 命名集合（自动补 savedAt；queryAllNotesWithPaper 可见） */
    persisted?: boolean
    name?: string
    snapshotText?: string
  } = {},
): { noteId: ObjectId; setId: ObjectId; refId: ObjectId } {
  const note = createNote(repo, { body })
  const persisted = opts.persisted ?? false
  const set = createEvidenceSet(repo, {
    workspaceId: opts.workspaceId ?? 'ws-test',
    noteId: note.id,
    persisted,
    // name / savedAt 仅 persisted=true 时可传（CreateEvidenceSetInput 约定）
    ...(persisted ? { name: opts.name ?? 'Set', savedAt: nowIso() as Timestamp } : {}),
    evidenceRefIds: [],
  })
  const anchor: Anchor = buildMdAnchor({ snapshotText: opts.snapshotText ?? 'snap' })
  const ref = createEvidenceRef(repo, {
    source: { kind: 'paper', id: paperId, anchor },
    target: { kind: 'evidence-set', id: set.id },
  })
  appendEvidenceRefToSet(repo, set.id, ref.id)
  return { noteId: note.id, setId: set.id, refId: ref.id }
}

/** 用 EXPLAIN QUERY PLAN 抓取执行计划，扁平拼成字符串便于断言索引名出现 */
function explainPlan(db: Database, sql: string, params: unknown[]): string {
  const rows = db.query(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as Array<{
    detail: string
  }>
  return rows.map((r) => r.detail).join(' | ')
}

// ---------------- V5: P1 追加不覆盖 ----------------

describe('query: V5 / P1 同 paper 多条 Note 全部返回（经 evidence_refs 反查）', () => {
  test('queryNotesByPaper 返回全部 3 条', async () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [] })
    const n1 = attachNoteToPaper(repo, p.id, 'first')
    await new Promise((r) => setTimeout(r, 5))
    const n2 = attachNoteToPaper(repo, p.id, 'second')
    await new Promise((r) => setTimeout(r, 5))
    const n3 = attachNoteToPaper(repo, p.id, 'third')
    const got = queryNotesByPaper(repo, p.id, 'ws-test')
    expect(got.map((it) => it.note.id).sort()).toEqual([n1.noteId, n2.noteId, n3.noteId].sort())
  })

  test('queryNotesByPaper 默认排除软删 Note', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [] })
    const alive = attachNoteToPaper(repo, p.id, 'a')
    const dead = attachNoteToPaper(repo, p.id, 'b')
    softDeleteNote(repo, dead.noteId)
    expect(queryNotesByPaper(repo, p.id, 'ws-test').map((it) => it.note.id)).toEqual([alive.noteId])
  })

  test('queryNotesByPaper 不串扰挂在其他 paper 的 Note', () => {
    const { repo } = openTestDb()
    const p1 = createPaper(repo, { title: 'P1', authors: [] })
    const p2 = createPaper(repo, { title: 'P2', authors: [] })
    attachNoteToPaper(repo, p1.id, 'p1-note')
    attachNoteToPaper(repo, p2.id, 'p2-note')
    expect(queryNotesByPaper(repo, p1.id, 'ws-test').length).toBe(1)
    expect(queryNotesByPaper(repo, p2.id, 'ws-test').length).toBe(1)
  })

  // issue #452：PDF 锚点页码随 NoteWithQuote.page 回吐，供 PdfRenderer 文本 miss 时回退翻页。
  test('queryNotesByPaper 回吐 pdf anchor 的页码；md anchor 无页码', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [] })
    // pdf anchor：带捕获页码 → page 应回吐
    const noteWithPage = createNote(repo, { body: 'pdf note' })
    const setWithPage = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: noteWithPage.id,
      persisted: false,
      evidenceRefIds: [],
    })
    const refWithPage = createEvidenceRef(repo, {
      source: {
        kind: 'paper',
        id: p.id,
        anchor: buildPdfAnchor({ snapshotText: 'formula', page: 5 }),
      },
      target: { kind: 'evidence-set', id: setWithPage.id },
    })
    appendEvidenceRefToSet(repo, setWithPage.id, refWithPage.id)
    // md anchor：无 page
    attachNoteToPaper(repo, p.id, 'md note', { snapshotText: 'plain' })

    const got = queryNotesByPaper(repo, p.id, 'ws-test')
    const pdfNote = got.find((it) => it.note.id === noteWithPage.id)
    const mdNote = got.find((it) => it.note.id !== noteWithPage.id)
    expect(pdfNote?.page).toBe(5)
    expect(mdNote?.page).toBeUndefined()
  })

  test('queryNotesByEvidenceSet：1:1 强绑定 → 返回单条 note', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [] })
    const { noteId, setId } = attachNoteToPaper(repo, p.id, 'set-note')
    const got = queryNotesByEvidenceSet(repo, setId)
    expect(got.length).toBe(1)
    expect(got[0]!.id).toBe(noteId)
  })
})

// ---------------- V3: P2 源已移除标记 ----------------

describe('query: V3 / P2 源 Paper 软删后引用反查带 state=removed', () => {
  test('EvidenceRef on Review 视角：源 Paper 软删 → sourcePaper.state="removed"', () => {
    const { repo } = openTestDb()
    const px = createPaper(repo, { title: 'X', authors: [] })
    const py = createPaper(repo, { title: 'Y', authors: [] })
    const rev = createReview(repo, { title: 'r', intent: 'i', sourceCapability: 'c' })
    const refX = createEvidenceRef(repo, {
      source: { kind: 'paper', id: px.id, anchor: buildMdAnchor({ snapshotText: 'a' }) },
      target: { kind: 'review', id: rev.id, anchor: buildHtmlAnchor({ snapshotText: 'b' }) },
    })
    const refY = createEvidenceRef(repo, {
      source: { kind: 'paper', id: py.id, anchor: buildMdAnchor({ snapshotText: 'c' }) },
      target: { kind: 'review', id: rev.id, anchor: buildHtmlAnchor({ snapshotText: 'd' }) },
    })
    softDeletePaper(repo, px.id)

    const result = queryEvidenceRefsByReview(repo, rev.id)
    expect(result.length).toBe(2)
    const xItem = result.find((r) => r.evidenceRef.id === refX.id)!
    const yItem = result.find((r) => r.evidenceRef.id === refY.id)!
    expect(xItem.sourcePaper.state).toBe('removed')
    if (xItem.sourcePaper.state === 'removed') {
      // V3 占位卡：从软删快照恢复原标题
      expect(xItem.sourcePaper.removedTitle).toBe('X')
    }
    expect(yItem.sourcePaper.state).toBe('present')
  })

  test('queryEvidenceRefsByPaper：软删的 EvidenceRef 自身被排除', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [] })
    const rev = createReview(repo, { title: 'r', intent: 'i', sourceCapability: 'c' })
    const r1 = createEvidenceRef(repo, {
      source: { kind: 'paper', id: p.id, anchor: buildMdAnchor({ snapshotText: 'a' }) },
      target: { kind: 'review', id: rev.id, anchor: buildHtmlAnchor({ snapshotText: 'b' }) },
    })
    const r2 = createEvidenceRef(repo, {
      source: { kind: 'paper', id: p.id, anchor: buildMdAnchor({ snapshotText: 'c' }) },
      target: { kind: 'review', id: rev.id, anchor: buildHtmlAnchor({ snapshotText: 'd' }) },
    })
    softDeleteEvidenceRef(repo, r2.id)
    expect(queryEvidenceRefsByPaper(repo, p.id).map((r) => r.id)).toEqual([r1.id])
  })
})

// ---------------- 索引契约：EXPLAIN QUERY PLAN ----------------

describe('query: 索引契约 (EXPLAIN QUERY PLAN) — V6e 恒定时间反查的硬要求', () => {
  test('queryEvidenceRefsByPaper SQL 走 idx_evidence_refs_source (source_kind, source_id)', () => {
    const { db } = openTestDb()
    const plan = explainPlan(
      db,
      `SELECT * FROM evidence_refs
        WHERE source_kind = 'paper'
          AND source_id   = ?
          AND visibility != 'deleted'
        ORDER BY created_at DESC`,
      ['anything'],
    )
    expect(plan).toContain('idx_evidence_refs_source')
    expect(plan).not.toMatch(/SCAN evidence_refs\b/i)
  })

  test('queryEvidenceRefsByReview SQL 走 idx_evidence_refs_target (target_kind, target_id)', () => {
    const { db } = openTestDb()
    const plan = explainPlan(
      db,
      `SELECT * FROM evidence_refs
        WHERE target_kind = 'review'
          AND target_id   = ?
          AND visibility != 'deleted'
        ORDER BY created_at DESC`,
      ['anything'],
    )
    expect(plan).toContain('idx_evidence_refs_target')
  })
})

// ---------------- queryEvidenceSetDetail 聚合查询 ----------------

/**
 * 测试辅助：建一个完整的 set + 关联的 note + N 条 evidence_refs（source=paper, target=set）。
 * 返回各方便测试断言的 id。
 */
function seedFullSet(
  repo: RepoDb,
  paperIds: ObjectId[],
  noteBody = 'set note body',
  workspaceId = 'ws-test',
): { setId: ObjectId; noteId: ObjectId; refIds: ObjectId[] } {
  const note = createNote(repo, { body: noteBody })
  const set = createEvidenceSet(repo, {
    workspaceId,
    noteId: note.id,
    persisted: false,
    evidenceRefIds: [],
  })
  const refIds: ObjectId[] = []
  for (const paperId of paperIds) {
    const ref = createEvidenceRef(repo, {
      source: {
        kind: 'paper',
        id: paperId,
        anchor: buildMdAnchor({ snapshotText: `snap for ${paperId}` }),
      },
      target: { kind: 'evidence-set', id: set.id },
    })
    appendEvidenceRefToSet(repo, set.id, ref.id)
    refIds.push(ref.id)
  }
  return { setId: set.id, noteId: note.id, refIds }
}

describe('queryEvidenceSetDetail: 基本聚合', () => {
  test('完整 set：note 命中，refs 按 position 升序，memberPapers 去重保序', () => {
    const { repo } = openTestDb()
    const p1 = createPaper(repo, { title: 'P1', authors: [] })
    const p2 = createPaper(repo, { title: 'P2', authors: [] })
    const { setId, noteId, refIds } = seedFullSet(repo, [p1.id, p2.id, p1.id], 'animals')

    const detail = queryEvidenceSetDetail(repo, setId)
    expect(detail).not.toBeNull()
    expect(detail!.set.id).toBe(setId)
    expect(detail!.set.noteId).toBe(noteId)
    expect(detail!.note?.id).toBe(noteId)
    expect(detail!.note?.body).toBe('animals')

    // refs 按 position 升序（与插入顺序一致）
    expect(detail!.refs.map((r) => r.ref.id)).toEqual(refIds)

    // 每条 ref 的 sourcePaper present
    detail!.refs.forEach((r) => {
      expect(r.sourcePaper.state).toBe('present')
    })

    // memberPapers：[p1, p2] 去重保序（p1 出现两次只算一次）
    expect(detail!.memberPapers.map((p) => p.id)).toEqual([p1.id, p2.id])
  })

  test('空集合：refs=[] memberPapers=[] memberReviews=[]，note 仍能命中', () => {
    const { repo } = openTestDb()
    const { setId, noteId } = seedFullSet(repo, [], 'empty')
    const detail = queryEvidenceSetDetail(repo, setId)
    expect(detail).not.toBeNull()
    expect(detail!.note?.id).toBe(noteId)
    expect(detail!.refs).toEqual([])
    expect(detail!.memberPapers).toEqual([])
    expect(detail!.memberReviews).toEqual([])
  })

  test('set 不存在 → null', () => {
    const { repo } = openTestDb()
    expect(queryEvidenceSetDetail(repo, 'ghost' as ObjectId)).toBeNull()
  })

  test('混合 source（paper + review）→ memberPapers 与 memberReviews 各自正确派生', () => {
    const { repo } = openTestDb()
    const p1 = createPaper(repo, { title: 'P1', authors: [] })
    const p2 = createPaper(repo, { title: 'P2', authors: [] })
    const r1 = createReview(repo, { title: 'R1', intent: 'i', sourceCapability: 'c' })
    const r2 = createReview(repo, { title: 'R2', intent: 'i', sourceCapability: 'c' })

    // 用 seedFullSet 只能建 paper-source ref；手动建 mixed set
    const note = createNote(repo, { body: 'mixed' })
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: note.id,
      persisted: false,
      evidenceRefIds: [],
    })
    // 顺序：p1, r1, p2, r1 (重复), r2 —— 验证去重保序
    const refs = [
      createEvidenceRef(repo, {
        source: { kind: 'paper', id: p1.id, anchor: buildMdAnchor({ snapshotText: 'a' }) },
        target: { kind: 'evidence-set', id: set.id },
      }),
      createEvidenceRef(repo, {
        source: { kind: 'review', id: r1.id, anchor: buildHtmlAnchor({ snapshotText: 'b' }) },
        target: { kind: 'evidence-set', id: set.id },
      }),
      createEvidenceRef(repo, {
        source: { kind: 'paper', id: p2.id, anchor: buildMdAnchor({ snapshotText: 'c' }) },
        target: { kind: 'evidence-set', id: set.id },
      }),
      createEvidenceRef(repo, {
        source: { kind: 'review', id: r1.id, anchor: buildHtmlAnchor({ snapshotText: 'd' }) },
        target: { kind: 'evidence-set', id: set.id },
      }),
      createEvidenceRef(repo, {
        source: { kind: 'review', id: r2.id, anchor: buildHtmlAnchor({ snapshotText: 'e' }) },
        target: { kind: 'evidence-set', id: set.id },
      }),
    ]
    refs.forEach((r) => appendEvidenceRefToSet(repo, set.id, r.id))

    const detail = queryEvidenceSetDetail(repo, set.id)!
    expect(detail.memberPapers.map((p) => p.id)).toEqual([p1.id, p2.id])
    expect(detail.memberReviews.map((r) => r.id)).toEqual([r1.id, r2.id])
    expect(detail.refs).toHaveLength(5)
    // 没有 review 把本 set 当作 source_evidence_set_id → sourceReview 为 null
    expect(detail.sourceReview).toBeNull()
  })

  test('sourceReview：派生出本 set 的源综述被反查出来', () => {
    const { repo } = openTestDb()
    const { setId } = seedFullSet(repo, [], 'review-derived')
    // 模拟综述派生：review.source_evidence_set_id 指向本 set
    const review = createReview(repo, {
      title: '源综述原文',
      intent: 'i',
      sourceCapability: 'c',
      sourceEvidenceSetId: setId,
    })
    const detail = queryEvidenceSetDetail(repo, setId)!
    expect(detail.sourceReview?.id).toBe(review.id)
    expect(detail.sourceReview?.title).toBe('源综述原文')
  })

  test('sourceReview 兜底：会话组建的 set 按 conversation session 反查综述', () => {
    const { repo } = openTestDb()
    const sessionId = 'sess-litreview'
    // 会话里产出的综述（source_evidence_set_id 不指向本 set）
    const review = createReview(repo, {
      title: '会话综述原文',
      intent: 'i',
      sourceCapability: 'c',
      agentSessionId: sessionId,
    })
    // 用户在该综述会话里「+ Add to evidence set」建出的 set：含一条 conversation ref
    const note = createNote(repo, { body: '检索 + 综述' })
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: note.id,
      persisted: true,
      name: '检索 + 综述',
      savedAt: '2026-05-29T10:00:00Z',
      evidenceRefIds: [],
    })
    const convRef = createEvidenceRef(repo, {
      source: {
        kind: 'conversation',
        id: sessionId as ObjectId,
        anchor: buildConversationAnchor({
          snapshotText: 'Q: ...\n\nA: ...',
          sessionId,
          messageUuid: 'msg-1',
        }),
      },
      target: { kind: 'evidence-set', id: set.id },
    })
    appendEvidenceRefToSet(repo, set.id, convRef.id)

    const detail = queryEvidenceSetDetail(repo, set.id)!
    // source_evidence_set_id 反查落空 → 走 conversation session 兜底
    expect(detail.sourceReview?.id).toBe(review.id)
    expect(detail.sourceReview?.title).toBe('会话综述原文')
  })
})

describe('queryEvidenceSetDetail: 软删 + includeDeleted', () => {
  test('源 paper 软删 → sourcePaper.state="removed"，不进 memberPapers', () => {
    const { repo } = openTestDb()
    const pAlive = createPaper(repo, { title: 'Alive', authors: [] })
    const pDead = createPaper(repo, { title: 'Dead', authors: [] })
    const { setId } = seedFullSet(repo, [pAlive.id, pDead.id])
    softDeletePaper(repo, pDead.id)

    const detail = queryEvidenceSetDetail(repo, setId)!
    expect(detail.refs).toHaveLength(2)
    const deadRef = detail.refs.find((r) => r.ref.source.id === pDead.id)
    expect(deadRef!.sourcePaper.state).toBe('removed')
    if (deadRef!.sourcePaper.state === 'removed') {
      expect(deadRef!.sourcePaper.id).toBe(pDead.id)
      expect(deadRef!.sourcePaper.removedAt).toBeTruthy()
    }
    // memberPapers 仅含 alive
    expect(detail.memberPapers.map((p) => p.id)).toEqual([pAlive.id])
  })

  test('ref 软删 → 默认从 refs 中排除', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [] })
    const { setId, refIds } = seedFullSet(repo, [p.id, p.id])
    softDeleteEvidenceRef(repo, refIds[0]!)

    const detail = queryEvidenceSetDetail(repo, setId)!
    expect(detail.refs.map((r) => r.ref.id)).toEqual([refIds[1]])
  })

  test('ref 软删 + includeDeleted=true → 仍出现在 refs 中', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [] })
    const { setId, refIds } = seedFullSet(repo, [p.id, p.id])
    softDeleteEvidenceRef(repo, refIds[0]!)

    const detail = queryEvidenceSetDetail(repo, setId, { includeDeleted: true })!
    expect(detail.refs.map((r) => r.ref.id)).toEqual(refIds)
  })

  test('set 自身软删 → 仍返回详情（调用方按 set.visibility 自己决定过滤）', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [] })
    const { setId } = seedFullSet(repo, [p.id])
    softDeleteEvidenceSet(repo, setId)

    const detail = queryEvidenceSetDetail(repo, setId)
    expect(detail).not.toBeNull()
    expect(detail!.set.visibility).toBe('deleted')
    // refs / memberPapers 仍有内容（DB 行还在）
    expect(detail!.refs).toHaveLength(1)
    expect(detail!.memberPapers).toHaveLength(1)
  })
})

describe('queryEvidenceSetDetail: 索引契约', () => {
  test('SELECT evidence_sets WHERE id=? 走 PK', () => {
    const { db } = openTestDb()
    const plan = explainPlan(db, `SELECT * FROM evidence_sets WHERE id = ?`, ['anything'])
    expect(plan).toMatch(/USING (INTEGER )?PRIMARY KEY|sqlite_autoindex/i)
  })

  test('SELECT evidence_set_refs JOIN evidence_refs WHERE set_id=? ORDER BY position 走 PK 复合索引', () => {
    const { db } = openTestDb()
    const plan = explainPlan(
      db,
      `SELECT er.*, esr.position
         FROM evidence_set_refs esr
         JOIN evidence_refs er ON er.id = esr.ref_id
        WHERE esr.set_id = ?
        ORDER BY esr.position`,
      ['anything'],
    )
    // 复合主键 (set_id, position) 既能 WHERE set_id=? 又能 ORDER BY position 无需额外排序
    expect(plan).not.toMatch(/SCAN evidence_set_refs\b/i)
    expect(plan).not.toMatch(/USE TEMP B-TREE FOR ORDER BY/i)
  })
})

describe('queryEvidenceSetSummaries: 列表摘要 + paperCount', () => {
  test('persistedOnly=true 默认只返回命名集合，按 created_at DESC', () => {
    const { repo } = openTestDb()
    const p1 = createPaper(repo, { title: 'P1', authors: [] })
    const p2 = createPaper(repo, { title: 'P2', authors: [] })

    // 临时集合（persisted=false）：seedFullSet 走的就是 persisted=false 路径
    seedFullSet(repo, [p1.id], 'temp note')

    // 持久集合 A
    const noteA = createNote(repo, { body: 'persisted note A' })
    const setA = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: noteA.id,
      persisted: true,
      name: 'Set A',
      savedAt: new Date().toISOString() as never,
      evidenceRefIds: [],
    })
    const refA1 = createEvidenceRef(repo, {
      source: { kind: 'paper', id: p1.id, anchor: buildMdAnchor({ snapshotText: 'a' }) },
      target: { kind: 'evidence-set', id: setA.id },
    })
    appendEvidenceRefToSet(repo, setA.id, refA1.id)
    // 同一 paper 第二条 ref —— 不应被计为额外 paper（去重）
    const refA1b = createEvidenceRef(repo, {
      source: { kind: 'paper', id: p1.id, anchor: buildMdAnchor({ snapshotText: 'a2' }) },
      target: { kind: 'evidence-set', id: setA.id },
    })
    appendEvidenceRefToSet(repo, setA.id, refA1b.id)
    // 另一 paper
    const refA2 = createEvidenceRef(repo, {
      source: { kind: 'paper', id: p2.id, anchor: buildMdAnchor({ snapshotText: 'b' }) },
      target: { kind: 'evidence-set', id: setA.id },
    })
    appendEvidenceRefToSet(repo, setA.id, refA2.id)

    const summaries = queryEvidenceSetSummaries(repo, { workspaceId: 'ws-test' })
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.id).toBe(setA.id)
    expect(summaries[0]!.name).toBe('Set A')
    expect(summaries[0]!.persisted).toBe(true)
    expect(summaries[0]!.paperCount).toBe(2) // p1 / p2，去重
    expect(summaries[0]!.notePreview).toContain('persisted note A')
  })

  test('persistedOnly=false 时含临时集合', () => {
    const { repo } = openTestDb()
    seedFullSet(repo, [], 'temp')
    const summaries = queryEvidenceSetSummaries(repo, { persistedOnly: false, workspaceId: 'ws-test' })
    expect(summaries.length).toBeGreaterThanOrEqual(1)
    expect(summaries.some((s) => s.persisted === false)).toBe(true)
  })
})

// ---------------- queryEvidenceSetSummariesByPaper: CITED BY 区数据源 ----------------

describe('queryEvidenceSetSummariesByPaper: 包含指定 paper 的证据集列表', () => {
  test('zoteroKey 未懒建 paper → 返回空数组', () => {
    const { repo } = openTestDb()
    // DB 完全为空：zoteroKey "ZK-NEVER" 没对应行
    const summaries = queryEvidenceSetSummariesByPaper(repo, 'ZK-NEVER', 'ws-test')
    expect(summaries).toEqual([])
  })

  test('paper 已建但未加入任何 set → 返回空数组', () => {
    const { repo } = openTestDb()
    createPaper(repo, { title: 'P', authors: [], zoteroKey: 'ZK-ALONE' })
    const summaries = queryEvidenceSetSummariesByPaper(repo, 'ZK-ALONE', 'ws-test')
    expect(summaries).toEqual([])
  })

  test('paper 在 1 个 set 中：返回 1 条，notePreview / paperCount / name 正确', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [], zoteroKey: 'ZK-1' })
    // 命名 set 含 1 个 paper
    const note = createNote(repo, { body: 'why this set matters' })
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: note.id,
      persisted: true,
      name: 'Named Set',
      savedAt: new Date().toISOString() as never,
      evidenceRefIds: [],
    })
    const ref = createEvidenceRef(repo, {
      source: { kind: 'paper', id: p.id, anchor: buildMdAnchor({ snapshotText: 'snap' }) },
      target: { kind: 'evidence-set', id: set.id },
    })
    appendEvidenceRefToSet(repo, set.id, ref.id)

    const summaries = queryEvidenceSetSummariesByPaper(repo, 'ZK-1', 'ws-test')
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.id).toBe(set.id)
    expect(summaries[0]!.name).toBe('Named Set')
    expect(summaries[0]!.persisted).toBe(true)
    expect(summaries[0]!.paperCount).toBe(1)
    expect(summaries[0]!.notePreview).toContain('why this set matters')
  })

  test('paper 在 N 个 set 中：按 created_at DESC 排序', async () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [], zoteroKey: 'ZK-N' })
    const seedNamedSet = (name: string): ObjectId => {
      const note = createNote(repo, { body: `body for ${name}` })
      const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
        noteId: note.id,
        persisted: true,
        name,
        savedAt: new Date().toISOString() as never,
        evidenceRefIds: [],
      })
      const ref = createEvidenceRef(repo, {
        source: { kind: 'paper', id: p.id, anchor: buildMdAnchor({ snapshotText: `s-${name}` }) },
        target: { kind: 'evidence-set', id: set.id },
      })
      appendEvidenceRefToSet(repo, set.id, ref.id)
      return set.id
    }
    const sA = seedNamedSet('A')
    await new Promise((r) => setTimeout(r, 5))
    const sB = seedNamedSet('B')
    await new Promise((r) => setTimeout(r, 5))
    const sC = seedNamedSet('C')

    const summaries = queryEvidenceSetSummariesByPaper(repo, 'ZK-N', 'ws-test')
    expect(summaries.map((s) => s.id)).toEqual([sC, sB, sA])
  })

  test('软删过滤：set / ref 任一软删，该集合不出现', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [], zoteroKey: 'ZK-SD' })

    // 集合 alive
    const noteAlive = createNote(repo, { body: 'alive' })
    const setAlive = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: noteAlive.id,
      persisted: true,
      name: 'Alive',
      savedAt: new Date().toISOString() as never,
      evidenceRefIds: [],
    })
    const refAlive = createEvidenceRef(repo, {
      source: { kind: 'paper', id: p.id, anchor: buildMdAnchor({ snapshotText: 'sA' }) },
      target: { kind: 'evidence-set', id: setAlive.id },
    })
    appendEvidenceRefToSet(repo, setAlive.id, refAlive.id)

    // 集合本身软删
    const noteDelSet = createNote(repo, { body: 'dead set note' })
    const setDel = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: noteDelSet.id,
      persisted: true,
      name: 'DeletedSet',
      savedAt: new Date().toISOString() as never,
      evidenceRefIds: [],
    })
    const refDelSet = createEvidenceRef(repo, {
      source: { kind: 'paper', id: p.id, anchor: buildMdAnchor({ snapshotText: 'sB' }) },
      target: { kind: 'evidence-set', id: setDel.id },
    })
    appendEvidenceRefToSet(repo, setDel.id, refDelSet.id)
    softDeleteEvidenceSet(repo, setDel.id)

    // ref 软删（set 还在）
    const noteRefDel = createNote(repo, { body: 'ref dead' })
    const setRefDel = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: noteRefDel.id,
      persisted: true,
      name: 'RefDeletedSet',
      savedAt: new Date().toISOString() as never,
      evidenceRefIds: [],
    })
    const refDel = createEvidenceRef(repo, {
      source: { kind: 'paper', id: p.id, anchor: buildMdAnchor({ snapshotText: 'sC' }) },
      target: { kind: 'evidence-set', id: setRefDel.id },
    })
    appendEvidenceRefToSet(repo, setRefDel.id, refDel.id)
    softDeleteEvidenceRef(repo, refDel.id)

    const summaries = queryEvidenceSetSummariesByPaper(repo, 'ZK-SD', 'ws-test')
    expect(summaries.map((s) => s.id)).toEqual([setAlive.id])
  })

  test('paperCount 准确性：包括 set 内其他 paper（DISTINCT source_id）', () => {
    const { repo } = openTestDb()
    const pA = createPaper(repo, { title: 'A', authors: [], zoteroKey: 'ZK-A' })
    const pB = createPaper(repo, { title: 'B', authors: [], zoteroKey: 'ZK-B' })

    const note = createNote(repo, { body: 'multi-paper set' })
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: note.id,
      persisted: true,
      name: 'Multi',
      savedAt: new Date().toISOString() as never,
      evidenceRefIds: [],
    })
    for (const p of [pA, pA, pB]) {
      const ref = createEvidenceRef(repo, {
        source: { kind: 'paper', id: p.id, anchor: buildMdAnchor({ snapshotText: `s${p.id}` }) },
        target: { kind: 'evidence-set', id: set.id },
      })
      appendEvidenceRefToSet(repo, set.id, ref.id)
    }

    // 用 pA 的 zoteroKey 查 → 应回 1 个 set，其 paperCount = 2（pA / pB 去重）
    const summaries = queryEvidenceSetSummariesByPaper(repo, 'ZK-A', 'ws-test')
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.paperCount).toBe(2)
  })

  test('paper 同一 set 多条 ref：set 只出现一次（DISTINCT）', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [], zoteroKey: 'ZK-DUP' })
    const note = createNote(repo, { body: 'dup ref' })
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: note.id,
      persisted: true,
      name: 'Dup',
      savedAt: new Date().toISOString() as never,
      evidenceRefIds: [],
    })
    for (let i = 0; i < 3; i++) {
      const ref = createEvidenceRef(repo, {
        source: { kind: 'paper', id: p.id, anchor: buildMdAnchor({ snapshotText: `s${i}` }) },
        target: { kind: 'evidence-set', id: set.id },
      })
      appendEvidenceRefToSet(repo, set.id, ref.id)
    }
    const summaries = queryEvidenceSetSummariesByPaper(repo, 'ZK-DUP', 'ws-test')
    expect(summaries).toHaveLength(1)
  })
})

// ---------------- queryLatestReviewSetByAgentSession (B5) ----------------

describe('queryLatestReviewSetByAgentSession: BookmarkPlus popover 数据源', () => {
  test('session 无 review → reviewId=null', () => {
    const { repo } = openTestDb()
    const res = queryLatestReviewSetByAgentSession(repo, 'no-such-session')
    expect(res.reviewId).toBeNull()
    expect(res.setId).toBeNull()
    expect(res.setPersisted).toBe(false)
  })

  test('review 存在但无 sourceEvidenceSetId → setId=null', () => {
    const { repo } = openTestDb()
    createReview(repo, {
      title: 'R',
      intent: 'i',
      sourceCapability: 'c',
      agentSessionId: 'sess-1',
    })
    const res = queryLatestReviewSetByAgentSession(repo, 'sess-1')
    expect(res.reviewId).not.toBeNull()
    expect(res.reviewTitle).toBe('R')
    expect(res.setId).toBeNull()
    expect(res.setPersisted).toBe(false)
  })

  test('review 挂 persisted=0 临时 set → setPersisted=false', () => {
    const { repo } = openTestDb()
    const note = createNote(repo, { body: 'placeholder' })
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: note.id,
      persisted: false,
      evidenceRefIds: [],
    })
    const review = createReview(repo, {
      title: 'Temp Review',
      intent: 'i',
      sourceCapability: 'c',
      agentSessionId: 'sess-2',
    })
    updateReview(repo, review.id, { sourceEvidenceSetId: set.id })

    const res = queryLatestReviewSetByAgentSession(repo, 'sess-2')
    expect(res.setId).toBe(set.id)
    expect(res.setPersisted).toBe(false)
    expect(res.setName).toBeNull()
  })

  test('review 挂 persisted=1 正式 set → setPersisted=true，setName 命中', () => {
    const { repo } = openTestDb()
    const note = createNote(repo, { body: 'placeholder' })
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: note.id,
      persisted: true,
      name: 'Saved Review Set',
      savedAt: new Date().toISOString() as never,
      evidenceRefIds: [],
    })
    const review = createReview(repo, {
      title: 'Saved',
      intent: 'i',
      sourceCapability: 'c',
      agentSessionId: 'sess-3',
    })
    updateReview(repo, review.id, { sourceEvidenceSetId: set.id })

    const res = queryLatestReviewSetByAgentSession(repo, 'sess-3')
    expect(res.setPersisted).toBe(true)
    expect(res.setName).toBe('Saved Review Set')
  })

  test('同 session 多份 review → 取最新（createdAt DESC）', async () => {
    const { repo } = openTestDb()
    createReview(repo, {
      title: 'Old',
      intent: 'i',
      sourceCapability: 'c',
      agentSessionId: 'sess-4',
    })
    await new Promise((r) => setTimeout(r, 5))
    createReview(repo, {
      title: 'New',
      intent: 'i',
      sourceCapability: 'c',
      agentSessionId: 'sess-4',
    })
    const res = queryLatestReviewSetByAgentSession(repo, 'sess-4')
    expect(res.reviewTitle).toBe('New')
  })
})

// ---------------- issue #457：证据集 workspace 隔离 ----------------

describe('issue #457：证据集查询按 workspace scope', () => {
  /** 在指定 workspace 建一个 persisted=1 + 含指定 paper ref 的命名集合 */
  function seedNamedSetWithPaper(
    repo: RepoDb,
    workspaceId: string,
    name: string,
    paperId: ObjectId,
  ): void {
    attachNoteToPaper(repo, paperId, name, { workspaceId, persisted: true, name, snapshotText: 's' })
  }

  test('queryEvidenceSetSummaries 只返回当前 workspace 的集合', () => {
    const { repo } = openTestDb()
    const pa = createPaper(repo, { title: 'PA', authors: [] })
    const pb = createPaper(repo, { title: 'PB', authors: [] })
    seedNamedSetWithPaper(repo, 'ws-A', 'Set A', pa.id)
    seedNamedSetWithPaper(repo, 'ws-B', 'Set B', pb.id)

    const inA = queryEvidenceSetSummaries(repo, { workspaceId: 'ws-A' })
    expect(inA.map((s) => s.name)).toEqual(['Set A'])

    const inB = queryEvidenceSetSummaries(repo, { workspaceId: 'ws-B' })
    expect(inB.map((s) => s.name)).toEqual(['Set B'])

    // 不存在的 workspace → 空
    expect(queryEvidenceSetSummaries(repo, { workspaceId: 'ws-none' })).toEqual([])
  })

  test('queryEvidenceSetSummariesByPaper 跨 workspace 不串扰（同一 paper 各自归属）', () => {
    const { repo } = openTestDb()
    // 同一篇 paper 在 A、B 各自被一个集合引用
    const shared = createPaper(repo, { title: 'Shared', authors: [], zoteroKey: 'ZK-SHARED' })
    seedNamedSetWithPaper(repo, 'ws-A', 'Set A', shared.id)
    seedNamedSetWithPaper(repo, 'ws-B', 'Set B', shared.id)

    const inA = queryEvidenceSetSummariesByPaper(repo, 'ZK-SHARED', 'ws-A')
    expect(inA.map((s) => s.name)).toEqual(['Set A'])

    const inB = queryEvidenceSetSummariesByPaper(repo, 'ZK-SHARED', 'ws-B')
    expect(inB.map((s) => s.name)).toEqual(['Set B'])
  })
})

describe('#709 容器化：detail.notes[] + tags + summary.tagFilter', () => {
  function seedContainer(repo: RepoDb, name: string, workspaceId = 'ws-test'): ObjectId {
    return createEvidenceSet(repo, {
      workspaceId,
      persisted: true,
      name,
      savedAt: nowIso(),
      evidenceRefIds: [],
    }).id
  }

  test('queryEvidenceSetDetail：notes[] 按 position 多笔记 + tags 字典序', () => {
    const { repo } = openTestDb()
    const setId = seedContainer(repo, 'CRISPR')
    const n1 = createNote(repo, { body: 'note one' })
    const n2 = createNote(repo, { body: 'note two' })
    appendNoteToSet(repo, setId, n1.id)
    appendNoteToSet(repo, setId, n2.id)
    setTags(repo, setId, ['在读', '小样本'])

    const detail = queryEvidenceSetDetail(repo, setId)
    expect(detail!.notes.map((n) => n.body)).toEqual(['note one', 'note two'])
    expect(detail!.note?.body).toBe('note one') // @deprecated 兼容字段 = 首条
    expect(detail!.tags).toEqual(['在读', '小样本'])
  })

  test('queryEvidenceSetSummaries：noteCount / tags 派生 + tagFilter 多选 OR', () => {
    const { repo } = openTestDb()
    const setA = seedContainer(repo, 'A')
    const setB = seedContainer(repo, 'B')
    const setC = seedContainer(repo, 'C')
    appendNoteToSet(repo, setA, createNote(repo, { body: 'a1' }).id)
    appendNoteToSet(repo, setA, createNote(repo, { body: 'a2' }).id)
    setTags(repo, setA, ['在读'])
    setTags(repo, setB, ['待写作'])
    setTags(repo, setC, ['在读', '待写作'])

    const all = queryEvidenceSetSummaries(repo, { workspaceId: 'ws-test' })
    expect(all.find((s) => s.name === 'A')!.noteCount).toBe(2)
    expect(all.find((s) => s.name === 'A')!.tags).toEqual(['在读'])

    // tagFilter OR：含 在读 的 = A、C
    const filtered = queryEvidenceSetSummaries(repo, {
      workspaceId: 'ws-test',
      tagFilter: ['在读'],
    })
    expect(filtered.map((s) => s.name).sort()).toEqual(['A', 'C'])

    // 多选 OR：在读 或 待写作 = A、B、C
    const both = queryEvidenceSetSummaries(repo, {
      workspaceId: 'ws-test',
      tagFilter: ['在读', '待写作'],
    })
    expect(both.map((s) => s.name).sort()).toEqual(['A', 'B', 'C'])
  })
})

// ---------------- issue #446：伪引文查询层归一化 ----------------

describe('issue #446：sanitizeQuote 伪引文判定', () => {
  test('空 snapshot → 空串', () => {
    expect(sanitizeQuote('', 'any body')).toBe('')
    expect(sanitizeQuote('   ', 'any body')).toBe('')
  })

  test('真实引文（正文不以 quote 开头）→ 原样返回', () => {
    expect(sanitizeQuote('original paper sentence', 'my own thoughts about it')).toBe(
      'original paper sentence',
    )
  })

  test('伪引文（正文以 quote 开头，旧版正文前 200 字兜底）→ 空串', () => {
    const body = 'user note body that was once copied into the anchor as fake quote'
    expect(sanitizeQuote(body.slice(0, 20), body)).toBe('')
  })

  test('带空白差异的前缀（snapshot 尾随空白 / 正文前导空白）→ 仍判伪', () => {
    expect(sanitizeQuote('  note text ', '\n note text continues here')).toBe('')
  })
})

describe('issue #446：查询出口对存量伪 quote 归一化', () => {
  test('queryNotesByPaper：伪 quote 行返回空 quote，真实划词行原样返回', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [] })
    const fakeBody = 'this body was sliced into the anchor by the legacy fallback path'
    const fake = attachNoteToPaper(repo, p.id, fakeBody, {
      persisted: true, name: 'fake', snapshotText: fakeBody.slice(0, 200),
    })
    const real = attachNoteToPaper(repo, p.id, 'my commentary', {
      persisted: true, name: 'real', snapshotText: 'quoted from the paper',
    })

    const got = queryNotesByPaper(repo, p.id, 'ws-test')
    const fakeRow = got.find((it) => it.note.id === fake.noteId)!
    const realRow = got.find((it) => it.note.id === real.noteId)!
    expect(fakeRow.quote).toBe('')
    expect(realRow.quote).toBe('quoted from the paper')
  })

  test('queryAllNotesWithPaper：伪 quote 归一为空，paper 标题（列表副行数据源）正常返回', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'Attention Is All You Need', authors: [] })
    const fakeBody = 'legacy note whose prefix was forged into anchor snapshot'
    const fake = attachNoteToPaper(repo, p.id, fakeBody, {
      persisted: true, name: 'fake', snapshotText: fakeBody.slice(0, 200),
    })
    const real = attachNoteToPaper(repo, p.id, 'my commentary', {
      persisted: true, name: 'real', snapshotText: 'real highlight',
    })

    const got = queryAllNotesWithPaper(repo, 'ws-test')
    const fakeRow = got.find((it) => it.note.id === fake.noteId)!
    const realRow = got.find((it) => it.note.id === real.noteId)!
    expect(fakeRow.quote).toBe('')
    expect(realRow.quote).toBe('real highlight')
    expect(fakeRow.paper?.title).toBe('Attention Is All You Need')
    expect(realRow.paper?.title).toBe('Attention Is All You Need')
  })

  test('queryEvidenceSetDetail：refs[].quote 派生归一，raw anchor 原样保留', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [] })
    const fakeBody = 'note body forged into the paper anchor by the legacy path'
    const fakeSnapshot = fakeBody.slice(0, 200)
    const fake = attachNoteToPaper(repo, p.id, fakeBody, {
      persisted: true, name: 'fake', snapshotText: fakeSnapshot,
    })

    const detail = queryEvidenceSetDetail(repo, fake.setId)!
    expect(detail.refs.length).toBe(1)
    // 派生 quote 判伪归一为空串；raw anchor 不动（promote / 导出 / 幂等键依赖）
    expect(detail.refs[0]!.quote).toBe('')
    expect(detail.refs[0]!.ref.source.anchor?.snapshotText).toBe(fakeSnapshot)
  })

  test('queryEvidenceSetDetail：conversation 锚点不做判伪（Q/A 快照与正文同源是合法形态）', () => {
    const { repo } = openTestDb()
    const snapshot = 'Q: what is attention?\n\nA: a weighting mechanism'
    // note 正文与 conversation 快照同前缀 —— 仍不该被判伪
    const note = createNote(repo, { body: snapshot })
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: note.id,
      persisted: true,
      name: 'conv',
      savedAt: nowIso() as Timestamp,
      evidenceRefIds: [],
    })
    const ref = createEvidenceRef(repo, {
      source: {
        kind: 'conversation',
        id: 'session-1',
        anchor: buildConversationAnchor({
          snapshotText: snapshot,
          sessionId: 'session-1',
          messageUuid: 'msg-1',
        }),
      },
      target: { kind: 'evidence-set', id: set.id },
    })
    appendEvidenceRefToSet(repo, set.id, ref.id)

    const detail = queryEvidenceSetDetail(repo, set.id)!
    expect(detail.refs[0]!.quote).toBe(snapshot)
  })
})
