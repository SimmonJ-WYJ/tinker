/**
 * 渠道默认值挑选 —— 纯函数,便于单测
 *
 * 提供给「首次配置渠道」场景:用户填好 API Key、勾上模型后,自动把新渠道的首个
 * enabled 模型写入 agentChannelId / agentModelId,避免用户回到对话页还得手动二选。
 */

import type { Channel } from '@asci/shared'

/**
 * 新建渠道托底:在全局默认 agentChannelId / agentModelId 均为空时,返回该渠道
 * 首个 enabled 模型对应的 (channelId, modelId);否则返回 null 表示无需改写。
 *
 * 边界:
 *   - 全局默认已有值 → null (不改写用户已选)
 *   - 渠道下无 enabled 模型 → null (不强制写入,保持原行为)
 */
export function pickDefaultModelOnCreate(
  newChannel: Channel,
  currentChannelId: string | null,
  currentModelId: string | null,
): { agentChannelId: string; agentModelId: string } | null {
  if (currentChannelId || currentModelId) return null
  const picked = newChannel.models.find((m) => m.enabled)
  if (!picked) return null
  return { agentChannelId: newChannel.id, agentModelId: picked.id }
}
