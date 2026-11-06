/**
 * 文本选择工具栏
 *
 * 当用户在 AI 生成的内容中选中文本时，显示浮动工具栏
 * 提供两个操作：
 * - Ask in sidebar: 在侧边栏中提问
 * - Add to chat: 添加到当前对话框（带引用）
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'

interface TextSelectionToolbarProps {
  /** 选中的文本 */
  selectedText: string
  /** 工具栏位置 */
  position: { top: number; left: number }
  /** 是否显示 */
  visible: boolean
  /** 点击 "Ask in sidebar" */
  onAskInSidebar: (text: string) => void
  /** 点击 "Add to chat" */
  onAddToChat: (text: string) => void
  /** 关闭工具栏 */
  onClose: () => void
}

/**
 * 文本选择工具栏组件
 */
export function TextSelectionToolbar({
  selectedText,
  position,
  visible,
  onAskInSidebar,
  onAddToChat,
  onClose,
}: TextSelectionToolbarProps): React.ReactElement | null {
  const toolbarRef = React.useRef<HTMLDivElement>(null)
  const { t } = useT('conversation')

  // 点击外部关闭工具栏
  React.useEffect(() => {
    if (!visible) return

    function handleClickOutside(event: MouseEvent): void {
      if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [visible, onClose])

  if (!visible || !selectedText) return null

  return (
    <div
      ref={toolbarRef}
      className={cn(
        'fixed z-50 flex items-center gap-0 rounded-md bg-white border border-[#D7D7D7] shadow-lg transition-opacity',
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      )}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        transform: 'translate(-50%, -100%) translateY(-16px)',
      }}
    >
      {/* Ask in sidebar 按钮 */}
      <Button
        type="button"
        variant="ghost"
        size="chip"
        onClick={() => {
          onAskInSidebar(selectedText)
          onClose()
        }}
        // eslint-disable-next-line asci/no-tailwind-palette, asci/min-font-size -- Figma 设计稿指定样式
        className="px-1.5 py-1.5 text-xs leading-none font-normal hover:bg-gray-50 rounded-l-md rounded-r-none border-r border-[#EFEFEF]"
      >
        <span>{t('rightPanel.textSelection.askInSidebar')}</span>
      </Button>

      {/* Add to chat 按钮 */}
      <Button
        type="button"
        variant="ghost"
        size="chip"
        onClick={() => {
          onAddToChat(selectedText)
          onClose()
        }}
        // eslint-disable-next-line asci/no-tailwind-palette, asci/min-font-size -- Figma 设计稿指定样式
        className="px-1.5 py-1.5 text-xs leading-none font-normal hover:bg-gray-50 rounded-r-md rounded-l-none"
      >
        <span>{t('rightPanel.textSelection.addToChat')}</span>
      </Button>
    </div>
  )
}
