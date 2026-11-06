/**
 * NotesView —— 全局「证据集」视图（#709 主题容器化）
 *
 * UI 文案对外是 "Evidence Sets / 证据集"，代码保留 `NotesView` 命名 + 路由值 `'notes'`
 * 不动（避免改 atom/router 连锁）。
 *
 * v0.4 主题容器化（ADR-007 / #709）：从 note-centric（1 笔记=1 行）反转为
 * container-centric（1 容器=1 行）。
 *
 * 布局：左 380px 列表（搜索 + tag 筛选条 + 容器卡）+ 右 flex-1 详情。
 *
 * 数据：
 * - 中间列：IPC `evidenceSets.listSummary()` → `EvidenceSetSummary[]`（每行一个容器，
 *   含 name / noteCount / paperCount / tags / createdAt）。tag 候选 + 筛选在客户端做
 *   （union 已加载 summaries 的 tags；多选 OR）。
 * - 右侧详情：选中容器后调 `evidenceSets.getDetail({ id })` 获完整 `EvidenceSetDetail`，
 *   渲染共享的 SetHeader（名/rename/tag）+ EvidenceSetMembers（笔记区/证据区）。
 * - 增删走 EvidenceSetMembers / SetHeader 内的新 IPC（addNote/removeNote/removeEvidence/
 *   setTags），变更后 re-fetch detail；左列表计数同步刷新。
 *
 * 见 docs/specs/0.4.0/evidence-set-notes-spec.md
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { HelpCircle, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { nowMs, nowIso, sanitizeText } from '@asci/shared'
import { dayjs } from '@/utils/dayjs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/hooks/useT'
import { useConceptSpotlight } from '@/hooks/useConceptSpotlight'
import { spotlightActiveAtom } from '@/atoms/onboarding-spotlight-atoms'
import { currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { pendingNotesViewSelectionAtom } from '@/atoms/notes-atoms'
import {
  notesListWidthAtom,
  clampWidth,
  NOTES_LIST_MIN,
  NOTES_LIST_MAX,
} from '@/atoms/notes-layout'
import { ColumnResizer } from './ColumnResizer'
import { SetHeader } from './evidence-set-detail/SetHeader'
import { EvidenceSetMembers } from './evidence-set-detail/EvidenceSetMembers'
import { PaperPdfReader } from './PaperPdfReader'
import { FilePreviewOverlay, type FilePreviewTarget } from '../preview/FilePreviewOverlay'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { PreviewErrorBoundary } from '../preview/PreviewErrorBoundary'
import type {
  EvidenceRefWithSource,
  EvidenceSetDetail,
  EvidenceSetSummary,
  ObjectId,
  PaperRecord,
  Review,
} from '@asci/shared'

// 摘要卡片渲染器较重，与 InlinePreview 一致 lazy 引入。
const PaperDetailRenderer = React.lazy(() => import('../preview/renderers/PaperDetailRenderer'))

/** 点 paper 证据「跳到原文」打开的 PDF 全屏目标 */
interface PdfTarget {
  paperKey: string
  /** 一次性滚动锚点引文（anchor.snapshotText 派生 quote） */
  quote?: string
  /** 与 quote 配对的稳定 id；切换 cite 时变化触发重定位 */
  traceId?: string
}

export function NotesView(): React.ReactElement {
  const { t } = useT('library')
  const { t: tOn } = useT('onboarding')
  const {
    tourState: evidenceSetTourState,
    restart: restartEvidenceSetTour,
    start: startEvidenceSetTour,
  } = useConceptSpotlight('evidenceSet')
  const spotlightActive = useAtomValue(spotlightActiveAtom)

  // issue #457：按当前 workspace scope；workspace 切换重新拉取。
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const [summaries, setSummaries] = React.useState<EvidenceSetSummary[]>([])
  const [selectedId, setSelectedId] = React.useState<ObjectId | null>(null)
  const [query, setQuery] = React.useState('')
  // tag 筛选：多选 OR；空 = 不过滤
  const [selectedTags, setSelectedTags] = React.useState<string[]>([])
  const [listWidth, setListWidth] = useAtom(notesListWidthAtom)
  // 跨视图跳转信号：Library CITED BY 行点击 → 切到本视图自动选中对应容器
  const [pendingSelection, setPendingSelection] = useAtom(pendingNotesViewSelectionAtom)

  // 列表刷新触发器：详情内增删后 +1，让左栏计数/标签同步
  const [refreshTick, setRefreshTick] = React.useState(0)
  const refreshList = React.useCallback(() => setRefreshTick((n) => n + 1), [])

  React.useEffect(() => {
    if (!currentWorkspaceId) {
      setSummaries([])
      return
    }
    let cancelled = false
    window.electronAPI.evidenceSets
      // persistedOnly=false：连同划词 / Agent 临时集（单成员容器）一并展示，与容器化前可见性一致
      .listSummary({ workspaceId: currentWorkspaceId, persistedOnly: false })
      .then((rows) => {
        if (!cancelled) setSummaries(rows)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error('[notes-view] listSummary failed:', err)
          setSummaries([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [currentWorkspaceId, refreshTick])

  // 消费跨视图跳转信号
  React.useEffect(() => {
    if (!pendingSelection || summaries.length === 0) return
    const match = summaries.find((s) => s.id === pendingSelection.evidenceSetId)
    if (match) setSelectedId(match.id)
    setPendingSelection(null)
  }, [summaries, pendingSelection, setPendingSelection])

  // 空列表 + tour 未启过 → auto-start（用 ref 守"只 fire 一次"）
  const autoStartedRef = React.useRef(false)
  React.useEffect(() => {
    if (autoStartedRef.current) return
    if (evidenceSetTourState != null) return
    if (spotlightActive) return
    if (summaries.length > 0) return
    const timer = window.setTimeout(() => {
      if (autoStartedRef.current) return
      if (evidenceSetTourState != null) return
      if (spotlightActive) return
      if (summaries.length > 0) return
      autoStartedRef.current = true
      void startEvidenceSetTour()
    }, 200)
    return () => window.clearTimeout(timer)
  }, [evidenceSetTourState, spotlightActive, summaries.length, startEvidenceSetTour])

  // tag 候选：所有容器 tags 的并集（字典序）
  const allTags = React.useMemo(() => {
    const set = new Set<string>()
    for (const s of summaries) for (const tag of s.tags) set.add(tag)
    return [...set].sort()
  }, [summaries])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return summaries.filter((s) => {
      // tag 过滤（OR）
      if (selectedTags.length > 0 && !s.tags.some((tag) => selectedTags.includes(tag))) {
        return false
      }
      if (!q) return true
      return (
        (s.name ?? '').toLowerCase().includes(q) ||
        s.notePreview.toLowerCase().includes(q) ||
        s.tags.some((tag) => tag.toLowerCase().includes(q))
      )
    })
  }, [summaries, query, selectedTags])

  const selected = filtered.find((s) => s.id === selectedId) ?? null

  const toggleTag = (tag: string): void => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* 左栏：列表 + 搜索 + tag 筛选 */}
      <aside
        className="shrink-0 flex flex-col min-h-0 border-r border-border"
        style={{ width: clampWidth(listWidth, NOTES_LIST_MIN, NOTES_LIST_MAX) }}
      >
        <div className="px-3 pt-4 pb-2 space-y-2 titlebar-drag-region">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-base font-semibold text-foreground">{t('notes.view.title')}</div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={tOn('conceptSpotlight.replayTooltip')}
                    onClick={() => { void restartEvidenceSetTour() }}
                    className="text-muted-foreground/60 hover:text-foreground transition-colors titlebar-no-drag"
                  >
                    <HelpCircle className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{tOn('conceptSpotlight.replayTooltip')}</TooltipContent>
              </Tooltip>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground leading-snug">
              <span>{t('notes.view.subtitle')}</span>
              <span className="shrink-0 tabular-nums text-sm">
                {t('notes.view.list.countLabel', { count: filtered.length })}
              </span>
            </div>
          </div>
          {/* 搜索框（titlebar-no-drag：脱离窗口拖拽区，否则点击/输入被吞） */}
          <div className="relative titlebar-no-drag">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('notes.view.searchPlaceholder')}
              className="w-full pl-7 pr-2.5 py-1.5 text-xs rounded-md border-[0.5px] border-border/60 bg-muted/30 placeholder:text-muted-foreground/60 focus:outline-none focus:bg-background focus:border-border transition-colors"
            />
          </div>
          {/* tag 筛选条（多选 OR）—— 仅有标签时显示；titlebar-no-drag 保证 chip 可点 */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5 titlebar-no-drag">
              <span className="w-full text-badge text-muted-foreground/70">
                {t('notes.view.filter.label')}
              </span>
              <button
                type="button"
                onClick={() => setSelectedTags([])}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-badge transition-colors',
                  selectedTags.length === 0
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground/80 hover:bg-accent',
                )}
              >
                {t('notes.view.filter.all')}
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-badge transition-colors',
                    selectedTags.includes(tag)
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground/80 hover:bg-accent',
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* 滚动列表 */}
        <div className="flex-1 min-h-0 overflow-auto px-3 py-1 space-y-2 scrollbar-thin">
          {summaries.length === 0 ? (
            <div className="px-4 py-8 text-xs text-muted-foreground/60 text-center">
              {t('notes.view.emptyAll')}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-xs text-muted-foreground/60 text-center">
              {t('notes.view.emptyFiltered')}
            </div>
          ) : (
            filtered.map((summary) => (
              <ContainerListItem
                key={summary.id}
                summary={summary}
                active={selectedId === summary.id}
                onClick={() => setSelectedId(summary.id)}
              />
            ))
          )}
        </div>
      </aside>

      <ColumnResizer
        width={listWidth}
        min={NOTES_LIST_MIN}
        max={NOTES_LIST_MAX}
        onResize={setListWidth}
        ariaLabel={t('notes.view.title')}
      />

      {/* 右栏：容器详情（SetHeader + 笔记区/证据区） */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {selected ? (
          <ContainerDetailPane key={selected.id} setId={selected.id} onMutated={refreshList} />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground/60 px-6 text-center">
            {t('notes.view.emptySelect')}
          </div>
        )}
      </main>
    </div>
  )
}

// ===== 列表项（容器卡：名 + tag + N 笔记·M 篇·时间） =====

interface ContainerListItemProps {
  summary: EvidenceSetSummary
  active: boolean
  onClick: () => void
}

function ContainerListItem({ summary, active, onClick }: ContainerListItemProps): React.ReactElement {
  const { t } = useT('library')
  const title = summary.name?.trim() || summary.notePreview.trim() || t('notes.view.unlinkedNote')
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group w-full rounded-md border bg-card text-left shadow-sm px-3 py-2.5 transition-colors',
        'hover:bg-muted/35',
        active ? 'border-foreground/30' : 'border-border hover:border-border/80',
      )}
    >
      <div className="truncate text-sm font-semibold leading-snug text-foreground">{title}</div>
      {summary.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {summary.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-secondary px-2 py-0.5 text-badge text-secondary-foreground/80"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="mt-1.5 text-badge text-muted-foreground tabular-nums">
        {t('notes.view.list.meta', { notes: summary.noteCount, papers: summary.paperCount })}
        {' · '}
        {formatRelativeTime(dayjs(summary.createdAt).valueOf(), t)}
      </div>
    </button>
  )
}

// ===== 右栏详情（共享 SetHeader + EvidenceSetMembers） =====

function ContainerDetailPane({
  setId,
  onMutated,
}: {
  setId: ObjectId
  onMutated: () => void
}): React.ReactElement {
  const { t } = useT('library')
  const [detail, setDetail] = React.useState<EvidenceSetDetail | null>(null)
  // 点 paper 证据「跳到原文」→ 全屏 PDF + 滚到 cite（复刻旧 PairedCardsList 行为）
  const [pdfTarget, setPdfTarget] = React.useState<PdfTarget | null>(null)
  // 非 Zotero 论文「跳到原文」→ 全屏摘要卡片覆盖层（无 PDF 可看时的兜底）
  const [paperCardTarget, setPaperCardTarget] = React.useState<PaperRecord | null>(null)
  // 点综述证据「跳到综述」→ 应用内全屏 HTML 预览（复用 preview 渲染器）
  const [reviewPreview, setReviewPreview] = React.useState<FilePreviewTarget | null>(null)
  // 切换容器时关掉残留覆盖层
  React.useEffect(() => {
    setPdfTarget(null)
    setPaperCardTarget(null)
    setReviewPreview(null)
  }, [setId])

  // 有 zoteroKey → 全屏 PDF + 高亮 quote；无 zoteroKey（非 Zotero 论文）→ 用 Paper 本地
  // 字段映射 PaperRecord，兜底打开摘要卡片（OpenAlex metadata：标题/摘要/DOI/Add to Zotero）。
  // 独立 Evidence Sets 视图无 agent session，openInRightPanel 在此为 no-op，故走视图内覆盖层。
  const handleSelectPaperRef = React.useCallback((row: EvidenceRefWithSource) => {
    if (row.sourcePaper.state !== 'present') return
    const paper = row.sourcePaper.ref
    if (paper.zoteroKey) {
      setPdfTarget({ paperKey: paper.zoteroKey, quote: row.quote, traceId: `evidence-ref:${row.ref.id}` })
      return
    }
    setPaperCardTarget({
      ts: nowIso(),
      query: null,
      source: 'evidence-set',
      title: paper.title,
      authors: paper.authors,
      year: paper.year ?? null,
      venue: paper.venue ?? null,
      doi: paper.doi ?? null,
      url: null,
      abstract: paper.abstract ?? null,
    })
  }, [])

  // 综述证据「跳到综述」→ 应用内全屏 HTML 预览（FilePreviewOverlay 复用 preview 渲染器）。
  // 不走 openInRightPanel：那个 hook 需 active agent session 且开到会话右面板，独立的
  // Evidence Sets 视图无 session → no-op。这里在本视图内直接全屏渲染。
  const handleSelectReview = React.useCallback((review: Review) => {
    const path = review.bodyPath
    if (!path) return
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    window.electronAPI
      .statFile(path)
      .then((info) => setReviewPreview({ path, ext, size: info.size }))
      .catch(() => setReviewPreview({ path, ext, size: 0 }))
  }, [])

  React.useEffect(() => {
    setDetail(null)
    let cancelled = false
    window.electronAPI.evidenceSets
      .getDetail({ id: setId })
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error('[notes-view] getDetail failed:', err)
          setDetail(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [setId])

  // 详情内增删（含 SetHeader tag/rename、EvidenceSetMembers 补/删）后刷新本地 detail +
  // 通知左栏刷新计数。
  const handleUpdate = React.useCallback(
    (next: EvidenceSetDetail) => {
      setDetail(next)
      onMutated()
    },
    [onMutated],
  )

  if (!detail) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground/60">
        {t('evidenceSetDetail.loading')}
      </div>
    )
  }

  return (
    <>
      <div className="h-full overflow-auto p-6 space-y-5 scrollbar-thin">
        {/* titlebar-no-drag：SetHeader 含 rename / tag 增删按钮，必须脱离窗口拖拽区才可点 */}
        <div className="titlebar-no-drag">
          <SetHeader detail={detail} onUpdateDetail={handleUpdate} />
        </div>
        <EvidenceSetMembers
          detail={detail}
          onUpdateDetail={handleUpdate}
          onSelectPaperRef={handleSelectPaperRef}
          onSelectReview={handleSelectReview}
        />
      </div>
      {/* paper 证据「跳到原文」全屏 PDF 覆盖层：PaperPdfReader 受控 expanded，自带 X/Esc/backdrop 关闭 */}
      {pdfTarget && (
        <NotesViewPdfOverlay target={pdfTarget} onClose={() => setPdfTarget(null)} />
      )}
      {/* 非 Zotero 论文「跳到原文」全屏摘要卡片覆盖层 */}
      <NotesViewPaperOverlay record={paperCardTarget} onClose={() => setPaperCardTarget(null)} />
      {/* 综述证据「跳到综述」应用内全屏 HTML 预览 */}
      <FilePreviewOverlay target={reviewPreview} onClose={() => setReviewPreview(null)} />
    </>
  )
}

/**
 * 「跳到原文」全屏 PDF 覆盖层：复用 PaperPdfReader 的 expanded 受控模式（右滑 90vw + backdrop）。
 * pendingScroll 一次性消费——首次滚到位后置 null，避免用户手动滚走又被自动滚回。
 */
function NotesViewPdfOverlay({
  target,
  onClose,
}: {
  target: PdfTarget
  onClose: () => void
}): React.ReactElement {
  const [consumed, setConsumed] = React.useState(false)
  React.useEffect(() => {
    setConsumed(false)
  }, [target])
  const pendingScroll = React.useMemo(() => {
    if (consumed || !target.quote || !target.traceId) return null
    return { id: target.traceId, quote: target.quote }
  }, [consumed, target])
  const extraHighlights = React.useMemo(() => {
    if (!target.quote || !target.traceId) return []
    return [{ id: target.traceId, quote: target.quote }]
  }, [target])

  return (
    <PaperPdfReader
      zoteroKey={target.paperKey}
      extraHighlights={extraHighlights}
      pendingScroll={pendingScroll}
      onScrollComplete={() => setConsumed(true)}
      enableExpand
      expanded
      onExpandedChange={(next) => {
        if (!next) onClose()
      }}
    />
  )
}

/**
 * 非 Zotero 论文「跳到原文」全屏摘要卡片覆盖层：复用 FilePreviewOverlay 的 Dialog 全屏形态，
 * 内部渲染 PaperDetailRenderer（与右栏 kind:'paper' 同一卡片）。受控于一个 PaperRecord。
 */
function NotesViewPaperOverlay({
  record,
  onClose,
}: {
  record: PaperRecord | null
  onClose: () => void
}): React.ReactElement {
  const { t: tCommon } = useT('common')
  return (
    <Dialog open={record != null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        className="max-w-none w-[90vw] h-[88vh] p-0 gap-0 flex flex-col overflow-hidden"
        aria-describedby={undefined}
      >
        {record && (
          <>
            <div className="flex items-center gap-2 h-12 pl-6 pr-12 bg-muted/30 border-b border-border flex-shrink-0">
              <span className="text-xs font-medium text-foreground truncate flex-1" title={sanitizeText(record.title)}>
                {sanitizeText(record.title)}
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <PreviewErrorBoundary>
                <React.Suspense
                  fallback={<div className="p-4 text-xs text-muted-foreground">{tCommon('loading')}</div>}
                >
                  <PaperDetailRenderer record={record} />
                </React.Suspense>
              </PreviewErrorBoundary>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
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
