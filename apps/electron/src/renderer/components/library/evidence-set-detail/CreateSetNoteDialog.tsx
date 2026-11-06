/**
 * [mockup] 新建集合级 Note 弹窗
 *
 * 字段：body (textarea) —— 本期不暴露 hypothesis kind，固定 kind='note'
 *
 * v0.2 重构后语义微调：notes 表去除 targetRef，note ↔ set 是 1:1 强绑定
 * （evidence_sets.note_id UNIQUE）。本 dialog 现仅把 note 加入 sessionEvidenceSetNotesAtom
 * 池子，**不直接挂到当前 set 上**（mock 阶段没有 mutating set.noteId 的入口）；
 * 真实交互在下个 PR 接入 IPC notes.createFromPaperHighlight + 写入 evidence_sets.note_id。
 * TODO: 改为更新 set 当前 note 的 body，或显式新建 set。
 */
import * as React from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import type { Note, ObjectId } from '@asci/shared'
import { nowIso, nowMs } from '@asci/shared'
import { sessionEvidenceSetNotesAtom } from '@/atoms/session-evidence-atoms'

interface CreateSetNoteDialogProps {
  open: boolean
  /** 调用方传入；v0.2 mock 阶段未真正绑定到 set（见文件头注释 TODO） */
  evidenceSetId: ObjectId
  onOpenChange: (open: boolean) => void
}

export function CreateSetNoteDialog({
  open,
  evidenceSetId: _evidenceSetId,
  onOpenChange,
}: CreateSetNoteDialogProps): React.ReactElement {
  const { t } = useT('library')
  const setNotes = useSetAtom(sessionEvidenceSetNotesAtom)
  const [body, setBody] = React.useState('')

  React.useEffect(() => {
    if (!open) {
      setBody('')
    }
  }, [open])

  const handleSubmit = (): void => {
    const trimmed = body.trim()
    if (!trimmed) return
    const now = nowIso()
    // v0.2 重构后 Note 不再带 targetRef；mock 阶段仅把 note 加入池子，
    // 真实集合绑定走 evidence_sets.note_id（见文件头 TODO）
    const note: Note = {
      id: `set-note-${nowMs()}` as ObjectId,
      body: trimmed,
      createdAt: now,
      updatedAt: now,
      visibility: 'visible',
    }
    setNotes((prev) => [note, ...prev])
    toast.success(t('evidenceSetDetail.toast.noteCreated'))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('evidenceSetDetail.create.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('evidenceSetDetail.create.bodyPlaceholder')}
            className="w-full h-32 rounded-md border border-border bg-background p-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none resize-none"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('evidenceSetDetail.create.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!body.trim()}>
            {t('evidenceSetDetail.create.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
