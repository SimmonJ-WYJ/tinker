/**
 * 列拖拽手柄 —— 放在两栏之间，按住横向拖动改变左侧栏宽度。
 *
 * 受控：宽度由外部 atom 持有，本组件只负责把指针位移换算成新的宽度回调出去。
 * 用 pointer capture 保证拖出元素也能持续收到 move；拖拽期间禁用全局文本选中。
 */
import * as React from 'react'

import { cn } from '@/lib/utils'
import { clampWidth } from '@/atoms/notes-layout'

interface ColumnResizerProps {
  /** 当前左侧栏宽度（px） */
  width: number
  /** 宽度下限（px） */
  min: number
  /** 宽度上限（px） */
  max: number
  /** 拖动产生的新宽度（已 clamp） */
  onResize: (next: number) => void
  /** 无障碍标签 */
  ariaLabel?: string
}

export function ColumnResizer({ width, min, max, onResize, ariaLabel }: ColumnResizerProps): React.ReactElement {
  const dragRef = React.useRef<{ startX: number; startWidth: number } | null>(null)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.classList.add('select-none')
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    onResize(clampWidth(drag.startWidth + (e.clientX - drag.startX), min, max))
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current) return
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    document.body.classList.remove('select-none')
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      className={cn(
        'shrink-0 w-1 cursor-col-resize select-none',
        'bg-border hover:bg-primary/40 active:bg-primary/60 transition-colors',
      )}
    />
  )
}
