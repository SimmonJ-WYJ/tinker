import type { ContextPin, SDKMessage, AgentEventUsage, SDKUserMessage, SDKAssistantMessage } from '@asci/shared'
/** Only actual conversational text; tool output and internal prompts stay excluded. */
export function contextCandidates(messages: SDKMessage[]): ContextPin[] {
  return messages.flatMap((message, index) => {
    if ((message.type !== 'user' && message.type !== 'assistant') || message.parent_tool_use_id || message.isReplay || ('isSynthetic' in message && message.isSynthetic)) return []
    const conversation = message as SDKUserMessage | SDKAssistantMessage
    const content = conversation.message?.content
    if (!Array.isArray(content)) return []
    const text = content.filter(block => block.type === 'text').map(block => (block as { text: string }).text).join('\n').trim()
    if (!text || text === '/compact') return []
    return [{ id: conversation.uuid ?? `message-${index}`, label: text.slice(0, 70), text }]
  }).slice(-20)
}
export function latestContextUsage(messages: SDKMessage[]): AgentEventUsage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.type !== 'assistant' || message.parent_tool_use_id) continue
    const u = (message as SDKAssistantMessage).message.usage
    if (!u) continue
    return { inputTokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), outputTokens: u.output_tokens, cacheReadTokens: u.cache_read_input_tokens, cacheCreationTokens: u.cache_creation_input_tokens }
  }
}
