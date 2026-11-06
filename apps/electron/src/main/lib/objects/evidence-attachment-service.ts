/**
 * Review 证据关联 service
 *
 * 把"一组证据片段 + 涉及的论文 + 一份 EvidenceSet" 一次性绑到指定 Review 上。
 *
 * 设计分层（用户明确诉求"解耦给后续其他服务用"）：
 *
 *   ┌────────────────── composite（一站式）──────────────────┐
 *   │  attachReviewEvidenceBundle                            │
 *   │    内部组合 paper 反查 + 下面三个 helper                  │
 *   └────────────────────────────────────────────────────────┘
 *           ↓ 任一可独立调用 ↓
 *   ┌──────────────── 三层 helper ────────────────┐
 *   │  [1] createEvidenceRefsBatch  批量 ref     │
 *   │  [2] buildEvidenceSetForRefs  打包 set     │
 *   │  [3] attachEvidenceSetToReview 绑到 review  │
 *   └─────────────────────────────────────────────┘
 *
 * 失败语义：service 层不静默 warn，全部抛 typed error；调用方决定如何报警 / 重试。
 *
 * 与 review-persistence-service 的关系：本 service **不被任何 orchestrator
 * 自动触发**，需要上游（综述后处理 / fact-checker / 抽取器）显式调用。
 */

import type {
  Anchor,
  EvidenceRef,
  EvidenceSet,
  ObjectId,
  Review,
  Timestamp,
} from '@asci/shared'

import {
  createEvidenceRef,
  type CreateEvidenceRefInput,
} from './repositories/evidence-ref-repository.ts'
import {
  createEvidenceSet,
  type CreateEvidenceSetInput,
} from './repositories/evidence-set-repository.ts'
import { createNote } from './repositories/note-repository.ts'
import {
  getPaperById,
  getPaperByDoi,
  findPaperByZoteroKey,
} from './repositories/paper-repository.ts'
import {
  getReviewById,
  updateReview,
} from './repositories/review-repository.ts'
import type { RepoDb } from './internal/repo-db.ts'

// =============================================================================
// Typed errors
// =============================================================================

/**
 * 任一 paperRef 反查不到时抛出。`missing` 数组保留原始入参形态，便于调用方
 * 直接报告"哪个 doi/zoteroKey 没找到"。
 */
export class PaperNotFoundError extends Error {
  constructor(public readonly missing: readonly PaperRef[]) {
    super(
      `[evidence-attachment] 以下 ${missing.length} 个 paper 反查失败：` +
        JSON.stringify(missing),
    )
    this.name = 'PaperNotFoundError'
  }
}

/** Review 已有 source_evidence_set_id 时抛出。需要调用方显式 detach 后重试。 */
export class ReviewAlreadyHasEvidenceSetError extends Error {
  constructor(
    public readonly reviewId: ObjectId,
    public readonly existingEvidenceSetId: ObjectId,
  ) {
    super(
      `[evidence-attachment] review ${reviewId} 已挂载 evidenceSet ${existingEvidenceSetId}；` +
        `请先 detach 后重试`,
    )
    this.name = 'ReviewAlreadyHasEvidenceSetError'
  }
}

/** items 为空时抛出。0 条证据没有挂载意义，提早失败让上游修复数据。 */
export class EmptyEvidenceBundleError extends Error {
  constructor() {
    super(`[evidence-attachment] items 为空，无法构建 evidenceSet`)
    this.name = 'EmptyEvidenceBundleError'
  }
}

/** Review 不存在时抛出。 */
export class ReviewNotFoundError extends Error {
  constructor(public readonly reviewId: ObjectId) {
    super(`[evidence-attachment] review ${reviewId} 不存在`)
    this.name = 'ReviewNotFoundError'
  }
}

// =============================================================================
// 三层 helper
// =============================================================================

/**
 * [1] 批量创建 EvidenceRef。
 *
 * 单事务包装：任一条插入失败（如 FK 不匹配 → 论文 / 综述不存在）→ 整批回滚。
 * 空数组合法返回空数组（避免在调用方处再加一道空集判断）。
 */
export function createEvidenceRefsBatch(
  db: RepoDb,
  inputs: readonly CreateEvidenceRefInput[],
): EvidenceRef[] {
  if (inputs.length === 0) return []
  const created: EvidenceRef[] = []
  db.transaction(() => {
    for (const input of inputs) {
      created.push(createEvidenceRef(db, input))
    }
  })()
  return created
}

/**
 * [2] 把已有的 evidence-refs 打包成 EvidenceSet。
 *
 * v0.2 重构后：set 必须绑一个 note（DB UNIQUE + NOT NULL）。本服务面向 review
 * 自动归档场景，系统侧没有用户撰写的 note —— **自动生成一个占位 note**，
 * body = `noteBody` 入参（调用方推荐传 review.title 或类似简短摘要）。
 *
 * 旧 `paperIds` 入参已删除：paper ↔ set 关系在 v0.2 后完全由 evidence_refs 表达
 * （source_kind='paper', target_kind='evidence-set'）。本 service 的 evidence_refs
 * 是 target='review' 形态 —— set 只是这些 refs 的"打包容器"，paper 通过 ref.source
 * 间接关联，UI 反查时按需 SELECT。
 *
 * 薄包 [createEvidenceSet]：refIds 去重后传入，position 按入参顺序。
 * persisted 默认 true（命名集合）；persisted=true 时 name 必填，与底层校验一致。
 */
export interface BuildEvidenceSetInput {
  refIds: readonly ObjectId[]
  /** 自动生成的占位 note 内容（推荐传 review.title 之类的简短摘要） */
  noteBody: string
  persisted?: boolean
  name?: string
  savedAt?: Timestamp
  /** 所属 workspace id（issue #457）；综述自动归档的证据集也必须 scope 到 workspace。 */
  workspaceId: string
}

export function buildEvidenceSetForRefs(
  db: RepoDb,
  params: BuildEvidenceSetInput,
): EvidenceSet {
  const dedupedRefIds = Array.from(new Set(params.refIds))
  const persisted = params.persisted ?? true
  // 系统侧自动占位 note：body 由调用方决定
  const placeholderNote = createNote(db, {
    body: params.noteBody,
  })
  const setInput: CreateEvidenceSetInput = {
    noteId: placeholderNote.id,
    persisted,
    name: params.name,
    savedAt: params.savedAt,
    evidenceRefIds: dedupedRefIds,
    workspaceId: params.workspaceId,
  }
  return createEvidenceSet(db, setInput)
}

/**
 * [3] 把已有 EvidenceSet 关联到 Review。
 *
 * 守门：
 *   - review 不存在 → `ReviewNotFoundError`
 *   - review.sourceEvidenceSetId 已有非空值 → `ReviewAlreadyHasEvidenceSetError`
 *     （强制调用方显式决策是否覆盖；避免静默丢历史）
 */
export function attachEvidenceSetToReview(
  db: RepoDb,
  params: { reviewId: ObjectId; evidenceSetId: ObjectId },
): Review {
  const existing = getReviewById(db, params.reviewId)
  if (!existing) throw new ReviewNotFoundError(params.reviewId)
  if (existing.sourceEvidenceSetId) {
    throw new ReviewAlreadyHasEvidenceSetError(
      params.reviewId,
      existing.sourceEvidenceSetId,
    )
  }
  return updateReview(db, params.reviewId, {
    sourceEvidenceSetId: params.evidenceSetId,
  })
}

// =============================================================================
// composite（一站式）
// =============================================================================

/** Paper 标识：三选一。上游传哪种取决于已有的元数据。 */
export type PaperRef =
  | { id: ObjectId }
  | { doi: string }
  | { zoteroKey: string }

export interface EvidenceItemInput {
  paper: PaperRef
  /** 论文侧锚点（含 snapshotText = verbatim quote） */
  source: Anchor
  /** 综述侧锚点（含 snapshotText = 包含 cite 的段落文本） */
  target: Anchor
}

export interface AttachReviewEvidenceBundleInput {
  reviewId: ObjectId
  items: readonly EvidenceItemInput[]
  /** 所属 workspace id（issue #457）；综述自动归档的证据集必须 scope 到 workspace。 */
  workspaceId: string
  /** EvidenceSet 元信息 */
  evidenceSet: {
    /**
     * 自动生成的占位 note 内容；不传时默认用 review.title。
     * v0.2 后 evidence_set 必须 1:1 绑一个 note，此处由系统侧合成而非用户输入。
     */
    noteBody?: string
    persisted?: boolean
    name?: string
    savedAt?: Timestamp
  }
}

export interface AttachReviewEvidenceBundleResult {
  review: Review
  evidenceSet: EvidenceSet
  evidenceRefs: EvidenceRef[]
}

/**
 * 一站式：解析 paper ref → 反查 paperIds → 批量建 ref → 建 set → attach to review。
 *
 * 全程一个事务（外层 `db.transaction`）；任一步失败 → 整体回滚，DB 完全无副作用。
 *
 * 失败语义（全部抛 typed error）：
 *   - items 长度 0 → `EmptyEvidenceBundleError`
 *   - review 不存在 → `ReviewNotFoundError`
 *   - review 已有 evidenceSet → `ReviewAlreadyHasEvidenceSetError`
 *   - 任一 paperRef 反查不到 → `PaperNotFoundError`（一次性收集所有 missing，
 *     而不是首个失败就抛 —— 调用方一次拿到完整缺失列表更省事）
 *
 * 注意：reference 的去重以 (source.anchor + target.anchor + paperId) 为身份时
 * 本服务不做隐式去重 —— 上游若有重复语义请自己去重；下游 EvidenceRef 表也
 * 没有 UNIQUE 约束，逐行写入即可。refIds 在 buildEvidenceSetForRefs 内部去重。
 */
export function attachReviewEvidenceBundle(
  db: RepoDb,
  input: AttachReviewEvidenceBundleInput,
): AttachReviewEvidenceBundleResult {
  if (input.items.length === 0) throw new EmptyEvidenceBundleError()

  // 提前校验 review（落在事务外，错误信息更早返回）
  const review = getReviewById(db, input.reviewId)
  if (!review) throw new ReviewNotFoundError(input.reviewId)
  if (review.sourceEvidenceSetId) {
    throw new ReviewAlreadyHasEvidenceSetError(
      input.reviewId,
      review.sourceEvidenceSetId,
    )
  }

  // 解析 paper refs（先做反查，再决定是否进入事务）
  const resolvedPaperIds: ObjectId[] = []
  const missing: PaperRef[] = []
  for (const item of input.items) {
    const id = resolvePaperRef(db, item.paper)
    if (id == null) missing.push(item.paper)
    else resolvedPaperIds.push(id)
  }
  if (missing.length > 0) throw new PaperNotFoundError(missing)

  // ----- 事务：批量 ref → set → attach -----
  let outRefs: EvidenceRef[] = []
  let outSet: EvidenceSet | null = null
  let outReview: Review | null = null

  db.transaction(() => {
    const refInputs: CreateEvidenceRefInput[] = input.items.map((item, i) => ({
      source: {
        kind: 'paper',
        id: resolvedPaperIds[i]!,
        anchor: item.source,
      },
      target: {
        kind: 'review',
        id: input.reviewId,
        anchor: item.target,
      },
    }))
    outRefs = createEvidenceRefsBatch(db, refInputs)

    outSet = buildEvidenceSetForRefs(db, {
      refIds: outRefs.map((r) => r.id),
      noteBody: input.evidenceSet.noteBody ?? review.title,
      persisted: input.evidenceSet.persisted,
      name: input.evidenceSet.name,
      savedAt: input.evidenceSet.savedAt,
      workspaceId: input.workspaceId,
    })

    outReview = attachEvidenceSetToReview(db, {
      reviewId: input.reviewId,
      evidenceSetId: outSet.id,
    })
  })()

  // 事务回调里抛错会让 transaction 整体回滚，所以走到这里说明三者都被赋值了
  return {
    review: outReview!,
    evidenceSet: outSet!,
    evidenceRefs: outRefs,
  }
}

/**
 * 将 PaperRef 反查为 ObjectId；找不到返回 null。
 *
 * 分发顺序按 union 类型分支，命中即返回；不混合多键查询（避免歧义）。
 */
export function resolvePaperRef(db: RepoDb, ref: PaperRef): ObjectId | null {
  // {id} 必须校验行存在再返回——否则上游把 zoteroKey 误填进 data-paper-id（综述 §7）时，
  // 会盲信生成一条 source.id=<zoteroKey> 的悬空 EvidenceRef，最终在库里反查不到 paper 行、
  // UI 显示 "(source removed)"。校验失败返回 null，让调用方走 doi/zoteroKey 反查或 meta 兜底建库。
  if ('id' in ref) return getPaperById(db, ref.id) ? ref.id : null
  if ('doi' in ref) {
    const p = getPaperByDoi(db, ref.doi)
    return p?.id ?? null
  }
  if ('zoteroKey' in ref) {
    const p = findPaperByZoteroKey(db, ref.zoteroKey)
    return p?.id ?? null
  }
  // discriminated union 已穷尽，这里不应到达
  return null
}
