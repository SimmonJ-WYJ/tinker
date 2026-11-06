/**
 * EvidenceRef —— 通用引用关系：来源对象的段落锚点 → 引用承载方
 *
 * v0.2 重构后变成 **双侧多态**（spec：2026-05-22-evidence-list-data-model-design）：
 *
 *   source 端：kind ∈ {'paper','review'}（2026-05-24 review-side note 扩展）
 *     - 'paper'  → 论文段落（md / pdf anchor）
 *     - 'review' → 综述句子（html anchor，含 sectionId/paragraphIndex/citeIndex）
 *     source_id 不再持硬 FK（多态化后跨表 FK 不可用）→ 应用层 GC：
 *       删 papers / reviews 时仓储层先调 deleteRefsBySource(kind, id)
 *
 *   target 端：多态（'review' | 'evidence-set'），同样无 FK → 应用层 GC：
 *     - 删 reviews / evidence_sets 时，仓储层 delete 入口先 DELETE
 *       evidence_refs WHERE target_kind=? AND target_id=?。
 *     - target='review' → anchor 必填（定位综述句子；type='html'）
 *     - target='evidence-set' → anchor 必空（set 非文本载体，无 anchor 可言）
 *
 * Anchor 通过 snapshotText 字段保留 verbatim 原文 —— 既是展示内容，也是
 * 跨副本 / 跨 schema 升级时的兜底定位 key（结构化 location 失效时仍能文本搜索）。
 *
 * v0.19.0+ 起：删去老的 paragraphAnchor / sentenceAnchor / quote 字段，全部
 * 统一到 Anchor 之下；DB 列存 Anchor JSON（见 anchor-codec.ts）。
 *
 * 参见 docs/milestones/0.2/north-star.md §一 对象表第 2 行 +
 *      docs/superpowers/specs/2026-05-22-evidence-list-data-model-design.md +
 *      docs/superpowers/specs/2026-05-24-review-side-note-design.md
 */

import type { Anchor } from '../anchor.ts'
import type { ObjectId, ObjectMeta } from './common.ts'

/**
 * Source 端的判别类型：
 *   - 'paper'        论文段落（md / pdf anchor）
 *   - 'review'       综述句子（html anchor，含 sectionId/paragraphIndex/citeIndex）
 *   - 'conversation' Agent 会话 Q&A 快照（conversation anchor，含 sessionId/messageUuid）
 *
 * v0.2.x 扩展：用户可在 SDKMessageRenderer 工具栏将「最近一次问答」存为
 * 证据条目，源 id 用 sessionId，anchor.snapshotText 形如 `Q: ...\n\nA: ...`。
 */
export type EvidenceRefSourceKind = 'paper' | 'review' | 'conversation'

/** Target 端的判别类型：综述（cite 引用点）或证据集（聚拢载体） */
export type EvidenceRefTargetKind = 'review' | 'evidence-set'

/**
 * source 端：扁平 union（kind 决定 id / anchor 的语义）
 *   - kind='paper'        → id=papers.id,     anchor=type='md'|'pdf'
 *   - kind='review'       → id=reviews.id,    anchor=type='html'
 *   - kind='conversation' → id=agentSessionId, anchor=type='conversation'
 *
 * 注意：'conversation' 源的 id 是 agent session id（agent-sessions.json 索引），
 * 不是 ObjectId 品牌类型——SQLite 列 source_id 是裸 TEXT，应用层不做 FK 校验，
 * 与 papers/reviews 在 schema 层都没有 FK 一致。
 */
export interface EvidenceRefSource {
  kind: EvidenceRefSourceKind
  /** 来源对象 ID（papers.id / reviews.id / agentSessionId，按 kind 决定） */
  id: ObjectId
  /** 来源对象内的段落锚点（含 snapshotText = verbatim quote） */
  anchor: Anchor
}

/** target 端：discriminated union，按 kind 决定 anchor 是否存在 */
export type EvidenceRefTarget =
  | {
      kind: 'review'
      /** 目标综述 id；指向 reviews.id */
      id: ObjectId
      /** 综述侧锚点（含 snapshotText = 包含 cite 的段落文本） */
      anchor: Anchor
    }
  | {
      kind: 'evidence-set'
      /** 目标证据集 id；指向 evidence_sets.id */
      id: ObjectId
      /** evidence-set 非文本载体 —— 无 anchor 概念 */
      anchor?: never
    }

export interface EvidenceRef extends ObjectMeta {
  source: EvidenceRefSource
  target: EvidenceRefTarget
}
