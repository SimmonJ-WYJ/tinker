/**
 * EvidenceSet 服务层 —— 不依赖 Note 的创建 / 提升路径（B2）
 *
 * 与 notes-service.ts 的分工：
 *   - notes-service：以"Note"为核心的入口（用户主动 highlight 建笔记）
 *   - evidence-set-service：以"Set"为核心的入口（Agent 自动组建、用户事后 promote）
 *
 * 两类入口对应数据模型设计稿（`docs/.../evidence-data-model.html`）中：
 *   - "Agent 自动组建底层证据集" → createAgentEvidenceSet
 *   - "用户认可结论后主动保存为笔记" → promoteSetToNote
 *
 * IPC 暂未开放：当前 Agent 流尚未接入；等真正有调用方时再走
 *   shared/types/evidence-sets.ts 加 channel → main/ipc.ts 注册 → preload 桥接。
 */

import type {
  EvidenceRef,
  EvidenceSet,
  Note,
  ObjectId,
} from '@asci/shared'

import type { RepoDb } from './objects/internal/repo-db.ts'
import {
  createNote as repoCreateNote,
  softDeleteNote as repoSoftDeleteNote,
} from './objects/repositories/note-repository.ts'
import {
  appendEvidenceRefToSet,
  appendNoteToSet,
  bindNoteToSet,
  countSetsForRef,
  createEvidenceSet,
  getEvidenceSetById,
  promoteToPersisted,
  removeEvidenceRefFromSet,
  removeNoteFromSet,
  renameEvidenceSet as repoRenameEvidenceSet,
  setTags as repoSetTags,
  softDeleteEvidenceSet,
} from './objects/repositories/evidence-set-repository.ts'
import { nowIso } from './objects/internal/common.ts'
import {
  createEvidenceRef,
  listEvidenceRefsByTarget,
  softDeleteEvidenceRef,
} from './objects/repositories/evidence-ref-repository.ts'
import { getReviewById } from './objects/repositories/review-repository.ts'
import { reparseReviewCitations } from './objects/review-persistence-service.ts'

// ============================================================================
// backfillLegacyEvidenceSetWorkspace —— 历史证据集回填 workspace（issue #457）
// ============================================================================

/**
 * 把 002 迁移落成占位 workspace_id='' 的历史证据集回填到默认 workspace。
 *
 * 背景：launch 后 002 给 evidence_sets 加 workspace_id NOT NULL DEFAULT ''，
 * 老行统一落 ''。本函数在 app 启动、`ensureDefaultWorkspace()` 之后调用一次，
 * 把这些"无归属"的历史证据集划归默认 workspace —— 用户切到默认项目仍能看到
 * 历史证据集，既不丢数据也不跨 workspace 串。
 *
 * 幂等：首次回填后再无 workspace_id='' 的行，重复调用 0 影响。
 * 新写入路径（createEvidenceSet）强制非空 workspaceId，不会再产生 '' 占位。
 *
 * @returns 实际回填的行数
 */
export function backfillLegacyEvidenceSetWorkspace(
  db: RepoDb,
  defaultWorkspaceId: string,
): number {
  if (!defaultWorkspaceId || !defaultWorkspaceId.trim()) {
    throw new Error(`[evidence-set-service] backfill: defaultWorkspaceId 必填且非空`)
  }
  // RepoStmt.run 返回 unknown；better-sqlite3 实际返回 { changes, lastInsertRowid }
  const info = db
    .prepare(`UPDATE evidence_sets SET workspace_id = ?, updated_at = ? WHERE workspace_id = ''`)
    .run(defaultWorkspaceId, nowIso()) as { changes?: number }
  const changes = Number(info.changes ?? 0)
  if (changes > 0) {
    console.log(`[evidence-set-service] 历史证据集回填到默认 workspace：${changes} 条（issue #457）`)
  }
  return changes
}

// ============================================================================
// createAgentEvidenceSet —— Agent 自动组建临时证据集
// ============================================================================

export interface CreateAgentEvidenceSetInput {
  /**
   * Agent 已经创建好的 EvidenceRef ID 列表（必须存在于 evidence_refs 表中且
   * target_kind='evidence-set'，但 target_id 还未指向任何 set —— 由本函数补全）。
   *
   * 现状：Agent 流未真正接入；此处先做最简形态，调用方先建 ref（暂指向 set placeholder）
   * 然后调本函数。等 Agent 真正接入后再优化 ref 创建/挂载的单事务。
   */
  evidenceRefIds: ObjectId[]
  /** 所属 workspace id（issue #457）；Agent 临时集合也必须 scope 到 workspace。 */
  workspaceId: string
}

export interface CreateAgentEvidenceSetResult {
  set: EvidenceSet
}

/**
 * 建一个 Agent-assembled 临时证据集（无 note）。
 *
 * 用途：Agent 回答用户问题时把检索到的证据片段聚合成一个底层 set；用户
 * 不主动保存，则不晋升为 Note；保存则走 promoteSetToNote。
 *
 * 不在事务内：调用方负责包事务（Agent 通常已有上层事务）。
 */
export function createAgentEvidenceSet(
  db: RepoDb,
  input: CreateAgentEvidenceSetInput,
): CreateAgentEvidenceSetResult {
  const set = createEvidenceSet(db, {
    persisted: false,
    evidenceRefIds: input.evidenceRefIds,
    source: 'agent-assembled',
    workspaceId: input.workspaceId,
  })
  return { set }
}

// ============================================================================
// promoteSetToNote —— 用户认可结论后把临时 set 提升为正式笔记
// ============================================================================

export interface PromoteSetToNoteInput {
  setId: ObjectId
  /** 用户备注的正文（Markdown） */
  body: string
}

export interface PromoteSetToNoteResult {
  set: EvidenceSet
  note: Note
}

/**
 * 把一个 source='agent-assembled' 的 set 提升为 Note 持有的 set。
 *
 * 单事务两步：
 *   ① INSERT notes (kind='note', body)
 *   ② UPDATE evidence_sets SET note_id=①, source='user-highlight'
 *
 * 前置检查：
 *   - set 必须存在
 *   - set.noteId 必须为空（已绑定 note 的 set 不能再 promote）
 *
 * 不显式开启事务：调用方若已在事务中可直接调；否则包装一层。当前 IPC 入口
 * 尚未开放，统一在测试 / 未来 IPC handler 中包事务。
 */
export function promoteSetToNote(
  db: RepoDb,
  input: PromoteSetToNoteInput,
): PromoteSetToNoteResult {
  const existing = getEvidenceSetById(db, input.setId)
  if (!existing) {
    throw new Error(`[evidence-set-service] promote: set not found: ${input.setId}`)
  }
  if (existing.noteId !== undefined) {
    throw new Error(
      `[evidence-set-service] promote: set ${input.setId} already bound to note ${existing.noteId}`,
    )
  }
  const note = repoCreateNote(db, { body: input.body })
  bindNoteToSet(db, input.setId, note.id)
  const set = getEvidenceSetById(db, input.setId)
  if (!set) {
    throw new Error(`[evidence-set-service] promote: set ${input.setId} disappeared after bind`)
  }
  return { set, note }
}

// ============================================================================
// promoteReviewEvidenceSet —— 综述临时 set 升级为正式 set（B5）
// ============================================================================

export interface PromoteReviewEvidenceSetInput {
  setId: ObjectId
  /** 用户在 popover 里输入的集合名；调用方应 trim 非空 */
  name: string
}

export interface PromoteReviewEvidenceSetResult {
  set: EvidenceSet
}

/**
 * 把综述自动建出的临时 set（persisted=0）升级为正式命名 set（persisted=1）。
 *
 * 用于场景：综述生成后 → 默认 persisted=0 → 用户在 Agent 消息上点 BookmarkPlus +
 * 输入名 → 调本服务把 set 升格，证据集列表里就可见。
 *
 * 区别于 promoteSetToNote：这里 set 已经有占位 note（review-persistence 路径建的，
 * 占位 note.body = review.title），无需创建新 note；仅更新 persisted/name/savedAt。
 *
 * 错误归一：repo 层校验失败原样抛出（不存在 / 已 persisted=1 / name 空）。
 */
export function promoteReviewEvidenceSet(
  db: RepoDb,
  input: PromoteReviewEvidenceSetInput,
): PromoteReviewEvidenceSetResult {
  const name = input.name.trim()
  if (!name) {
    throw new Error(`[evidence-set-service] promoteReviewEvidenceSet: name 不能为空`)
  }
  const set = promoteToPersisted(db, input.setId, name, nowIso())
  return { set }
}

// ============================================================================
// createNamedEvidenceSet —— 独立建一个 persisted=true 的命名 set（无 refs）
// ============================================================================

export interface CreateNamedEvidenceSetInput {
  /** 用户输入的集合名，trim 后必须非空 */
  name: string
  /** 所属 workspace id（issue #457）；新建证据集必须 scope 到当前 workspace。 */
  workspaceId: string
}

export interface CreateNamedEvidenceSetResult {
  set: EvidenceSet
}

/**
 * 兜底创建一个独立的命名证据集（无 refs，待后续手动添加 paper）。
 *
 * 用于场景：popover 点击"新建证据集"但当前 review 没有挂的临时 set（cite 抽取
 * 失败 / review 还未入库 等异常情况）。保证用户始终能"创建证据集 + 命名"。
 *
 * 实现：建占位 note（body=name） + 持久化 set（persisted=1, name, savedAt=now）。
 */
export function createNamedEvidenceSet(
  db: RepoDb,
  input: CreateNamedEvidenceSetInput,
): CreateNamedEvidenceSetResult {
  const trimmed = input.name.trim()
  if (!trimmed) {
    throw new Error(`[evidence-set-service] createNamedEvidenceSet: name 不能为空`)
  }
  const note = repoCreateNote(db, { body: trimmed })
  const set = createEvidenceSet(db, {
    noteId: note.id,
    persisted: true,
    name: trimmed,
    savedAt: nowIso(),
    evidenceRefIds: [],
    workspaceId: input.workspaceId,
  })
  return { set }
}

// ============================================================================
// renameEvidenceSet —— 修改已保存证据集的名字（B5 跟进）
// ============================================================================

export interface RenameEvidenceSetInput {
  setId: ObjectId
  name: string
}

export interface RenameEvidenceSetResult {
  set: EvidenceSet
}

/**
 * 重命名一个已 persisted=1 的证据集。
 *
 * 使用场景：用户在 Agent 消息上点 BookmarkPlus → popover 已保存态 → 输入框
 * 改名 + 点"重命名" → 调本服务更新 name。
 */
export function renameEvidenceSet(
  db: RepoDb,
  input: RenameEvidenceSetInput,
): RenameEvidenceSetResult {
  const set = repoRenameEvidenceSet(db, input.setId, input.name)
  return { set }
}

// ============================================================================
// ensureAndPromoteReviewEvidenceSet —— review 没挂 set 时先解析再 promote（B5 follow-up）
// ============================================================================

export interface EnsureAndPromoteReviewEvidenceSetInput {
  reviewId: ObjectId
  /** 用户输入的集合名；调用方应已 trim，本函数也会再 trim 一次防御 */
  name: string
}

export interface EnsureAndPromoteReviewEvidenceSetResult {
  set: EvidenceSet
}

export class ReviewNotFoundForEnsureError extends Error {
  constructor(reviewId: ObjectId) {
    super(`[evidence-set-service] ensureAndPromote: review 不存在: ${reviewId}`)
    this.name = 'ReviewNotFoundForEnsureError'
  }
}

/**
 * 综述添加证据集的兜底入口：保证 review 有一个 persisted=1 的命名 set。
 *
 * 行为分支（按用户描述的顺序）：
 *   1. 先查 review.sourceEvidenceSetId
 *      - 有，且 set 仍存活 → 直接走 promote（persisted=0→1）或 rename（已 persisted=1），
 *        **不重抽**，避免误清用户已经 promote 过的 set 里的 refs
 *   2. 无关联 set（或关联 set 已被软删）→ 调 reparseReviewCitations 触发一次
 *      parseAndAttachReviewCitations：读 bodyPath、抽 cite、建新临时 set 并挂到 review
 *   3. 拿到新 setId 后再 promoteToPersisted 写 name + saved_at
 *
 * 错误：
 *   - review 不存在 → ReviewNotFoundForEnsureError
 *   - review.bodyPath 缺失 / 文件读取失败 → reparseReviewCitations 抛 Error，原样传出
 *   - name 空 → Error（与 promoteReviewEvidenceSet 一致）
 */
export function ensureAndPromoteReviewEvidenceSet(
  db: RepoDb,
  input: EnsureAndPromoteReviewEvidenceSetInput,
): EnsureAndPromoteReviewEvidenceSetResult {
  const name = input.name.trim()
  if (!name) {
    throw new Error(`[evidence-set-service] ensureAndPromote: name 不能为空`)
  }
  const review = getReviewById(db, input.reviewId)
  if (!review) {
    throw new ReviewNotFoundForEnsureError(input.reviewId)
  }

  // 1) 已有关联 set 且未被软删 → 直接走 promote / rename，跳过重抽
  //    （getEvidenceSetById 不过滤 visibility，需要手动判断；deleted 的视为无关联走重抽）
  if (review.sourceEvidenceSetId) {
    const existing = getEvidenceSetById(db, review.sourceEvidenceSetId)
    if (existing && existing.visibility !== 'deleted') {
      if (existing.persisted) {
        const set = repoRenameEvidenceSet(db, existing.id, name)
        return { set }
      }
      const set = promoteToPersisted(db, existing.id, name, nowIso())
      return { set }
    }
  }

  // 2) 无关联 set → 触发解析（读文件 + 抽 cite + 建新临时 set + 挂到 review）
  const reparsed = reparseReviewCitations(db, { reviewId: input.reviewId })
  if (!reparsed.evidenceSetId) {
    // 理论上 parseAndAttachReviewCitations 即便 cite 全空也会建空 set；这里防御性兜底
    throw new Error(
      `[evidence-set-service] ensureAndPromote: 解析后仍未建出 evidence_set（reviewId=${input.reviewId}）`,
    )
  }

  // 3) 把新建的临时 set 升格为命名 set
  const set = promoteToPersisted(db, reparsed.evidenceSetId, name, nowIso())
  return { set }
}

// ============================================================================
// softDeleteAgentEvidenceSet —— 软删一个无 note 的 Agent set
// ============================================================================

/**
 * 软删一个未提升为笔记的 Agent set 及其 evidence_refs。
 *
 * 与 softDeleteNote 路径互补：
 *   - 有 note → 走 notes-service.softDeleteNote（删 note 级联 set + refs）
 *   - 无 note → 走本函数（直接软删 set + refs）
 *
 * 前置检查：set.noteId 必须为空（已绑定 note 的请走 softDeleteNote）。
 */
export function softDeleteAgentEvidenceSet(db: RepoDb, setId: ObjectId): void {
  const set = getEvidenceSetById(db, setId)
  if (!set) {
    throw new Error(`[evidence-set-service] softDelete: set not found: ${setId}`)
  }
  if (set.noteId !== undefined) {
    throw new Error(
      `[evidence-set-service] softDelete: set ${setId} is bound to a note; delete the note instead`,
    )
  }
  softDeleteEvidenceSet(db, setId)
  const refs: EvidenceRef[] = listEvidenceRefsByTarget(db, 'evidence-set', setId)
  for (const r of refs) {
    softDeleteEvidenceRef(db, r.id)
  }
}

// ============================================================================
// #709 主题容器：笔记 / 证据 co-member 增删 + 标签
//
// 笔记与证据是容器的并列成员（ADR-007）。这些服务函数走 evidence_set_notes /
// evidence_set_refs join 表，不再依赖 evidence_sets.note_id 1:1 legacy 列。
// ============================================================================

/**
 * EN1/EN2：详情页内联建一条自由笔记并挂入容器（建 note + 写 evidence_set_notes join）。
 * 单事务。不依赖划词、不依附证据。body 去空白后不得为空。
 */
export function addFreeNoteToContainer(db: RepoDb, setId: ObjectId, body: string): Note {
  const trimmed = body.trim()
  if (!trimmed) {
    throw new Error('[evidence-set-service] addFreeNoteToContainer: body 不能为空')
  }
  if (!getEvidenceSetById(db, setId)) {
    throw new Error(`[evidence-set-service] addFreeNoteToContainer: set not found: ${setId}`)
  }
  let note!: Note
  db.transaction(() => {
    note = repoCreateNote(db, { body: trimmed })
    appendNoteToSet(db, setId, note.id)
  })()
  return note
}

/**
 * EN4：从容器移除一条笔记 —— 软删 note（visibility='deleted'，可恢复）+ 删 join 行。
 * 不动容器、不影响其余成员。单事务。
 *
 * 注意：用 note-repository 的裸 softDeleteNote（仅软删 note 行），**不是** notes-service
 * 的 softDeleteNote（后者带 1:1 级联会把整个 set 也删掉，容器模型下不可用）。
 */
export function removeNoteFromContainer(db: RepoDb, setId: ObjectId, noteId: ObjectId): void {
  db.transaction(() => {
    removeNoteFromSet(db, setId, noteId)
    repoSoftDeleteNote(db, noteId)
  })()
}

/**
 * EN1/EN3：补证据（对象级引用）—— 建 object-level evidence_ref + 挂入容器。单事务。
 *
 * 对象级（#709 C1）：整篇引用无具体段落 → snapshotText 留空（''），证据卡只显示来源标题、
 * 不显示引文；精确段落仍走划词老路。snapshotText 非空时也接受（供未来段落级复用）。
 * 幂等：同来源（同 kind + id）已在本集中则复用既有 ref，不重复挂。
 * conversation 类证据走既有 addConversationToSet 流程，不在本函数。
 */
export function addEvidenceToContainer(
  db: RepoDb,
  setId: ObjectId,
  input: { sourceKind: 'paper' | 'review'; sourceId: ObjectId; snapshotText?: string },
): EvidenceRef {
  if (!getEvidenceSetById(db, setId)) {
    throw new Error(`[evidence-set-service] addEvidenceToContainer: set not found: ${setId}`)
  }
  const snap = (input.snapshotText ?? '').trim()
  // 幂等：同来源已在集中（未删）→ 复用
  const existing = listEvidenceRefsByTarget(db, 'evidence-set', setId).find(
    (r) => r.source.kind === input.sourceKind && r.source.id === input.sourceId,
  )
  if (existing) return existing
  // 对象级锚点：仅 snapshotText（可空），无 locationData。raw 构造（绕开 build 助手的非空提醒）
  const anchor =
    input.sourceKind === 'review'
      ? { type: 'html' as const, snapshotText: snap }
      : { type: 'md' as const, snapshotText: snap }
  let ref!: EvidenceRef
  db.transaction(() => {
    ref = createEvidenceRef(db, {
      source: { kind: input.sourceKind, id: input.sourceId, anchor },
      target: { kind: 'evidence-set', id: setId },
    })
    appendEvidenceRefToSet(db, setId, ref.id)
  })()
  return ref
}

/**
 * EN4：从容器移除一条证据 —— 删 evidence_set_refs join 行（来源 paper/综述留库）；
 * 该 ref 移除后无任何集合引用（孤儿）则软删。单事务。
 *
 * 本期多归属 UI 未放开 → 每条 ref 仅一个归属 → 移除必成孤儿 → 必软删；
 * countSetsForRef 的判定是面向 0.5 多归属的前向逻辑。
 */
export function removeEvidenceFromContainer(db: RepoDb, setId: ObjectId, refId: ObjectId): void {
  db.transaction(() => {
    removeEvidenceRefFromSet(db, setId, refId)
    if (countSetsForRef(db, refId) === 0) {
      softDeleteEvidenceRef(db, refId)
    }
  })()
}

/** 整体替换容器标签（去空白去重，空数组清空）。 */
export function setContainerTags(db: RepoDb, setId: ObjectId, tags: string[]): void {
  if (!getEvidenceSetById(db, setId)) {
    throw new Error(`[evidence-set-service] setContainerTags: set not found: ${setId}`)
  }
  repoSetTags(db, setId, tags)
}

