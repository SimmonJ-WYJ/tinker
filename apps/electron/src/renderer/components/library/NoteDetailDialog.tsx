/**
 * [mockup] NoteDetailDialog — 笔记详情弹层（V6c' / V6d）
 *
 * 触发：摘要/PDF 上的 quote 高亮点击 + NotesView 左栏 NoteListItem 点击。
 *
 * 内容：
 * - 元信息：时间
 * - 原文引用（若有）
 * - 笔记正文（read-only / edit 双模式，可改 body / 删除）
 *
 * 注：本期不暴露 hypothesis kind / Proposals 功能，UI 全部去掉；Note schema 仍保留兼容字段。
 */

import * as React from 'react'
import { nowMs } from '@asci/shared'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useT } from '@/hooks/useT'
import type { RuntimeNote } from './PaperNotesPanel'

interface NoteDetailDialogProps {
  note: RuntimeNote | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate?: (id: string, patch: Partial<RuntimeNote>) => void
  onDelete?: (id: string) => void
}

export function NoteDetailDialog({ note, open, onOpenChange, onUpdate, onDelete }: NoteDetailDialogProps): React.ReactElement {
  const { t } = useT('library')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto scrollbar-thin">
        {note && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">
                {t('notes.detail.titleNote')}
              </DialogTitle>
            </DialogHeader>
            <NoteDetailBody note={note} onUpdate={onUpdate} onDelete={onDelete} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ===== 笔记主体（read-only / edit 双模式） =====

export interface NoteDetailBodyProps {
  note: RuntimeNote
  onUpdate?: (id: string, patch: Partial<RuntimeNote>) => void
  onDelete?: (id: string) => void
  /** 可选区块标题（如 "NOTE"）。提供后在 meta 行左侧渲染，与时间 / Edit / Delete 同行。 */
  headingLabel?: string
  /** 隐藏划词原文引用（证据集详情面板里 quote 已由「证据条目」卡片展示，避免重复）。 */
  hideQuote?: boolean
}

export function NoteDetailBody({ note, onUpdate, onDelete, headingLabel, hideQuote }: NoteDetailBodyProps): React.ReactElement {
  const { t } = useT('library')
  const [editing, setEditing] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [draftContent, setDraftContent] = React.useState(note.content)

  // 切换 note 时重置 draft（确保上次留下的草稿不污染新笔记）
  React.useEffect(() => {
    setEditing(false)
    setDraftContent(note.content)
  }, [note])

  const startEdit = (): void => setEditing(true)
  const cancelEdit = (): void => {
    setDraftContent(note.content)
    setEditing(false)
  }
  const saveEdit = (): void => {
    const trimmed = draftContent.trim()
    if (!trimmed) return
    onUpdate?.(note.id, { content: trimmed })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="space-y-3">
        {/* 元信息行（read-only,即使在 edit 模式也保留时间锚点）。min-h-7 与 read-only
            模式 Edit/Delete 按钮的 h-6 对齐，避免编辑态因没有按钮而整体上移几像素。 */}
        <div className="flex items-center gap-2 min-h-7 text-sm text-muted-foreground">
          {headingLabel && (
            <span className="text-sm font-semibold tracking-wider uppercase">
              {headingLabel}
            </span>
          )}
          <span className="tabular-nums">{formatRelativeTime(note.createdAt, t)}</span>
        </div>

        {/* quote 引用（read-only,选区原文不可编辑） */}
        {!hideQuote && note.quote && (
          <div className="text-xs leading-relaxed text-foreground/70 border-l-2 border-foreground/30 pl-2.5">
            {note.quote}
          </div>
        )}

        {/* 正文 textarea */}
        <textarea
          autoFocus
          value={draftContent}
          onChange={(e) => setDraftContent(e.target.value)}
          rows={4}
          placeholder={t('notes.detail.contentPlaceholder')}
          className="w-full px-3 py-2 text-sm leading-relaxed rounded-md border-[0.5px] border-border/60 bg-muted/30 placeholder:text-muted-foreground/60 focus:outline-none focus:bg-background focus:border-border resize-y transition-colors"
        />

        {/* 操作行 */}
        <div className="flex items-center justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7 text-xs px-3">
            {t('notes.detail.cancel')}
          </Button>
          <Button
            size="sm"
            variant="default"
            disabled={draftContent.trim().length === 0}
            onClick={saveEdit}
            className="h-7 text-xs px-3"
          >
            {t('notes.detail.save')}
          </Button>
        </div>
      </div>
    )
  }

  // read-only 模式
  return (
    <div className="space-y-3">
      {/* 元信息行:可选标题（NOTE）+ 时间 + 编辑按钮 同一行（min-h-7 与编辑态对齐，避免切换抖动） */}
      <div className="flex items-center gap-2 min-h-7 text-sm">
        {headingLabel && (
          <span className="text-sm font-semibold tracking-wider uppercase text-muted-foreground">
            {headingLabel}
          </span>
        )}
        <span className="text-muted-foreground tabular-nums">
          {formatRelativeTime(note.createdAt, t)}
        </span>
        {(onUpdate || onDelete) && (
          <div className="ml-auto flex items-center gap-1.5">
            {onUpdate && (
              <Button
                type="button"
                variant="ghost"
                onClick={startEdit}
                className={cn(
                  'h-auto gap-1.5 px-2 py-1 rounded-md text-sm',
                  'bg-muted/60 hover:bg-muted text-foreground/80 hover:text-foreground/80',
                )}
              >
                {t('notes.detail.edit')}
              </Button>
            )}
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                className={cn(
                  'h-auto gap-1.5 px-2 py-1 rounded-md text-sm',
                  'bg-muted/60 hover:bg-destructive/10 text-foreground/80 hover:text-destructive',
                )}
              >
                {t('notes.detail.delete')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* quote 引用 */}
      {!hideQuote && note.quote && (
        <div className="text-xs leading-relaxed text-foreground/70 border-l-2 border-foreground/30 pl-2.5">
          {note.quote}
        </div>
      )}

      {/* 正文 */}
      <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
        {note.content}
      </div>

      {/* 删除确认 */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('notes.detail.deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('notes.detail.deleteConfirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('notes.detail.deleteConfirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete?.(note.id)
                setConfirmDelete(false)
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('notes.detail.deleteConfirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ===== 时间格式 =====

function formatRelativeTime(ts: number, t: ReturnType<typeof useT>['t']): string {
  const diff = Math.max(0, nowMs() - ts)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return t('notes.time.justNow')
  if (minutes < 60) return t('notes.time.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('notes.time.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  return t('notes.time.daysAgo', { count: days })
}
