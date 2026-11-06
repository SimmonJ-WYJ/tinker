/**
 * Agent Teams 冗余 auto-resume 守门逻辑（issue #566）。
 *
 * 背景：主 Agent 在本 turn 已把完整长总结（如「文献检索报告已生成…」）作为最终
 * 顶层回答交付后，编排层默认仍会触发一次「worker 完成后补总结」的 auto-resume，
 * 导致主 Agent 再补一条冗余短确认（「所有子任务均已完成，报告已交付…」）。
 *
 * 这里提供纯函数判断：当本 turn 已有主 Agent 顶层正文，且 SDK 自然结束返回的
 * result.result 已经包含这段最终回答时，应跳过这次补充 resume——既去掉重复消息，
 * 也省一次模型调用。
 *
 * 只看主 Agent 顶层 assistant 文本（parent_tool_use_id === null）：
 * - 子 Agent 文本（parent_tool_use_id 非空）不算匹配
 * - 非成功 result（error_* 等 subtype）不跳过
 * - 本 turn 无顶层正文（worker 完成后才需汇总的任务，通常走 watchdog 中断路径、
 *   无自然 result）不跳过
 */
import type { SDKMessage } from '@asci/shared'

/** 折叠空白后比较，吸收换行 / 缩进等格式差异 */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 从单条 SDK 消息提取「主 Agent 顶层 assistant 纯文本」。
 * 非 assistant / 子 Agent（parent_tool_use_id 非空）/ replay 一律返回空串。
 */
export function extractTopLevelAssistantText(message: SDKMessage): string {
  if (message.type !== 'assistant') return ''
  const m = message as {
    parent_tool_use_id?: string | null
    isReplay?: boolean
    message?: { content?: Array<{ type: string; text?: string }> }
  }
  if (m.parent_tool_use_id != null) return '' // 子 Agent 文本，忽略
  if (m.isReplay) return ''
  const content = m.message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
}

/**
 * 判断是否应跳过本轮 Agent Teams 的冗余 auto-resume。
 *
 * @param resultMessage 本 turn 自然结束捕获到的 SDK result 消息；watchdog 中断路径下为 null
 * @param topLevelText  本 turn 累积的主 Agent 顶层 assistant 正文（已由 extractTopLevelAssistantText 拼接）
 */
export function shouldSkipRedundantAutoResume(params: {
  resultMessage: SDKMessage | null
  topLevelText: string
}): boolean {
  const { resultMessage, topLevelText } = params
  if (!resultMessage || resultMessage.type !== 'result') return false

  const r = resultMessage as { subtype?: string; result?: string }
  if (r.subtype !== 'success') return false // 非成功 result 不跳过

  const finalAnswer = typeof r.result === 'string' ? normalize(r.result) : ''
  const delivered = normalize(topLevelText)
  if (!finalAnswer || !delivered) return false // 无最终回答 / 本 turn 无顶层正文 → 不跳过

  // result.result 已包含本 turn 顶层正文（或反之）→ 最终回答确已交付
  return finalAnswer.includes(delivered) || delivered.includes(finalAnswer)
}
