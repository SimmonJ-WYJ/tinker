/**
 * [mockup] 添加笔记 Dialog（从 P4 综述的 EvidenceCard 触发）
 *
 * 源 quote 来自当前 EvidenceRef，预填只读。内容必填。提交后写入 sessionPaperNotesAtom。
 *
 * 本期不暴露 hypothesis kind，固定 kind='note'。
 *
 * 与 PaperNotesPanel 内置的"划词加笔记"流程数据落点一致，UI 形态为居中 Dialog
 * （EvidenceCard 已是 inline 卡片，没有选区 rect 可锚定）。
 */
import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Info } from 'lucide-react'
import { toast } from 'sonner'
import { nowMs } from '@asci/shared'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import { sessionPaperNotesAtom } from '@/components/library/PaperNotesPanel'

interface AddNoteDialogProps {
  open: boolean
  quote: string
  onOpenChange: (open: boolean) => void
  /** 提交成功后回调（先于 onOpenChange(false) 触发） */
  onSuccess?: () => void
}

export function AddNoteDialog({
  open,
  quote,
  onOpenChange,
  onSuccess,
}: AddNoteDialogProps): React.ReactElement {
  const { t } = useT('library')
  const setNotes = useSetAtom(sessionPaperNotesAtom)

  const [content, setContent] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setContent('')
  }, [open])

  const canSubmit = content.trim().length > 0

  const handleSubmit = (): void => {
    if (!canSubmit) return
    setNotes((prev) => [
      {
        id: `from-review-${nowMs()}`,
        content: content.trim(),
        kind: 'note',
        quote: quote.replace(/^["“]|["”]$/g, '').trim(),
        createdAt: nowMs(),
        createdAtMsAgo: 0,
      },
      ...prev,
    ])
    toast.success(t('reviewDemo.evidence.addNoteToast'))
    onSuccess?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,28rem)] max-w-none max-h-[85vh] overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle>{t('reviewDemo.evidence.addNoteDialog.title')}</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          {/* 源 quote 只读展示 */}
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              {t('reviewDemo.evidence.addNoteDialog.fromQuote')}
            </div>
            <blockquote className="border-l-2 border-border pl-3 py-1 text-sm text-foreground/75 leading-relaxed break-words">
              {quote}
            </blockquote>
          </div>

          {/* content textarea */}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('reviewDemo.evidence.addNoteDialog.contentPlaceholder')}
            rows={4}
            autoFocus
            className={cn(
              'flex w-full rounded-md border border-input bg-transparent px-3 py-2',
              'text-sm shadow-sm placeholder:text-muted-foreground',
              'focus-visible:outline-none',
            )}
          />

          {/* session 演示提示 */}
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-muted/40 border border-border/50 text-sm text-muted-foreground">
            <Info className="size-3.5 flex-shrink-0 mt-0.5" />
            <span>{t('detail.evidence.dialog.sessionNotice')}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('detail.evidence.dialog.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {t('reviewDemo.evidence.addNoteDialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
