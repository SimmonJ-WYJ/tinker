/**
 * [mockup] 集合视角的"加入更多论文" picker
 *
 * 当前实现:展示 Zotero 已缓存的 papers 中尚未在该集合的条目,允许多选 + 一次性加入。
 * mock 阶段简化为输入 paperKey 字符串列表(逗号或换行分隔)的 textarea —— 待 Zotero 元数据
 * atom 接入后再升级为可视化 picker。
 */
import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import type { ObjectId } from '@asci/shared'
import { nowIso } from '@asci/shared'
import {
  sessionEvidenceSetsAtom,
  sessionEvidenceSetPapersAtom,
} from '@/atoms/session-evidence-atoms'

interface AddPapersToSetDialogProps {
  open: boolean
  evidenceSetId: ObjectId
  onOpenChange: (open: boolean) => void
}

export function AddPapersToSetDialog({
  open,
  evidenceSetId,
  onOpenChange,
}: AddPapersToSetDialogProps): React.ReactElement {
  const { t } = useT('library')
  // v0.2 重构后 EvidenceSet 不再带 paperIds；mock 阶段读写副车 sessionEvidenceSetPapersAtom
  const [setPapersMap, setSetPapersMap] = useAtom(sessionEvidenceSetPapersAtom)
  const setSets = useSetAtom(sessionEvidenceSetsAtom)
  const [input, setInput] = React.useState('')

  React.useEffect(() => {
    if (!open) setInput('')
  }, [open])

  const handleAdd = (): void => {
    const parts = input
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length === 0) return
    const existing = new Set(setPapersMap[evidenceSetId] ?? [])
    const newIds = parts.filter((p) => !existing.has(p as ObjectId))
    if (newIds.length === 0) {
      onOpenChange(false)
      return
    }
    setSetPapersMap((prev) => ({
      ...prev,
      [evidenceSetId]: [
        ...(prev[evidenceSetId] ?? []),
        ...newIds.map((p) => p as ObjectId),
      ],
    }))
    setSets((prev) =>
      prev.map((s) =>
        s.id === evidenceSetId ? { ...s, updatedAt: nowIso() } : s,
      ),
    )
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('evidenceSetDetail.addPapers.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">
            {t('evidenceSetDetail.addPapers.helper')}
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('evidenceSetDetail.addPapers.placeholder')}
            className="w-full h-24 rounded-md border border-border bg-background p-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none resize-none"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('evidenceSetDetail.create.cancel')}
          </Button>
          <Button onClick={handleAdd} disabled={!input.trim()}>
            {t('evidenceSetDetail.addPapers.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
