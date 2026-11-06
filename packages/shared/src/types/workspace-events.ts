/**
 * 工作区事件总线 —— 事件枚举与 payload 类型
 *
 * 对齐 docs/milestones/0.2/agent-and-capability-pack-spec.md §3.1。
 *
 * 设计：
 *   - 0.2 阶段无运行时订阅者；emit 必须发生以便 0.3 ProposalDispatcher 零改动接入。
 *   - payload 仅携带稳定 ID + 必要元数据；订阅者按需走 Repository 反查详情。
 *
 * 0.2 数据模型重构（c1fda468）后已弃用的事件：
 *   - evidenceSet.created / evidenceSet.paperAdded：paper↔set 由 evidence_refs 承载
 *   - note.created / note.updated：notes 不再带 target；与对象的关系由 evidence_sets.note_id 解析
 *
 * 0.4 CitationRelation 功能废弃（#718）后已删除的事件：
 *   - citationRelation.created：随 citation-relation-repository 一并移除
 *
 * emit owner（spec §3.2）：
 *   - paper.* → paper-repository CRUD
 *   - evidenceRef.created → 综述 pipeline（review-persistence-service / evidence-attachment-service）
 *   - pack.taskCompleted → SDK SubagentStop hook（仅针对能力包注册的 scenario Agent）
 *
 * 不变量：
 *   - emit 必须**同步**完成；总线层不引入 await
 *   - payload `at` 与 Repository 写入时 `created_at` / `deleted_at` 同源（nowIso）
 */

import type { ObjectId, Timestamp } from './objects/common.ts'

/** 事件 kind 字面量集合（对齐 spec §3.1；0.2 重构后已删 evidenceSet.* / note.*） */
export type WorkspaceEventKind =
  | 'paper.created'
  | 'paper.deleted'
  | 'evidenceRef.created'
  | 'pack.taskCompleted'

export interface PaperCreatedEvent {
  kind: 'paper.created'
  paperId: ObjectId
  at: Timestamp
}

export interface PaperDeletedEvent {
  kind: 'paper.deleted'
  paperId: ObjectId
  at: Timestamp
}

export interface EvidenceRefCreatedEvent {
  kind: 'evidenceRef.created'
  evidenceRefId: ObjectId
  sourcePaperId: ObjectId
  targetReviewId: ObjectId
  at: Timestamp
}

/**
 * 能力包场景 Agent 收口事件。
 *
 * 由 SubagentStop hook emit；仅当停止的 subagent 在 SubagentRegistry 中
 * 标记 source='capability-pack' 时才会发出。packId / scenarioAgentName 来自 registry。
 */
export interface PackTaskCompletedEvent {
  kind: 'pack.taskCompleted'
  packId: string
  scenarioAgentName: string
  /** 触发本次场景 Agent 的 Agent SDK 会话 ID */
  sessionId: string
  /** SDK 上报的 success flag；undefined 时按 true 处理 */
  success: boolean
  at: Timestamp
}

export type WorkspaceEvent =
  | PaperCreatedEvent
  | PaperDeletedEvent
  | EvidenceRefCreatedEvent
  | PackTaskCompletedEvent
