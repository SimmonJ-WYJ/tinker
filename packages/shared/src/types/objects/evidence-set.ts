/**
 * EvidenceSet —— 一组 EvidenceRef 的集合 + 与之 1:1 绑定的 Note
 *
 * 两种生命形态（issue #214 评论由 @pantsbang-yannik 提出）：
 * - `persisted: false`：对话临时产物 / 划词建注默认形态，结论关闭即丢弃
 * - `persisted: true`：用户显式保存的命名集合，可反复打开
 *
 * `name` / `savedAt` 仅在 `persisted: true` 时有意义；schema 通过
 * `if/then/else` 表达该约束。
 *
 * --- v0.2 重构后的结构变化 ---
 *
 * 1. `noteId` 强绑定：每个 set 必有一个 note 作为"动机/标题"（DB UNIQUE + NOT NULL）。
 *    删 note 自动级联删 set（ON DELETE CASCADE）。
 * 2. `paperIds` 字段已删除：paper ↔ set 关系完全由 evidence_refs 表达
 *    （source_kind='paper', target_kind='evidence-set'），段落级 anchor 是唯一表达粒度。
 *    "set 里有哪些 paper" 通过 `evidenceRefIds` 反查 evidence_refs.source_id 得到。
 *
 * 参见 docs/milestones/0.2/north-star.md §一 对象表第 4 行 + issue #214 评论 +
 *      docs/superpowers/specs/2026-05-22-evidence-list-data-model-design.md
 */

import type { ObjectId, ObjectMeta, ResolvedRef } from './common.ts'
import type { EvidenceRef } from './evidence-ref.ts'
import type { Note } from './note.ts'
import type { Paper } from './paper.ts'
import type { Review } from './review.ts'

/**
 * 创建来源标记（v0.2.x，issue: 新数据模型对齐）
 *
 * - `user-highlight`：用户在 PDF / 综述里划词建笔记走的路径
 *   （createNoteFromPaperHighlight / createNoteFromReviewHighlight）
 * - `agent-assembled`：Agent 自动组建的临时证据集（B2 引入；不绑定 Note）
 *
 * 历史路径（如 "+ Add to evidence set → 新建"）暂留 `undefined`。
 */
export type EvidenceSetSource = 'user-highlight' | 'agent-assembled'

export interface EvidenceSet extends ObjectMeta {
  /**
   * 与本 set 1:1 绑定的 Note id（DB UNIQUE）。
   *
   * B2 之后 nullable：
   *   - user-highlight 路径仍带 noteId（划词建注一气呵成）
   *   - agent-assembled 路径 noteId=undefined（Agent 临时产物，待用户 promote 为 note 后再补上）
   */
  noteId?: ObjectId
  /** true = 命名持久集合；false = 对话临时产物 / 划词建注默认形态 */
  persisted: boolean
  /** 集合内 EvidenceRef ID 列表（顺序有意义） */
  evidenceRefIds: ObjectId[]
  /** 用户起的集合名称；仅 persisted === true 时必填 */
  name?: string
  /** 用户保存时间；仅 persisted === true 时必填 */
  savedAt?: string
  /** 创建来源；可空（历史 / 未标记路径） */
  source?: EvidenceSetSource
  /**
   * 所属 agent workspace id（issue #457）。
   *
   * 证据集 scope 到单个 workspace —— 不同 workspace 各自独立、互不可见。
   * 值 = agent-workspaces.json 的 workspace id（软引用，无 FK）。所有创建路径必须注入：
   *   - 用户划词 / 手动建集合：renderer 传当前 `currentAgentWorkspaceIdAtom`
   *   - Agent 会话 / 综述自动建集合：主进程由 agentSessionId 反查 session meta.workspaceId
   */
  workspaceId: string
}

/**
 * 单条 evidence ref + 其源 paper 的解析状态。
 *
 * 当前 source.kind 仅 'paper'，保留 ResolvedRef 包装 source paper 是为：
 *   - source paper 软删 → state='removed'，UI 显示"源已移除"占位
 *   - 未来 source.kind 扩展到 'pdf' / 'web' 等时，把这里改为 union
 */
export interface EvidenceRefWithSource {
  ref: EvidenceRef
  sourcePaper: ResolvedRef<Paper>
  /**
   * 展示/定位用引文 —— anchor.snapshotText 经查询层伪引文归一化后的派生只读值
   * （issue #446：旧版本 paper 锚点曾用 note 正文前缀兜底伪造，详见
   * query-service 的 sanitizeQuote）。空串 = 无可用引文。
   * 消费侧（UI 引用块 / PDF 定位 / agent 注入）一律读本字段；
   * `ref.source.anchor` 保持原始值不动（promote / 导出 / 幂等键依赖 raw anchor）。
   */
  quote: string
}

/**
 * Conversation 类型证据条目的轻量元信息（v0.2.x）。
 *
 * 把 ref 自身 + 解析后的 session 标题打包给 UI 用；session 已删除 / 不存在时
 * sessionTitle=null（UI 据此把"跳到会话"按钮禁掉），快照本身（ref.source.anchor.snapshotText）
 * 仍可读，详情面板做"只读引用"展示。
 *
 * 不在这里判定 messageExists —— 翻 JSONL 全量太贵；UI 真正需要"是否还能跳"时再发 IPC 查。
 */
export interface ConversationEvidenceMember {
  ref: EvidenceRef
  sessionId: string
  /** session 在 agent-sessions.json 索引中仍存在时取 meta.title；否则 null */
  sessionTitle: string | null
}

/**
 * 证据集的"完整详情"—— 聚合 set + note + refs + 派生 paper 列表。
 *
 * 用于 UI 详情页（EvidenceSetDetailSheet）一次性渲染所有关联数据，
 * 避免多次 IPC + 客户端拼装。由 query-service.queryEvidenceSetDetail 返回。
 *
 * 见 docs/superpowers/specs/2026-05-24-evidence-set-aggregate-query-design.md
 */
export interface EvidenceSetDetail {
  /** 主表行（含 noteId / persisted / name / savedAt 等） */
  set: EvidenceSet
  /**
   * @deprecated 0.4 主题容器化（#709）后保留为兼容字段 = `notes[0] ?? null`（首条笔记）。
   * 新代码读 `notes` / `tags`；本字段待所有 renderer 消费方迁移完后移除。
   */
  note: Note | null
  /**
   * 容器内所有笔记（M:N，按 evidence_set_notes.position 升序）。
   * 取自 evidence_set_notes join 表（不再读 evidence_sets.note_id legacy 列）。
   * 默认排除 visibility='deleted' 的 note；可通过 opts.includeDeleted 包含。
   */
  notes: Note[]
  /** 容器级标签（字典序）。取自 evidence_set_tags。 */
  tags: string[]
  /**
   * 集合内所有 ref + 源 paper 解析状态，按 evidence_set_refs.position 升序。
   * 默认排除 ref.visibility='deleted'；可通过 opts.includeDeleted 包含。
   */
  refs: EvidenceRefWithSource[]
  /**
   * 派生：成员 paper 去重列表（按 refs[] 顺序的"首次出现"次序排）。
   * 已软删的 paper **不**出现在这里（与 refs[].sourcePaper.state='removed' 互补）；
   * UI 渲染 paper 列表时直接用这个数组；要看引用细节再展开 refs[]。
   *
   * 仅派生 source_kind='paper' 的 ref；source_kind='review' 的 ref 派生到 memberReviews。
   */
  memberPapers: Paper[]
  /**
   * 派生：成员 review 去重列表（与 memberPapers 对称；source_kind='review' 的 ref 派生）。
   * 仅含 visibility='visible'/'archived' 的 review（默认排除 deleted；includeDeleted=true 时含 deleted）。
   * 用于 UI EVIDENCE ITEMS 区与 paper 一并展示综述类来源。
   */
  memberReviews: Review[]
  /**
   * 派生：source_kind='conversation' 的 ref 列表（按 refs[] 出现序），每项带其 sessionId
   * 与 session 标题（若 session 仍在）。同一 session 多条 Q&A 不去重——每条问答都是独立条目。
   */
  memberConversations: ConversationEvidenceMember[]
  /**
   * 派生：与本证据集关联的源综述（用于详情面板「综述原文」入口，点击在右侧查看 HTML）。
   *
   * 关联通过两条链路任一命中（query-service 先①后②）：
   *   ① 综述解析自身 §7 References 建出本 set —— reviews.source_evidence_set_id == set.id；
   *   ② 用户在综述生成会话里「+ Add to evidence set」建出本 set —— 集合内 conversation ref
   *      的 source.id（= agentSessionId）反查 reviews.agent_session_id 命中。
   *
   * 与 memberReviews 语义**相反**，务必区分：
   *   - memberReviews：作为**被引来源**（source_kind='review' 的 ref）进入本集合的综述；
   *   - sourceReview：**产出/关联**本集合的那篇综述本身。
   *
   * 单值（一个 set 至多关联一篇综述）；与综述无关的集合（如纯划词建注）为 null。
   * 仅含非 deleted 综述。
   */
  sourceReview: Review | null
}
