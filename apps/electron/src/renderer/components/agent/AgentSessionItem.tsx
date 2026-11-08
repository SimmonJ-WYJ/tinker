/**
 * AgentSessionItem - Agent 会话列表项
 *
 * 提供统一的 Agent 会话展示，供 Sidebar 会话列表与设置面板「已归档」Tab 复用。
 *
 * 默认右侧：相对时间；hover 时：操作按钮组（重命名 / 归档 / 删除）。
 * 置顶（pin）功能的 UI 入口已移除，后端字段保留。
 * 已归档（session.archived）非选中态附带 bg-muted/50 底色以与活跃会话区分；
 * Sidebar 已过滤 archived，不会受影响。
 */

import * as React from 'react'
import { Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useFormatRelativeTime } from '@/utils/format-relative-time'
import { useT } from '@/hooks/useT'
import { useDisplaySessionTitle } from '@/hooks/useDisplaySessionTitle'
import type { AgentSessionMeta } from '@asci/shared'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'

export interface AgentSessionItemProps {
  session: AgentSessionMeta
  active: boolean
  hovered: boolean
  indicatorStatus: SessionIndicatorStatus
  actionSpacing?: 'compact' | 'comfortable'
  appearance?: 'default' | 'home'
  onSelect: () => void
  onRequestDelete: () => void
  onRename: (id: string, newTitle: string) => Promise<void>
  onToggleArchive: (id: string) => Promise<void>
  onMouseEnter: () => void
  onMouseLeave: () => void
}

export interface AgentSessionItemClassNameOptions {
  active: boolean
  archived: boolean
}

export function agentSessionItemClassName({ active, archived }: AgentSessionItemClassNameOptions): string {
  return cn(
    'w-full h-8 flex items-center gap-2 p-2 rounded-[10px] transition-colors duration-100 titlebar-no-drag text-left',
    active
      ? 'session-item-selected bg-foreground/[0.08]'
      : archived
        ? 'bg-muted/50 hover:bg-muted/70'
        : 'hover:bg-primary/5',
  )
}

export function AgentSessionItem({
  session,
  active,
  hovered,
  indicatorStatus,
  actionSpacing = 'compact',
  appearance = 'default',
  onSelect,
  onRequestDelete,
  onRename,
  onToggleArchive,
  onMouseEnter,
  onMouseLeave,
}: AgentSessionItemProps): React.ReactElement {
  const { t } = useT('nav')
  const displayTitle = useDisplaySessionTitle()
  const formatRelativeTime = useFormatRelativeTime()
  const [editing, setEditing] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)

  const startEdit = (): void => {
    setEditTitle(displayTitle(session.title))
    setEditing(true)
    justStartedEditing.current = true
    setTimeout(() => {
      justStartedEditing.current = false
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 300)
  }

  const saveTitle = async (): Promise<void> => {
    if (justStartedEditing.current) return
    const trimmed = editTitle.trim()
    if (!trimmed || trimmed === session.title) {
      setEditing(false)
      return
    }
    await onRename(session.id, trimmed)
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      // 显式确认不受双击后防止误触 blur 的短暂保护影响。
      justStartedEditing.current = false
      saveTitle()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }

  const relativeTime = React.useMemo(
    () => formatRelativeTime(session.updatedAt),
    [session.updatedAt, formatRelativeTime],
  )

  const showActions = (hovered || focused) && !editing
  const comfortableActions = actionSpacing === 'comfortable'
  const actionButtonClassName = cn(
    'h-auto text-foreground/30 hover:bg-foreground/[0.08] hover:text-foreground/60 [&_svg]:size-[13px]',
    comfortableActions ? 'p-1.5' : 'p-1',
  )

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        startEdit()
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(agentSessionItemClassName({ active, archived: session.archived ?? false }), appearance === 'home' && 'home-recent-session')}
    >
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={saveTitle}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-sm leading-5 text-foreground border-b border-primary/50 outline-none px-0 py-0"
            maxLength={100}
          />
        ) : (
          <div className={cn(
            'truncate text-sm leading-4 flex items-center gap-1.5',
            active ? 'text-foreground' : 'text-foreground/80',
          )}>
            {appearance !== 'home' && indicatorStatus !== 'idle' && (
              <span className="relative flex-shrink-0 size-4 flex items-center justify-center">
                {indicatorStatus === 'completed' ? (
                  <span className="relative block size-2 rounded-full bg-success" />
                ) : (
                  <>
                    <span className={cn(
                      'absolute size-2 rounded-full animate-ping',
                      indicatorStatus === 'blocked' ? 'bg-warning/60' : 'bg-info/60',
                    )} />
                    <span className={cn(
                      'relative block size-2 rounded-full',
                      indicatorStatus === 'blocked' ? 'bg-warning' : 'bg-info',
                    )} />
                  </>
                )}
              </span>
            )}
            <span className="truncate">{displayTitle(session.title)}</span>
          </div>
        )}
      </div>

      {/* 右侧：默认显示相对时间；hover 切换为操作按钮组 */}
      {!editing && (
        <div className={cn(
          'flex-shrink-0 relative flex items-center justify-end h-4 transition-[min-width] duration-150',
          comfortableActions
            ? (showActions ? 'min-w-[92px]' : 'min-w-[56px]')
            : (showActions ? 'min-w-[68px]' : 'min-w-[56px]'),
        )}>
          {/* 时间（默认可见） */}
          <span className={cn(
            'text-sm leading-4 tabular-nums text-foreground/40 transition-opacity duration-100 select-none',
            showActions || appearance === 'home' ? 'opacity-0 pointer-events-none' : 'opacity-100',
          )}>
            {relativeTime}
          </span>

          {/* 操作按钮（hover 显示） */}
          <div className={cn(
            'absolute right-0 top-0 flex items-center transition-opacity duration-100',
            comfortableActions ? 'gap-2' : 'gap-0.5',
            showActions ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t('sessionItem.rename')}
                  onClick={(e) => { e.stopPropagation(); startEdit() }}
                  className={actionButtonClassName}
                >
                  <Pencil size={13} className="!size-[13px]" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('sessionItem.rename')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t(session.archived ? 'sessionItem.unarchive' : 'sessionItem.archive')}
                  onClick={(e) => { e.stopPropagation(); onToggleArchive(session.id) }}
                  className={actionButtonClassName}
                >
                  {session.archived ? <ArchiveRestore size={13} className="!size-[13px]" /> : <Archive size={13} className="!size-[13px]" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{session.archived ? t('sessionItem.unarchive') : t('sessionItem.archive')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t('sessionItem.deleteSession')}
                  onClick={(e) => { e.stopPropagation(); onRequestDelete() }}
                  className={cn(
                    'h-auto text-foreground/30 hover:bg-destructive/10 hover:text-destructive [&_svg]:size-[13px]',
                    comfortableActions ? 'p-1.5' : 'p-1',
                  )}
                >
                  <Trash2 size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('sessionItem.deleteSession')}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  )
}
