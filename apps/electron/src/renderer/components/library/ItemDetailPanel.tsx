/**
 * ItemDetailPanel - 文献库右栏
 *
 * 视觉对齐 PaperDetailRenderer：title → 紧凑 authors/year slim → 操作按钮行
 * → Abstract → 元信息 grid → Tags。
 * 数据源：Zotero ItemDetail（不含 citations / 检索 provenance）。
 */

import * as React from 'react'
import { MAX_AUTHORS_FULL, sanitizeText } from '@asci/shared'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  Loader2,
  FileText,
  ExternalLink,
  Share2,
  Plus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  librarySelectedItemKeyAtom,
  libraryItemDetailAtom,
  libraryLoadingDetailAtom,
} from '@/atoms/library-atoms'
import { Button } from '@/components/ui/button'
import { useOpenCitationGraph } from '@/components/citation-graph/useOpenCitationGraph'
import { useT } from '@/hooks/useT'
import { refreshPaperContainingSetsAtom } from '@/atoms/session-evidence-atoms'
import type { CachedPaperMeta } from '@asci/core/zotero'
import { AddToEvidenceSetDialog } from './dialogs/AddToEvidenceSetDialog'
import { DeletedSourcePlaceholder } from './DeletedSourcePlaceholder'
import { EvidenceSetDetailSheet } from './EvidenceSetDetailSheet'
import { PaperContainingEvidenceSetsPanel } from './PaperContainingEvidenceSetsPanel'
import {
  FloatingNoteButton,
  PendingNoteEditor,
  useDetailSelection,
  type RuntimeNote,
  type PendingDraft,
} from './PaperNotesPanel'
import {
  activeEvidenceHighlightAtom,
  composeBody,
  paperNotesAtom,
  pendingEvidenceScrollAtom,
  pendingQuoteScrollAtom,
} from '@/atoms/notes-atoms'
import { usePaperNotes } from '@/hooks/usePaperNotes'
import { NoteDetailDialog } from './NoteDetailDialog'
import { PaperPdfReader, resolvePendingScroll } from './PaperPdfReader'

// ===== 证据链 / 笔记 Tab 组 =====
// EvidenceRef / Note 的真实数据源待综述 hook + 对象模型落地（north-star 0.2 P0）。
// EvidenceTab 类型 + activeEvidenceTabAtom 已提到 atoms/notes-atoms.ts,
// 让 NotesView 跨视图入口可以直接指定落在哪个 tab。

export function ItemDetailPanel(): React.ReactElement {
  const { t } = useT('library')
  const selectedKey = useAtomValue(librarySelectedItemKeyAtom)
  const [detail, setDetail] = useAtom(libraryItemDetailAtom)
  const [loading, setLoading] = useAtom(libraryLoadingDetailAtom)
  const openGraph = useOpenCitationGraph()
  // PDF 预览：附件探测结果由 PaperPdfReader 内部完成，这里只关心"是否找到"
  // 以决定走 PDF 分支还是 abstract 兜底分支
  const [pdfFound, setPdfFound] = React.useState<boolean | null>(null)
  // issue #462：Zotero 源已删除态。undefined = 非删除态；null = 已删但无本地缓存元数据；
  // CachedPaperMeta = 已删且有缓存。非 undefined 时渲染 DeletedSourcePlaceholder。
  const [deletedMeta, setDeletedMeta] = React.useState<CachedPaperMeta | null | undefined>(undefined)
  const [paperNotes, setPaperNotes] = useAtom(paperNotesAtom)
  // 文献笔记 IPC hook（监听 selectedKey 自动拉列表 + 暴露 createNote / updateBody / deleteNote）
  const { createNote: createPaperNote, updateBody: updatePaperNoteBody, deleteNote: deletePaperNote } = usePaperNotes()
  // 跨视图跳转后的待滚动信号：NotesView → 此 atom → PdfRenderer 找页+滚动 → 清空
  const [pendingQuoteScroll, setPendingQuoteScroll] = useAtom(pendingQuoteScrollAtom)
  const [pendingEvidenceScroll, setPendingEvidenceScroll] = useAtom(pendingEvidenceScrollAtom)
  // 持续高亮（与信号 atom 分离，scroll 完不清；切论文时通过 paperKey 比对自然失效）
  const activeEvidenceHighlight = useAtomValue(activeEvidenceHighlightAtom)
  // CITED BY 区刷新信号：Add to evidence set 成功后写一次即可
  const refreshContainingSets = useSetAtom(refreshPaperContainingSetsAtom)
  const [addToEvidenceSetOpen, setAddToEvidenceSetOpen] = React.useState(false)
  // PDF "全屏" 展开状态：由顶部"打开 PDF"徽章按钮触发，下放给 PaperPdfReader 做受控状态。
  // PaperPdfReader 内部仍负责 Esc / 关闭按钮 / 背景遮罩 click，触发 onExpandedChange 回写本 atom。
  const [pdfExpanded, setPdfExpanded] = React.useState(false)
  // 「添加笔记」按钮 + PDF/摘要划词流共用的 pending：
  //   - 顶部 Add note 按钮触发 → rect=null，PendingNoteEditor 渲染为 inline
  //   - 划词浮按钮触发 → rect=DOMRect，PendingNoteEditor 渲染为 portal 浮层
  const [blankPending, setBlankPending] = React.useState<PendingDraft | null>(null)
  // 划词流：监听摘要 ([data-note-source]) + PDF textLayer 内的选区,排除标题/作者/徽章
  const { anchor: selectionAnchor, clear: clearSelection } = useDetailSelection()
  // NoteDetailDialog 当前打开的笔记（PDF 高亮点击触发；底部已无 Notes 列表）
  const [openedNote, setOpenedNote] = React.useState<RuntimeNote | null>(null)
  // 给 PdfRenderer 的 quote 高亮列表：只挑有 quote 的笔记，按 id+quote 同一性 memo,
  // 避免每次父组件 re-render 都让 PdfRenderer 的 useEffect 依赖变化重渲染 textLayer
  //
  // 综述引文流：
  //   - activeEvidenceHighlight（持续高亮 atom，绑 paperKey）作为黄色高亮的真相源
  //   - pendingEvidenceScroll（信号 atom）只用作 PdfRenderer 的 scroll 触发，scroll 完
  //     onScrollComplete 清空，**不**影响 quoteHighlights 列表
  //   两者 traceId 同步；scroll 信号清后高亮仍在，避免"闪一下就消失"。
  //   paperKey !== selectedKey 时持续高亮被丢弃，无需清空 effect。
  const evidenceForCurrentPaper =
    activeEvidenceHighlight && activeEvidenceHighlight.paperKey === selectedKey
      ? activeEvidenceHighlight
      : null
  const evidenceHighlightId = evidenceForCurrentPaper
    ? `evidence:${evidenceForCurrentPaper.traceId}`
    : null
  const pdfQuoteHighlights = React.useMemo(() => {
    const fromNotes = paperNotes
      .filter((n): n is RuntimeNote & { quote: string } => Boolean(n.quote))
      .map((n) => ({ id: n.id, quote: n.quote, content: n.content, page: n.page }))
    if (evidenceForCurrentPaper && evidenceHighlightId) {
      return [
        ...fromNotes,
        { id: evidenceHighlightId, quote: evidenceForCurrentPaper.quote },
      ]
    }
    return fromNotes
  }, [paperNotes, evidenceForCurrentPaper, evidenceHighlightId])
  const handlePdfQuoteHighlightClick = React.useCallback((noteId: string): void => {
    const note = paperNotes.find((n) => n.id === noteId)
    if (note) setOpenedNote(note)
  }, [paperNotes])

  React.useEffect(() => {
    setPdfFound(null) // 切论文时重置附件命中状态，等 PaperPdfReader 重新探测后回写
    setDeletedMeta(undefined) // 切论文时重置"源已删除"态（issue #462）
    if (!selectedKey) {
      setDetail(null)
      return
    }
    let cancelled = false
    const load = async (): Promise<void> => {
      setLoading(true)
      try {
        // issue #462：getItem 返回判别联合 —— 区分 ok / deleted（Zotero 404）/ error。
        const result = await window.electronAPI.zotero.library.getItem({ itemKey: selectedKey })
        if (cancelled) return
        if (result.status === 'ok') {
          setDetail(result.detail)
          setDeletedMeta(undefined)
        } else if (result.status === 'deleted') {
          // 源已删除：渲染降级占位（带本地缓存元数据），不再走空白 / loadFailed
          setDetail(null)
          setDeletedMeta(result.cachedMeta)
        } else {
          // 其它故障（Zotero 没在跑 / 端口冲突等）：保留原"加载失败请重试"语义
          setDetail(null)
          setDeletedMeta(undefined)
        }
      } catch (err) {
        // getItem 现已不 throw（兜底防御）
        if (cancelled) return
        console.error('[文献库] 加载详情失败:', err)
        setDetail(null)
        setDeletedMeta(undefined)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [selectedKey, setDetail, setLoading])

  if (!selectedKey) {
    return (
      <EmptyState
        icon={<FileText size={36} strokeWidth={1.5} />}
        text={t('detail.emptySelect')}
      />
    )
  }

  if (loading && !detail) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" size={22} />
      </div>
    )
  }

  // issue #462：Zotero 源已删除 → 渲染降级占位（缓存元数据 + 源已删除提示 + 降级动作）
  if (deletedMeta !== undefined) {
    return <DeletedSourcePlaceholder cachedMeta={deletedMeta} />
  }

  if (!detail) {
    return (
      <EmptyState
        icon={<FileText size={36} strokeWidth={1.5} />}
        text={t('detail.loadFailed')}
      />
    )
  }

  const canOpenGraph = Boolean(detail.doi) || Boolean(detail.title)

  const handleOpenGraph = (): void => {
    if (!canOpenGraph) return
    openGraph({
      seed: { doi: detail.doi || null, title: detail.title || null },
      seedTitleHint: detail.title || null,
    })
  }

  const openExternal = (url: string): void => {
    window.electronAPI.openExternal(url).catch(console.error)
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-3 scrollbar-thin">
      {/* 论文详情主体 —— note 卡片 / tab 区放在外面,避免选中卡片自身被划词流捕获 */}
      <div className="space-y-3">
      {/* 顶部元信息：arXiv/DOI/URL 徽章 + 日期 · venue · 类型（对齐原型 P3）。
          PDF 全屏入口由下方 PaperPdfReader 预览框右上角的 Maximize 图标承担，
          这里不再重复"打开 PDF" 徽章按钮，避免功能冗余。 */}
      <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground titlebar-drag-region">
        {detail.arxivId ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => detail.arxivId && openExternal(`https://arxiv.org/abs/${detail.arxivId}`)}
            title={t('detail.header.arxivBadgeTooltip')}
            className={cn(
              'h-auto gap-1.5 px-2 py-1 rounded-md text-sm titlebar-no-drag',
              'bg-muted/60 hover:bg-muted text-foreground/80 hover:text-foreground/80 [&_svg]:size-3',
            )}
          >
            <ExternalLink className="size-3" />
            arXiv:{detail.arxivId}
          </Button>
        ) : detail.doi ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => detail.doi && openExternal(`https://doi.org/${detail.doi}`)}
            title={t('detail.header.doiBadgeTooltip')}
            className={cn(
              'h-auto gap-1.5 px-2 py-1 rounded-md text-sm titlebar-no-drag',
              'bg-muted/60 hover:bg-muted text-foreground/80 hover:text-foreground/80 [&_svg]:size-3',
            )}
          >
            <ExternalLink className="size-3" />
            <span className="truncate max-w-[200px]">DOI:{detail.doi}</span>
          </Button>
        ) : detail.url ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => detail.url && openExternal(detail.url)}
            title={t('detail.header.urlBadgeTooltip')}
            className={cn(
              'h-auto gap-1.5 px-2 py-1 rounded-md text-sm titlebar-no-drag',
              'bg-muted/60 hover:bg-muted text-foreground/80 hover:text-foreground/80 [&_svg]:size-3',
            )}
          >
            <ExternalLink className="size-3" />
            {t('detail.header.urlBadgeLabel')}
          </Button>
        ) : null}
        {(detail.date || detail.venue || detail.itemType) && (
          <span className="tabular-nums">
            {[detail.date, detail.venue, detail.itemType].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>

      {/* 标题 — 与原型一致：大字号 / 半粗 / 紧字距 */}
      <h2 className="text-xl font-semibold leading-snug text-foreground tracking-tight">{sanitizeText(detail.title)}</h2>

      {/* 作者 */}
      {detail.creators.length > 0 && (
        <div className="text-sm text-muted-foreground leading-relaxed">
          {detail.creators.slice(0, MAX_AUTHORS_FULL).join(', ')}{detail.creators.length > MAX_AUTHORS_FULL ? ' et al.' : ''}
        </div>
      )}

      {/* 摘要 / 内嵌 PDF — 紧贴作者，无 section header（按原型 P3）
          统一通过 PaperPdfReader 共享组件：探测附件 + 渲染 + 展开浮层均下放给它。
          未找到 PDF 时由 onAttachmentResolved 回写 pdfFound=false，本组件展示 abstract 兜底。 */}
      <PaperPdfReader
        zoteroKey={selectedKey}
        extraHighlights={pdfQuoteHighlights}
        pendingScroll={resolvePendingScroll(
          pendingQuoteScroll,
          pendingEvidenceScroll,
          pdfQuoteHighlights,
        )}
        onScrollComplete={() => {
          setPendingQuoteScroll(null)
          setPendingEvidenceScroll(null)
        }}
        onHighlightClick={handlePdfQuoteHighlightClick}
        expanded={pdfExpanded}
        onExpandedChange={setPdfExpanded}
        onAttachmentResolved={setPdfFound}
        renderMissing={() =>
          detail.abstract ? (
            <div data-note-source className="text-sm leading-relaxed text-foreground/85 whitespace-pre-wrap">
              {/* 摘要先 sanitizeText（剥 JATS / HTML 标签、解实体、去不可见符）再传入高亮渲染。
                  清洗后的文本既是渲染文本，也是 quote indexOf 匹配的基准，偏移自洽（quote
                  来自用户在已渲染=已清洗摘要上的划选）。 */}
              {renderAbstractWithHighlights(
                sanitizeText(detail.abstract),
                paperNotes,
                null,
                setOpenedNote,
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground/60">
              {t('detail.section.abstractUnavailable')}
            </div>
          )
        }
      />

      {/* 操作按钮行：添加证据集 / 引用图谱 / DOI —— 紧贴简介，作为简介的一部分。
          "添加证据集" 合并了原"添加笔记"+"加入证据集"两个入口；点击弹 dialog，
          内含"加入已有 / 新建命名集合"两个 tab。底层 4 步事务一致：
          note + evidence_set(1:1) + evidence_ref(paper→set) + set_ref。
          划词浮按钮"记笔记"仍走 inline 编辑器（PendingNoteEditor），与本按钮并存。 */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          size="sm"
          variant="default"
          className="gap-1.5"
          onClick={() => setAddToEvidenceSetOpen(true)}
        >
          <Plus className="!size-3.5" />
          {t('detail.evidence.actions.addEvidenceSet')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleOpenGraph}
          disabled={!canOpenGraph}
          title={canOpenGraph ? t('detail.openGraphTooltip') : t('detail.openGraphDisabledTooltip')}
          className="gap-1.5"
        >
          <Share2 className="!size-3.5" />
          {t('detail.openGraph')}
        </Button>
        {/* "在浏览器打开 DOI" 入口由顶部 DOI 徽章承担（位置即视觉，点击同样跳 https://doi.org/...），
            这里不再重复一个 outline 按钮，避免与顶部徽章功能冗余。 */}
      </div>
      </div>

      {/* 「添加笔记」inline 编辑器:渲染在主内容容器 **外** —
          否则用户在 textarea 里选词会被 useDetailSelection 误捕获、触发划词浮按钮
          (虽然现在白名单到 [data-note-source]/.textLayer,留在内层仍易被未来 marker 误命中)。
          位置紧贴按钮行下方,铺满卡片宽度;保存追加到 paperNotes atom,取消清空。
          rect 为 null 才走 inline；划词流的 pending 带 rect，由下方 portal 编辑器处理。 */}
      {blankPending && !blankPending.rect && (
        <PendingNoteEditor
          mode="inline"
          draft={blankPending}
          onChange={setBlankPending}
          onSave={() => {
            const content = blankPending.content.trim()
            if (!content) return
            // 通过 hook 走 IPC 持久化：每条 paper note 在主进程自动建一个
            // 1:1 绑定的 persisted=false 临时 evidence_set，所以保存后该 set 会
            // 出现在 CITED BY 区（手动 refresh 触发重拉）。
            void createPaperNote({
              content,
              // 空白笔记快捷流无 quote
            }).then(() => refreshContainingSets())
            setBlankPending(null)
          }}
          onCancel={() => setBlankPending(null)}
        />
      )}

      {/* ===== CITED BY 区（无 Notes 区，paper 详情面板底部只列证据集）===== */}
      <div className="pt-4 mt-2 border-t border-border">
        <PaperContainingEvidenceSetsPanel />
      </div>
      <AddToEvidenceSetDialog
        open={addToEvidenceSetOpen}
        paperKey={detail.key}
        paperTitle={detail.title}
        onOpenChange={setAddToEvidenceSetOpen}
        onSuccess={() => refreshContainingSets()}
      />
      {/* NoteDetailDialog：摘要高亮点击 + notes 列表 NoteCard 点击共用此实例。
          B3/B4 后：body 走 IPC updateBody（纯用户备注，不再混 quote）；softDelete 走 IPC；
          已无 kind / hypothesisStatus 概念。 */}
      <NoteDetailDialog
        note={openedNote}
        open={openedNote !== null}
        onOpenChange={(o) => { if (!o) setOpenedNote(null) }}
        onUpdate={(id, patch) => {
          // 本地乐观更新（kind / status 仅本地，body 走下面的 IPC 持久化）
          setPaperNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)))
          setOpenedNote((curr) => (curr && curr.id === id ? { ...curr, ...patch } : curr))
          // body 改动持久化：拼回 markdown body（保留可能存在的 quote 段）后调 IPC
          if (patch.content !== undefined || patch.quote !== undefined) {
            const merged = openedNote ? { ...openedNote, ...patch } : patch
            void updatePaperNoteBody(id, composeBody(merged.quote, merged.content ?? ''))
          }
        }}
        onDelete={(id) => {
          void deletePaperNote(id)
          setOpenedNote(null)
        }}
      />
      {/* 划词浮按钮（PDF textLayer / 摘要划词共用）—— 选区有效且未进入编辑态时浮出 */}
      {selectionAnchor && !blankPending && (
        <FloatingNoteButton
          rect={selectionAnchor.rect}
          label={t('notes.selection.button')}
          onClick={() => {
            setBlankPending({
              quote: selectionAnchor.quote,
              rect: selectionAnchor.rect,
              content: '',
              insidePdfExpanded: selectionAnchor.insidePdfExpanded,
              pdfPage: selectionAnchor.pdfPage,
            })
            clearSelection()
          }}
        />
      )}
      {/* 划词流编辑器：rect 非 null → portal 浮层（锚定选区下方）；
          顶部 Add note 按钮触发的 inline 编辑器在按钮行下方独立渲染，rect=null */}
      {blankPending && blankPending.rect && (
        <PendingNoteEditor
          mode="portal"
          draft={blankPending}
          onChange={setBlankPending}
          onSave={() => {
            const content = blankPending.content.trim()
            if (!content) return
            void createPaperNote({
              content,
              quote: blankPending.quote || undefined,
              pdfPage: blankPending.pdfPage,
            }).then(() => refreshContainingSets())
            setBlankPending(null)
          }}
          onCancel={() => setBlankPending(null)}
        />
      )}
      {/* 证据集详情抽屉:多入口共用,atom 驱动,只在视图根挂一次 */}
      <EvidenceSetDetailSheet />
    </div>
  )
}

// ===== 摘要 quote 高亮 =====

/**
 * Span 包含来源:note 非 null 表示已保存的笔记(可点击打开 dialog);null 表示编辑中的 pending(不可点击)。
 */
interface HighlightSpan {
  start: number
  end: number
  note: RuntimeNote | null
}

/**
 * 在文本中按 quote 字符串首次出现位置标记 spans,重叠区段按文档顺序保留先到的。
 *
 * 简化版:每个 quote 只匹配首次出现;不支持跨段落或部分匹配;不区分大小写选项暂不需要(quote 来自原文片段,大小写一致)。
 */
function buildHighlightSpans(
  text: string,
  savedNotes: RuntimeNote[],
  pendingQuote: string | null,
): HighlightSpan[] {
  const found: HighlightSpan[] = []
  for (const note of savedNotes) {
    const q = note.quote
    if (!q) continue
    const start = text.indexOf(q)
    if (start === -1) continue
    found.push({ start, end: start + q.length, note })
  }
  if (pendingQuote) {
    const start = text.indexOf(pendingQuote)
    if (start !== -1) {
      found.push({ start, end: start + pendingQuote.length, note: null })
    }
  }
  // 按起点排序,重叠取先到
  found.sort((a, b) => a.start - b.start)
  const result: HighlightSpan[] = []
  let lastEnd = -1
  for (const s of found) {
    if (s.start >= lastEnd) {
      result.push(s)
      lastEnd = s.end
    }
  }
  return result
}

/**
 * 渲染摘要,在已记录 quote / pending quote 的区段外包 `<mark>`。
 * 已保存笔记的 mark 可点击(打开 NoteDetailDialog);pending(编辑中)的 mark 不可点击。
 * 无任何 quote 命中时退化为原始字符串(保持 whitespace-pre-wrap)。
 */
function renderAbstractWithHighlights(
  text: string,
  savedNotes: RuntimeNote[],
  pendingQuote: string | null,
  onClickNote: (note: RuntimeNote) => void,
): React.ReactNode {
  const spans = buildHighlightSpans(text, savedNotes, pendingQuote)
  if (spans.length === 0) return text
  const out: React.ReactNode[] = []
  let cursor = 0
  spans.forEach((s, i) => {
    if (cursor < s.start) out.push(text.slice(cursor, s.start))
    if (s.note !== null) {
      const note = s.note
      out.push(
        <mark
          key={`hl-${i}-${s.start}`}
          className="bg-search-hit-bg rounded-sm px-0.5 text-inherit cursor-pointer hover:bg-search-hit-bg/80 transition-colors"
          onClick={() => onClickNote(note)}
          title={truncateForTitle(note.content, 80)}
        >
          {text.slice(s.start, s.end)}
        </mark>
      )
    } else {
      out.push(
        <mark
          key={`hl-pending-${s.start}`}
          className="bg-search-hit-bg rounded-sm px-0.5 text-inherit"
        >
          {text.slice(s.start, s.end)}
        </mark>
      )
    }
    cursor = s.end
  })
  if (cursor < text.length) out.push(text.slice(cursor))
  return out
}

function truncateForTitle(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max).trimEnd() + '…'
}

// ===== 子组件 =====

interface EmptyStateProps {
  icon: React.ReactNode
  text: string
}

function EmptyState({ icon, text }: EmptyStateProps): React.ReactElement {
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
      <div className={cn('text-muted-foreground/40')}>{icon}</div>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}
