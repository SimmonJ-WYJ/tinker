/**
 * 0.2 北极星核心对象的共享原语
 *
 * - 所有对象 ID 统一为 `ObjectId`（branded string），防止裸 string 误用。
 * - 时间戳统一 ISO 8601，便于跨平台 / 跨语言序列化。
 * - `ObjectKind` 是 6 个核心对象 + 后续可能加入对象的判别字面量。
 *
 * 参见 docs/milestones/0.2/north-star.md §一 / §对象标准开放。
 */

/** 全局对象 ID，命名空间内唯一；类型层防止与普通 string 混用 */
export type ObjectId = string & { readonly __brand: 'ObjectId' }

/** ISO 8601 时间戳字符串，e.g. `2026-05-19T10:00:00.000Z` */
export type Timestamp = string

/** 核心对象判别值，与 Proposal.targetObjectRef.kind 共用 */
export type ObjectKind =
  | 'paper'
  | 'evidence-ref'
  | 'note'
  | 'evidence-set'
  | 'proposal'
  | 'review'

/**
 * 对象可见性三态：
 *   - 'visible'：默认状态，在所有视图正常出现
 *   - 'archived'：从默认视图隐去，仍可通过"已归档"过滤器找到
 *   - 'deleted'：软删除；查询响应里反向引用方会拿到 `state: 'removed'` 占位
 *
 * 命名为 visibility 而非 state 是为避免与 Proposal.status 概念重叠
 * （后者是业务决策流转，前者是显示生命周期）。
 */
export type ObjectVisibility = 'visible' | 'archived' | 'deleted'

/** 对其他对象的弱引用（不强制存在性约束，由上层服务校验） */
export interface ObjectRef {
  kind: ObjectKind
  id: ObjectId
}

/**
 * 引用解析结果三态包装。
 *
 * 服务层在做反查（按 paperId 找 EvidenceRef 等）时，
 * 源对象可能已经软删（`visibility = 'deleted'` + `deleted_at` 非空）。
 * 此时直接返回 null 会丢失"曾经存在过"的信号，破坏 0.2 §二 P2
 * "引用不复制 + 源已移除标记"协议。
 *
 * 约定：
 *   - `present`：源对象仍可见 / 已归档，`ref` 携带完整对象
 *   - `removed`：源对象已软删；`id` 保留原 ID，`removedAt` 记录何时移除，
 *     `removedTitle` 从软删快照里恢复的原标题（行还在，只是 visibility='deleted'），
 *     供占位卡展示标题 / hover tooltip 用；行已被硬删（查不到）时无标题可恢复，留空。
 *
 * 反查响应中，关联的源指针字段统一使用本类型，UI 侧只需判一次 state。
 *
 * 参见 docs/milestones/0.2/north-star.md §二 P2 + V3 审计项。
 */
export type ResolvedRef<T> =
  | { state: 'present'; ref: T }
  | { state: 'removed'; id: ObjectId; removedAt: Timestamp; removedTitle?: string }

/** 所有核心对象共享的元字段 */
export interface ObjectMeta {
  id: ObjectId
  createdAt: Timestamp
  updatedAt: Timestamp
  /**
   * 对象可见性三态判别（详见 {@link ObjectVisibility}）。
   * 与可选的 `deletedAt` 审计时间戳分工：visibility 描述"现在是什么状态"，
   * deletedAt 记录"何时转入 deleted 状态"。约束关系由 app 层维护。
   */
  visibility: ObjectVisibility
}
