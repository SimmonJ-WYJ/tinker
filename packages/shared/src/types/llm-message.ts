/**
 * 通用 LLM 消息类型
 *
 * 供 @asci/core 的 Provider 适配器使用的最小消息接口。
 * 不含 Chat / Agent 特有字段（如 reasoning、toolActivities、model 等），
 * 仅保留 LLM API 调用必需的 role / content / attachments。
 */

import type { FileAttachment } from './attachment'

/** LLM 消息角色 */
export type LLMMessageRole = 'user' | 'assistant' | 'system'

/**
 * 通用 LLM 历史消息
 *
 * 用于传给 Provider 适配器的 `history` 字段，
 * 各适配器负责转换为供应商特定格式。
 */
export interface LLMMessage {
  /** 消息角色 */
  role: LLMMessageRole
  /** 消息文本内容 */
  content: string
  /** 文件附件（仅用户消息可能携带） */
  attachments?: FileAttachment[]
}
