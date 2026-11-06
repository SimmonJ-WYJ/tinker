/**
 * 工具结果查找 — 从 allMessages 中按 tool_use_id 提取对应的 tool_result。
 *
 * 纯函数，无 React 依赖：被 ContentBlock 的 useToolResult 包成 hook 使用。
 */
import type { SDKMessage, SDKUserMessage, SDKToolResultBlock } from '@asci/shared'

export interface ToolResultData {
  result?: string
  isError?: boolean
}

/** 在 allMessages 中查找匹配 toolUseId 的工具结果；未找到返回 null */
export function findToolResultInMessages(
  toolUseId: string,
  allMessages: SDKMessage[],
): ToolResultData | null {
  for (const msg of allMessages) {
    if (msg.type !== 'user') continue
    const userMsg = msg as SDKUserMessage
    const contentBlocks = userMsg.message?.content
    if (!Array.isArray(contentBlocks)) continue

    for (const block of contentBlocks) {
      if (block.type === 'tool_result') {
        const resultBlock = block as SDKToolResultBlock
        if (resultBlock.tool_use_id === toolUseId) {
          let result: string | undefined
          if (typeof resultBlock.content === 'string') {
            result = resultBlock.content
          } else if (Array.isArray(resultBlock.content)) {
            result = (resultBlock.content as Array<{ type: string; text?: string }>)
              .filter((c) => c.type === 'text' && typeof c.text === 'string')
              .map((c) => c.text)
              .join('\n')
          }
          return { result, isError: resultBlock.is_error }
        }
      }
    }
  }
  return null
}
