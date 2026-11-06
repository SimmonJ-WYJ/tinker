/**
 * evidence-attachment-service 集成测试（v0.2 证据列表重构后）
 *
 * 内存 SQLite + 完整 001-initial schema。覆盖：
 *   - 三层 helper 各自的 happy path + 边界（含 noteId 自动占位）
 *   - composite attachReviewEvidenceBundle 的 happy path + 4 种 typed error
 *   - 关键不变量：失败时 DB 必须无副作用（事务回滚）
 *
 * v0.2 重构后：
 *   - buildEvidenceSetForRefs 不再接收 paperIds —— paper ↔ set 通过 evidence_refs 表达
 *   - 系统侧自动建占位 note（noteBody 参数传入或默认 review.title）
 */

import { describe, expect, test } from 'bun:test'
import { buildHtmlAnchor, buildMdAnchor } from './anchor-codec.ts'

import type { ObjectId, Timestamp } from '@asci/shared'

import { openTestDb } from './repositories/_helpers.test.ts'
import { createPaper, softDeletePaper } from './repositories/paper-repository.ts'
import { createReview } from './repositories/review-repository.ts'
import { createEvidenceRef, listEvidenceRefs } from './repositories/evidence-ref-repository.ts'
import { listEvidenceSets } from './repositories/evidence-set-repository.ts'
import { listNotes } from './repositories/note-repository.ts'

import {
  attachEvidenceSetToReview,
  attachReviewEvidenceBundle,
  buildEvidenceSetForRefs,
  createEvidenceRefsBatch,
  EmptyEvidenceBundleError,
  PaperNotFoundError,
  resolvePaperRef,
  ReviewAlreadyHasEvidenceSetError,
  ReviewNotFoundError,
  type PaperRef,
} from './evidence-attachment-service.ts'

// =============================================================================
// 三层 helper
// =============================================================================

describe('resolvePaperRef — {id} 校验存在性（防综述 §7 把 zoteroKey 误填进 data-paper-id 造成悬空 ref / "source removed"）', () => {
  test('{id} 命中真实 paper 行 → 返回该 id', () => {
    const { repo } = openTestDb()
    const paper = createPaper(repo, { title: 'P', authors: [] })
    expect(resolvePaperRef(repo, { id: paper.id })).toBe(paper.id)
  })

  test('{id} 不存在（如 zoteroKey 被误当 paper-id）→ 返回 null，不盲信', () => {
    const { repo } = openTestDb()
    // 'F5E2JEY7' 是一个 Zotero key，绝非库里的 paper 主键
    expect(resolvePaperRef(repo, { id: 'F5E2JEY7' as ObjectId })).toBeNull()
  })

  test('{zoteroKey} 命中 → 返回真实 paper id（正确的 Zotero 反查路径）', () => {
    const { repo } = openTestDb()
    const paper = createPaper(repo, { title: 'Z', authors: [], zoteroKey: 'F5E2JEY7' })
    expect(resolvePaperRef(repo, { zoteroKey: 'F5E2JEY7' })).toBe(paper.id)
  })
})

describe('createEvidenceRefsBatch', () => {
  test('空数组 → 返回空，DB 无副作用', () => {
    const { repo } = openTestDb()
    expect(createEvidenceRefsBatch(repo, [])).toEqual([])
    expect(listEvidenceRefs(repo)).toHaveLength(0)
  })

  test('3 条全成功 → 返回 3 条并落库', () => {
    const { repo } = openTestDb()
    const paper = createPaper(repo, { title: 'p', authors: [] })
    const review = createReview(repo, { title: 't', intent: 'i', sourceCapability: 'c' })
    const refs = createEvidenceRefsBatch(repo, [
      {
        source: { kind: 'paper', id: paper.id, anchor: buildMdAnchor({ snapshotText: 'p1' }) },
        target: { kind: 'review', id: review.id, anchor: buildHtmlAnchor({ snapshotText: 's1' }) },
      },
      {
        source: { kind: 'paper', id: paper.id, anchor: buildMdAnchor({ snapshotText: 'p2' }) },
        target: { kind: 'review', id: review.id, anchor: buildHtmlAnchor({ snapshotText: 's2' }) },
      },
      {
        source: { kind: 'paper', id: paper.id, anchor: buildMdAnchor({ snapshotText: 'p3' }) },
        target: { kind: 'review', id: review.id, anchor: buildHtmlAnchor({ snapshotText: 's3' }) },
      },
    ])
    expect(refs).toHaveLength(3)
    expect(listEvidenceRefs(repo)).toHaveLength(3)
  })

  test('中途一条 CHECK 违反 → 整批回滚，DB 无副作用', () => {
    // 2026-05-24 后 source 端撤了 FK，原 "FK 拒绝不存在 paper" 不再可用。
    // 用 CHECK 违反代替：source_kind 取非法值 'pdf'（CHECK 仅允许 'paper'|'review'）。
    const { repo } = openTestDb()
    const paper = createPaper(repo, { title: 'p', authors: [] })
    const review = createReview(repo, { title: 't', intent: 'i', sourceCapability: 'c' })
    expect(() =>
      createEvidenceRefsBatch(repo, [
        {
          source: { kind: 'paper', id: paper.id, anchor: buildMdAnchor({ snapshotText: 'ok' }) },
          target: { kind: 'review', id: review.id, anchor: buildHtmlAnchor({ snapshotText: 's' }) },
        },
        // 第二条 source_kind 非法 → CHECK 抛错
        {
          source: {
            kind: 'pdf' as unknown as 'paper',
            id: paper.id,
            anchor: buildMdAnchor({ snapshotText: 'bad' }),
          },
          target: { kind: 'review', id: review.id, anchor: buildHtmlAnchor({ snapshotText: 's' }) },
        },
      ]),
    ).toThrow(/CHECK/i)
    expect(listEvidenceRefs(repo)).toHaveLength(0)
  })
})

describe('buildEvidenceSetForRefs', () => {
  test('refIds 自动去重 + 自动建占位 note', () => {
    const { repo } = openTestDb()
    const paper = createPaper(repo, { title: 'p', authors: [] })
    const review = createReview(repo, { title: 't', intent: 'i', sourceCapability: 'c' })
    const ref = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: buildMdAnchor({ snapshotText: 'p' }) },
      target: { kind: 'review', id: review.id, anchor: buildHtmlAnchor({ snapshotText: 's' }) },
    })
    const now: Timestamp = new Date().toISOString() as Timestamp
    const set = buildEvidenceSetForRefs(repo, {
      workspaceId: 'ws-test',
      refIds: [ref.id, ref.id],
      noteBody: 'review-side bundle',
      persisted: true,
      name: '去重测试',
      savedAt: now,
    })
    expect(set.evidenceRefIds).toEqual([ref.id])
    // 自动建 note + 1:1 绑定
    expect(set.noteId).toBeTruthy()
    const notes = listNotes(repo)
    expect(notes.length).toBe(1)
    expect(notes[0]!.id).toBe(set.noteId)
    expect(notes[0]!.body).toBe('review-side bundle')
  })

  test('persisted=true 时缺 name → 抛错（沿用底层校验）', () => {
    const { repo } = openTestDb()
    expect(() =>
      buildEvidenceSetForRefs(repo, {
      workspaceId: 'ws-test',
        refIds: [],
        noteBody: 'note',
        persisted: true,
      }),
    ).toThrow(/name 必填/)
  })

  test('persisted 默认 true 时仍按 persisted 校验 name', () => {
    const { repo } = openTestDb()
    expect(() =>
      buildEvidenceSetForRefs(repo, {
      workspaceId: 'ws-test',
        refIds: [],
        noteBody: 'note',
      }),
    ).toThrow(/name 必填/)
  })
})

describe('attachEvidenceSetToReview', () => {
  test('review.sourceEvidenceSetId 从空设到 evidenceSetId', () => {
    const { repo } = openTestDb()
    const review = createReview(repo, { title: 't', intent: 'i', sourceCapability: 'c' })
    const now: Timestamp = new Date().toISOString() as Timestamp
    const set = buildEvidenceSetForRefs(repo, {
      workspaceId: 'ws-test',
      refIds: [],
      noteBody: 'placeholder',
      persisted: true,
      name: 'empty set',
      savedAt: now,
    })
    const updated = attachEvidenceSetToReview(repo, {
      reviewId: review.id,
      evidenceSetId: set.id,
    })
    expect(updated.sourceEvidenceSetId).toBe(set.id)
  })

  test('review 已有 set → 抛 ReviewAlreadyHasEvidenceSetError', () => {
    const { repo } = openTestDb()
    const review = createReview(repo, { title: 't', intent: 'i', sourceCapability: 'c' })
    const now: Timestamp = new Date().toISOString() as Timestamp
    const set1 = buildEvidenceSetForRefs(repo, {
      workspaceId: 'ws-test',
      refIds: [], noteBody: 'n1', persisted: true, name: 's1', savedAt: now,
    })
    attachEvidenceSetToReview(repo, { reviewId: review.id, evidenceSetId: set1.id })

    const set2 = buildEvidenceSetForRefs(repo, {
      workspaceId: 'ws-test',
      refIds: [], noteBody: 'n2', persisted: true, name: 's2', savedAt: now,
    })
    expect(() =>
      attachEvidenceSetToReview(repo, { reviewId: review.id, evidenceSetId: set2.id }),
    ).toThrow(ReviewAlreadyHasEvidenceSetError)
  })

  test('review 不存在 → 抛 ReviewNotFoundError', () => {
    const { repo } = openTestDb()
    const now: Timestamp = new Date().toISOString() as Timestamp
    const set = buildEvidenceSetForRefs(repo, {
      workspaceId: 'ws-test',
      refIds: [], noteBody: 'n', persisted: true, name: 's', savedAt: now,
    })
    expect(() =>
      attachEvidenceSetToReview(repo, {
        reviewId: 'no-such-review' as ObjectId,
        evidenceSetId: set.id,
      }),
    ).toThrow(ReviewNotFoundError)
  })
})

// =============================================================================
// composite
// =============================================================================

describe('attachReviewEvidenceBundle (composite)', () => {
  test('happy path：3 条 ref 引用 2 篇 paper（id / doi / zoteroKey 混用）', () => {
    const { repo } = openTestDb()
    const paperById = createPaper(repo, { title: 'A', authors: [] })
    const paperByDoi = createPaper(repo, { title: 'B', authors: [], doi: '10.x/B' })
    const paperByKey = createPaper(repo, { title: 'C', authors: [], zoteroKey: 'ZK-C' })
    const review = createReview(repo, { title: 't', intent: 'i', sourceCapability: 'c' })

    const now: Timestamp = new Date().toISOString() as Timestamp
    const result = attachReviewEvidenceBundle(repo, {
        workspaceId: 'ws-test',
      reviewId: review.id,
      items: [
        { paper: { id: paperById.id }, source: buildMdAnchor({ snapshotText: 'p1' }), target: buildHtmlAnchor({ snapshotText: 's1' }) },
        { paper: { doi: '10.x/B' }, source: buildMdAnchor({ snapshotText: 'q2' }), target: buildHtmlAnchor({ snapshotText: 's2' }) },
        { paper: { zoteroKey: 'ZK-C' }, source: buildMdAnchor({ snapshotText: 'p3' }), target: buildHtmlAnchor({ snapshotText: 's3' }) },
      ],
      evidenceSet: { persisted: true, name: '混合 ref 集', savedAt: now },
    })

    expect(result.evidenceRefs).toHaveLength(3)
    // paper ↔ set 通过 ref.source 反查（不再通过 paperIds 字段）
    const sourceIds = result.evidenceRefs.map((r) => r.source.id)
    expect(new Set(sourceIds)).toEqual(new Set([paperById.id, paperByDoi.id, paperByKey.id]))
    expect(result.evidenceSet.evidenceRefIds.length).toBe(3)
    expect(result.review.sourceEvidenceSetId).toBe(result.evidenceSet.id)

    // DB 行数对齐
    expect(listEvidenceRefs(repo)).toHaveLength(3)
    expect(listEvidenceSets(repo)).toHaveLength(1)
  })

  test('同一 paper 被多条 ref 引用 → ref 各自独立，DB 不去重', () => {
    const { repo } = openTestDb()
    const paper = createPaper(repo, { title: 'P', authors: [], doi: '10.x/P' })
    const review = createReview(repo, { title: 't', intent: 'i', sourceCapability: 'c' })
    const now: Timestamp = new Date().toISOString() as Timestamp
    const result = attachReviewEvidenceBundle(repo, {
        workspaceId: 'ws-test',
      reviewId: review.id,
      items: [
        { paper: { doi: '10.x/P' }, source: buildMdAnchor({ snapshotText: 'p1' }), target: buildHtmlAnchor({ snapshotText: 's1' }) },
        { paper: { doi: '10.x/P' }, source: buildMdAnchor({ snapshotText: 'p2' }), target: buildHtmlAnchor({ snapshotText: 's2' }) },
        { paper: { id: paper.id }, source: buildMdAnchor({ snapshotText: 'p3' }), target: buildHtmlAnchor({ snapshotText: 's3' }) },
      ],
      evidenceSet: { persisted: true, name: 's', savedAt: now },
    })
    // 3 条 ref 都独立写入
    expect(result.evidenceRefs).toHaveLength(3)
    // 所有 ref 的 source 都指向同一 paper
    expect(new Set(result.evidenceRefs.map((r) => r.source.id))).toEqual(new Set([paper.id]))
  })

  test('items 为空 → EmptyEvidenceBundleError，DB 无副作用', () => {
    const { repo } = openTestDb()
    const review = createReview(repo, { title: 't', intent: 'i', sourceCapability: 'c' })
    expect(() =>
      attachReviewEvidenceBundle(repo, {
        workspaceId: 'ws-test',
        reviewId: review.id,
        items: [],
        evidenceSet: { persisted: true, name: 's', savedAt: new Date().toISOString() as Timestamp },
      }),
    ).toThrow(EmptyEvidenceBundleError)
    expect(listEvidenceSets(repo)).toHaveLength(0)
  })

  test('review 不存在 → ReviewNotFoundError，DB 无副作用', () => {
    const { repo } = openTestDb()
    const paper = createPaper(repo, { title: 'P', authors: [] })
    expect(() =>
      attachReviewEvidenceBundle(repo, {
        workspaceId: 'ws-test',
        reviewId: 'ghost' as ObjectId,
        items: [
          { paper: { id: paper.id }, source: buildMdAnchor({ snapshotText: 'p' }), target: buildHtmlAnchor({ snapshotText: 's' }) },
        ],
        evidenceSet: { persisted: true, name: 's', savedAt: new Date().toISOString() as Timestamp },
      }),
    ).toThrow(ReviewNotFoundError)
    expect(listEvidenceRefs(repo)).toHaveLength(0)
    expect(listEvidenceSets(repo)).toHaveLength(0)
  })

  test('review 已有 evidenceSet → ReviewAlreadyHasEvidenceSetError，DB 无副作用', () => {
    const { repo } = openTestDb()
    const paper = createPaper(repo, { title: 'P', authors: [] })
    const review = createReview(repo, { title: 't', intent: 'i', sourceCapability: 'c' })
    const now: Timestamp = new Date().toISOString() as Timestamp

    // 先挂一个 set
    const seedSet = buildEvidenceSetForRefs(repo, {
      workspaceId: 'ws-test',
      refIds: [], noteBody: 'seed-note', persisted: true, name: 'seed', savedAt: now,
    })
    attachEvidenceSetToReview(repo, { reviewId: review.id, evidenceSetId: seedSet.id })

    const setsBefore = listEvidenceSets(repo).length
    const refsBefore = listEvidenceRefs(repo).length

    expect(() =>
      attachReviewEvidenceBundle(repo, {
        workspaceId: 'ws-test',
        reviewId: review.id,
        items: [{ paper: { id: paper.id }, source: buildMdAnchor({ snapshotText: 'p' }), target: buildHtmlAnchor({ snapshotText: 's' }) }],
        evidenceSet: { persisted: true, name: 'override', savedAt: now },
      }),
    ).toThrow(ReviewAlreadyHasEvidenceSetError)

    // 数量不变，没产生半身体记录
    expect(listEvidenceSets(repo).length).toBe(setsBefore)
    expect(listEvidenceRefs(repo).length).toBe(refsBefore)
  })

  test('任一 paperRef 反查不到 → PaperNotFoundError（收集所有 missing），DB 无副作用', () => {
    const { repo } = openTestDb()
    const paper = createPaper(repo, { title: 'P', authors: [], doi: '10.x/exists' })
    const review = createReview(repo, { title: 't', intent: 'i', sourceCapability: 'c' })

    const items = [
      { paper: { id: paper.id }, source: buildMdAnchor({ snapshotText: 'p1' }), target: buildHtmlAnchor({ snapshotText: 's1' }) },
      { paper: { doi: '10.x/exists' }, source: buildMdAnchor({ snapshotText: 'p2' }), target: buildHtmlAnchor({ snapshotText: 's2' }) },
      { paper: { doi: '10.x/missing-A' }, source: buildMdAnchor({ snapshotText: 'p3' }), target: buildHtmlAnchor({ snapshotText: 's3' }) },
      { paper: { zoteroKey: 'missing-key-B' }, source: buildMdAnchor({ snapshotText: 'p4' }), target: buildHtmlAnchor({ snapshotText: 's4' }) },
    ] as const

    let caught: unknown
    try {
      attachReviewEvidenceBundle(repo, {
        workspaceId: 'ws-test',
        reviewId: review.id,
        items,
        evidenceSet: { persisted: true, name: 's', savedAt: new Date().toISOString() as Timestamp },
      })
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(PaperNotFoundError)
    const err = caught as PaperNotFoundError
    expect(err.missing).toHaveLength(2)
    const missing = err.missing.map((m) => JSON.stringify(m))
    expect(missing).toContain(JSON.stringify({ doi: '10.x/missing-A' }))
    expect(missing).toContain(JSON.stringify({ zoteroKey: 'missing-key-B' }))

    // DB 完全无副作用
    expect(listEvidenceRefs(repo)).toHaveLength(0)
    expect(listEvidenceSets(repo)).toHaveLength(0)
  })

  test('paperRef 走软删 paper → 视为 missing', () => {
    const { repo } = openTestDb()
    const paper = createPaper(repo, { title: 'P', authors: [], doi: '10.x/del' })
    softDeletePaper(repo, paper.id)
    const review = createReview(repo, { title: 't', intent: 'i', sourceCapability: 'c' })

    let caught: unknown
    try {
      attachReviewEvidenceBundle(repo, {
        workspaceId: 'ws-test',
        reviewId: review.id,
        items: [{ paper: { doi: '10.x/del' }, source: buildMdAnchor({ snapshotText: 'p' }), target: buildHtmlAnchor({ snapshotText: 's' }) }],
        evidenceSet: { persisted: true, name: 's', savedAt: new Date().toISOString() as Timestamp },
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(PaperNotFoundError)
    const missing = (caught as PaperNotFoundError).missing[0] as PaperRef
    expect(missing).toEqual({ doi: '10.x/del' })
  })
})
