/** 生图尝试后的恢复先交回输入框，避免错误页直接重放可能已经计费的工具。 */
import type { SDKMessage, SDKUserMessage, SDKAssistantMessage } from '@asci/shared'

/** 重试沿用已发送消息的原图；当前草稿可能已经移除或改选，不能参与绑定。 */
export function latestUserImageEditReferenceId(messages: SDKMessage[]): string | undefined {
 for (let index = messages.length - 1; index >= 0; index--) {
  const item = messages[index]!
  if (item.type !== 'user') continue
  const message = item as SDKUserMessage
  if (message.parent_tool_use_id || message.isSynthetic) continue
  const content = message.message?.content
  if (Array.isArray(content) && content.some(block => block.type === 'tool_result')) continue
  if (typeof content === 'string' || Array.isArray(content) && content.some(block => block.type === 'text')) {
   return message.imageEditReference?.imageId
  }
 }
 return undefined
}

export function latestTurnAttemptedImage(messages: SDKMessage[]): boolean {
 for (let index=messages.length-1;index>=0;index--) {
  const item=messages[index]!
  if(item.type!=='user' && item.type!=='assistant') continue
  const content=(item as SDKUserMessage | SDKAssistantMessage).message?.content
  if(item.type==='user' && (typeof content==='string' || Array.isArray(content) && content.some(block=>block.type==='text'))) return false
  if(item.type==='assistant' && Array.isArray(content) && content.some(block=>block.type==='tool_use' && block.name==='mcp__asci-image__generate_image')) return true
 }
 return false
}
