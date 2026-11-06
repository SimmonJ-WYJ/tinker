/**
 * 文本选择 Hook
 *
 * 处理文本选择事件，计算工具栏位置
 */

import * as React from 'react'

interface UseTextSelectionOptions {
  /** 容器元素引用 */
  containerRef: React.RefObject<HTMLElement>
  /** 是否启用文本选择 */
  enabled?: boolean
}

interface TextSelectionState {
  /** 选中的文本 */
  selectedText: string
  /** 工具栏位置 */
  position: { top: number; left: number }
  /** 是否显示工具栏 */
  visible: boolean
}

interface UseTextSelectionReturn extends TextSelectionState {
  /** 清除选择 */
  clearSelection: () => void
}

/**
 * 文本选择 Hook
 */
export function useTextSelection({
  containerRef,
  enabled = true,
}: UseTextSelectionOptions): UseTextSelectionReturn {
  const [state, setState] = React.useState<TextSelectionState>({
    selectedText: '',
    position: { top: 0, left: 0 },
    visible: false,
  })

  const clearSelection = React.useCallback(() => {
    setState({
      selectedText: '',
      position: { top: 0, left: 0 },
      visible: false,
    })
  }, [])

  React.useEffect(() => {
    if (!enabled || !containerRef.current) return

    const container = containerRef.current

    function handleMouseUp(): void {
      // 延迟执行，确保选择已完成
      setTimeout(() => {
        const selection = window.getSelection()
        if (!selection || selection.rangeCount === 0) {
          clearSelection()
          return
        }

        const selectedText = selection.toString().trim()
        if (!selectedText || selectedText.length === 0) {
          clearSelection()
          return
        }

        // 检查选择是否在容器内
        const range = selection.getRangeAt(0)
        if (!container.contains(range.commonAncestorContainer)) {
          clearSelection()
          return
        }

        // 计算工具栏位置（选择区域的中心上方）
        const rect = range.getBoundingClientRect()
        const position = {
          top: rect.top + window.scrollY,
          left: rect.left + rect.width / 2 + window.scrollX,
        }

        setState({
          selectedText,
          position,
          visible: true,
        })
      }, 10)
    }

    function handleMouseDown(): void {
      // 鼠标按下时清除之前的选择
      clearSelection()
    }

    container.addEventListener('mouseup', handleMouseUp)
    container.addEventListener('mousedown', handleMouseDown)

    return () => {
      container.removeEventListener('mouseup', handleMouseUp)
      container.removeEventListener('mousedown', handleMouseDown)
    }
  }, [enabled, containerRef, clearSelection])

  return {
    ...state,
    clearSelection,
  }
}
