/**
 * Notes 服务层 —— v0.2 证据列表重构版
 *
 * 薄壳：把 IPC 入参翻成仓储层调用。本层负责：
 *   - "Zotero 条目 key" → "ASCI Paper.ObjectId" 的懒桥接（findOrCreatePaperByZoteroKey）
 *   - "在 paper 中划词建 note" 的单事务 4 步：
 *       1) note → 2) evidence_set (1:1) → 3) evidence_ref (source=paper, target=set)
 *       → 4) evidence_set_refs (位置 0)
 *   - 软删链：删 note 同步软删 evidence_set 及该 set 上的 evidence_refs（应用层一致性，
 *     DB CASCADE 仅在 hard delete 路径生效）
 *
 * DB 通过参数注入，便于单测；IPC 层负责调 `getDb()` 取单例后传入。
 *
 * 不负责：
 *   - 不做 IPC 注册（在 main/ipc.ts）
 *   - 不做 quote 的 body 切分（B3 后引文来自 ref.anchor.snapshotText，无需切分）
 *
 * 参见 docs/superpowers/specs/2026-05-22-evidence-list-data-model-design.md
 */

import type {
  EvidenceSetsAddPaperInput,
  EvidenceSetsAddPaperResult,
  EvidenceSetsCreateWithPaperInput,
  EvidenceSetsCreateWithPaperResult,
  Note,
  NoteWithQuote,
  NotesCreateFromPaperHighlightInput,
  NotesCreateFromPaperHighlightResult,
  NotesCreateFromReviewHighlightInput,
  NotesCreateFromReviewHighlightResult,
  NotesListAllItem,
  NotesListByPaperInput,
  NotesSoftDeleteInput,
  NotesUpdateBodyInput,
  ObjectId,
  Paper,
} from '@asci/shared'
import { nowIso } from '@asci/shared'

import type { RepoDb } from './objects/internal/repo-db.ts'
import { queryAllNotesWithPaper, queryNotesByPaper } from './objects/query-service.ts'
import {
  createNote as repoCreateNote,
  getNoteById,
  softDeleteNote as repoSoftDeleteNote,
  updateNoteBody as repoUpdateNoteBody,
} from './objects/repositories/note-repository.ts'
import {
  findOrCreatePaperByZoteroKey,
  findPaperByZoteroKey,
} from './objects/repositories/paper-repository.ts'
import {
  appendEvidenceRefToSet,
  createEvidenceSet,
  getEvidenceSetById,
  getEvidenceSetByNoteId,
  softDeleteEvidenceSet,
} from './objects/repositories/evidence-set-repository.ts'
import {
  createEvidenceRef,
  listEvidenceRefsByTarget,
  softDeleteEvidenceRef,
} from './objects/repositories/evidence-ref-repository.ts'

/**
 * 在 paper 中划词建 note —— 单事务 4 步。
 *
 * 顺序与原子性：必须在同一 db.transaction(() => {...}) 内执行，避免出现
 * "有 note 无 set" / "有 set 无 ref" 这类孤儿状态。
 *
 * 顺序：
 *   1. lazy upsert Paper（事务外 / 单独一句也行；这里放进事务以保证一致点）
 *   2. INSERT notes
 *   3. INSERT evidence_sets (note_id=2.id, persisted=0 → 临时集合)
 *   4. INSERT evidence_refs (source=paper, target=set)
 *   5. INSERT evidence_set_refs (position=0)
 */
export function createNoteFromPaperHighlight(
  db: RepoDb,
  input: NotesCreateFromPaperHighlightInput,
): NotesCreateFromPaperHighlightResult {
  let note!: Note
  let paper!: Paper
  let evidenceSetId!: ObjectId
  let evidenceRefId!: ObjectId

  db.transaction(() => {
    paper = findOrCreatePaperByZoteroKey(db, input.paper.zoteroKey, {
      title: input.paper.fallback.title,
      authors: input.paper.fallback.authors,
      abstract: input.paper.fallback.abstract,
      year: input.paper.fallback.year,
      venue: input.paper.fallback.venue,
      doi: input.paper.fallback.doi,
      url: input.paper.fallback.url,
    })

    note = repoCreateNote(db, { body: input.body })

    const set = createEvidenceSet(db, {
      noteId: note.id,
      persisted: false,
      evidenceRefIds: [],
      source: 'user-highlight',
      workspaceId: input.workspaceId,
    })
    evidenceSetId = set.id

    const ref = createEvidenceRef(db, {
      source: {
        kind: 'paper',
        id: paper.id,
        anchor: input.sourceAnchor,
      },
      target: {
        kind: 'evidence-set',
        id: set.id,
      },
    })
    evidenceRefId = ref.id

    appendEvidenceRefToSet(db, set.id, ref.id)
  })()

  return {
    note,
    paperId: paper.id,
    evidenceSetId,
    evidenceRefId,
  }
}

/**
 * 在综述中点 Evidence trace "+ Add note here" 建 note —— 单事务 4 步，与 paper 链路对偶。
 *
 *   ① INSERT notes
 *   ② INSERT evidence_sets (note_id=①, persisted=0 → 临时集合)
 *   ③ INSERT evidence_refs (source_kind='review', source_id=reviewId,
 *                           source_anchor, target_kind='evidence-set', target_id=②)
 *   ④ INSERT evidence_set_refs (set_id=②, ref_id=③, position=0)
 *
 * 与 paper 版本的区别：
 *   - 不做 review 懒物化（review 已在 DB 才能被用户在前端点到）
 *   - source 端是 review（HTML 锚点），不是 paper（md/pdf 锚点）
 *
 * 见 docs/superpowers/specs/2026-05-24-review-side-note-design.md
 */
export function createNoteFromReviewHighlight(
  db: RepoDb,
  input: NotesCreateFromReviewHighlightInput,
): NotesCreateFromReviewHighlightResult {
  let note!: Note
  let evidenceSetId!: ObjectId
  let evidenceRefId!: ObjectId

  db.transaction(() => {
    note = repoCreateNote(db, { body: input.body })

    const set = createEvidenceSet(db, {
      noteId: note.id,
      persisted: false,
      evidenceRefIds: [],
      source: 'user-highlight',
      workspaceId: input.workspaceId,
    })
    evidenceSetId = set.id

    const ref = createEvidenceRef(db, {
      source: {
        kind: 'review',
        id: input.reviewId,
        anchor: input.sourceAnchor,
      },
      target: {
        kind: 'evidence-set',
        id: set.id,
      },
    })
    evidenceRefId = ref.id

    appendEvidenceRefToSet(db, set.id, ref.id)
  })()

  return {
    note,
    evidenceSetId,
    evidenceRefId,
  }
}

/**
 * 反查；若该 zoteroKey 还没物化过 Paper（用户还没写过 Note），直接返回空数组。
 * issue #457：按 workspaceId scope —— 只返回当前 workspace 内引用本 paper 的 note。
 */
export function listNotesByPaper(db: RepoDb, input: NotesListByPaperInput): NoteWithQuote[] {
  const paper = findPaperByZoteroKey(db, input.zoteroKey)
  if (!paper) return []
  return queryNotesByPaper(db, paper.id, input.workspaceId)
}

/**
 * 全局列出 Note + 关联 paper 信息（V6a：Notes 视图聚合显示）。
 * issue #457：按 workspaceId scope —— 只返回当前 workspace 内的 note。
 */
export function listAllNotes(db: RepoDb, workspaceId: string): NotesListAllItem[] {
  return queryAllNotesWithPaper(db, workspaceId)
}

export function updateNoteBody(db: RepoDb, input: NotesUpdateBodyInput): Note {
  return repoUpdateNoteBody(db, input.id, input.body)
}

/**
 * 软删 Note —— 同步软删与之 1:1 绑定的 evidence_set，以及 set 内的所有 evidence_refs。
 *
 * 这是**应用层一致性**：DB 的 ON DELETE CASCADE 只在 hard delete 路径生效；
 * softDelete 仅改 visibility，DB 不会替我们级联。若不在应用层主动软删 set / refs，
 * 会出现"note 已删但 set 在列表里还显示"的不一致。
 *
 * 注意：evidence_set_refs 关联表无 visibility 列（设计上随主表生命周期走），
 * 这里不动它；下游 query 已通过 set.visibility != 'deleted' 过滤掉关联记录。
 */
export function softDeleteNote(db: RepoDb, input: NotesSoftDeleteInput): void {
  db.transaction(() => {
    repoSoftDeleteNote(db, input.id)
    const set = getEvidenceSetByNoteId(db, input.id)
    if (!set) return
    softDeleteEvidenceSet(db, set.id)
    const refs = listEvidenceRefsByTarget(db, 'evidence-set', set.id)
    for (const r of refs) {
      softDeleteEvidenceRef(db, r.id)
    }
  })()
}

// ============================================================================
// 把 paper 关联到证据集（"+ Add to evidence set" UI 入口背后的两条 service）
// ============================================================================

/**
 * 把 paper 加入既有 evidence_set。**幂等**：若该 paper 已在 set 内（有同向 ref
 * 且 visibility != 'deleted'）则返回既有 ref，不重复创建。
 *
 * 单事务 3 步：
 *   ① lazy upsert paper（按 zoteroKey）
 *   ② 查询是否已有匹配的 evidence_ref（source=paper, target=set, visibility != 'deleted'）
 *      —— 有则复用，无则 INSERT
 *   ③ append 到 evidence_set_refs（仅在新建 ref 时）
 *
 * 不带 sourceAnchor —— "+ Add to evidence set" 是从 paper 整体加进集合，没有划词
 * 上下文；用占位 anchor（snapshotText=''）记录到 ref。未来若需要"加 paper 时带具体
 * 段落"可以扩输入。
 */
export function addPaperToEvidenceSet(
  db: RepoDb,
  input: EvidenceSetsAddPaperInput,
): EvidenceSetsAddPaperResult {
  let paperId!: ObjectId
  let evidenceRefId!: ObjectId
  let created = false

  db.transaction(() => {
    const paper = findOrCreatePaperByZoteroKey(db, input.paper.zoteroKey, {
      title: input.paper.fallback.title,
      authors: input.paper.fallback.authors,
      abstract: input.paper.fallback.abstract,
      year: input.paper.fallback.year,
      venue: input.paper.fallback.venue,
      doi: input.paper.fallback.doi,
      url: input.paper.fallback.url,
    })
    paperId = paper.id

    // 幂等：查既有 ref（source=paper, target=set, 不含 deleted）
    const existing = listEvidenceRefsByTarget(db, 'evidence-set', input.setId).find(
      (r) => r.source.kind === 'paper' && r.source.id === paper.id,
    )
    if (existing) {
      evidenceRefId = existing.id
      return
    }

    const ref = createEvidenceRef(db, {
      source: {
        kind: 'paper',
        id: paper.id,
        anchor: {
          type: 'md',
          snapshotText: '', // 整篇加入，无具体段落锚点
        },
      },
      target: {
        kind: 'evidence-set',
        id: input.setId,
      },
    })
    evidenceRefId = ref.id
    appendEvidenceRefToSet(db, input.setId, ref.id)
    created = true
  })()

  // 用户在 dialog textarea 写了"补充说明" → 追加到 set 自有 note.body 末尾。
  // - 事务外做：set/ref 必须先落，否则即便 note 更新成功用户也看不到加入结果
  // - agent-assembled set 允许 note_id IS NULL（schema CHECK 约束），此时静默跳过：
  //   只挂关系不附加文本，dialog 提交不应因此报错
  // - 已有 body 末尾追加空行做视觉分隔；append-only，避免改动他人/自己历史内容
  const addendum = input.noteAddendum?.trim()
  if (addendum) {
    const set = getEvidenceSetById(db, input.setId)
    if (set?.noteId) {
      const note = getNoteById(db, set.noteId)
      if (note) {
        const existing = note.body
        const next = existing.length > 0 ? `${existing}\n\n${addendum}` : addendum
        repoUpdateNoteBody(db, set.noteId, next)
      }
    }
  }

  return { paperId, evidenceRefId, created }
}

/**
 * 新建 evidence_set + 同时把 paper 挂上去 ——"+ Add to evidence set → 新建" 入口。
 *
 * 单事务 5 步：
 *   ① lazy upsert paper
 *   ② 自动建占位 note（kind='note', body = input.noteBody ?? name）
 *   ③ INSERT evidence_set (note_id, persisted=true, name, savedAt=now)
 *   ④ INSERT evidence_ref (source=paper, target=set)
 *   ⑤ append 到 evidence_set_refs
 *
 * 占位 note 的 body：用户在 dialog 写了"补充说明" → 用之；未写 → 空串 ''。
 * **不再默认用 name 兜底**：name 已经是 evidence_sets 表的独立字段，再灌进 note.body
 * 会导致：(1) 列表 preview 与 title 重复显示；(2) addPaper 追加时 body 变成 "name\n\nnew"
 * 视觉上像 "name new" 一长串；(3) 详情里 note 区把 name 当内容呈现混淆语义。
 */
export function createEvidenceSetWithPaper(
  db: RepoDb,
  input: EvidenceSetsCreateWithPaperInput,
): EvidenceSetsCreateWithPaperResult {
  let paperId!: ObjectId
  let noteId!: ObjectId
  let evidenceSetId!: ObjectId
  let evidenceRefId!: ObjectId

  db.transaction(() => {
    const paper = findOrCreatePaperByZoteroKey(db, input.paper.zoteroKey, {
      title: input.paper.fallback.title,
      authors: input.paper.fallback.authors,
      abstract: input.paper.fallback.abstract,
      year: input.paper.fallback.year,
      venue: input.paper.fallback.venue,
      doi: input.paper.fallback.doi,
      url: input.paper.fallback.url,
    })
    paperId = paper.id

    const note = repoCreateNote(db, {
      body: input.noteBody ?? '',
    })
    noteId = note.id

    const set = createEvidenceSet(db, {
      noteId: note.id,
      persisted: true,
      name: input.name,
      savedAt: nowIso(),
      evidenceRefIds: [],
      workspaceId: input.workspaceId,
    })
    evidenceSetId = set.id

    const ref = createEvidenceRef(db, {
      source: {
        kind: 'paper',
        id: paper.id,
        anchor: { type: 'md', snapshotText: '' },
      },
      target: {
        kind: 'evidence-set',
        id: set.id,
      },
    })
    evidenceRefId = ref.id
    appendEvidenceRefToSet(db, set.id, ref.id)
  })()

  return {
    paperId,
    noteId,
    evidenceSetId,
    evidenceRefId,
  }
}
