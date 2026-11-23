/**
 * 渠道激活模型校验与 fallback
 *
 * 用于解决 "settings.json 里 agentModelId" 与 "channels.json 里
 * channel.models[].enabled" 两个状态相互独立、缺少联动校验的问题（issue #62）。
 *
 * 在以下三处复用：
 * 1. 渲染端启动加载（main.tsx）
 * 2. ChannelForm auto-save 之后
 * 3. 主进程 sendMessage 兜底
 */

import type { Channel } from '../types/channel'

/**
 * modelId 是否在 channel 的启用模型列表里
 */
export function isModelEnabledInChannel(
  channel: Channel | null | undefined,
  modelId: string | null | undefined,
): boolean {
  if (!channel || channel.provider === 'custom-image' || !modelId) return false
  return channel.models.some((m) => m.id === modelId && m.enabled && m.capability !== 'unsupported')
}

/** Claude 家族别名（与 capability-pack manifest 的 model enum 一致） */
export type ClaudeModelFamily = 'haiku' | 'sonnet' | 'opus'

/**
 * channel 是否有"该家族"的已启用 Claude 具体模型。
 *
 * manifest 里子 Agent 的 model 是别名（haiku/sonnet/opus），channel.models 存的是
 * 具体 id（如 claude-sonnet-4-5-20250929）。claude binary 本就按家族解析别名，故这里用
 * 家族子串匹配判定"该别名是否落在某个已启用的具体模型上"。
 */
export function isClaudeFamilyEnabled(
  channel: Channel | null | undefined,
  family: ClaudeModelFamily,
): boolean {
  if (!channel) return false
  return channel.models.some((m) => m.enabled && m.id.toLowerCase().includes(family))
}

/** channel 是否有任意已启用的 Claude 具体模型（id 含 'claude'）。用于"零 Claude 激活"兜底判定。 */
export function hasAnyEnabledClaudeModel(channel: Channel | null | undefined): boolean {
  if (!channel) return false
  return channel.models.some((m) => m.enabled && m.id.toLowerCase().includes('claude'))
}

/**
 * 取 channel 中的第一个启用模型（按数组顺序）
 */
export function pickFallbackModel(
  channel: Channel | null | undefined,
): { id: string; name: string } | null {
  if (!channel || channel.provider === 'custom-image') return null
  const m = channel.models.find((mm) => mm.enabled && mm.capability !== 'unsupported')
  return m ? { id: m.id, name: m.name } : null
}

/**
 * 校验结果
 *
 * - `valid: true` 表示 modelId 当前在 channel 的启用列表里（无需变更）。
 * - `valid: true, changed: true` 表示原 modelId 已失效，但找到了 fallback。
 * - `valid: false, changed: true` 表示 channel 当前没有任何启用模型。
 * - `valid: false, changed: false` 表示一开始 channel/modelId 都为空（也无 fallback 需要做）。
 */
export interface ReconcileActiveModelResult {
  /** fallback 后是否有可用 modelId */
  valid: boolean
  /** 是否相对入参发生了变化 */
  changed: boolean
  /** 解析后的 modelId（可能与入参一致，也可能是 fallback，或 null） */
  modelId: string | null
  /** 解析后 modelId 对应的显示名（用于 toast 提示） */
  modelName: string | null
}

/**
 * 把 "上次记住的激活 modelId" 与 "当前 channel 的启用模型列表" 调和到一致状态。
 *
 * 规则：
 * - channel 为空 → 返回 null（valid:false）；当原 modelId 非空时 changed:true。
 * - modelId 在 channel.models 中已启用 → 原样返回，changed:false。
 * - 否则尝试用 channel 第一个启用模型作 fallback。
 * - 都没有 → null。
 */
export function reconcileActiveModel(
  channel: Channel | null | undefined,
  modelId: string | null | undefined,
): ReconcileActiveModelResult {
  if (!channel) {
    return {
      valid: false,
      changed: modelId != null,
      modelId: null,
      modelName: null,
    }
  }
  if (modelId && isModelEnabledInChannel(channel, modelId)) {
    const m = channel.models.find((mm) => mm.id === modelId)!
    return { valid: true, changed: false, modelId, modelName: m.name }
  }
  const fallback = pickFallbackModel(channel)
  if (fallback) {
    return { valid: true, changed: true, modelId: fallback.id, modelName: fallback.name }
  }
  return { valid: false, changed: modelId != null, modelId: null, modelName: null }
}
