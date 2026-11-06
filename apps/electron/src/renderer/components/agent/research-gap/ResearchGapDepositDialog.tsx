/**
 * ResearchGapDepositDialog —— 把研究空白洞察沉淀进证据集（存为笔记）
 *
 * 一条/多条洞察(组合空白·结论冲突)拼成一条笔记正文(标题 + 依据 + 涉及论文)，
 * 加入用户选的已有集合(addNote)或新建集合(createNamed + addNote)。
 * 与 library 的 AddToEvidenceSetDialog 同款 existing/new 交互，但走 note 路径
 * ——研究空白表的论文是 AI 给的 id、无 zoteroKey，不能走 addPaper。
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import type { EvidenceSetSummary, ObjectId } from '@asci/shared'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { useT } from '@/hooks/useT'

/** 待沉淀的单条洞察（已在调用处解析好 paperLabels） */
export interface DepositInsight {
  kind: 'gap' | 'conflict'
  title: string
  rationale: string
  paperLabels: string[]
}

interface ResearchGapDepositDialogProps {
  open: boolean
  insights: DepositInsight[]
  /** 新建集合的默认名（本次分析标题） */
  defaultName: string
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

type Mode = 'existing' | 'new'

function summaryLabel(s: EvidenceSetSummary): string {
  if (s.name) return s.name
  const preview = s.notePreview.trim()
  if (preview) return preview.length > 40 ? preview.slice(0, 40) + '…' : preview
  return '(unnamed)'
}

export function ResearchGapDepositDialog({
  open,
  insights,
  defaultName,
  onOpenChange,
  onSuccess,
}: ResearchGapDepositDialogProps): React.ReactElement {
  const { t } = useT('conversation')
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)

  const [sets, setSets] = React.useState<EvidenceSetSummary[]>([])
  const [loading, setLoading] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const hasExisting = sets.length > 0
  const [mode, setMode] = React.useState<Mode>('new')
  const [selectedSetId, setSelectedSetId] = React.useState<string>('')
  const [newName, setNewName] = React.useState('')

  // 笔记正文：每条洞察「[类型] 标题 / 依据 / 涉及论文」，多条空行分隔
  const noteBody = React.useMemo(() => {
    const gapTag = t('researchGap.insights.gapsTitle')
    const conflictTag = t('researchGap.insights.conflictsTitle')
    return insights
      .map((i) => {
        const tag = i.kind === 'gap' ? gapTag : conflictTag
        const papers = i.paperLabels.length
          ? `\n${t('researchGap.deposit.involvedLabel')}：${i.paperLabels.join('、')}`
          : ''
        return `【${tag}】${i.title}\n${i.rationale}${papers}`
      })
      .join('\n\n')
  }, [insights, t])

  React.useEffect(() => {
    if (!open) return
    setNewName(defaultName)
    setSubmitting(false)
    if (!currentWorkspaceId) {
      setSets([])
      setMode('new')
      return
    }
    let cancelled = false
    setLoading(true)
    window.electronAPI.evidenceSets
      .listSummary({ persistedOnly: false, workspaceId: currentWorkspaceId })
      .then((rows) => {
        if (cancelled) return
        setSets(rows)
        setMode(rows.length > 0 ? 'existing' : 'new')
        setSelectedSetId(rows.length > 0 ? rows[0]!.id : '')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('[ResearchGapDepositDialog] listSummary failed:', err)
        setSets([])
        setMode('new')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, currentWorkspaceId, defaultName])

  const selectedSet = sets.find((s) => s.id === selectedSetId)
  const canSubmit =
    !submitting &&
    insights.length > 0 &&
    (mode === 'existing' ? Boolean(selectedSet) : newName.trim().length > 0)

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return
    if (!currentWorkspaceId) {
      toast.error(t('researchGap.deposit.noWorkspace'))
      return
    }
    setSubmitting(true)
    try {
      let setId: ObjectId
      let setName: string
      if (mode === 'existing' && selectedSet) {
        setId = selectedSet.id
        setName = summaryLabel(selectedSet)
      } else {
        const name = newName.trim()
        const created = await window.electronAPI.evidenceSets.createNamed({
          name,
          workspaceId: currentWorkspaceId,
        })
        setId = created.setId
        setName = name
      }
      await window.electronAPI.evidenceSets.addNote({ setId, body: noteBody })
      toast.success(t('researchGap.deposit.toastDone', { name: setName, count: insights.length }))
      onSuccess?.()
      onOpenChange(false)
    } catch (err) {
      console.error('[ResearchGapDepositDialog] submit failed:', err)
      toast.error(t('researchGap.deposit.error'))
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,30rem)] max-w-none">
        <DialogHeader>
          <DialogTitle>{t('researchGap.deposit.dialogTitle', { count: insights.length })}</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-3">
          {/* existing / new 二选一 */}
          <div className="inline-flex w-full rounded-md bg-muted p-0.5">
            <button
              type="button"
              disabled={!hasExisting}
              onClick={() => setMode('existing')}
              className={cn(
                'flex-1 rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors',
                mode === 'existing' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
                !hasExisting && 'cursor-not-allowed opacity-40',
              )}
            >
              {t('researchGap.deposit.modeExisting')}
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className={cn(
                'flex-1 rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors',
                mode === 'new' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t('researchGap.deposit.modeNew')}
            </button>
          </div>

          {mode === 'existing' ? (
            loading ? (
              <div className="flex h-10 items-center px-1 text-xs text-muted-foreground">
                {t('researchGap.deposit.loading')}
              </div>
            ) : hasExisting ? (
              <Select value={selectedSetId} onValueChange={setSelectedSetId}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder={t('researchGap.deposit.selectPlaceholder')}>
                    {selectedSet ? summaryLabel(selectedSet) : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)]">
                  {sets.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {summaryLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex h-10 items-center px-1 text-xs text-muted-foreground">
                {t('researchGap.deposit.empty')}
              </div>
            )
          ) : (
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('researchGap.deposit.newNamePlaceholder')}
              className="h-10"
            />
          )}

          {/* 笔记预览（只读，让用户知道存进去的是什么） */}
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2.5 text-sm leading-relaxed text-muted-foreground scrollbar-thin">
            {noteBody}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('researchGap.deposit.cancel')}
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
            {t('researchGap.deposit.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
