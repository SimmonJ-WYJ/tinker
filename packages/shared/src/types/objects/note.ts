/**
 * Note —— 笔记（B4 后单一形态）
 *
 * B4 之前曾区分 `kind: 'note' | 'hypothesis'`（"假设"作为产品扩展概念）；与新数据
 * 模型设计稿（`docs/.../evidence-data-model.html`）对齐后，统一回归"笔记"单形态：
 *   - 去掉 `kind` 与 `hypothesisStatus` 字段
 *   - "用户对一组证据的解读"完全靠 `body` 承载
 *
 * --- 关于 note 的所属关系（v0.2 重构后；B2 后不再强制 1:1）---
 *
 * Note **不再**直接挂 paper / evidence-set。新模型里：
 *   - note ↔ evidence-set 经 `evidence_sets.note_id` 反向引用：
 *     - user-highlight set 必带 note（划词建注一气呵成）
 *     - agent-assembled set 暂无 note（待用户 promote）
 *     删 note 自动级联删其绑定的 set（ON DELETE CASCADE）。
 *   - note ↔ paper 的关系通过 **evidence_refs 段落级 anchor** 表达：
 *     note → set →（多条）evidence_ref(source_kind='paper', target_kind='evidence-set')。
 *
 * 参见 docs/milestones/0.2/north-star.md §一 对象表第 3 行 +
 *      docs/superpowers/specs/2026-05-22-evidence-list-data-model-design.md
 */

import type { ObjectMeta } from './common.ts'

export interface Note extends ObjectMeta {
  /** 笔记正文（Markdown） */
  body: string
}
