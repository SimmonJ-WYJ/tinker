/**
 * Proposal —— Agent 产出、用户决策的提议对象
 *
 * 0.2 §零 "Agent 主导，用户决策" 哲学的载体。
 *
 * `kind` 区分四种提议；`payload` 由对应能力包按 kind 约定结构填充，
 * 类型层留 `unknown` 防止误用，schema 层用 oneOf 按 kind 分支约束。
 *
 * `reasoning` 必填：B-4 (V2b) 明确要求"无 reasoning 不展示"，故在
 * 对象层即强制要求，避免下游 UI 反复防御性判断。
 *
 * 参见 docs/milestones/0.2/north-star.md §一 对象表第 6 行 + §一-A。
 */

import type { ObjectId, ObjectMeta, ObjectRef, Timestamp } from './common.ts'

export type ProposalKind =
  | 'citation-relation'
  | 'evidence-set'

export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'modified'

/** 拒绝粒度（B-4 / C-8 V6f）：仅本条 / 仅对该对象再不提示 / 这类提议全部静默 */
export type ProposalDismissPolicy = 'once' | 'scoped' | 'silence-this-kind'

/** Proposal 只指向 Paper / EvidenceSet / Note 三类对象 */
export type ProposalTargetRef = ObjectRef & {
  kind: 'paper' | 'evidence-set' | 'note'
}

export interface Proposal extends ObjectMeta {
  kind: ProposalKind
  /** 提议产出方能力包 ID（用于审计 / 采纳率统计） */
  sourceCapability: string
  /** Agent 给出的原始候选；不论 status 怎么流转都保留，用于 0.3 §三-A 采纳率分析 */
  payload: unknown
  /**
   * 用户在采纳前修改后的 payload；仅当 status === 'modified' 时有意义。
   * 与 payload 同时存在的目的：区分"原样采纳"与"改后采纳"这两类信号，
   * 否则采纳率统计无法反映 Agent 候选质量 vs 用户介入程度。
   * 业务约束（status='modified' 时必填）由 app 层强制，DB 层不约束。
   */
  modifiedPayload?: unknown
  /** Agent 给出的判定理由，**必填** */
  reasoning: string
  status: ProposalStatus
  /** 提议挂载的目标对象（决定 scoped dismiss 的作用域） */
  targetObjectRef: ProposalTargetRef
  dismissPolicy: ProposalDismissPolicy
  /** 用户做出决策的时间；pending 状态下为 undefined */
  decidedAt?: Timestamp
}

/** Proposal 的 ID 别名，方便与其他 ObjectId 区分（仍是同一类型） */
export type ProposalId = ObjectId
