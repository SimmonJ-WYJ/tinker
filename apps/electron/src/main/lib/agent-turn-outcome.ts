/** 主Agent回合收尾守门；不重放工具或发起网络调用。 */
import { AGENT_RESPONSE_FAILURE } from '@asci/shared'

export function getAgentTurnFailure(subtype: string | undefined, hasOutput: boolean, interrupted = false): string | null {
  if (interrupted) return null
  if (!subtype) return AGENT_RESPONSE_FAILURE.INCOMPLETE
  if (subtype === 'success' && !hasOutput) return AGENT_RESPONSE_FAILURE.EMPTY
  return null
}
export function hasAgentOutput(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false
  const msg = message as { type?: string; isReplay?: boolean; parent_tool_use_id?: string | null; message?: { content?: unknown } }
  if (msg.type !== 'assistant' || msg.isReplay || msg.parent_tool_use_id) return false
  if (!Array.isArray(msg.message?.content)) return false
  return msg.message.content.some((block: unknown) => {
    if (!block || typeof block !== 'object') return false
    const item = block as { type?: string; text?: string }
    return item.type === 'tool_use' || (item.type === 'text' && typeof item.text === 'string' && item.text.trim().length > 0)
  })
}
