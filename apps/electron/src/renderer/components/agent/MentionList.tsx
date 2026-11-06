/**
 * MentionList — 泛型 Mention 下拉列表
 *
 * 统一键盘导航（上/下/Enter/Escape）、选中高亮、滚动定位。
 * 通过 renderItem / keyExtractor 适配不同 Mention 类型（Skill、MCP 等）。
 * 通过 React.useImperativeHandle 暴露 onKeyDown 给 TipTap Suggestion。
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export interface MentionListProps<T> {
  items: T[]
  selectedIndex: number
  onSelect: (item: T) => void
  /** 空列表占位文字 */
  emptyText: string
  /** 从 item 提取唯一 key */
  keyExtractor: (item: T) => string
  /** 自定义每项渲染 */
  renderItem: (item: T) => React.ReactNode
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

function MentionListInner<T>(
  { items, onSelect, emptyText, keyExtractor, renderItem }: MentionListProps<T>,
  ref: React.ForwardedRef<MentionListRef>,
): React.ReactElement {
  const [localIndex, setLocalIndex] = React.useState(0)
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setLocalIndex(0)
  }, [items])

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const item = container.children[localIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [localIndex])

  React.useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        setLocalIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1))
        return true
      }
      if (event.key === 'ArrowDown') {
        setLocalIndex((prev) => (prev >= items.length - 1 ? 0 : prev + 1))
        return true
      }
      if (event.key === 'Enter') {
        if (items.length === 0) return false
        const item = items[localIndex]
        if (item) onSelect(item)
        return true
      }
      if (event.key === 'Escape') {
        return true
      }
      return false
    },
  }))

  if (items.length === 0) {
    return (
      <div className="rounded-lg border bg-popover p-2 shadow-lg text-sm text-muted-foreground w-[280px]">
        {emptyText}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="rounded-lg border bg-popover shadow-lg overflow-y-auto max-h-[240px] w-[280px] scrollbar-thin"
    >
      {items.map((item, index) => (
        <Button
          key={keyExtractor(item)}
          type="button"
          variant="list"
          size="row"
          className={cn(
            'px-2.5 py-1.5 text-xs',
            index === localIndex && 'bg-accent text-accent-foreground',
          )}
          onClick={() => onSelect(item)}
        >
          {renderItem(item)}
        </Button>
      ))}
    </div>
  )
}

// 泛型 forwardRef 包装
export const MentionList = React.forwardRef(MentionListInner) as <T>(
  props: MentionListProps<T> & { ref?: React.Ref<MentionListRef> },
) => React.ReactElement
