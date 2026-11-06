/**
 * EvidenceSet 服务层集成测试（B2）
 *
 * 覆盖：
 *   - createAgentEvidenceSet：建无 note 的 set，source='agent-assembled'
 *   - promoteSetToNote：把 agent-assembled set 提升为 note 持有的 set；
 *     幂等性（重复 promote 应抛错）；不存在的 setId 抛错
 *   - softDeleteAgentEvidenceSet：软删无 note 的 set 及其 refs；
 *     已绑定 note 的 set 应拒绝
 *   - DB CHECK 守门：直接 INSERT source='user-highlight' + note_id=NULL 抛错
 *
 * 复用 objects/repositories/_helpers.test.ts 的 openTestDb()。
 */

import { afterAll, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// issue #457：ensureAndPromote 走 reparse → 综述证据集由 review.agentSessionId 反查 workspaceId。
// 桩成固定 workspace，避免依赖真实 agent-sessions.json。
// mock.module 进程级全局，afterAll 必须还原（防泄漏到 agent-rewind 等后续 test）。
import * as sessionMgrNs from './agent-session-manager.ts'
const REAL_SESSION_MGR = { ...sessionMgrNs }
mock.module('./agent-session-manager.ts', () => ({
  ...REAL_SESSION_MGR,
  getAgentSessionMeta: (id: string) => ({
    id,
    title: 'test-session',
    createdAt: '2026-01-01T00:00:00Z',
    workspaceId: 'ws-test',
  }),
}))
afterAll(() => {
  mock.module('./agent-session-manager.ts', () => ({ ...REAL_SESSION_MGR }))
})

import { openTestDb } from './objects/repositories/_helpers.test.ts'
import { createEvidenceRef } from './objects/repositories/evidence-ref-repository.ts'
import { createPaper } from './objects/repositories/paper-repository.ts'
import {
  createEvidenceSet,
  getEvidenceSetById,
  softDeleteEvidenceSet,
} from './objects/repositories/evidence-set-repository.ts'
import { createReview, getReviewById } from './objects/repositories/review-repository.ts'

import {
  addEvidenceToContainer,
  addFreeNoteToContainer,
  backfillLegacyEvidenceSetWorkspace,
  createAgentEvidenceSet,
  createNamedEvidenceSet,
  ensureAndPromoteReviewEvidenceSet,
  promoteReviewEvidenceSet,
  promoteSetToNote,
  removeEvidenceFromContainer,
  removeNoteFromContainer,
  renameEvidenceSet,
  setContainerTags,
  softDeleteAgentEvidenceSet,
} from './evidence-set-service.ts'
import { createNote } from './objects/repositories/note-repository.ts'
import { readTags } from './objects/repositories/evidence-set-repository.ts'
import { queryEvidenceSetDetail } from './objects/query-service.ts'

function seedPaper(repo: ReturnType<typeof openTestDb>['repo']) {
  return createPaper(repo, { title: 'Paper A', authors: ['Alice'] })
}

describe('evidence-set-service: createAgentEvidenceSet', () => {
  test('建一个无 note 的 set，source=agent-assembled', () => {
    const { repo } = openTestDb()
    const { set } = createAgentEvidenceSet(repo, { evidenceRefIds: [], workspaceId: 'ws-test' })
    expect(set.noteId).toBeUndefined()
    expect(set.source).toBe('agent-assembled')
    expect(set.persisted).toBe(false)
    expect(set.evidenceRefIds).toEqual([])
  })

  test('多次调用各自独立，UNIQUE(note_id) 在 NULL 下允许多条', () => {
    const { repo } = openTestDb()
    const a = createAgentEvidenceSet(repo, { evidenceRefIds: [], workspaceId: 'ws-test' }).set
    const b = createAgentEvidenceSet(repo, { evidenceRefIds: [], workspaceId: 'ws-test' }).set
    expect(a.id).not.toBe(b.id)
    expect(a.noteId).toBeUndefined()
    expect(b.noteId).toBeUndefined()
  })
})

describe('evidence-set-service: promoteSetToNote', () => {
  test('promote 一个 agent-assembled set → 建 note 并绑定，source 升级为 user-highlight', () => {
    const { repo } = openTestDb()
    const { set: agentSet } = createAgentEvidenceSet(repo, { evidenceRefIds: [], workspaceId: 'ws-test' })

    const { set, note } = promoteSetToNote(repo, { setId: agentSet.id, body: '用户解读' })
    expect(set.id).toBe(agentSet.id)
    expect(set.noteId).toBe(note.id)
    expect(set.source).toBe('user-highlight')
    expect(note.body).toBe('用户解读')
  })

  test('重复 promote 同一 set 抛错', () => {
    const { repo } = openTestDb()
    const { set } = createAgentEvidenceSet(repo, { evidenceRefIds: [], workspaceId: 'ws-test' })
    promoteSetToNote(repo, { setId: set.id, body: '第一次' })
    expect(() => promoteSetToNote(repo, { setId: set.id, body: '第二次' })).toThrow(/already bound/)
  })

  test('setId 不存在抛错', () => {
    const { repo } = openTestDb()
    expect(() => promoteSetToNote(repo, { setId: 'nope' as never, body: 'x' })).toThrow(/not found/)
  })
})

describe('evidence-set-service: softDeleteAgentEvidenceSet', () => {
  test('软删无 note 的 set 及其 refs', () => {
    const { repo } = openTestDb()
    const paper = seedPaper(repo)
    const { set } = createAgentEvidenceSet(repo, { evidenceRefIds: [], workspaceId: 'ws-test' })
    const ref = createEvidenceRef(repo, {
      source: { kind: 'paper', id: paper.id, anchor: { type: 'md', snapshotText: 'quote' } },
      target: { kind: 'evidence-set', id: set.id },
    })

    softDeleteAgentEvidenceSet(repo, set.id)

    const after = getEvidenceSetById(repo, set.id)
    expect(after?.visibility).toBe('deleted')

    const refRow = repo
      .prepare(`SELECT visibility FROM evidence_refs WHERE id = ?`)
      .get(ref.id) as { visibility: string }
    expect(refRow.visibility).toBe('deleted')
  })

  test('已绑定 note 的 set 不允许此路径删', () => {
    const { repo } = openTestDb()
    const { set } = createAgentEvidenceSet(repo, { evidenceRefIds: [], workspaceId: 'ws-test' })
    promoteSetToNote(repo, { setId: set.id, body: 'x' })
    expect(() => softDeleteAgentEvidenceSet(repo, set.id)).toThrow(/bound to a note/)
  })
})

describe('evidence-set-service: DB CHECK 守门', () => {
  test('source=user-highlight 时 noteId 必传（repo 层抛错）', () => {
    const { repo } = openTestDb()
    expect(() =>
      createEvidenceSet(repo, {
      workspaceId: 'ws-test',
        persisted: false,
        evidenceRefIds: [],
        source: 'user-highlight',
      }),
    ).toThrow(/noteId 必传/)
  })

  test('source=agent-assembled 时 noteId 必空（repo 层抛错）', () => {
    const { repo } = openTestDb()
    // 先建一个独立 note，模拟误传
    const dummyNoteId = repo
      .prepare(
        `INSERT INTO notes (id, body, visibility, created_at, updated_at)
         VALUES ('n1', 'b', 'visible', '2026-01-01', '2026-01-01') RETURNING id`,
      )
      .get() as { id: string }
    expect(() =>
      createEvidenceSet(repo, {
      workspaceId: 'ws-test',
        persisted: false,
        evidenceRefIds: [],
        source: 'agent-assembled',
        noteId: dummyNoteId.id as never,
      }),
    ).toThrow(/noteId 必空/)
  })
})

describe('evidence-set-service: promoteReviewEvidenceSet (B5)', () => {
  test('persisted=0 → 1：写 name + savedAt + updated_at', () => {
    const { repo } = openTestDb()
    // 模拟综述自动建出的临时 set：persisted=0，挂占位 note
    const note = createNote(repo, { body: 'review title placeholder' })
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: note.id,
      persisted: false,
      evidenceRefIds: [],
    })

    const { set: promoted } = promoteReviewEvidenceSet(repo, {
      setId: set.id,
      name: 'My Saved Review',
    })

    expect(promoted.persisted).toBe(true)
    expect(promoted.name).toBe('My Saved Review')
    expect(promoted.savedAt).toBeTruthy()
    expect(promoted.id).toBe(set.id)
  })

  test('已 persisted=1 的 set 再 promote 抛错', () => {
    const { repo } = openTestDb()
    const note = createNote(repo, { body: 'b' })
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: note.id,
      persisted: true,
      name: 'Already Saved',
      savedAt: '2026-01-01T00:00:00Z' as never,
      evidenceRefIds: [],
    })
    expect(() =>
      promoteReviewEvidenceSet(repo, { setId: set.id, name: 'x' }),
    ).toThrow(/已是 persisted=1/)
  })

  test('setId 不存在抛错', () => {
    const { repo } = openTestDb()
    expect(() =>
      promoteReviewEvidenceSet(repo, { setId: 'nope' as never, name: 'x' }),
    ).toThrow(/not found/)
  })

  test('name 为空字符串 / 仅空白抛错', () => {
    const { repo } = openTestDb()
    const note = createNote(repo, { body: 'b' })
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: note.id,
      persisted: false,
      evidenceRefIds: [],
    })
    expect(() => promoteReviewEvidenceSet(repo, { setId: set.id, name: '   ' })).toThrow(
      /name 不能为空/,
    )
  })
})

describe('evidence-set-service: renameEvidenceSet (B5 follow-up)', () => {
  test('已 persisted=1 的 set 可改名；name 更新，savedAt 不动', async () => {
    const { repo } = openTestDb()
    const note = createNote(repo, { body: 'b' })
    const original = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: note.id,
      persisted: true,
      name: 'Original',
      savedAt: '2026-01-01T00:00:00Z' as never,
      evidenceRefIds: [],
    })
    await new Promise((r) => setTimeout(r, 5))
    const { set: renamed } = renameEvidenceSet(repo, { setId: original.id, name: 'Changed' })
    expect(renamed.name).toBe('Changed')
    expect(renamed.savedAt).toBe('2026-01-01T00:00:00Z')
    expect(renamed.updatedAt).not.toBe(original.updatedAt)
  })

  test('persisted=0 的临时 set 不可改名（必须先 promote）', () => {
    const { repo } = openTestDb()
    const note = createNote(repo, { body: 'b' })
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: note.id,
      persisted: false,
      evidenceRefIds: [],
    })
    expect(() => renameEvidenceSet(repo, { setId: set.id, name: 'X' })).toThrow(/还未 persisted=1/)
  })

  test('name 为空抛错', () => {
    const { repo } = openTestDb()
    const note = createNote(repo, { body: 'b' })
    const set = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      noteId: note.id,
      persisted: true,
      name: 'Original',
      savedAt: new Date().toISOString() as never,
      evidenceRefIds: [],
    })
    expect(() => renameEvidenceSet(repo, { setId: set.id, name: '   ' })).toThrow(/name 不能为空/)
  })

  test('setId 不存在抛错', () => {
    const { repo } = openTestDb()
    expect(() => renameEvidenceSet(repo, { setId: 'nope' as never, name: 'x' })).toThrow(/not found/)
  })
})

describe('evidence-set-service: createNamedEvidenceSet (B5 follow-up，兜底独立建)', () => {
  test('建一个 persisted=1 + 占位 note + 空 refs 的 set', () => {
    const { repo } = openTestDb()
    const { set } = createNamedEvidenceSet(repo, { name: 'My Set', workspaceId: 'ws-test' })
    expect(set.persisted).toBe(true)
    expect(set.name).toBe('My Set')
    expect(set.savedAt).toBeTruthy()
    expect(set.evidenceRefIds).toEqual([])
    expect(set.noteId).toBeTruthy()
  })

  test('name 仅空白抛错', () => {
    const { repo } = openTestDb()
    expect(() => createNamedEvidenceSet(repo, { name: '   ', workspaceId: 'ws-test' })).toThrow(/name 不能为空/)
  })

  test('name 自动 trim', () => {
    const { repo } = openTestDb()
    const { set } = createNamedEvidenceSet(repo, { name: '  Trimmed  ', workspaceId: 'ws-test' })
    expect(set.name).toBe('Trimmed')
  })
})

// ============================================================================
// ensureAndPromoteReviewEvidenceSet —— 综述兜底入口（B5 follow-up）
// ============================================================================

function makeFakeReviewsDir(): { reviewsDir: string; cleanup: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), 'asci-ensure-promote-'))
  const reviewsDir = join(cwd, 'reviews')
  mkdirSync(reviewsDir, { recursive: true })
  return { reviewsDir, cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}

const REVIEW_HTML_TEMPLATE = (doi: string): string => `<article class="asci-review">
  <section id="s1"><p>x<cite data-ref="1"><q>q1</q></cite>.</p></section>
  <section id="s7" class="references"><ol class="refs">
    <li id="ref-1" data-ref="1" data-doi="${doi}">A. <i>T</i>. 2020.</li>
  </ol></section>
</article>`

describe('evidence-set-service: ensureAndPromoteReviewEvidenceSet (B5 follow-up)', () => {
  test('C1：review.sourceEvidenceSetId=null → 触发解析建临时 set，再 promote 成 persisted=1', () => {
    const { repo } = openTestDb()
    const { reviewsDir, cleanup } = makeFakeReviewsDir()
    try {
      createPaper(repo, { title: 'P1', authors: [], doi: '10.x/c1' })
      const bodyPath = join(reviewsDir, 'r.html')
      writeFileSync(bodyPath, REVIEW_HTML_TEMPLATE('10.x/c1'), 'utf-8')
      const review = createReview(repo, {
        agentSessionId: 'sess-evset-test',
        title: 'R',
        intent: 'i',
        sourceCapability: 'c',
        bodyPath,
      })
      expect(review.sourceEvidenceSetId).toBeUndefined()

      const { set } = ensureAndPromoteReviewEvidenceSet(repo, {
        reviewId: review.id,
        name: 'Saved C1',
      })
      expect(set.persisted).toBe(true)
      expect(set.name).toBe('Saved C1')
      expect(set.savedAt).toBeTruthy()
      // review 已被关联到新 set
      const reviewAfter = getReviewById(repo, review.id)!
      expect(reviewAfter.sourceEvidenceSetId).toBe(set.id)
      // refs 跟着 set 走（HTML 里有 1 条 cite）
      expect(set.evidenceRefIds.length).toBe(1)
    } finally {
      cleanup()
    }
  })

  test('C2：review.html cite 全空 → 返回 persisted=1 的空 set（不报错）', () => {
    const { repo } = openTestDb()
    const { reviewsDir, cleanup } = makeFakeReviewsDir()
    try {
      const bodyPath = join(reviewsDir, 'empty.html')
      writeFileSync(bodyPath, `<article class="asci-review"><section id="s1"><p>no cites</p></section></article>`, 'utf-8')
      const review = createReview(repo, {
        agentSessionId: 'sess-evset-test',
        title: 'R',
        intent: 'i',
        sourceCapability: 'c',
        bodyPath,
      })

      const { set } = ensureAndPromoteReviewEvidenceSet(repo, {
        reviewId: review.id,
        name: 'Saved Empty',
      })
      expect(set.persisted).toBe(true)
      expect(set.name).toBe('Saved Empty')
      expect(set.evidenceRefIds).toEqual([])
    } finally {
      cleanup()
    }
  })

  test('C3：重复调用（已 persisted=1）→ 走 rename，不重抽、refs 不变', () => {
    const { repo } = openTestDb()
    const { reviewsDir, cleanup } = makeFakeReviewsDir()
    try {
      createPaper(repo, { title: 'P1', authors: [], doi: '10.x/c3' })
      const bodyPath = join(reviewsDir, 'r.html')
      writeFileSync(bodyPath, REVIEW_HTML_TEMPLATE('10.x/c3'), 'utf-8')
      const review = createReview(repo, {
        agentSessionId: 'sess-evset-test',
        title: 'R',
        intent: 'i',
        sourceCapability: 'c',
        bodyPath,
      })

      const first = ensureAndPromoteReviewEvidenceSet(repo, {
        reviewId: review.id,
        name: 'V1',
      })
      const refIdsAfterFirst = [...first.set.evidenceRefIds]
      const savedAtFirst = first.set.savedAt

      // 再次触发：set 已 persisted=1 → 直接 rename，不重抽
      const second = ensureAndPromoteReviewEvidenceSet(repo, {
        reviewId: review.id,
        name: 'V2 Renamed',
      })
      expect(second.set.id).toBe(first.set.id)
      expect(second.set.name).toBe('V2 Renamed')
      // rename 不会动 savedAt
      expect(second.set.savedAt).toBe(savedAtFirst)
      // refs 完全不变（未触发重抽）
      expect(second.set.evidenceRefIds).toEqual(refIdsAfterFirst)
    } finally {
      cleanup()
    }
  })

  test('C3b：review 有 persisted=0 临时 set → 走 promote，不重抽', () => {
    const { repo } = openTestDb()
    const { reviewsDir, cleanup } = makeFakeReviewsDir()
    try {
      createPaper(repo, { title: 'P1', authors: [], doi: '10.x/c3b' })
      const bodyPath = join(reviewsDir, 'r.html')
      writeFileSync(bodyPath, REVIEW_HTML_TEMPLATE('10.x/c3b'), 'utf-8')

      // 手动构造「review + 已挂临时 set + 1 条 ref」状态，模拟自动 hook 已经跑完
      const note = createNote(repo, { body: 'placeholder' })
      const tempSet = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
        noteId: note.id,
        persisted: false,
        evidenceRefIds: [],
      })
      const review = createReview(repo, {
        agentSessionId: 'sess-evset-test',
        title: 'R',
        intent: 'i',
        sourceCapability: 'c',
        bodyPath,
        sourceEvidenceSetId: tempSet.id,
      })

      const { set } = ensureAndPromoteReviewEvidenceSet(repo, {
        reviewId: review.id,
        name: 'Promoted',
      })
      expect(set.id).toBe(tempSet.id)
      expect(set.persisted).toBe(true)
      expect(set.name).toBe('Promoted')
    } finally {
      cleanup()
    }
  })

  test('C4：review.bodyPath 文件不存在 → 抛业务错', () => {
    const { repo } = openTestDb()
    const { reviewsDir, cleanup } = makeFakeReviewsDir()
    try {
      const review = createReview(repo, {
        agentSessionId: 'sess-evset-test',
        title: 'R',
        intent: 'i',
        sourceCapability: 'c',
        bodyPath: join(reviewsDir, 'does-not-exist.html'),
      })
      expect(() =>
        ensureAndPromoteReviewEvidenceSet(repo, { reviewId: review.id, name: 'X' }),
      ).toThrow()
    } finally {
      cleanup()
    }
  })

  test('reviewId 不存在 → 抛 ReviewNotFoundForEnsureError', () => {
    const { repo } = openTestDb()
    expect(() =>
      ensureAndPromoteReviewEvidenceSet(repo, { reviewId: 'nope' as never, name: 'X' }),
    ).toThrow(/review 不存在/)
  })

  test('name 仅空白 → 抛错', () => {
    const { repo } = openTestDb()
    expect(() =>
      ensureAndPromoteReviewEvidenceSet(repo, { reviewId: 'whatever' as never, name: '   ' }),
    ).toThrow(/name 不能为空/)
  })

  test('sourceEvidenceSetId 指向已软删的 set → 走重抽分支', () => {
    const { repo } = openTestDb()
    const { reviewsDir, cleanup } = makeFakeReviewsDir()
    try {
      createPaper(repo, { title: 'P1', authors: [], doi: '10.x/deleted' })
      const bodyPath = join(reviewsDir, 'r.html')
      writeFileSync(bodyPath, REVIEW_HTML_TEMPLATE('10.x/deleted'), 'utf-8')

      const note = createNote(repo, { body: 'placeholder' })
      const oldSet = createEvidenceSet(repo, {
      workspaceId: 'ws-test',
        noteId: note.id,
        persisted: false,
        evidenceRefIds: [],
      })
      const review = createReview(repo, {
        agentSessionId: 'sess-evset-test',
        title: 'R',
        intent: 'i',
        sourceCapability: 'c',
        bodyPath,
        sourceEvidenceSetId: oldSet.id,
      })
      softDeleteEvidenceSet(repo, oldSet.id)

      const { set } = ensureAndPromoteReviewEvidenceSet(repo, {
        reviewId: review.id,
        name: 'Reborn',
      })
      // 拿到了一个不是旧 set 的新 set
      expect(set.id).not.toBe(oldSet.id)
      expect(set.persisted).toBe(true)
      // 老 set 仍是 deleted（getEvidenceSetById 不过滤 visibility）
      const deletedSet = getEvidenceSetById(repo, oldSet.id)
      expect(deletedSet?.visibility).toBe('deleted')
    } finally {
      cleanup()
    }
  })
})

describe('evidence-set-service: backfillLegacyEvidenceSetWorkspace（issue #457，002 历史回填）', () => {
  /** 模拟 002 迁移后的历史行：workspace_id='' 占位（绕过仓储非空校验，直接 raw UPDATE） */
  function makeLegacySet(repo: ReturnType<typeof openTestDb>['repo']): string {
    const { set } = createAgentEvidenceSet(repo, { evidenceRefIds: [], workspaceId: 'ws-test' })
    repo.prepare(`UPDATE evidence_sets SET workspace_id = '' WHERE id = ?`).run(set.id)
    return set.id
  }

  test('把无归属（workspace_id 空串）的历史证据集回填到默认 workspace', () => {
    const { repo } = openTestDb()
    const legacyId = makeLegacySet(repo)

    const changed = backfillLegacyEvidenceSetWorkspace(repo, 'ws-default')
    expect(changed).toBe(1)
    expect(getEvidenceSetById(repo, legacyId as never)?.workspaceId).toBe('ws-default')
  })

  test('幂等：无空串行时回填 0 条；不动已有归属的集合', () => {
    const { repo } = openTestDb()
    const { set: scoped } = createAgentEvidenceSet(repo, { evidenceRefIds: [], workspaceId: 'ws-A' })
    makeLegacySet(repo)

    expect(backfillLegacyEvidenceSetWorkspace(repo, 'ws-default')).toBe(1) // 仅历史行
    expect(backfillLegacyEvidenceSetWorkspace(repo, 'ws-default')).toBe(0) // 再跑无 '' 行
    // 已有归属的集合不被改写
    expect(getEvidenceSetById(repo, scoped.id)?.workspaceId).toBe('ws-A')
  })

  test('defaultWorkspaceId 为空抛错', () => {
    const { repo } = openTestDb()
    expect(() => backfillLegacyEvidenceSetWorkspace(repo, '  ')).toThrow(/defaultWorkspaceId 必填/)
  })
})

describe('evidence-set-service: #709 容器 co-member 增删 + 标签', () => {
  function seedContainer(repo: ReturnType<typeof openTestDb>['repo']): ObjectId {
    return createEvidenceSet(repo, {
      workspaceId: 'ws-test',
      persisted: true,
      name: 'C',
      savedAt: '2026-06-25T10:00:00.000Z',
      evidenceRefIds: [],
    }).id
  }

  test('addFreeNoteToContainer：建自由笔记并挂入，detail.notes 保序读回（去空白）', () => {
    const { repo } = openTestDb()
    const setId = seedContainer(repo)
    addFreeNoteToContainer(repo, setId, '  第一条想法  ')
    addFreeNoteToContainer(repo, setId, '第二条')
    const d = queryEvidenceSetDetail(repo, setId)
    expect(d!.notes.map((n) => n.body)).toEqual(['第一条想法', '第二条'])
  })

  test('addFreeNoteToContainer：空 body 抛错', () => {
    const { repo } = openTestDb()
    const setId = seedContainer(repo)
    expect(() => addFreeNoteToContainer(repo, setId, '   ')).toThrow(/body 不能为空/)
  })

  test('removeNoteFromContainer：软删 note + 删 join，容器与其余笔记不受影响', () => {
    const { repo } = openTestDb()
    const setId = seedContainer(repo)
    const n1 = addFreeNoteToContainer(repo, setId, 'a')
    addFreeNoteToContainer(repo, setId, 'b')
    removeNoteFromContainer(repo, setId, n1.id)
    const d = queryEvidenceSetDetail(repo, setId)
    expect(d).not.toBeNull()
    expect(d!.notes.map((n) => n.body)).toEqual(['b'])
  })

  test('addEvidenceToContainer：对象级 paper 引用（snapshotText=标题）落 ref + 挂入', () => {
    const { repo } = openTestDb()
    const setId = seedContainer(repo)
    const paper = seedPaper(repo)
    const ref = addEvidenceToContainer(repo, setId, {
      sourceKind: 'paper',
      sourceId: paper.id,
      snapshotText: paper.title,
    })
    const d = queryEvidenceSetDetail(repo, setId)
    expect(d!.refs.map((r) => r.ref.id)).toEqual([ref.id])
    expect(d!.refs[0]!.ref.source.anchor?.snapshotText).toBe('Paper A')
  })

  test('addEvidenceToContainer：对象级空 snapshot 合法（C1，卡片无引文）', () => {
    const { repo } = openTestDb()
    const setId = seedContainer(repo)
    const paper = seedPaper(repo)
    const ref = addEvidenceToContainer(repo, setId, { sourceKind: 'paper', sourceId: paper.id })
    const d = queryEvidenceSetDetail(repo, setId)
    expect(d!.refs.map((r) => r.ref.id)).toEqual([ref.id])
    expect(d!.refs[0]!.ref.source.anchor?.snapshotText).toBe('')
    expect(d!.refs[0]!.quote).toBe('') // 无引文 → 卡片不显示 quote
  })

  test('addEvidenceToContainer：同来源幂等（重复加复用既有 ref）', () => {
    const { repo } = openTestDb()
    const setId = seedContainer(repo)
    const paper = seedPaper(repo)
    const a = addEvidenceToContainer(repo, setId, { sourceKind: 'paper', sourceId: paper.id })
    const b = addEvidenceToContainer(repo, setId, { sourceKind: 'paper', sourceId: paper.id })
    expect(b.id).toBe(a.id)
    expect(queryEvidenceSetDetail(repo, setId)!.refs).toHaveLength(1)
  })

  test('removeEvidenceFromContainer：删 join + 孤儿 ref 软删（单归属 → 证据区清空）', () => {
    const { repo } = openTestDb()
    const setId = seedContainer(repo)
    const paper = seedPaper(repo)
    const ref = addEvidenceToContainer(repo, setId, {
      sourceKind: 'paper',
      sourceId: paper.id,
      snapshotText: paper.title,
    })
    removeEvidenceFromContainer(repo, setId, ref.id)
    const d = queryEvidenceSetDetail(repo, setId)
    expect(d!.refs).toEqual([])
  })

  test('setContainerTags：去空白去重 + readTags 字典序', () => {
    const { repo } = openTestDb()
    const setId = seedContainer(repo)
    setContainerTags(repo, setId, ['在读', ' 小样本 ', '在读'])
    expect(readTags(repo, setId)).toEqual(['在读', '小样本'])
  })
})
