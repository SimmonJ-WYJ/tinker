/**
 * 带文本选择功能的消息响应包装器
 *
 * 为 AI 生成的内容添加划词选择功能
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { MessageResponse, type MessageResponseProps } from './message'
import { TextSelectionToolbar } from './text-selection-toolbar'
import { useTextSelection } from '@/hooks/useTextSelection'
import { pendingQuoteAtom, sidebarQuoteAtom } from '@/atoms/text-selection-atoms'

/**
 * 带文本选择功能的消息响应组件
 *
 * 在 MessageResponse 基础上添加：
 * - 划词选择工具栏
 * - "Ask in sidebar" 功能
 * - "Add to chat" 功能
 */
export function SelectableMessageResponse(props: MessageResponseProps): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const setPendingQuote = useSetAtom(pendingQuoteAtom)
  const setSidebarQuote = useSetAtom(sidebarQuoteAtom)

  const { selectedText, position, visible, clearSelection } = useTextSelection({
    containerRef,
    enabled: true,
  })

  // 处理 "Ask in sidebar"
  const handleAskInSidebar = React.useCallback(
    (text: string) => {
      setSidebarQuote({
        text,
        timestamp: Date.now(),
      })
    },
    [setSidebarQuote]
  )

  // 处理 "Add to chat"
  const handleAddToChat = React.useCallback(
    (text: string) => {
      setPendingQuote({
        text,
        timestamp: Date.now(),
      })
    },
    [setPendingQuote]
  )

  return (
    <>
      <div ref={containerRef}>
        <MessageResponse {...props} />
      </div>
      <TextSelectionToolbar
        selectedText={selectedText}
        position={position}
        visible={visible}
        onAskInSidebar={handleAskInSidebar}
        onAddToChat={handleAddToChat}
        onClose={clearSelection}
      />
    </>
  )
}
