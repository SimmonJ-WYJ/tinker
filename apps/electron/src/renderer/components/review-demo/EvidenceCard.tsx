/**
 * [mockup] P4 证据溯源卡片
 *
 * 在段落下方 inline 展开，显示原 Paper 段落引用 + 操作按钮。
 *
 * 按钮联动：
 * - 「在 Paper 中查看完整上下文」→ 切 activeView 到文献库（demo 阶段，paper
 *   detail 跳转待综述 EvidenceRef 与真实 Zotero key 关联后再做精准锚定）
 * - 「在此段加笔记」→ 弹 AddNoteDialog，用户填内容 + kind，提交后写入
 *   sessionPaperNotesAtom，paper 详情「笔记」tab 立刻可见
 */
import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Link2, X, FileText, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import { activeViewAtom } from '@/atoms/active-view'
import { AddNoteDialog } from './AddNoteDialog'
import type { DemoCitationRef } from './demo-content'

interface EvidenceCardProps {
  refData: DemoCitationRef
  onClose: () => void
}

export function EvidenceCard({ refData, onClose }: EvidenceCardProps): React.ReactElement {
  const { t } = useT('library')
  const setActiveView = useSetAtom(activeViewAtom)
  const [noteDialogOpen, setNoteDialogOpen] = React.useState(false)

  const handleOpenInPaper = (): void => {
    setActiveView('library')
    toast.info(
      t('reviewDemo.evidence.openContextToast', { paper: refData.source.paperLabel }),
    )
  }

  const handleAddNote = (): void => {
    setNoteDialogOpen(true)
  }

  return (
    <>
      <div className="my-4 rounded-lg border border-info/30 bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2">
            <Link2 className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">
              {t('reviewDemo.evidence.header')}
            </span>
            <span className="text-sm text-muted-foreground">{t('reviewDemo.evidence.refLabel')}</span>
          </div>
          <Button
            type="button"
            variant="subtle"
            size="icon-2xs"
            onClick={onClose}
            className="size-auto [&_svg]:size-3.5"
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-sm text-muted-foreground">
            {t('reviewDemo.evidence.sourcePrefix')} ·{' '}
            <span className="text-foreground font-medium">{refData.source.paperLabel}</span> ·{' '}
            {refData.source.location}
          </div>
          <blockquote className="border-l-2 border-border pl-3 py-1 text-sm text-foreground/80 leading-relaxed">
            {refData.quote}
          </blockquote>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={handleOpenInPaper}>
              <FileText className="!size-3 mr-1" />
              {t('reviewDemo.evidence.openContext')}
            </Button>
            <Button size="sm" variant="outline" onClick={handleAddNote}>
              <Plus className="!size-3 mr-1" />
              {t('reviewDemo.evidence.addNote')}
            </Button>
          </div>
        </div>
      </div>
      <AddNoteDialog
        open={noteDialogOpen}
        quote={refData.quote}
        onOpenChange={setNoteDialogOpen}
        onSuccess={onClose}
      />
    </>
  )
}
