/**
 * Proposal 仓储层 + 状态机
 *
 * §零 "Agent 主导，用户决策" 哲学的载体。每条 Proposal 的生命周期：
 *
 *   pending → accepted | rejected | modified
 *
 * - `pending`：刚由能力包产出，等待用户审阅
 * - `accepted`：用户原样采纳，原 payload 保留
 * - `rejected`：用户拒绝；dismissPolicy 决定后续静默粒度
 *     · once：仅本条不再提示
 *     · scoped：同 (sourceCapability, kind, target) 永久静默
 *     · silence-this-kind：同 (sourceCapability, kind) 全工作区永久静默
 * - `modified`：用户改后采纳；`modifiedPayload` 必填（业务侧强制）
 *
 * `decidedAt` 在 status 从 pending 翻转时设置，便于 0.3 §三-A 采纳率统计。
 * 原 `payload` 在任何状态下都保留 —— 区分"原样采纳"和"改后采纳"是
 * 衡量 Agent 候选质量的关键信号。
 *
 * 不做：
 *   - 不暴露"再次置 pending"接口（撤回决策）；当前 milestone 不需要
 *   - 不暴露 modifiedPayload 在 accepted/rejected 状态下的存在性检查
 *     （schema 不约束 modifiedPayload 与 status 的耦合，由 app 层强制）
 */

import type {
  ObjectId,
  Proposal,
  ProposalDismissPolicy,
  ProposalKind,
  ProposalTargetRef,
  Timestamp,
} from '@asci/shared'

import { encodeJson, nowIso, softDeleteRow } from '../internal/common.ts'
import { newObjectId } from '../internal/id.ts'
import { proposalFromRow, type ProposalRow } from '../internal/mappers.ts'
import type { RepoDb } from '../internal/repo-db.ts'

export interface CreateProposalInput {
  kind: ProposalKind
  sourceCapability: string
  payload: unknown
  reasoning: string
  targetObjectRef: ProposalTargetRef
  dismissPolicy: ProposalDismissPolicy
}

export function createProposal(db: RepoDb, input: CreateProposalInput): Proposal {
  if (!input.reasoning || input.reasoning.length === 0) {
    // schema CHECK 也会拦，但应用层先抛清晰错（reasoning 必填是 B-4 V2b "无 reasoning 不展示"协议）
    throw new Error(`[proposal-repo] reasoning 必填且非空`)
  }
  const id = newObjectId()
  const now: Timestamp = nowIso()
  db.prepare(
    `INSERT INTO proposals
       (id, kind, source_capability, payload_json, reasoning, status,
        target_kind, target_id, dismiss_policy,
        visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, 'visible', ?, ?)`,
  ).run(
    id,
    input.kind,
    input.sourceCapability,
    encodeJson(input.payload) ?? 'null',
    input.reasoning,
    input.targetObjectRef.kind,
    input.targetObjectRef.id,
    input.dismissPolicy,
    now,
    now,
  )
  return getProposalByIdOrThrow(db, id)
}

export function getProposalById(db: RepoDb, id: ObjectId): Proposal | null {
  const row = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(id) as
    | ProposalRow
    | undefined
  return row ? proposalFromRow(row) : null
}

function getProposalByIdOrThrow(db: RepoDb, id: ObjectId): Proposal {
  const p = getProposalById(db, id)
  if (!p) throw new Error(`[proposal-repo] proposal not found after write: ${id}`)
  return p
}

/**
 * 翻转到 accepted：保留 payload 不动，写 decidedAt + updated_at。
 * 拒绝二次决策（status 非 pending 时抛错）。
 */
export function acceptProposal(db: RepoDb, id: ObjectId): Proposal {
  return decide(db, id, 'accepted', null)
}

export function rejectProposal(db: RepoDb, id: ObjectId): Proposal {
  return decide(db, id, 'rejected', null)
}

/**
 * 翻转到 modified：写 modifiedPayload + decidedAt + updated_at。
 * 原 payload 保留供回溯。
 */
export function modifyProposal(db: RepoDb, id: ObjectId, modifiedPayload: unknown): Proposal {
  return decide(db, id, 'modified', encodeJson(modifiedPayload) ?? 'null')
}

function decide(
  db: RepoDb,
  id: ObjectId,
  status: 'accepted' | 'rejected' | 'modified',
  modifiedPayloadJson: string | null,
): Proposal {
  const existing = getProposalByIdOrThrow(db, id)
  if (existing.status !== 'pending') {
    throw new Error(
      `[proposal-repo] proposal ${id} already decided (status=${existing.status}); 不允许二次决策`,
    )
  }
  const now = nowIso()
  if (status === 'modified') {
    db.prepare(
      `UPDATE proposals
         SET status = ?, modified_payload_json = ?, decided_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(status, modifiedPayloadJson, now, now, id)
  } else {
    db.prepare(
      `UPDATE proposals
         SET status = ?, decided_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(status, now, now, id)
  }
  return getProposalByIdOrThrow(db, id)
}

export function listPendingProposals(db: RepoDb): Proposal[] {
  const rows = db
    .prepare(
      `SELECT * FROM proposals
        WHERE status = 'pending' AND visibility != 'deleted'
        ORDER BY created_at DESC`,
    )
    .all() as ProposalRow[]
  return rows.map(proposalFromRow)
}

/** 命中 idx_proposals_target (target_kind, target_id)；默认排除软删 */
export function findProposalsByTarget(
  db: RepoDb,
  targetRef: ProposalTargetRef,
): Proposal[] {
  const rows = db
    .prepare(
      `SELECT * FROM proposals
        WHERE target_kind = ? AND target_id = ? AND visibility != 'deleted'
        ORDER BY created_at DESC`,
    )
    .all(targetRef.kind, targetRef.id) as ProposalRow[]
  return rows.map(proposalFromRow)
}

export function softDeleteProposal(db: RepoDb, id: ObjectId): void {
  softDeleteRow(db, 'proposals', id, nowIso())
}
