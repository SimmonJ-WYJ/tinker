/**
 * Notes 服务层集成测试 —— v0.2 证据列表重构后
 *
 * 覆盖：
 *   - createNoteFromPaperHighlight 单事务 4 步原子性（note + set + ref + setRef）
 *   - Paper 懒物化（findOrCreatePaperByZoteroKey 复用）
 *   - listNotesByPaper / listAllNotes 经 evidence_refs 三跳反查
 *   - softDeleteNote 应用层链式软删（set + refs 同步 visibility）
 *
 * 复用 objects/repositories/_helpers.test.ts 的 openTestDb()：bun:sqlite 内存库
 * + 完整 001-initial migration。注入到 service 即可绕过 better-sqlite3 单例。
 */

import { describe, expect, test } from 'bun:test'

import type { Anchor } from '@asci/shared'

import { openTestDb } from './objects/repositories/_helpers.test.ts'
import { findPaperByZoteroKey } from './objects/repositories/paper-repository.ts'
import { getEvidenceSetByNoteId } from './objects/repositories/evidence-set-repository.ts'
import { buildEvidenceSetForRefs } from './objects/evidence-attachment-service.ts'
import {
  listEvidenceRefsByTarget,
  listEvidenceRefsBySourcePaper,
} from './objects/repositories/evidence-ref-repository.ts'
import { createReview } from './objects/repositories/review-repository.ts'

import {
  addPaperToEvidenceSet,
  createEvidenceSetWithPaper,
  createNoteFromPaperHighlight,
  createNoteFromReviewHighlight,
  listAllNotes,
  listNotesByPaper,
  softDeleteNote,
  updateNoteBody,
} from './notes-service.ts'

const FALLBACK = {
  title: 'Long-context vs RAG',
  authors: ['Alice', 'Bob'],
  abstract: 'TL;DR: retrieval still beats long context past 1M tokens.',
  year: 2026,
}

const HIGHLIGHT: Anchor = {
  type: 'md',
  snapshotText: 'highlighted paragraph from paper',
}

describe('notes-service: createFromPaperHighlight 单事务 4 步', () => {
  test('首次调用 → 懒物化 paper + 建 note + set + ref + set_ref', () => {
    const { repo } = openTestDb()
    expect(findPaperByZoteroKey(repo, 'ZK-1')).toBeNull()

    const result = createNoteFromPaperHighlight(repo, {
      workspaceId: 'ws-test',

      body: 'first note',
      paper: { zoteroKey: 'ZK-1', fallback: FALLBACK },
      sourceAnchor: HIGHLIGHT,
    })

    // (1) Paper 已物化
    const paper = findPaperByZoteroKey(repo, 'ZK-1')
    expect(paper).not.toBeNull()
    expect(paper!.id).toBe(result.paperId)
    expect(paper!.title).toBe(FALLBACK.title)

    // (2) Note 落库
    expect(result.note.body).toBe('first note')

    // (3) evidence_set 1:1 绑定 note；persisted=0 临时集合
    const set = getEvidenceSetByNoteId(repo, result.note.id)
    expect(set).not.toBeNull()
    expect(set!.id).toBe(result.evidenceSetId)
    expect(set!.persisted).toBe(false)
    expect(set!.evidenceRefIds).toEqual([result.evidenceRefId])

    // (4) evidence_ref source=paper, target=set
    const refs = listEvidenceRefsByTarget(repo, 'evidence-set', set!.id)
    expect(refs.length).toBe(1)
    expect(refs[0]!.id).toBe(result.evidenceRefId)
    expect(refs[0]!.source.kind).toBe('paper')
    expect(refs[0]!.source.id).toBe(paper!.id)
    expect(refs[0]!.source.anchor.snapshotText).toBe(HIGHLIGHT.snapshotText)
    expect(refs[0]!.target.kind).toBe('evidence-set')
  })
})

describe('notes-service: V5 多条追加 P1 协议（连续划词建注）', () => {
  test('同一 zoteroKey 连续 3 次 → 3 个独立 note + 3 个独立 set + 复用同一 Paper', async () => {
    const { repo } = openTestDb()

    const r1 = createNoteFromPaperHighlight(repo, {
      workspaceId: 'ws-test',

      body: 'note one',
      paper: { zoteroKey: 'ZK-A', fallback: FALLBACK },
      sourceAnchor: HIGHLIGHT,
    })
    await new Promise((r) => setTimeout(r, 5))
    const r2 = createNoteFromPaperHighlight(repo, {
      workspaceId: 'ws-test',

      body: 'note two',
      paper: { zoteroKey: 'ZK-A', fallback: FALLBACK },
      sourceAnchor: HIGHLIGHT,
    })
    await new Promise((r) => setTimeout(r, 5))
    const r3 = createNoteFromPaperHighlight(repo, {
      workspaceId: 'ws-test',


      body: 'note three (as hypothesis)',
      paper: { zoteroKey: 'ZK-A', fallback: FALLBACK },
      sourceAnchor: HIGHLIGHT,
    })

    // 共用同一 paper
    expect(r1.paperId).toBe(r2.paperId)
    expect(r2.paperId).toBe(r3.paperId)

    // 三个独立 note
    expect(new Set([r1.note.id, r2.note.id, r3.note.id]).size).toBe(3)
    // 三个独立 set
    expect(new Set([r1.evidenceSetId, r2.evidenceSetId, r3.evidenceSetId]).size).toBe(3)

    // listByPaper 经 evidence_refs 反查到 3 条 note
    const list = listNotesByPaper(repo, { zoteroKey: 'ZK-A', workspaceId: 'ws-test' })
    expect(list.map((it) => it.note.id).sort()).toEqual([r1.note.id, r2.note.id, r3.note.id].sort())

    // body 内容正确保存
    const byId = new Map(list.map((it) => [it.note.id, it.note]))
    expect(byId.get(r3.note.id)!.body).toBe('note three (as hypothesis)')
    expect(byId.get(r1.note.id)!.body).toBe('note one')
  })

  test('不同 zoteroKey 的 Note 互不串扰', () => {
    const { repo } = openTestDb()
    const a = createNoteFromPaperHighlight(repo, {
      workspaceId: 'ws-test',

      body: 'A',
      paper: { zoteroKey: 'ZK-X', fallback: FALLBACK },
      sourceAnchor: HIGHLIGHT,
    })
    const b = createNoteFromPaperHighlight(repo, {
      workspaceId: 'ws-test',

      body: 'B',
      paper: { zoteroKey: 'ZK-Y', fallback: { ...FALLBACK, title: 'Other' } },
      sourceAnchor: HIGHLIGHT,
    })

    expect(a.paperId).not.toBe(b.paperId)
    expect(listNotesByPaper(repo, { zoteroKey: 'ZK-X', workspaceId: 'ws-test' }).map((n) => n.note.body)).toEqual(['A'])
    expect(listNotesByPaper(repo, { zoteroKey: 'ZK-Y', workspaceId: 'ws-test' }).map((n) => n.note.body)).toEqual(['B'])
  })

  test('listNotesByPaper 返回 quote 字段（来自 ref.anchor.snapshotText，B3）', () => {
    const { repo } = openTestDb()
    createNoteFromPaperHighlight(repo, {
      workspaceId: 'ws-test',

      body: 'user note',
      paper: { zoteroKey: 'ZK-Q', fallback: FALLBACK },
      sourceAnchor: { type: 'md', snapshotText: '这是引文片段' },
    })
    const list = listNotesByPaper(repo, { zoteroKey: 'ZK-Q', workspaceId: 'ws-test' })
    expect(list).toHaveLength(1)
    expect(list[0]!.quote).toBe('这是引文片段')
    expect(list[0]!.note.body).toBe('user note')
  })
})

describe('notes-service: listNotesByPaper 兜底', () => {
  test('zoteroKey 还未物化过 Paper → 返回空数组（不抛错）', () => {
    const { repo } = openTestDb()
    expect(listNotesByPaper(repo, { zoteroKey: 'NONE', workspaceId: 'ws-test' })).toEqual([])
  })
})

describe('notes-service: listAllNotes 全局聚合（V6a）', () => {
  test('空库 → 返回空数组', () => {
    const { repo } = openTestDb()
    expect(listAllNotes(repo, 'ws-test')).toEqual([])
  })

  test('跨多 paper 写入 → 全部按 createdAt DESC 聚合，每条带 paper 标题', async () => {
    const { repo } = openTestDb()
    const a = createNoteFromPaperHighlight(repo, {
      workspaceId: 'ws-test',

      body: 'a',
      paper: { zoteroKey: 'PAPER-A', fallback: { ...FALLBACK, title: 'Paper A' } },
      sourceAnchor: HIGHLIGHT,
    })
    await new Promise((r) => setTimeout(r, 5))
    const b = createNoteFromPaperHighlight(repo, {
      workspaceId: 'ws-test',


      body: 'b',
      paper: { zoteroKey: 'PAPER-B', fallback: { ...FALLBACK, title: 'Paper B' } },
      sourceAnchor: HIGHLIGHT,
    })
    const list = listAllNotes(repo, 'ws-test')
    expect(list.map((it) => it.note.id)).toEqual([b.note.id, a.note.id]) // DESC
    expect(list[0]!.paper!.title).toBe('Paper B')
    expect(list[0]!.paper!.zoteroKey).toBe('PAPER-B')
    expect(list[1]!.paper!.title).toBe('Paper A')
    expect(list[1]!.paper!.zoteroKey).toBe('PAPER-A')
  })

  test('softDelete 的 Note 不出现在聚合里', () => {
    const { repo } = openTestDb()
    const a = createNoteFromPaperHighlight(repo, {
      workspaceId: 'ws-test',

      body: 'a',
      paper: { zoteroKey: 'PAPER-D', fallback: FALLBACK },
      sourceAnchor: HIGHLIGHT,
    })
    softDeleteNote(repo, { id: a.note.id })
    expect(listAllNotes(repo, 'ws-test')).toEqual([])
  })

  test('persisted=0 的临时证据集不出现在聚合里（v0.2.x：综述 autohook 自动建的 temp set）', () => {
    const { repo } = openTestDb()
    // (1) 用户主动建的命名 set —— 持久，必须出现
    const persisted = createNoteFromPaperHighlight(repo, {
      workspaceId: 'ws-test',
      body: 'user-saved',
      paper: { zoteroKey: 'PAPER-PERSIST', fallback: { ...FALLBACK, title: 'User Saved' } },
      sourceAnchor: HIGHLIGHT,
    })
    // (2) 仿 review autohook 建一条 persisted=false 的临时 set（绕开 service，
    //     直接走 buildEvidenceSetForRefs，body=review.title 占位 note）
    buildEvidenceSetForRefs(repo, {
      refIds: [],
      noteBody: 'Auto-generated review title',
      persisted: false,
      workspaceId: 'ws-test',
    })

    const list = listAllNotes(repo, 'ws-test')
    expect(list).toHaveLength(1)
    expect(list[0]!.note.id).toBe(persisted.note.id)
    expect(list[0]!.paper!.title).toBe('User Saved')
  })
})

describe('notes-service: updateBody / softDelete 链', () => {
  test('updateNoteBody 改 body 不影响其他 Note', () => {
    const { repo } = openTestDb()
    const a = createNoteFromPaperHighlight(repo, {
      workspaceId: 'ws-test',

      body: 'a-orig',
      paper: { zoteroKey: 'ZK-U', fallback: FALLBACK },
      sourceAnchor: HIGHLIGHT,
    })
    const b = createNoteFromPaperHighlight(repo, {
      workspaceId: 'ws-test',

      body: 'b',
      paper: { zoteroKey: 'ZK-U', fallback: FALLBACK },
      sourceAnchor: HIGHLIGHT,
    })
    const updated = updateNoteBody(repo, { id: a.note.id, body: 'a-new' })
    expect(updated.body).toBe('a-new')

    const list = listNotesByPaper(repo, { zoteroKey: 'ZK-U', workspaceId: 'ws-test' })
    expect(list.find((it) => it.note.id === b.note.id)?.note.body).toBe('b')
  })

  test('softDeleteNote 触发应用层链：set + ref visibility 同步 deleted', () => {
    const { repo } = openTestDb()
    const a = createNoteFromPaperHighlight(repo, {
      workspaceId: 'ws-test',

      body: 'a',
      paper: { zoteroKey: 'ZK-D', fallback: FALLBACK },
      sourceAnchor: HIGHLIGHT,
    })

    softDeleteNote(repo, { id: a.note.id })

    // listNotesByPaper 反查不到（多重 visibility != 'deleted' 守门）
    expect(listNotesByPaper(repo, { zoteroKey: 'ZK-D', workspaceId: 'ws-test' })).toEqual([])

    // evidence_ref 也被软删（listEvidenceRefsBySourcePaper 默认排除 deleted）
    expect(listEvidenceRefsBySourcePaper(repo, a.paperId)).toEqual([])
  })
})

// ---------------- createNoteFromReviewHighlight ----------------

const REVIEW_ANCHOR: Anchor = {
  type: 'html',
  snapshotText: 'review-side cited sentence',
  locationData: {
    kind: 'html',
    sectionId: 's2',
    paragraphIndex: 1,
    citeIndex: 0,
  },
}

describe('notes-service: createFromReviewHighlight 单事务 4 步', () => {
  test('在综述里加 note → note + set + ref (source=review, target=set) + setRef 全部落库', () => {
    const { repo } = openTestDb()
    const review = createReview(repo, { title: 't', intent: 'i', sourceCapability: 'c' })

    const result = createNoteFromReviewHighlight(repo, {
      workspaceId: 'ws-test',
      reviewId: review.id,

      body: 'observation about that cite',
      sourceAnchor: REVIEW_ANCHOR,
    })

    // (1) Note 落库
    expect(result.note.body).toBe('observation about that cite')

    // (2) Set 1:1 绑定 note
    const set = getEvidenceSetByNoteId(repo, result.note.id)
    expect(set).not.toBeNull()
    expect(set!.id).toBe(result.evidenceSetId)
    expect(set!.persisted).toBe(false)
    expect(set!.evidenceRefIds).toEqual([result.evidenceRefId])

    // (3) Evidence ref source=review, target=set
    const refs = listEvidenceRefsByTarget(repo, 'evidence-set', set!.id)
    expect(refs.length).toBe(1)
    expect(refs[0]!.source.kind).toBe('review')
    expect(refs[0]!.source.id).toBe(review.id)
    expect(refs[0]!.source.anchor.snapshotText).toBe(REVIEW_ANCHOR.snapshotText)
    expect(refs[0]!.target.kind).toBe('evidence-set')
  })

  test('softDeleteNote 触发应用层链：set + ref visibility 同步 deleted（review-source 也覆盖）', () => {
    const { repo } = openTestDb()
    const review = createReview(repo, { title: 't', intent: 'i', sourceCapability: 'c' })
    const result = createNoteFromReviewHighlight(repo, {
      workspaceId: 'ws-test',
      reviewId: review.id,

      body: 'x',
      sourceAnchor: REVIEW_ANCHOR,
    })

    softDeleteNote(repo, { id: result.note.id })

    // 该 set 上的 refs 默认（visibility != deleted）反查不到
    expect(listEvidenceRefsByTarget(repo, 'evidence-set', result.evidenceSetId)).toEqual([])
  })
})

// ---------------- addPaperToEvidenceSet / createEvidenceSetWithPaper ----------------

describe('notes-service: createEvidenceSetWithPaper（"+ Add → 新建"入口）', () => {
  test('新建命名 set + 自动建占位 note + 挂当前 paper（4 步事务）', () => {
    const { repo } = openTestDb()
    const result = createEvidenceSetWithPaper(repo, {
      workspaceId: 'ws-test',
      name: 'My Trial Set',
      paper: { zoteroKey: 'ZK-X', fallback: FALLBACK },
    })
    expect(result.evidenceSetId).toBeTruthy()
    expect(result.noteId).toBeTruthy()
    expect(result.paperId).toBeTruthy()
    expect(result.evidenceRefId).toBeTruthy()

    // paper 物化 + set 持久化 + ref 落库 + 关联表挂上
    const paper = findPaperByZoteroKey(repo, 'ZK-X')
    expect(paper?.id).toBe(result.paperId)

    const set = getEvidenceSetByNoteId(repo, result.noteId)
    expect(set?.id).toBe(result.evidenceSetId)
    expect(set?.persisted).toBe(true)
    expect(set?.name).toBe('My Trial Set')
    expect(set?.evidenceRefIds).toEqual([result.evidenceRefId])

    const refs = listEvidenceRefsByTarget(repo, 'evidence-set', result.evidenceSetId)
    expect(refs.length).toBe(1)
    expect(refs[0]!.source.kind).toBe('paper')
    expect(refs[0]!.source.id).toBe(result.paperId)
  })

  test('占位 note body 默认空串；显式 noteBody 优先', () => {
    // name 已经是 evidence_sets 表的独立字段，body 不再用 name 兜底（否则列表 preview 与
    // title 重复、addPaper 追加 addendum 时会变成 "name\n\nnew" 视觉上像一长串）。
    const { repo } = openTestDb()
    const a = createEvidenceSetWithPaper(repo, {
      workspaceId: 'ws-test',
      name: 'Name A',
      paper: { zoteroKey: 'ZK-A', fallback: FALLBACK },
    })
    const b = createEvidenceSetWithPaper(repo, {
      workspaceId: 'ws-test',
      name: 'Name B',
      noteBody: 'custom body',
      paper: { zoteroKey: 'ZK-B', fallback: FALLBACK },
    })
    const setA = getEvidenceSetByNoteId(repo, a.noteId)!
    const setB = getEvidenceSetByNoteId(repo, b.noteId)!
    expect(setA.name).toBe('Name A')
    expect(setB.name).toBe('Name B')
    const listA = listNotesByPaper(repo, { zoteroKey: 'ZK-A', workspaceId: 'ws-test' })
    const listB = listNotesByPaper(repo, { zoteroKey: 'ZK-B', workspaceId: 'ws-test' })
    expect(listA[0]!.note.body).toBe('')
    expect(listB[0]!.note.body).toBe('custom body')
  })
})

describe('notes-service: addPaperToEvidenceSet（"+ Add → 选已有"入口，幂等）', () => {
  test('挂 paper 到既有 set → 新建 ref + 关联表 +1', () => {
    const { repo } = openTestDb()
    // 先建一个 set（带 paper A）
    const first = createEvidenceSetWithPaper(repo, {
      workspaceId: 'ws-test',
      name: 'Bucket',
      paper: { zoteroKey: 'ZK-A', fallback: FALLBACK },
    })
    // 再挂 paper B 到同一 set
    const result = addPaperToEvidenceSet(repo, {
      setId: first.evidenceSetId,
      paper: { zoteroKey: 'ZK-B', fallback: { ...FALLBACK, title: 'Other' } },
    })
    expect(result.created).toBe(true)

    const refs = listEvidenceRefsByTarget(repo, 'evidence-set', first.evidenceSetId)
    expect(refs.length).toBe(2)
    const sourceIds = new Set(refs.map((r) => r.source.id))
    expect(sourceIds.has(first.paperId)).toBe(true)
    expect(sourceIds.has(result.paperId)).toBe(true)
  })

  test('同一 paper 重复加入 → 幂等：created=false，refs 不增加', () => {
    const { repo } = openTestDb()
    const first = createEvidenceSetWithPaper(repo, {
      workspaceId: 'ws-test',
      name: 'Bucket',
      paper: { zoteroKey: 'ZK-A', fallback: FALLBACK },
    })
    const result = addPaperToEvidenceSet(repo, {
      setId: first.evidenceSetId,
      paper: { zoteroKey: 'ZK-A', fallback: FALLBACK },
    })
    expect(result.created).toBe(false)
    expect(result.evidenceRefId).toBe(first.evidenceRefId)
    expect(result.paperId).toBe(first.paperId)

    const refs = listEvidenceRefsByTarget(repo, 'evidence-set', first.evidenceSetId)
    expect(refs.length).toBe(1)
  })
})
