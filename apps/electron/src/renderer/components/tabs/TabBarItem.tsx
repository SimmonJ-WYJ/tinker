/**
 * TabBarItem — 单个标签页 UI
 *
 * 显示：标题 + 更多入口 + 流式指示器
 * 支持：点击聚焦、中键关闭、拖拽重排
 * hover 预览面板由父级 TabBar 统一管理状态
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { useAtomValue, useSetAtom } from 'jotai'
import { FolderOpen, MoreHorizontal, Pencil, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { TabType, TabMinimapItem } from '@/atoms/tab-atoms'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'
import { tabMinimapCacheAtom } from '@/atoms/tab-atoms'
import { agentSessionsAtom, agentSessionPathMapAtom } from '@/atoms/agent-atoms'
import { useT } from '@/hooks/useT'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TabPreviewPanel } from './TabPreviewPanel'
import {
  currentConversationLabelClassNames,
  currentConversationMenuContentClassNames,
  currentConversationMenuIconClassNames,
  currentConversationMenuItemClassNames,
  currentConversationStripClassNames,
} from './tab-strip-primitives.ts'

export interface TabBarItemProps {
  id: string
  type: TabType
  title: string
  isActive: boolean
  isStreaming: SessionIndicatorStatus
  /** 是否显示 hover 预览面板（由父级管理） */
  isHovered: boolean
  /** 预览面板是否正在退出动画 */
  isLeaving: boolean
  onActivate: () => void
  onClose: () => void
  onMiddleClick: () => void
  onDragStart: (e: React.PointerEvent) => void
  /** hover 进入 Tab */
  onHoverEnter: () => void
  /** hover 离开 Tab */
  onHoverLeave: () => void
  /** hover 进入面板（阻止关闭） */
  onPanelHoverEnter: () => void
  /** hover 离开面板 */
  onPanelHoverLeave: () => void
}

export function TabBarItem({
  id,
  title,
  isActive,
  isStreaming,
  isHovered,
  isLeaving,
  onActivate,
  onMiddleClick,
  onDragStart,
  onHoverEnter,
  onHoverLeave,
  onPanelHoverEnter,
  onPanelHoverLeave,
}: TabBarItemProps): React.ReactElement {
  const { t } = useT('nav')
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const minimapCache = useAtomValue(tabMinimapCacheAtom)
  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const sessionPath = sessionPathMap.get(id) ?? null

  const handleMouseDown = (e: React.MouseEvent): void => {
    if (e.button === 1) {
      e.preventDefault()
      onMiddleClick()
    }
  }

  const handleMouseEnter = (): void => {
    onHoverEnter()
  }

  const handleMouseLeave = (): void => {
    onHoverLeave()
  }

  const handleEditTitle = async (): Promise<void> => {
    const nextTitle = window.prompt(t('agentHeader.editTitle'), title)?.trim()
    if (!nextTitle || nextTitle === title) return

    try {
      await window.electronAPI.updateAgentSessionTitle(id, nextTitle)
      const sessions = await window.electronAPI.listAgentSessions()
      setAgentSessions(sessions)
    } catch (error) {
      console.error('[TabBarItem] 更新会话标题失败:', error)
    }
  }

  const handleOpenSessionFolder = (): void => {
    if (!sessionPath) return
    window.electronAPI.showInFolder(sessionPath).catch((error: unknown) => {
      console.error('[TabBarItem] 打开会话文件夹失败:', error)
    })
  }

  const indicatorColor = isStreaming !== 'idle'
    ? isStreaming === 'completed'
      ? 'bg-success'
      : isStreaming === 'blocked'
        ? 'bg-warning animate-pulse'
        : 'bg-info animate-pulse'
    : undefined
  const previewItems = minimapCache.get(id) ?? []
  // 当前 active Tab 不显示预览面板
  const showPreview = isHovered && !isActive

  return (
    <div
      data-tab-id={id}
      data-active={isActive}
      className="workspace-tab relative flex h-full min-w-0 shrink items-center titlebar-no-drag"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="flex min-w-0 items-center">
        <Button
          ref={buttonRef}
          type="button"
          variant="ghost"
          className={cn(
            currentConversationStripClassNames(),
            'max-w-[min(36rem,calc(100vw-28rem))] justify-start rounded-none bg-transparent hover:bg-transparent hover:text-foreground',
          )}
          onClick={onActivate}
          onMouseDown={handleMouseDown}
          onPointerDown={onDragStart}
        >
          <MessageSquare aria-hidden="true" strokeWidth={1.5} />
          {/* 标题：min-w-0 + truncate，由 CSS 处理省略 */}
          <span className={currentConversationLabelClassNames()}>{title}</span>

          {/* 流式/状态指示器 */}
          {indicatorColor && (
            <span
              className={cn('size-1.5 shrink-0 rounded-full', indicatorColor)}
            />
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="More"
              title="More"
              className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              <MoreHorizontal className="!size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className={currentConversationMenuContentClassNames()}
          >
            <DropdownMenuItem
              className={currentConversationMenuItemClassNames()}
              onSelect={() => { void handleEditTitle() }}
            >
              <Pencil className={currentConversationMenuIconClassNames()} />
              {t('agentHeader.editTitle')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={currentConversationMenuItemClassNames()}
              disabled={!sessionPath}
              onSelect={handleOpenSessionFolder}
            >
              <FolderOpen className={currentConversationMenuIconClassNames()} />
              {t('agentHeader.openSessionFolder')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 悬浮预览面板（Portal 渲染到 body） */}
      {showPreview && (
        <TabPreviewDropdown
          buttonRef={buttonRef}
          title={title}
          items={previewItems}
          isLeaving={isLeaving}
          onMouseEnter={onPanelHoverEnter}
          onMouseLeave={onPanelHoverLeave}
        />
      )}
    </div>
  )
}

/** 使用 Portal 渲染到 body，避免被容器 overflow 裁剪或被内容区遮盖 */
function TabPreviewDropdown({
  buttonRef,
  title,
  items,
  isLeaving,
  onMouseEnter,
  onMouseLeave,
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>
  title: string
  items: TabMinimapItem[]
  isLeaving: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
}): React.ReactElement | null {
  const panelWidth = 280
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null)

  React.useLayoutEffect(() => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const top = rect.bottom
    let left = rect.left
    if (left + panelWidth > viewportWidth - 8) {
      left = viewportWidth - panelWidth - 8
    }
    if (left < 8) {
      left = 8
    }
    setPos({ top, left })
  }, [buttonRef])

  if (!pos) return null

  return createPortal(
    <div
      className="fixed z-[9999] pt-1"
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <TabPreviewPanel title={title} items={items} isLeaving={isLeaving} />
    </div>,
    document.body
  )
}
