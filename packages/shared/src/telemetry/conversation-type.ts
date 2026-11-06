/**
 * agent_task_completed 对话类型映射（issue: 区分检索 / 综述 / 其他）
 *
 * 事实源：会话粘滞能力包 id（AgentSessionMeta.stickyCapabilityPackId）。
 * 内置包 id 由 apps/electron/default-capability-packs/<id>/manifest.json 定义：
 *   - lit-search → 检索
 *   - lit-review → 综述
 *   - 其他 / 无粘滞包（纯 master 轮、用户自建包）→ 其他
 *
 * 红线：只输出固定 3 值受控枚举，绝不透传原始 packId——用户自建包 id 是
 * 自由文本，透传会触碰 event-registry 顶部 PII 红线。
 */

/** 内置检索能力包 id（对应 manifest 与 apps 侧 LIT_SEARCH_PACK_ID） */
const SEARCH_PACK_ID = 'lit-search'
/** 内置综述能力包 id（对应 manifest） */
const REVIEW_PACK_ID = 'lit-review'

/** agent_task_completed 对话类型（受控枚举） */
export type ConversationType = 'search' | 'review' | 'other'

/** 粘滞能力包 id → 对话类型；未知 / 缺省一律归 'other'。 */
export function toConversationType(stickyPackId: string | undefined): ConversationType {
  if (stickyPackId === SEARCH_PACK_ID) return 'search'
  if (stickyPackId === REVIEW_PACK_ID) return 'review'
  return 'other'
}
