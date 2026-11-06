/**
 * Review —— 综述文档实体
 *
 * 0.1 综述链路（B 组）产出的"Review HTML"在 0.2 升格为持久对象，使其：
 *   - 被 EvidenceRef 用真正的 ObjectId FK 引用（不再是 opaque string）
 *   - 可被追溯到生成它的 EvidenceSet + 能力包
 *   - 与其他对象同样的 visibility 三态 + 软删（deletedAt）语义
 *
 * **body 不在本接口里**：综述 HTML 体可能较大，存到 `~/.asci/reviews/{id}.html`
 * 文件里（通过 `getReviewBodyPath(id)` 拿路径）。本 interface 只承载元数据，
 * 把 IPC 列表查询的 payload 控制在轻量级。需要正文时由 repository / 服务层
 * 单独读文件。
 *
 * 不做（dogfood 触发后再加）：
 *   - 不存 status='generating'：Review 只在完成时落库
 *   - 不拆 review_sentences 表：sentence anchor 内嵌在 HTML 文件
 *     （<span data-sentence-id="...">），EvidenceRef.target.sentenceAnchor
 *     字符串匹配即可
 *   - 不加 parentReviewId 版本链：milestone 2 没有任何 V-审计项需要 review
 *     版本对比；真要做时一条 migration 加列
 *   - Note.targetRef / Proposal.targetObjectRef 不扩 'review'：dogfood
 *     没需求挂笔记 / 提议到综述本身
 *
 * 参见 docs/milestones/0.2/north-star.md §一 + §四（0.1 → 0.2 关系）。
 */

import type { ObjectId, ObjectMeta } from './common.ts'

export interface Review extends ObjectMeta {
  /** 综述标题，默认由 intent 派生，用户可改 */
  title: string
  /** 触发综述生成的用户 prompt（原文或摘要） */
  intent: string
  /** 产出方能力包 ID（与 Proposal.sourceCapability 同语义） */
  sourceCapability: string
  /** 综述基于的 EvidenceSet ID；用户从 Paper 列表直接综述时为 undefined */
  sourceEvidenceSetId?: ObjectId
  /** 主题标签 / 列表副标题；由 synthesizer artifact frontmatter 给出，可空 */
  topic?: string
  /** 产出该综述的 Agent 会话 ID（agent-sessions.json 软引用），可空。
   *  用于：1) 同会话二次完成的幂等去重；2) UI 跳转回 Agent 会话 */
  agentSessionId?: string
  /** 正文文件的绝对路径，可空。
   *  cwd 模式直接指向 skill 写的 session cwd 下的 md 文件，不再镜像；
   *  inline / 旧 demo 路径为空时由 readReviewBody 兜底用 `~/.asci/reviews/{id}.{md,html}`。 */
  bodyPath?: string
}
