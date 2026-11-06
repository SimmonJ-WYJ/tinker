/**
 * 综述里"+ Add note here" 触发的真实建注 Dialog
 *
 * 与 [[AddNoteDialog]]（demo / 写 sessionPaperNotesAtom 的版本）的关键区别：
 *   - 调真实 IPC `notes.createFromReviewHighlight`
 *   - 主进程单事务建 note + evidence_set (1:1) + evidence_ref (source='review',
 *     target='evidence-set') + evidence_set_refs
 *
 * 入参：
 *   - reviewId：调用方（ReviewHtmlRenderer）从 ReviewHtmlPreviewRenderer 提供，
 *     经 IPC `reviews.resolveByBodyPath` 反查得到
 *   - quote：当前点击的 cite quote（即 EvidenceTraceCard 上展示的那段）
 *   - anchor：HTML 锚点（sectionId / paragraphIndex / citeIndex），由 ReviewHtmlRenderer
 *     的 activeCite 上下文提供，已组装好
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Info } from 'lucide-react'
import { toast } from 'sonner'
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
import { currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import type { Anchor, ObjectId } from '@asci/shared'

interface AddReviewNoteDialogProps {
  open: boolean
  reviewId: ObjectId
  quote: string
  /** 已组装好的 HTML 锚点（sectionId / paragraphIndex / citeIndex + snapshotText） */
  sourceAnchor: Anchor
  onOpenChange: (open: boolean) => void
  /** 提交成功后回调（先于 onOpenChange(false) 触发） */
  onSuccess?: () => void
}

export function AddReviewNoteDialog({
  open,
  reviewId,
  quote,
  sourceAnchor,
  onOpenChange,
  onSuccess,
}: AddReviewNoteDialogProps): React.ReactElement {
  const { t } = useT('library')
  // issue #457：综述划词建注的证据集 scope 到当前 workspace。
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const [content, setContent] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setContent('')
    setSubmitting(false)
  }, [open])

  const canSubmit = content.trim().length > 0 && !submitting

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return
    if (!currentWorkspaceId) {
      toast.error(t('notes.toast.noWorkspace'))
      return
    }
    setSubmitting(true)
    try {
      await window.electronAPI.notes.createFromReviewHighlight({
        reviewId,
        body: content.trim(),
        sourceAnchor,
        workspaceId: currentWorkspaceId,
      })
      toast.success(t('reviewDemo.evidence.addNoteToast'))
      onSuccess?.()
      onOpenChange(false)
    } catch (err) {
      console.error('[AddReviewNoteDialog] createFromReviewHighlight failed:', err)
      toast.error(t('reviewDemo.evidence.addNoteError'))
      setSubmitting(false)
    }
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

          {/* 持久化提示（这次是真持久，不是 session-only） */}
          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-muted/40 border border-border/50 text-sm text-muted-foreground">
            <Info className="size-3.5 flex-shrink-0 mt-0.5" />
            <span>{t('reviewDemo.evidence.addNoteDialog.persistedNotice')}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
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
