/**
 * "+ Add to evidence set" dialog —— 把当前 paper 加入证据集（已有 / 新建）
 *
 * v0.2 后真实持久化（替代了原 session 副车 mock）：
 *   - existing 模式：调 `evidenceSets.addPaper` —— 幂等，已存在则复用既有 ref
 *   - new 模式：调 `evidenceSets.createWithPaper` —— 自动建占位 note（body=name）+ set + ref
 *   - 挂载时通过 `evidenceSets.listSummary` 拉真实集合列表
 *
 * Paper fallback 元数据从 `libraryItemDetailAtom` 读（与 usePaperNotes 一致），
 * 主进程 lazy upsert Paper 行后再挂 ref，避免 renderer 直接传 Paper.ObjectId。
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Info } from 'lucide-react'
import { toast } from 'sonner'
import type { EvidenceSetSummary, NotesPaperFallback } from '@asci/shared'
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
import { libraryItemDetailAtom } from '@/atoms/library-atoms'
import { currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { useT } from '@/hooks/useT'

interface AddToEvidenceSetDialogProps {
  open: boolean
  paperKey: string
  paperTitle: string
  onOpenChange: (open: boolean) => void
  /** 提交成功后回调（先于 onOpenChange(false) 触发）—— 父组件可在此处刷新 CITED BY 区 */
  onSuccess?: () => void
}

type Mode = 'existing' | 'new'

function buildFallback(
  detail: { title: string; creators: string[]; abstract?: string; date?: string; venue?: string; doi?: string; url?: string } | null,
  fallbackTitle: string,
): NotesPaperFallback {
  if (!detail) return { title: fallbackTitle, authors: [] }
  return {
    title: detail.title,
    authors: detail.creators,
    abstract: detail.abstract,
    year: parseYear(detail.date),
    venue: detail.venue,
    doi: detail.doi,
    url: detail.url,
  }
}

function parseYear(date: string | undefined): number | undefined {
  if (!date) return undefined
  const m = /\b(\d{4})\b/.exec(date)
  return m ? Number(m[1]) : undefined
}

/**
 * 下拉项 / toast 用的"集合标题"：
 *   - 命名集合（persisted=true）：用 name
 *   - 临时集合（persisted=false）：没 name，用 notePreview 截短
 *   - 兜底："(unnamed)"
 */
function summaryLabel(s: EvidenceSetSummary): string {
  if (s.name) return s.name
  const preview = s.notePreview.trim()
  if (preview) return preview.length > 40 ? preview.slice(0, 40) + '…' : preview
  return '(unnamed)'
}

/** 通用字符截断 + 末尾 "…"；长度 ≤ max 时原样返回 */
function truncateChars(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

// SelectItem 集合名显示长度上限；超长 name 截到 30 字符 + "…"
const SET_NAME_MAX_CHARS = 30

export function AddToEvidenceSetDialog({
  open,
  paperKey,
  paperTitle,
  onOpenChange,
  onSuccess,
}: AddToEvidenceSetDialogProps): React.ReactElement {
  const { t } = useT('library')
  const itemDetail = useAtomValue(libraryItemDetailAtom)
  // issue #457：证据集 scope 到当前 workspace —— 列表只列本 workspace，新建也归本 workspace。
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)

  // 真实集合列表（仅 persisted=true）
  const [sets, setSets] = React.useState<EvidenceSetSummary[]>([])
  const [loading, setLoading] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const hasExisting = sets.length > 0
  const [mode, setMode] = React.useState<Mode>('new')
  const [selectedSetId, setSelectedSetId] = React.useState<string>('')
  const [newName, setNewName] = React.useState('')
  // "补充说明" textarea 内容 —— 提交时按 mode 分流：
  //   existing → addPaper(noteAddendum=…) 追加到 set 现有 note.body
  //   new      → createWithPaper(noteBody=…) 作为新集合的 note.body
  const [noteText, setNoteText] = React.useState('')

  // open 变 true 时拉列表
  // persistedOnly=false：包含"临时"集合（划词建注 / + Add note here 都是 persisted=false，
  // 但用户仍把它们视为正常的证据集；过滤掉会让 dialog 显示残缺）
  React.useEffect(() => {
    if (!open) return
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
        const hasAny = rows.length > 0
        setMode(hasAny ? 'existing' : 'new')
        setSelectedSetId(hasAny ? rows[0]!.id : '')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('[AddToEvidenceSetDialog] listSummary failed:', err)
        setSets([])
        setMode('new')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    setNewName('')
    setNoteText('')
    // 修 bug：成功提交路径只 onOpenChange(false) 关 dialog，没复位 submitting；
    // 下次打开时 canSubmit = !submitting 永远 false，"确认加入"灰着不可点。
    // 在 open 时统一复位，避免每条副本里漏改。
    setSubmitting(false)
    return () => {
      cancelled = true
    }
  }, [open, currentWorkspaceId])

  const selectedSet = sets.find((s) => s.id === selectedSetId)
  const canSubmit =
    !submitting &&
    (mode === 'existing'
      ? Boolean(selectedSet)
      : newName.trim().length > 0)

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return
    if (!currentWorkspaceId) {
      toast.error(t('notes.toast.noWorkspace'))
      return
    }
    setSubmitting(true)
    const fallback = buildFallback(itemDetail, paperTitle)
    // 用户在"补充说明"textarea 写的内容；非空时：
    //   - existing 模式：作为 noteAddendum 追加到 set 现有 note.body 末尾
    //   - new 模式：作为新集合的 note.body（替代默认拿 name 当占位的行为）
    const trimmedNote = noteText.trim()
    try {
      if (mode === 'existing' && selectedSet) {
        const result = await window.electronAPI.evidenceSets.addPaper({
          setId: selectedSet.id,
          paper: { zoteroKey: paperKey, fallback },
          noteAddendum: trimmedNote || undefined,
        })
        const setName = summaryLabel(selectedSet)
        if (result.created) {
          toast.success(t('detail.evidence.dialog.addToEvidenceSet.toast', { name: setName }))
        } else {
          toast.info(t('detail.evidence.dialog.addToEvidenceSet.alreadyAdded', { name: setName }))
        }
      } else {
        const name = newName.trim()
        await window.electronAPI.evidenceSets.createWithPaper({
          name,
          paper: { zoteroKey: paperKey, fallback },
          workspaceId: currentWorkspaceId,
          noteBody: trimmedNote || undefined,
        })
        toast.success(t('detail.evidence.dialog.addToEvidenceSet.toast', { name }))
      }
      onSuccess?.()
      onOpenChange(false)
    } catch (err) {
      console.error('[AddToEvidenceSetDialog] submit failed:', err)
      toast.error(t('detail.evidence.dialog.addToEvidenceSet.error'))
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,32rem)] max-w-none max-h-[85vh] overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle>{t('detail.evidence.dialog.addToEvidenceSet.title')}</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-3">
          {/* Segmented control —— 两个 tab 合并到一个 rounded track，激活态 chip 高亮。
              比独立按钮成对感更强，符合用户"二选一"的心智。 */}
          <div className="inline-flex w-full rounded-md bg-muted p-0.5">
            <ModePill
              active={mode === 'existing'}
              disabled={!hasExisting}
              onClick={() => setMode('existing')}
            >
              {t('detail.evidence.dialog.addToEvidenceSet.modeExisting')}
            </ModePill>
            <ModePill active={mode === 'new'} onClick={() => setMode('new')}>
              {t('detail.evidence.dialog.addToEvidenceSet.modeNew')}
            </ModePill>
          </div>

          {/* tab 主体：existing 用下拉，new 用单行 input。两者都 h-10，自然对齐。
              下拉展开后每条 = 集合名 + 首篇论文标题预览 + "+N" 计数；
              触发器仅显选中集合名（紧凑），便于焦点回到下方 textarea。 */}
          {mode === 'existing' &&
            (loading ? (
              <div className="h-10 flex items-center text-xs text-muted-foreground px-1">
                {t('detail.evidence.dialog.addToEvidenceSet.loading')}
              </div>
            ) : hasExisting ? (
              <Select value={selectedSetId} onValueChange={setSelectedSetId}>
                <SelectTrigger className="h-10">
                  <SelectValue
                    placeholder={t('detail.evidence.dialog.addToEvidenceSet.selectPlaceholder')}
                  >
                    {selectedSet ? summaryLabel(selectedSet) : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  // Radix Select 暴露 --radix-select-trigger-width CSS 变量；
                  // 绑定宽度让 dropdown 永远跟 trigger 等宽，长论文标题不会撑爆容器
                  className="w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)]"
                >
                  {sets.map((s) => {
                    // JS 截断兜底 —— Radix SelectItem 把 children 包进 inline 的
                    // ItemText span，CSS truncate 算不准溢出，靠字符上限稳出 "…"
                    const setNameShort = truncateChars(summaryLabel(s), SET_NAME_MAX_CHARS)
                    return (
                      // [&>span:first-child]:hidden 干掉内置 ✓；pr-2 收回让位
                      <SelectItem
                        key={s.id}
                        value={s.id}
                        className="pr-2 [&>span:first-child]:hidden"
                      >
                        {setNameShort}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            ) : (
              <div className="h-10 flex items-center text-xs text-muted-foreground px-1">
                {t('detail.evidence.dialog.addToEvidenceSet.noExisting')}
              </div>
            ))}

          {mode === 'new' && (
            <Input
              placeholder={t('detail.evidence.dialog.addToEvidenceSet.namePlaceholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
          )}

          {/* 可选"补充说明"—— 两个 tab 共用同一 textarea，提交时按 mode 分流：
              existing → 追加到选中 set 的 note.body 末尾（append-only，空行分隔）
              new      → 作为新集合的 note.body（替代默认用 name 占位的行为） */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground px-1">
              {t('detail.evidence.dialog.addToEvidenceSet.noteLabel')}
            </label>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={
                mode === 'existing'
                  ? t('detail.evidence.dialog.addToEvidenceSet.notePlaceholderExisting')
                  : t('detail.evidence.dialog.addToEvidenceSet.notePlaceholderNew')
              }
              rows={3}
              className={cn(
                'flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm',
                'placeholder:text-muted-foreground transition-colors resize-none',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            />
          </div>

          <div className="flex items-start gap-1.5 text-sm text-muted-foreground/80 px-1">
            <Info className="size-3 flex-shrink-0 mt-0.5" aria-hidden />
            <span>{t('detail.evidence.dialog.addToEvidenceSet.persistedNotice')}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('detail.evidence.dialog.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {t('detail.evidence.dialog.addToEvidenceSet.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ModePillProps {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}

function ModePill({ active, disabled, onClick, children }: ModePillProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex-1 h-7 rounded-[5px] px-3 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
        disabled && 'opacity-40 cursor-not-allowed hover:text-muted-foreground',
      )}
    >
      {children}
    </button>
  )
}

