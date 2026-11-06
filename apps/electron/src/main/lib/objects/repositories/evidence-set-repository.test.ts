/**
 * EvidenceSet repo 集成测试（v0.2 重构后）
 *
 * 覆盖：
 *   - persisted=true / false 输入校验
 *   - note_id 1:1 强绑定（UNIQUE / NOT NULL）+ ON DELETE CASCADE
 *   - evidence_set_refs 关联表事务 + position 保序
 *   - getEvidenceSetByNoteId 反查
 *   - appendEvidenceRefToSet 在尾部追加
 *   - 删 note → CASCADE 删 set（DB hard delete 路径）
 */

import { describe, expect, test } from 'bun:test'
import { buildHtmlAnchor, buildMdAnchor } from '../anchor-codec.ts'

import type { ObjectId } from '@asci/shared'

import { openTestDb } from './_helpers.test.ts'
import {
  appendEvidenceRefToSet,
  appendNoteToSet,
  createEvidenceSet,
  getEvidenceSetById,
  getEvidenceSetByNoteId,
  listAllTags,
  listEvidenceSets,
  listSetIdsByNote,
  readNoteIds,
  readTags,
  removeNoteFromSet,
  setEvidenceRefIds,
  setTags,
  softDeleteEvidenceSet,
} from './evidence-set-repository.ts'
import { createEvidenceRef } from './evidence-ref-repository.ts'
import { createNote } from './note-repository.ts'
import { createPaper } from './paper-repository.ts'
import { createReview } from './review-repository.ts'

function seedNote(repo: Parameters<typeof createPaper>[0]) {
  return createNote(repo, { body: 'b' })
}

describe('evidence-set-repository: workspaceId 必填（issue #457）', () => {
  test('缺省 workspaceId 抛错', () => {
    const { repo } = openTestDb()
    const n = seedNote(repo)
    expect(() =>
      // @ts-expect-error 故意省略 workspaceId 验证运行期守门
      createEvidenceSet(repo, { noteId: n.id, persisted: false, evidenceRefIds: [] }),
    ).toThrow(/workspaceId 必填/)
  })

  test('空白 workspaceId 抛错', () => {
    const { repo } = openTestDb()
    const n = seedNote(repo)
    expect(() =>
      createEvidenceSet(repo, {
        workspaceId: '   ',
        noteId: n.id,
        persisted: false,
        evidenceRefIds: [],
      }),
    ).toThrow(/workspaceId 必填/)
  })

  test('写入的 workspace_id 可在回读时拿到', () => {
    const { repo } = openTestDb()
    const n = seedNote(repo)
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-xyz',
      noteId: n.id,
      persisted: false,
      evidenceRefIds: [],
    })
    expect(set.workspaceId).toBe('ws-xyz')
  })
})

describe('evidence-set-repository: persisted 校验', () => {
  test('persisted=true 必填 name + savedAt', () => {
    const { repo } = openTestDb()
    const n = seedNote(repo)
    expect(() =>
      createEvidenceSet(repo, {
      workspaceId: 'ws-test',
        noteId: n.id,
        persisted: true,
        evidenceRefIds: [],
      }),
    ).toThrow(/name 必填/)
    const n2 = seedNote(repo)
    expect(() =>
      createEvidenceSet(repo, {
      workspaceId: 'ws-test',
        noteId: n2.id,
        persisted: true,
        name: 'n',
        evidenceRefIds: [],
      }),
    ).toThrow(/savedAt 必填/)
  })

  test('persisted=false 禁带 name / savedAt', () => {
    const { repo } = openTestDb()
    const n = seedNote(repo)
    expect(() =>
      createEvidenceSet(repo, {
      workspaceId: 'ws-test',
        noteId: n.id,
        persisted: false,
        name: 'oops',
        evidenceRefIds: [],
      }),
    ).toThrow(/name 必空/)
    const n2 = seedNote(repo)
    expect(() =>
      createEvidenceSet(repo, {
      workspaceId: 'ws-test',
        noteId: n2.id,
        persisted: false,
        savedAt: '2026-05-19T10:00:00Z' as never,
        evidenceRefIds: [],
      }),
    ).toThrow(/savedAt 必空/)
  })
})

describe('evidence-set-repository: noteId 1:1 强绑定', () => {
  test('一个 note 对应一个 set + getEvidenceSetByNoteId 反查命中', () => {
    const { repo } = openTestDb()
    const n = seedNote(repo)
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: n.id,
      persisted: false,
      evidenceRefIds: [],
    })
    expect(set.noteId).toBe(n.id)
    expect(getEvidenceSetByNoteId(repo, n.id)?.id).toBe(set.id)
  })

  test('同一 note 创建第二个 set → UNIQUE 抛错', () => {
    const { repo } = openTestDb()
    const n = seedNote(repo)
    createEvidenceSet(repo, {
      workspaceId: 'ws-test', noteId: n.id, persisted: false, evidenceRefIds: [] })
    expect(() =>
      createEvidenceSet(repo, {
      workspaceId: 'ws-test', noteId: n.id, persisted: false, evidenceRefIds: [] }),
    ).toThrow(/UNIQUE/i)
  })

  test('note 不存在 → FK 拒绝', () => {
    const { repo } = openTestDb()
    expect(() =>
      createEvidenceSet(repo, {
      workspaceId: 'ws-test',
        noteId: 'ghost' as ObjectId,
        persisted: false,
        evidenceRefIds: [],
      }),
    ).toThrow(/FOREIGN KEY/i)
  })

  test('硬删 note → CASCADE 删 set', () => {
    const { db, repo } = openTestDb()
    const n = seedNote(repo)
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: n.id,
      persisted: false,
      evidenceRefIds: [],
    })
    db.prepare('DELETE FROM notes WHERE id = ?').run(n.id)
    const row = db.query('SELECT id FROM evidence_sets WHERE id = ?').get(set.id)
    expect(row).toBeNull()
  })
})

describe('evidence-set-repository: create + 关联表事务', () => {
  test('createEvidenceSet 主表 + evidence_set_refs 一次性落库；position 保序', () => {
    const { db, repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [] })
    const rev = createReview(repo, { title: 'r', intent: 'i', sourceCapability: 'c' })
    const ref1 = createEvidenceRef(repo, {
      source: { kind: 'paper', id: p.id, anchor: buildMdAnchor({ snapshotText: 'a' }) },
      target: { kind: 'review', id: rev.id, anchor: buildHtmlAnchor({ snapshotText: 'b' }) },
    })
    const ref2 = createEvidenceRef(repo, {
      source: { kind: 'paper', id: p.id, anchor: buildMdAnchor({ snapshotText: 'c' }) },
      target: { kind: 'review', id: rev.id, anchor: buildHtmlAnchor({ snapshotText: 'd' }) },
    })

    const n = seedNote(repo)
    const s = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: n.id,
      persisted: true,
      name: 'My Set',
      savedAt: '2026-05-19T10:00:00Z' as never,
      evidenceRefIds: [ref2.id, ref1.id],
    })

    expect(s.persisted).toBe(true)
    expect(s.name).toBe('My Set')
    expect(s.evidenceRefIds).toEqual([ref2.id, ref1.id])

    const positions = db
      .query('SELECT ref_id, position FROM evidence_set_refs WHERE set_id = ? ORDER BY position')
      .all(s.id) as Array<{ ref_id: string; position: number }>
    expect(positions).toEqual([
      { ref_id: ref2.id, position: 0 },
      { ref_id: ref1.id, position: 1 },
    ])
  })

  test('createEvidenceSet 关联表 FK 失败 → 整体回滚', () => {
    const { db, repo } = openTestDb()
    const n = seedNote(repo)
    expect(() =>
      createEvidenceSet(repo, {
      workspaceId: 'ws-test',
        noteId: n.id,
        persisted: false,
        evidenceRefIds: ['ghost-ref' as ObjectId],
      }),
    ).toThrow(/FOREIGN KEY/i)
    const count = (db.query('SELECT COUNT(*) AS n FROM evidence_sets').get() as { n: number }).n
    expect(count).toBe(0)
  })

  test('createEvidenceSet persisted=false 不填 name → 落库', () => {
    const { repo } = openTestDb()
    const n = seedNote(repo)
    const s = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: n.id,
      persisted: false,
      evidenceRefIds: [],
    })
    expect(s.persisted).toBe(false)
    expect(s.name).toBeUndefined()
    expect(s.savedAt).toBeUndefined()
  })
})

describe('evidence-set-repository: setEvidenceRefIds / appendEvidenceRefToSet', () => {
  test('setEvidenceRefIds 重排 + 删旧增新', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [] })
    const r = createReview(repo, { title: 'r', intent: 'i', sourceCapability: 'c' })
    const r1 = createEvidenceRef(repo, {
      source: { kind: 'paper', id: p.id, anchor: buildMdAnchor({ snapshotText: 'a' }) },
      target: { kind: 'review', id: r.id, anchor: buildHtmlAnchor({ snapshotText: 'b' }) },
    })
    const r2 = createEvidenceRef(repo, {
      source: { kind: 'paper', id: p.id, anchor: buildMdAnchor({ snapshotText: 'c' }) },
      target: { kind: 'review', id: r.id, anchor: buildHtmlAnchor({ snapshotText: 'd' }) },
    })
    const n = seedNote(repo)
    const s = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: n.id,
      persisted: false,
      evidenceRefIds: [r1.id, r2.id],
    })
    setEvidenceRefIds(repo, s.id, [r2.id])
    const re = getEvidenceSetById(repo, s.id)!
    expect(re.evidenceRefIds).toEqual([r2.id])
  })

  test('appendEvidenceRefToSet 追加 + 计算下一个 position', () => {
    const { db, repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [] })
    const r = createReview(repo, { title: 'r', intent: 'i', sourceCapability: 'c' })
    const refs = [0, 1, 2].map((i) =>
      createEvidenceRef(repo, {
        source: { kind: 'paper', id: p.id, anchor: buildMdAnchor({ snapshotText: `s${i}` }) },
        target: { kind: 'review', id: r.id, anchor: buildHtmlAnchor({ snapshotText: `t${i}` }) },
      }),
    )
    const n = seedNote(repo)
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: n.id,
      persisted: false,
      evidenceRefIds: [refs[0]!.id],
    })
    appendEvidenceRefToSet(repo, set.id, refs[1]!.id)
    appendEvidenceRefToSet(repo, set.id, refs[2]!.id)
    const rows = db
      .query('SELECT ref_id, position FROM evidence_set_refs WHERE set_id = ? ORDER BY position')
      .all(set.id) as Array<{ ref_id: string; position: number }>
    expect(rows).toEqual([
      { ref_id: refs[0]!.id, position: 0 },
      { ref_id: refs[1]!.id, position: 1 },
      { ref_id: refs[2]!.id, position: 2 },
    ])
  })
})

describe('evidence-set-repository: softDelete + list', () => {
  test('softDelete + 默认 list 排除 deleted', () => {
    const { repo } = openTestDb()
    const n1 = seedNote(repo)
    const n2 = seedNote(repo)
    const alive = createEvidenceSet(repo, {
      workspaceId: 'ws-test', noteId: n1.id, persisted: false, evidenceRefIds: [] })
    const dead = createEvidenceSet(repo, {
      workspaceId: 'ws-test', noteId: n2.id, persisted: false, evidenceRefIds: [] })
    softDeleteEvidenceSet(repo, dead.id)
    expect(listEvidenceSets(repo).map((s) => s.id)).toEqual([alive.id])
    expect(listEvidenceSets(repo, { includeDeleted: true }).length).toBe(2)
  })

  test('硬删 set 触发 evidence_set_refs CASCADE 清理', () => {
    const { db, repo } = openTestDb()
    const p = createPaper(repo, { title: 'P', authors: [] })
    const r = createReview(repo, { title: 'r', intent: 'i', sourceCapability: 'c' })
    const ref = createEvidenceRef(repo, {
      source: { kind: 'paper', id: p.id, anchor: buildMdAnchor({ snapshotText: 'a' }) },
      target: { kind: 'review', id: r.id, anchor: buildHtmlAnchor({ snapshotText: 'b' }) },
    })
    const n = seedNote(repo)
    const s = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: n.id,
      persisted: false,
      evidenceRefIds: [ref.id],
    })
    db.prepare('DELETE FROM evidence_sets WHERE id = ?').run(s.id)
    const count = (db.query('SELECT COUNT(*) AS n FROM evidence_set_refs').get() as {
      n: number
    }).n
    expect(count).toBe(0)
  })

  test('getEvidenceSetById 缺失返回 null', () => {
    const { repo } = openTestDb()
    expect(getEvidenceSetById(repo, 'no' as ObjectId)).toBeNull()
  })
})

describe('evidence-set-repository: 笔记 ↔ 集 M:N join（003 容器化）', () => {
  /** 建一个无 note 的显式容器（persisted=1） */
  function seedContainer(repo: Parameters<typeof createPaper>[0], name = 'c'): ObjectId {
    return createEvidenceSet(repo, {
      persisted: true,
      name,
      savedAt: '2026-06-25T10:00:00.000Z',
      evidenceRefIds: [],
      workspaceId: 'ws-test',
    }).id
  }

  test('appendNoteToSet + readNoteIds：保序追加', () => {
    const { repo } = openTestDb()
    const setId = seedContainer(repo)
    const n1 = seedNote(repo)
    const n2 = seedNote(repo)
    appendNoteToSet(repo, setId, n1.id)
    appendNoteToSet(repo, setId, n2.id)
    expect(readNoteIds(repo, setId)).toEqual([n1.id, n2.id])
  })

  test('appendNoteToSet 幂等：同笔记重复加 → 仍一条、不抛错', () => {
    const { repo } = openTestDb()
    const setId = seedContainer(repo)
    const n1 = seedNote(repo)
    appendNoteToSet(repo, setId, n1.id)
    expect(() => appendNoteToSet(repo, setId, n1.id)).not.toThrow()
    expect(readNoteIds(repo, setId)).toEqual([n1.id])
  })

  test('removeNoteFromSet：移除一条不影响其余', () => {
    const { repo } = openTestDb()
    const setId = seedContainer(repo)
    const n1 = seedNote(repo)
    const n2 = seedNote(repo)
    appendNoteToSet(repo, setId, n1.id)
    appendNoteToSet(repo, setId, n2.id)
    removeNoteFromSet(repo, setId, n1.id)
    expect(readNoteIds(repo, setId)).toEqual([n2.id])
  })

  test('listSetIdsByNote：反查归属容器，排除已软删容器', () => {
    const { repo } = openTestDb()
    const setA = seedContainer(repo, 'a')
    const setB = seedContainer(repo, 'b')
    const n1 = seedNote(repo)
    appendNoteToSet(repo, setA, n1.id)
    appendNoteToSet(repo, setB, n1.id)
    softDeleteEvidenceSet(repo, setB)
    expect(listSetIdsByNote(repo, n1.id)).toEqual([setA])
  })
})

describe('evidence-set-repository: 容器级标签（003）', () => {
  function seedContainer(repo: Parameters<typeof createPaper>[0], name: string): ObjectId {
    return createEvidenceSet(repo, {
      persisted: true,
      name,
      savedAt: '2026-06-25T10:00:00.000Z',
      evidenceRefIds: [],
      workspaceId: 'ws-test',
    }).id
  }

  test('setTags + readTags：去空白去重 + 字典序读回', () => {
    const { repo } = openTestDb()
    const setId = seedContainer(repo, 'c')
    setTags(repo, setId, ['在读', ' 小样本 ', '在读', ''])
    expect(readTags(repo, setId)).toEqual(['在读', '小样本'])
  })

  test('setTags 整体替换；空数组清空', () => {
    const { repo } = openTestDb()
    const setId = seedContainer(repo, 'c')
    setTags(repo, setId, ['a', 'b'])
    setTags(repo, setId, ['c'])
    expect(readTags(repo, setId)).toEqual(['c'])
    setTags(repo, setId, [])
    expect(readTags(repo, setId)).toEqual([])
  })

  test('listAllTags：workspace 内 DISTINCT 字典序，排除已删容器', () => {
    const { repo } = openTestDb()
    const setA = seedContainer(repo, 'a')
    const setB = seedContainer(repo, 'b')
    const setC = seedContainer(repo, 'c')
    setTags(repo, setA, ['对比学习', '在读'])
    setTags(repo, setB, ['在读', '待写作'])
    setTags(repo, setC, ['已删标签'])
    softDeleteEvidenceSet(repo, setC)
    // SQLite 默认 BINARY collation：中文按 Unicode 码点排序（在 5728 < 对 5BF9 < 待 5F85）
    expect(listAllTags(repo, 'ws-test')).toEqual(['在读', '对比学习', '待写作'])
  })
})
