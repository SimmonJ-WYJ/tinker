/**
 * Proposal dismissPolicy 三档静默判定
 *
 * 由能力包在产出新 Proposal **之前** 调用；返回 true 则抑制（不入库 / 不展示）。
 *
 * 算法（不引入独立 dismiss_rules 表，直接以 proposals 表为唯一真相源）：
 *
 *   1. **silence-this-kind 命中**：存在任一历史行
 *        (source_capability, kind) 全等
 *        AND dismiss_policy = 'silence-this-kind'
 *        AND status ∈ ('rejected', 'accepted', 'modified')
 *        AND visibility != 'deleted'
 *      → 全工作区静默该 (capability × kind) 组合
 *
 *   2. **scoped 命中**：存在任一历史行
 *        (source_capability, kind, target_kind, target_id) 全等
 *        AND dismiss_policy = 'scoped'
 *        AND status ∈ ('rejected', 'accepted', 'modified')
 *        AND visibility != 'deleted'
 *      → 仅该 target 静默
 *
 *   3. **once**：不持续抑制；该粒度只让"原本那条 Proposal"自己 status
 *      流转，新触发的同条件 Proposal 仍正常入库
 *
 * 设计取舍：
 *   - 选择"用户做过该 dismissPolicy 决策"即视为永久静默（不区分 accepted /
 *     rejected / modified）。理由：scoped / silence-this-kind 三个值表达
 *     的是"该粒度上我已经表过态了，不要再问我同样问题"，与最终采纳/拒绝
 *     无关。这与 north-star §一-A 描述一致。
 *   - 不在算法里区分时间窗口（"7 天后静默失效"等）。0.2 milestone 没要求；
 *     未来需要时增加一个 `decided_at < now - X days` 限定即可，不影响接口。
 *
 * 索引利用：
 *   - silence-this-kind 命中查询：WHERE source_capability=? AND kind=?
 *     无单列索引 → 走 idx_proposals_kind + WHERE 过滤 source_capability（小开销）
 *   - scoped 命中查询：WHERE source_capability=? AND kind=? AND target_kind=?
 *     AND target_id=? → 走 idx_proposals_target (target_kind, target_id)
 *
 * 即便 silence-this-kind 那条不完全走索引，在 0.2 规模（工作区 Proposal
 * 数量 100~1k 量级）下也完全够；待 V6e 真实压测出问题再补复合索引。
 */

import type { ProposalKind, ProposalTargetRef } from '@asci/shared'

import type { RepoDb } from './internal/repo-db.ts'

export interface ProposalSilenceSpec {
  sourceCapability: string
  kind: ProposalKind
  targetRef: ProposalTargetRef
}

const DECIDED_STATUSES = ['rejected', 'accepted', 'modified'] as const

export function isProposalSilenced(db: RepoDb, spec: ProposalSilenceSpec): boolean {
  if (isSilencedThisKind(db, spec)) return true
  if (isSilencedScoped(db, spec)) return true
  return false
}

function isSilencedThisKind(db: RepoDb, spec: ProposalSilenceSpec): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM proposals
        WHERE source_capability = ?
          AND kind = ?
          AND dismiss_policy = 'silence-this-kind'
          AND status IN (${DECIDED_STATUSES.map(() => '?').join(',')})
          AND visibility != 'deleted'
        LIMIT 1`,
    )
    .get(spec.sourceCapability, spec.kind, ...DECIDED_STATUSES)
  return row !== undefined && row !== null
}

function isSilencedScoped(db: RepoDb, spec: ProposalSilenceSpec): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM proposals
        WHERE source_capability = ?
          AND kind = ?
          AND target_kind = ?
          AND target_id = ?
          AND dismiss_policy = 'scoped'
          AND status IN (${DECIDED_STATUSES.map(() => '?').join(',')})
          AND visibility != 'deleted'
        LIMIT 1`,
    )
    .get(
      spec.sourceCapability,
      spec.kind,
      spec.targetRef.kind,
      spec.targetRef.id,
      ...DECIDED_STATUSES,
    )
  return row !== undefined && row !== null
}
