import * as React from 'react'
import type { Note } from '@asci/shared'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import { toMs } from '@asci/shared'
import { formatDateTime } from '@/utils/dayjs'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { formatRelativeTime } from '@/components/library/PaperNotesPanel'

interface SetNoteCardProps {
  note: Note
  /** 提供 onOpen 时,整张卡片变成可点击区域 → 父组件打开 NoteDetailDialog(edit/delete) */
  onOpen?: () => void
}

export function SetNoteCard({ note, onOpen }: SetNoteCardProps): React.ReactElement {
  const { t } = useT('library')
  const interactive = onOpen !== undefined
  const createdAtMs = toMs(note.createdAt)

  return (
    <li
      {...(interactive
        ? {
            role: 'button',
            tabIndex: 0,
            onClick: onOpen,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpen?.()
              }
            },
          }
        : {})}
      className={cn(
        'rounded-md border border-border bg-card p-3 space-y-1.5 list-none',
        interactive && 'cursor-pointer transition-colors hover:bg-muted/20 hover:border-border/80 focus-visible:outline-none',
      )}
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {/* 相对时间(刚刚/X 分钟前/X 小时前/X 天前);hover Tooltip 给完整时间戳。
            Radix Tooltip 比原生 title 更可靠,Electron 下 title 偶尔不弹/延迟过久 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <time
              className="ml-auto tabular-nums"
              dateTime={note.createdAt}
              // 卡片是 role=button 整体可点,这里阻止冒泡避免 hover/click 误触卡片
              onClick={(e) => e.stopPropagation()}
            >
              {formatRelativeTime(createdAtMs, t)}
            </time>
          </TooltipTrigger>
          <TooltipContent side="top">
            {formatDateTime(createdAtMs)}
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
        {note.body}
      </p>
    </li>
  )
}
