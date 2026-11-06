/** 生图尝试后的恢复先交回输入框，避免错误页直接重放可能已经计费的工具。 */
import type { SDKMessage, SDKUserMessage, SDKAssistantMessage } from '@asci/shared'
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
