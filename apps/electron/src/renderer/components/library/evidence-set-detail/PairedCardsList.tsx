/**
 * PairedCardsList — paragraph↔paper 配对卡片列表，证据集详情主体排版。
 *
 * 排版：note.body 按 `\n{2,}` 切段，与 detail.memberPapers 按 index 顺序"位置匹配"。
 *   ┌── 卡片 ──────────────┐
 *   │ 说明 (主)   ✎ 🗑     │
 *   │ ───── divider ─────  │
 *   │ 论文标题 (轻)         │
 *   │ meta · 当前论文徽章   │
 *   └─────────────────────┘
 *   缺 note 的论文：只渲染下半段。
 *   多余段落（paragraphs > papers）：放最后作为 note-only 卡片。
 *
 * 编辑：hover 卡片右上角出现 ✎ + 🗑。✎ → 段落 inline textarea；🗑 → 删除段落
 * （论文留在集合里）。两条操作都走 notes:updateBody + 本地乐观更新（onUpdateDetail）。
 *
 * 复用：EvidenceSetDetailSheet（右侧抽屉）+ NotesView 右栏证据集详情。两边视觉同源。
 */
import * as React from 'react'
import { Pencil, Trash2, FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import { useFormatRelativeTime } from '@/utils/format-relative-time'
import { useEvidencePdfAvailability } from '@/hooks/useEvidencePdfAvailability'
import type { EvidenceRefWithSource, EvidenceSetDetail, ObjectId, Paper } from '@asci/shared'
import { sanitizeText } from '@asci/shared'
import { Button } from '@/components/ui/button'
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

interface PairedCardsListProps {
  detail: EvidenceSetDetail
  /** 乐观更新回写：notes.updateBody 成功后用新 note 替换 detail.note */
  onUpdateDetail: (next: EvidenceSetDetail) => void
  /** 高亮"当前论文"徽章用——zoteroKey 匹配则该卡显示徽章 */
  currentZoteroKey: string | null
  /**
   * 点 paper 卡片 → 触发右栏预览。可选；传了则 PaperSection 变可点击（hover bg + cursor-pointer）。
   * row 透传 anchor.snapshotText (quote) 和 ref.id (traceId)，给 PdfReader.pendingScroll 定位用。
   * NotesView 用；EvidenceSetDetailSheet 不传 → 纯展示。
   */
  onPaperClick?: (row: EvidenceRefWithSource) => void
  /** 选中的 ref.id —— 匹配则给对应卡片加 ring 高亮。和 onPaperClick 配对使用 */
  selectedRefId?: string | null
}

export function PairedCardsList({
  detail,
  onUpdateDetail,
  currentZoteroKey,
  onPaperClick,
  selectedRefId,
}: PairedCardsListProps): React.ReactElement {
  const { t } = useT('library')
  const formatRelative = useFormatRelativeTime()
  // 互斥编辑态：同一时间只允许一条段落处于编辑中，
  // 其他卡片的 ✎ / 🗑 disabled，避免"没保存/取消就去改另一条"的歧义。
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null)
  const enterEdit = (i: number): void => setEditingIndex(i)
  const exitEdit = (): void => setEditingIndex(null)
  // 删除前确认：存待删 paragraph index；null = 无对话框
  const [confirmDeleteIndex, setConfirmDeleteIndex] = React.useState<number | null>(null)
  const requestDeleteParagraph = (i: number): void => {
    setConfirmDeleteIndex(i)
  }

  // 底层 note 切换时强制退出编辑态——上层（NotesView 左栏切条 / Sheet 切 openId）
  // 复用同一个 PairedCardsList 实例时，若 paper id 恰好相同，NoteSection 不会卸载，
  // 其本地 draft 会泄漏到新 note 上；若用户继续点保存，会把旧草稿写入新 note 的 body。
  const noteId = detail.note?.id ?? null
  React.useEffect(() => {
    setEditingIndex(null)
  }, [noteId])

  // body → 段落数组：以"两个及以上换行"为分段（noteAddendum 用 \n\n 拼接）；
  // 段内单行回车 whitespace-pre-wrap 渲染保留。空段过滤掉。
  const paragraphs = React.useMemo(() => {
    const body = detail.note?.body ?? ''
    return body.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0)
  }, [detail.note?.body])

  // 写到 notes:updateBody + 本地乐观更新；transform(prev) 返回新段落数组
  const writeParagraphs = async (transform: (prev: string[]) => string[]): Promise<void> => {
    if (!detail.note) return
    const next = transform(paragraphs).filter((p) => p.length > 0)
    const newBody = next.join('\n\n')
    try {
      const updatedNote = await window.electronAPI.notes.updateBody({
        id: detail.note.id as ObjectId,
        body: newBody,
      })
      onUpdateDetail({ ...detail, note: updatedNote })
    } catch (err) {
      console.error('[PairedCardsList] updateBody failed:', err)
      toast.error(t('evidenceSetDetail.toast.editFailed'))
      throw err
    }
  }

  const handleSaveParagraph = async (i: number, newText: string): Promise<void> => {
    await writeParagraphs((prev) => {
      // i < prev.length → 编辑现有段落；i === prev.length → 末尾追加（"添加说明" CTA）
      if (i < prev.length) return prev.map((p, j) => (j === i ? newText.trim() : p))
      return [...prev, newText.trim()]
    })
  }

  const handleDeleteParagraph = async (i: number): Promise<void> => {
    await writeParagraphs((prev) => prev.filter((_, j) => j !== i))
  }

  const memberPapers = detail.memberPapers ?? []
  // 仅在卡片可点击（onPaperClick 存在 → NotesView PDF 预览场景）时探测 PDF 可用性；
  // 纯展示场景（Sheet 抽屉）不预览 PDF，无需探测、也不禁用任何条目。
  // hook 内部按 paper id 列表去抖，memberPapers 每渲染新引用不会触发重探，无需 memo。
  const { availability: pdfAvailability, checking: pdfChecking } =
    useEvidencePdfAvailability(onPaperClick ? memberPapers : [])
  // 段落比论文多时，多出部分放最后作为 note-only 卡片
  const trailingOrphanParagraphIndices: number[] = []
  for (let i = memberPapers.length; i < paragraphs.length; i++) {
    trailingOrphanParagraphIndices.push(i)
  }

  if (memberPapers.length === 0 && trailingOrphanParagraphIndices.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('evidenceSetDetail.empty.papers')}
      </p>
    )
  }

  // PDF 可用性探测期间先不渲染条目：等全部探测完一次性以 enabled/disabled 观感呈现，
  // 避免"先 enabled 再翻转 disabled"的闪烁。仅 clickable 场景才探测，故 checking 仅在彼时为 true。
  if (pdfChecking) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {t('evidenceSetDetail.loading')}
      </div>
    )
  }

  return (
    <>
    <ul className="space-y-2.5 list-none p-0">
      {memberPapers.map((p, i) => {
        const para = i < paragraphs.length ? paragraphs[i] ?? null : null
        const isCurrent =
          currentZoteroKey != null && p.zoteroKey === currentZoteroKey
        // 找到这篇 paper 对应的第一条 ref —— 用 ref.createdAt 作为
        // "加入这条记录的时间"的近似（一条 paper 通常 1 个 ref）
        const refRow = detail.refs.find(
          (r) => r.ref.source.kind === 'paper' && r.ref.source.id === p.id,
        )
        const joinedAt = refRow ? new Date(refRow.ref.createdAt).getTime() : null
        const joinedAtLabel =
          joinedAt != null && Date.now() - joinedAt < 60_000
            ? t('evidenceSetDetail.joinedRecently')
            : t('evidenceSetDetail.joinedAt', {
                time: joinedAt != null ? formatRelative(joinedAt) : '',
              })
        // PDF 不可用（Zotero 已移除 / 无 PDF 附件）：探测结果显式 false 才判定，
        // 未探测完（Map 无此 key）按"可用"处理，避免加载期闪烁误禁用。
        const noPdf = onPaperClick != null && pdfAvailability.get(p.id) === false
        // 可点击态：父传了 onPaperClick 且能定位到 refRow（透传 anchor/traceId）；
        // 无 PDF 时仍可点（cursor-pointer），但点击 toast 提示而非打开预览。
        const handlePaperClick = noPdf
          ? () => toast.info(t('evidenceSetDetail.toast.noPdf'))
          : onPaperClick && refRow
            ? () => onPaperClick(refRow)
            : undefined
        const isSelected = refRow != null && selectedRefId === refRow.ref.id
        return (
          <li key={p.id}>
            <PairedCard
              note={para}
              paragraphIndex={i}
              paper={p}
              joinedAt={joinedAt}
              isCurrent={isCurrent}
              isSelected={isSelected}
              noPdf={noPdf}
              editingIndex={editingIndex}
              onEnterEdit={enterEdit}
              onExitEdit={exitEdit}
              onSaveNote={handleSaveParagraph}
              onDeleteNote={requestDeleteParagraph}
              onPaperClick={handlePaperClick}
              editLabel={t('evidenceSetDetail.actions.edit')}
              deleteLabel={t('evidenceSetDetail.actions.delete')}
              saveLabel={t('evidenceSetDetail.actions.save')}
              cancelLabel={t('evidenceSetDetail.actions.cancel')}
              joinedAtLabel={joinedAtLabel}
              currentBadge={t('evidenceSetDetail.currentPaperBadge')}
            />
          </li>
        )
      })}
      {/* 多余段落：放最后作为 note-only 卡片 */}
      {trailingOrphanParagraphIndices.map((idx) => (
        <li key={`orphan-${idx}`}>
          <PairedCard
            note={paragraphs[idx]!}
            paragraphIndex={idx}
            paper={null}
            joinedAt={null}
            isCurrent={false}
            isSelected={false}
            noPdf={false}
            editingIndex={editingIndex}
            onEnterEdit={enterEdit}
            onExitEdit={exitEdit}
            onSaveNote={handleSaveParagraph}
            onDeleteNote={requestDeleteParagraph}
            editLabel={t('evidenceSetDetail.actions.edit')}
            deleteLabel={t('evidenceSetDetail.actions.delete')}
            saveLabel={t('evidenceSetDetail.actions.save')}
            cancelLabel={t('evidenceSetDetail.actions.cancel')}
            joinedAtLabel=""
            currentBadge=""
          />
        </li>
      ))}
    </ul>

    <AlertDialog
      open={confirmDeleteIndex !== null}
      onOpenChange={(open) => !open && setConfirmDeleteIndex(null)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('evidenceSetDetail.deleteParagraphConfirm.title')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('evidenceSetDetail.deleteParagraphConfirm.description')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {t('evidenceSetDetail.deleteParagraphConfirm.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              if (confirmDeleteIndex !== null) {
                void handleDeleteParagraph(confirmDeleteIndex)
              }
              setConfirmDeleteIndex(null)
            }}
          >
            {t('evidenceSetDetail.deleteParagraphConfirm.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

// ===== 配对卡片：note (主) + 论文 (轻) 在同一边框内 =====

interface PairedCardProps {
  note: string | null
  /** 该卡对应的 paragraph 槽位（paper 序列里的 i 或 trailing orphan 的 idx）。null 仅在 paper=null 的孤儿场景出现 */
  paragraphIndex: number | null
  paper: Paper | null
  /** evidence_ref.createdAt（毫秒）—— 用作"这条记录加入的时间" */
  joinedAt: number | null
  isCurrent: boolean
  /** 选中态：父匹配 selectedRefId === 该 paper 的 refRow.ref.id 时为 true，加 ring */
  isSelected: boolean
  /** 该 paper 无可预览 PDF（Zotero 已移除 / 无附件）→ paper 段落显示禁用态，点击 toast 提示 */
  noPdf: boolean
  /** 列表层共享的"当前正在编辑的 paragraphIndex"；null = 全列表无人编辑 */
  editingIndex: number | null
  onEnterEdit: (paragraphIndex: number) => void
  onExitEdit: () => void
  onSaveNote: (paragraphIndex: number, newText: string) => Promise<void>
  onDeleteNote: (paragraphIndex: number) => void
  /** 传入即让 PaperSection 可点击；no-op 时为 undefined（纯展示） */
  onPaperClick?: () => void
  editLabel: string
  deleteLabel: string
  saveLabel: string
  cancelLabel: string
  joinedAtLabel: string
  currentBadge: string
}

function PairedCard({
  note,
  paragraphIndex,
  paper,
  joinedAt,
  isCurrent,
  isSelected,
  noPdf,
  editingIndex,
  onEnterEdit,
  onExitEdit,
  onSaveNote,
  onDeleteNote,
  onPaperClick,
  editLabel,
  deleteLabel,
  saveLabel,
  cancelLabel,
  joinedAtLabel,
  currentBadge,
}: PairedCardProps): React.ReactElement {
  const hasNote = note != null
  // editing 自己：已有段落处于编辑态
  const isEditingSelf = paragraphIndex != null && editingIndex === paragraphIndex
  // 列表里别人在编辑 → 自己的 ✎/🗑 锁住，强制先完成当前编辑
  const lockedByOther = editingIndex !== null && !isEditingSelf
  // 顶部区域：仅"已有段落"时显示 note section；否则整卡只有 PaperSection（不再提供"添加说明"入口）
  const showNoteSection = hasNote
  const hasTopArea = showNoteSection
  return (
    <div
      className={cn(
        'group/card rounded-md border bg-card shadow-sm overflow-hidden transition-colors',
        // 选中态：用 foreground/25 一根细线，不加 ring 光晕——避免边框"太黑"
        isSelected ? 'border-foreground/25' : 'border-border',
      )}
    >
      {showNoteSection && paragraphIndex != null && (
        <NoteSection
          text={note ?? ''}
          paragraphIndex={paragraphIndex}
          joinedAt={joinedAt}
          editing={isEditingSelf}
          locked={lockedByOther}
          onEnterEdit={onEnterEdit}
          onExitEdit={onExitEdit}
          onSave={onSaveNote}
          onDelete={onDeleteNote}
          editLabel={editLabel}
          deleteLabel={deleteLabel}
          saveLabel={saveLabel}
          cancelLabel={cancelLabel}
          joinedAtLabel={joinedAtLabel}
        />
      )}
      {/* Note ↔ Paper 之间的分隔线：mx-3.5 与上下 section 的水平 padding 对齐，
          视觉上左右保留与内容一致的 14px 间隙，而非拉满卡片宽 */}
      {hasTopArea && paper && <div aria-hidden className="mx-3.5 h-px bg-border/60" />}
      {paper && (
        <PaperSection
          paper={paper}
          isCurrent={isCurrent}
          noPdf={noPdf}
          currentBadge={currentBadge}
          variant={hasNote ? 'paired' : 'standalone'}
          onClick={onPaperClick}
        />
      )}
    </div>
  )
}

// ===== Note section（卡片上半，主） =====

interface NoteSectionProps {
  text: string
  paragraphIndex: number
  joinedAt: number | null
  /** 自己是否处于编辑态，由列表层根据 editingIndex === paragraphIndex 算出 */
  editing: boolean
  /** 列表里别人在编辑 → ✎/🗑 disabled。和 editing 互斥（同时只可能一者 true） */
  locked: boolean
  onEnterEdit: (paragraphIndex: number) => void
  onExitEdit: () => void
  onSave: (paragraphIndex: number, newText: string) => Promise<void>
  onDelete: (paragraphIndex: number) => void
  editLabel: string
  deleteLabel: string
  saveLabel: string
  cancelLabel: string
  joinedAtLabel: string
}

function NoteSection({
  text,
  paragraphIndex,
  joinedAt,
  editing,
  locked,
  onEnterEdit,
  onExitEdit,
  onSave,
  onDelete,
  editLabel,
  deleteLabel,
  saveLabel,
  cancelLabel,
  joinedAtLabel,
}: NoteSectionProps): React.ReactElement {
  const [draft, setDraft] = React.useState(text)
  const [busy, setBusy] = React.useState(false)

  // 进入编辑态时同步 draft；退出编辑态时回写 text 作下次 reset 基准。
  React.useEffect(() => {
    if (!editing) setDraft(text)
  }, [text, editing])

  const handleSave = async (): Promise<void> => {
    const trimmed = draft.trim()
    if (trimmed.length === 0 || trimmed === text.trim()) {
      onExitEdit()
      setDraft(text)
      return
    }
    setBusy(true)
    try {
      await onSave(paragraphIndex, trimmed)
      onExitEdit()
    } catch {
      // toast 由父出，保持编辑态让用户重试
    } finally {
      setBusy(false)
    }
  }

  const handleCancel = (): void => {
    onExitEdit()
    setDraft(text)
  }

  const handleDelete = (): void => {
    onDelete(paragraphIndex)
  }

  if (editing) {
    // 浅底面板里嵌一个圆角边框容器：textarea 在上、按钮行在下，共享同一个边框。
    // textarea 自身无 border，focus-within 让外层容器边框响应聚焦——视觉上 取消/保存
    // 像是 input 内嵌的 toolbar，而不是独立的下一行控件。
    return (
      <div className="px-3 py-3 bg-muted/15">
        <div
          className={cn(
            'rounded-md border border-border bg-background transition-colors',
            'focus-within:border-foreground/40',
          )}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            rows={Math.max(3, draft.split('\n').length)}
            className={cn(
              'w-full bg-transparent px-3 py-2.5 text-sm leading-relaxed',
              'placeholder:text-muted-foreground resize-none',
              'focus:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
            disabled={busy}
          />
          <div className="flex items-center justify-end gap-2 px-2 pb-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleCancel}
              disabled={busy}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={busy || draft.trim().length === 0}
            >
              {saveLabel}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group relative px-3.5 py-3">
      <p className="text-sm whitespace-pre-wrap text-foreground leading-relaxed pr-14">
        {text}
      </p>
      {joinedAt != null && joinedAtLabel && (
        <div className="mt-2 text-sm leading-none text-muted-foreground/75 tabular-nums">
          {joinedAtLabel}
        </div>
      )}
      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 text-muted-foreground hover:text-foreground hover:bg-accent/50 [&_svg]:size-3 disabled:opacity-40"
          onClick={() => onEnterEdit(paragraphIndex)}
          disabled={busy || locked}
          aria-label={editLabel}
          title={editLabel}
        >
          <Pencil aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 [&_svg]:size-3 disabled:opacity-40"
          onClick={handleDelete}
          disabled={busy || locked}
          aria-label={deleteLabel}
          title={deleteLabel}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </div>
  )
}

// ===== Paper section（卡片下半，轻） =====

interface PaperSectionProps {
  paper: Paper
  isCurrent: boolean
  /** 无可预览 PDF → 整段以禁用观感（降透明度）呈现，但仍可点（cursor-pointer，点击 toast 提示） */
  noPdf: boolean
  currentBadge: string
  variant: 'paired' | 'standalone'
  /** 传入即让整个 section 变为 clickable button，触发右栏 PDF preview；undefined → 纯展示 */
  onClick?: () => void
}

function PaperSection({
  paper,
  isCurrent,
  noPdf,
  currentBadge,
  variant,
  onClick,
}: PaperSectionProps): React.ReactElement {
  const meta = [paper.venue, paper.year ? String(paper.year) : null]
    .filter(Boolean)
    .join(' · ')
  // 可点击态：button 语义（键盘可达、焦点环可控）。视觉上不加 hover 灰底，
  // 通过 title 颜色 灰→黑 表达 hover 反馈（含蓄符合 Codex 风）。
  // group/paper-row 命名空间隔离，避免和卡片其它 group hover 串扰。
  const titleClass = cn(
    'text-sm font-medium line-clamp-2 leading-snug transition-colors',
    noPdf && 'text-muted-foreground/55',
    !noPdf && onClick &&
      'text-muted-foreground group-hover/paper-row:text-foreground group-focus-visible/paper-row:text-foreground',
    !noPdf && !onClick && 'text-foreground',
  )
  const content = (
    <>
      <FileText
        className={cn(
          'size-3.5 mt-[2px] shrink-0',
          noPdf ? 'text-muted-foreground/40' : 'text-muted-foreground/70',
        )}
        aria-hidden
      />
      <div className="flex-1 min-w-0 text-left">
        <div className={titleClass}>{sanitizeText(paper.title)}</div>
        {(meta || isCurrent) && (
          <div className="mt-1 flex min-w-0 items-center gap-2">
            {meta && (
              <span className="min-w-0 truncate text-sm leading-none text-muted-foreground">
                {meta}
              </span>
            )}
            {isCurrent && (
              <span className="shrink-0 inline-flex items-center rounded-md bg-muted/60 px-1.5 py-0.5 text-badge leading-none text-muted-foreground">
                {currentBadge}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-variant={variant}
        aria-disabled={noPdf || undefined}
        className={cn(
          'group/paper-row w-full flex items-start gap-2 px-3.5 py-3 text-left',
          'focus-visible:outline-none',
          // 禁用观感但仍可点：保留 cursor-pointer，点击 toast 提示无 PDF
          noPdf && 'cursor-pointer opacity-70',
        )}
      >
        {content}
      </button>
    )
  }
  return (
    // 不再用内嵌灰底块 —— flat 在父卡片里，padding 跟 note section 对齐；
    // Note ↔ Paper 分隔线由父级 PairedCard 渲染（mx-3.5 hairline，左右与内容对齐），
    // 本组件不再画 border-t（避免和父级 hairline 双线）
    <div
      className={cn('flex items-start gap-2 px-3.5 py-3')}
      data-variant={variant}
    >
      {content}
    </div>
  )
}
