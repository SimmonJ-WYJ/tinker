/**
 * EvidenceRef repo 集成测试（v0.2 重构后：双侧多态 source/target）
 *
 * 覆盖：
 *   - source_kind='paper' + target_kind='review' / 'evidence-set' 两种 target 路径
 *   - target_kind='evidence-set' 时 target_anchor 必空（DB CHECK + mapper 行为）
 *   - target_kind='review' 时 target_anchor 必填
 *   - listEvidenceRefsByTarget / listEvidenceRefsBySourcePaper / deleteRefsByTarget
 */

import { describe, expect, test } from 'bun:test'

import type { ObjectId } from '@asci/shared'

import { buildHtmlAnchor, buildMdAnchor } from '../anchor-codec.ts'
import { openTestDb } from './_helpers.test.ts'
import {
  createEvidenceRef,
  deleteRefsBySource,
  deleteRefsByTarget,
  getEvidenceRefById,
  listEvidenceRefs,
  listEvidenceRefsBySourcePaper,
  listEvidenceRefsByTarget,
  softDeleteEvidenceRef,
} from './evidence-ref-repository.ts'
import {
  createEvidenceSet,
  getEvidenceSetById,
} from './evidence-set-repository.ts'
import { createNote } from './note-repository.ts'
import { createPaper } from './paper-repository.ts'
import { createReview } from './review-repository.ts'

function seedPaperReview(repo: Parameters<typeof createPaper>[0]) {
  const paper = createPaper(repo, { title: 'p', authors: [] })
  const review = createReview(repo, { title: 'r', intent: 'i', sourceCapability: 'c' })
  return { paper, review }
}

function seedSet(repo: Parameters<typeof createPaper>[0]) {
  const note = createNote(repo, { body: 'b' })
  const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
    noteId: note.id,
    persisted: false,
    evidenceRefIds: [],
  })
  return { note, set }
}

function anchors(quoteText = 'X is better than Y under conditions Z', targetText = 'claim X holds.') {
  return {
    source: buildMdAnchor({ snapshotText: quoteText }),
    target: buildHtmlAnchor({ snapshotText: targetText, sectionId: 's1', paragraphIndex: 0, citeIndex: 0 }),
  }
}

describe('evidence-ref-repository: target=review 路径', () => {
  test('createEvidenceRef target=review 落库 + 默认 visibility + anchor codec', () => {
    const { repo } = openTestDb()
    const { paper, review } = seedPaperReview(repo)
    const a = anchors()
    const ref = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: a.source },
      target: { kind: 'review', id: review.id, anchor: a.target },
    })
    expect(ref.source.kind).toBe('paper')
    expect(ref.source.id).toBe(paper.id)
    expect(ref.target.kind).toBe('review')
    expect(ref.target.id).toBe(review.id)
    expect(ref.source.anchor.snapshotText).toBe('X is better than Y under conditions Z')
    if (ref.target.kind === 'review') {
      expect(ref.target.anchor.snapshotText).toBe('claim X holds.')
    }
    expect(ref.visibility).toBe('visible')
  })

  test('source paper 不存在不报错（多态 source 无 FK，与 target 对称）', () => {
    // 2026-05-24 review-side note 扩展：source 端也多态化（'paper'|'review'），
    // source_id 撤了 FK → 上层服务必须先校验来源对象存在再调 createEvidenceRef。
    const { repo } = openTestDb()
    const review = createReview(repo, { title: 'r', intent: 'i', sourceCapability: 'c' })
    const a = anchors()
    const ref = createEvidenceRef(repo, {
      source: { kind: 'paper', id: 'ghost' as ObjectId, anchor: a.source },
      target: { kind: 'review', id: review.id, anchor: a.target },
    })
    expect(ref.source.id).toBe('ghost')
  })

  test('target=review 但 review 行不存在不报错（多态 target 无 FK）', () => {
    // v0.2 重构后 target 多态化，没有 DB-FK；应用层 GC 负责一致性。
    // 这条 ref 创建成功是预期行为 —— 上层服务必须先校验 review 存在再调 createEvidenceRef。
    const { repo } = openTestDb()
    const paper = createPaper(repo, { title: 'p', authors: [] })
    const a = anchors()
    const ref = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: a.source },
      target: { kind: 'review', id: 'ghost' as ObjectId, anchor: a.target },
    })
    expect(ref.target.id).toBe('ghost')
  })
})

describe('evidence-ref-repository: target=evidence-set 路径', () => {
  test('target=evidence-set 时不传 target.anchor 也通过', () => {
    const { repo } = openTestDb()
    const paper = createPaper(repo, { title: 'p', authors: [] })
    const { set } = seedSet(repo)
    const a = anchors()
    const ref = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: a.source },
      target: { kind: 'evidence-set', id: set.id },
    })
    expect(ref.target.kind).toBe('evidence-set')
    if (ref.target.kind === 'evidence-set') {
      expect(ref.target.anchor).toBeUndefined()
    }
  })

  test('回读 row 验证 target_anchor 列为 NULL', () => {
    const { db, repo } = openTestDb()
    const paper = createPaper(repo, { title: 'p', authors: [] })
    const { set } = seedSet(repo)
    const a = anchors()
    const ref = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: a.source },
      target: { kind: 'evidence-set', id: set.id },
    })
    const row = db
      .query('SELECT target_anchor FROM evidence_refs WHERE id = ?')
      .get(ref.id) as { target_anchor: string | null }
    expect(row.target_anchor).toBeNull()
  })
})

describe('evidence-ref-repository: softDelete + list', () => {
  test('softDeleteEvidenceRef 行保留 + visibility=deleted', () => {
    const { db, repo } = openTestDb()
    const { paper, review } = seedPaperReview(repo)
    const a = anchors()
    const ref = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: a.source },
      target: { kind: 'review', id: review.id, anchor: a.target },
    })
    softDeleteEvidenceRef(repo, ref.id)
    const row = db
      .query('SELECT visibility, deleted_at FROM evidence_refs WHERE id = ?')
      .get(ref.id) as { visibility: string; deleted_at: string }
    expect(row.visibility).toBe('deleted')
    expect(row.deleted_at).toBeTruthy()
  })

  test('listEvidenceRefs 默认排除 deleted', () => {
    const { repo } = openTestDb()
    const { paper, review } = seedPaperReview(repo)
    const a1 = anchors('q1', 't1')
    const a2 = anchors('q2', 't2')
    const alive = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: a1.source },
      target: { kind: 'review', id: review.id, anchor: a1.target },
    })
    const dead = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: a2.source },
      target: { kind: 'review', id: review.id, anchor: a2.target },
    })
    softDeleteEvidenceRef(repo, dead.id)
    expect(listEvidenceRefs(repo).map((r) => r.id)).toEqual([alive.id])
  })

  test('listEvidenceRefsByTarget 按 target_kind + target_id 反查', () => {
    const { repo } = openTestDb()
    const { paper, review } = seedPaperReview(repo)
    const { set } = seedSet(repo)
    const a1 = anchors('q1', 't1')
    const a2 = anchors('q2', 't2')
    const refToReview = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: a1.source },
      target: { kind: 'review', id: review.id, anchor: a1.target },
    })
    const refToSet = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: a2.source },
      target: { kind: 'evidence-set', id: set.id },
    })
    expect(listEvidenceRefsByTarget(repo, 'review', review.id).map((r) => r.id)).toEqual([
      refToReview.id,
    ])
    expect(listEvidenceRefsByTarget(repo, 'evidence-set', set.id).map((r) => r.id)).toEqual([
      refToSet.id,
    ])
  })

  test('listEvidenceRefsBySourcePaper 反查源 paper', () => {
    const { repo } = openTestDb()
    const { paper, review } = seedPaperReview(repo)
    const a = anchors()
    const ref = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: a.source },
      target: { kind: 'review', id: review.id, anchor: a.target },
    })
    expect(listEvidenceRefsBySourcePaper(repo, paper.id).map((r) => r.id)).toEqual([ref.id])
  })
})

describe('evidence-ref-repository: 应用层 GC (deleteRefsByTarget)', () => {
  test('deleteRefsByTarget 清掉 evidence_refs + evidence_set_refs 关联', () => {
    const { db, repo } = openTestDb()
    const paper = createPaper(repo, { title: 'p', authors: [] })
    const { set } = seedSet(repo)
    const a = anchors()
    const ref = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: a.source },
      target: { kind: 'evidence-set', id: set.id },
    })
    // 手动塞一条关联
    db.query(
      `INSERT INTO evidence_set_refs (set_id, ref_id, position) VALUES (?, ?, 0)`,
    ).run(set.id, ref.id)

    const n = deleteRefsByTarget(repo, 'evidence-set', set.id)
    expect(n).toBe(1)
    expect(listEvidenceRefsByTarget(repo, 'evidence-set', set.id)).toEqual([])
    const assoc = db
      .query('SELECT COUNT(*) AS n FROM evidence_set_refs WHERE ref_id = ?')
      .get(ref.id) as { n: number }
    expect(assoc.n).toBe(0)
  })

  test('deleteRefsByTarget 没有匹配时返回 0', () => {
    const { repo } = openTestDb()
    expect(deleteRefsByTarget(repo, 'review', 'no' as ObjectId)).toBe(0)
  })

  test('deleteRefsBySource 清掉指定 source 下的所有 refs + 关联表（与 byTarget 对称）', () => {
    const { db, repo } = openTestDb()
    const { paper, review } = seedPaperReview(repo)
    const { set } = seedSet(repo)
    const a1 = anchors('q1', 't1')
    const a2 = anchors('q2', 't2')

    // 两条 source=paper 的 ref（不同 target）
    const r1 = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: a1.source },
      target: { kind: 'review', id: review.id, anchor: a1.target },
    })
    const r2 = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: a2.source },
      target: { kind: 'evidence-set', id: set.id },
    })
    // 手动塞 evidence_set_refs 关联
    db.query(`INSERT INTO evidence_set_refs (set_id, ref_id, position) VALUES (?, ?, 0)`).run(
      set.id,
      r2.id,
    )

    const n = deleteRefsBySource(repo, 'paper', paper.id)
    expect(n).toBe(2)
    expect(listEvidenceRefsBySourcePaper(repo, paper.id)).toEqual([])

    // 关联表也清了（r2 那条）
    const assocCount = db
      .query('SELECT COUNT(*) AS n FROM evidence_set_refs WHERE ref_id IN (?, ?)')
      .get(r1.id, r2.id) as { n: number }
    expect(assocCount.n).toBe(0)
  })

  test('deleteRefsBySource: source=review 路径也工作（新 review-side note 链路用）', () => {
    const { repo } = openTestDb()
    const review = createReview(repo, { title: 'r', intent: 'i', sourceCapability: 'c' })
    const { set } = seedSet(repo)
    const a = anchors()
    const ref = createEvidenceRef(repo, {
      source: { kind: 'review', id: review.id, anchor: a.source },
      target: { kind: 'evidence-set', id: set.id },
    })
    const n = deleteRefsBySource(repo, 'review', review.id)
    expect(n).toBe(1)
    expect(getEvidenceRefById(repo, ref.id)).toBeNull()
  })

  test('deleteRefsBySource 没有匹配时返回 0', () => {
    const { repo } = openTestDb()
    expect(deleteRefsBySource(repo, 'paper', 'no' as ObjectId)).toBe(0)
  })
})

describe('evidence-ref-repository: Anchor JSON 在 DB 列里 round-trip', () => {
  test('locationData 完整保留 + snapshotText verbatim', () => {
    const { db, repo } = openTestDb()
    const { paper, review } = seedPaperReview(repo)
    const ref = createEvidenceRef(repo, {
      source: {
        kind: 'paper',
        id: paper.id,
        anchor: buildMdAnchor({ snapshotText: 'orig', paragraphIndex: 5 }),
      },
      target: {
        kind: 'review',
        id: review.id,
        anchor: buildHtmlAnchor({
          snapshotText: 'review-side text',
          selector: '#s2 > p:nth-of-type(3)',
          sectionId: 's2',
          paragraphIndex: 2,
          citeIndex: 1,
        }),
      },
    })
    // DB 列里确实是 JSON
    const row = db
      .query('SELECT source_anchor, target_anchor FROM evidence_refs WHERE id = ?')
      .get(ref.id) as { source_anchor: string; target_anchor: string }
    expect(row.source_anchor).toContain('"snapshot_text":"orig"')
    expect(row.target_anchor).toContain('"section_id":"s2"')
    expect(row.target_anchor).toContain('"cite_index":1')

    // 反查回来 anchor 结构完整
    const got = getEvidenceRefById(repo, ref.id)!
    expect(got.source.anchor.snapshotText).toBe('orig')
    if (got.target.kind === 'review') {
      expect(got.target.anchor.locationData).toEqual({
        kind: 'html',
        selector: '#s2 > p:nth-of-type(3)',
        sectionId: 's2',
        paragraphIndex: 2,
        citeIndex: 1,
      })
    }
  })
})

describe('evidence-ref-repository: 关联 set 用于反查', () => {
  test('getEvidenceSetById 读得到 1:1 绑定的 note', () => {
    const { repo } = openTestDb()
    const { note, set } = seedSet(repo)
    const got = getEvidenceSetById(repo, set.id)
    expect(got).not.toBeNull()
    expect(got!.noteId).toBe(note.id)
  })
})
