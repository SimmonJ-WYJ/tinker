/**
 * PaperPdfReader —— 论文 PDF 内嵌阅读器（共享组件）
 *
 * Library 详情面板与 Evidence Sets 预览面板共用：给定 zoteroKey，自己负责
 *   - 解析 PDF 附件路径（`window.electronAPI.zotero.library.getAttachmentPath`）
 *   - lazy 加载 PdfRenderer + PreviewErrorBoundary + Suspense
 *   - 维护本地 pdfExpanded（全屏浮层 / Esc 收起）
 *   - 转发外部 quote 高亮 + pendingScroll
 *
 * 不参与笔记创建 / 选区监听（仍由 Library 侧的 ItemDetailPanel + PaperNotesPanel
 * 负责，靠全局 selectionchange 监听 [data-pdf-expanded] / .textLayer 完成）。
 */

import * as React from 'react'
import { Maximize2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import { PreviewErrorBoundary } from '@/components/preview/PreviewErrorBoundary'

// 懒加载 PdfRenderer：pdfjs-dist ~2.5MB，只在用户真正打开论文 PDF 时才装载
const PdfRenderer = React.lazy(() => import('@/components/preview/renderers/PdfRenderer'))

export interface PaperPdfReaderHighlight {
  id: string
  quote: string
  content?: string
  /** PDF 锚点页码(1-based,issue #452);文本匹配 miss 时 PdfRenderer 据此回退翻页 */
  page?: number
}

export interface PaperPdfReaderProps {
  /** Zotero item key；为空时直接走 missing 分支。 */
  zoteroKey: string | null
  /** 调用方收集的高亮列表（Library 侧来自 paperNotesAtom + activeEvidenceHighlightAtom）。 */
  extraHighlights?: ReadonlyArray<PaperPdfReaderHighlight>
  /**
   * 进入后一次性滚动到指定 quote/note。组件会把它合并进 highlights 列表，
   * 确保 PdfRenderer 反查 quote 时能命中。滚动完成后回调 `onScrollComplete`。
   * content：可选笔记正文，传入时悬停高亮会浮出 tooltip（证据集预览用）。
   */
  pendingScroll?: { id: string; quote: string; content?: string } | null
  onScrollComplete?: () => void
  /** PDF 高亮 span 点击：上抛 note id，调用方据此打开 NoteDetailDialog 等。 */
  onHighlightClick?: (id: string) => void
  /** 是否允许"展开浮层"。默认 true。 */
  enableExpand?: boolean
  /** 受控展开状态。传入时由外部托管（外部按钮可触发 expand），否则内部自管。 */
  expanded?: boolean
  /** 受控模式回调：组件内部触发展开/收起时通知外部。 */
  onExpandedChange?: (next: boolean) => void
  /**
   * 内联模式高度（CSS height）。
   * - 默认 undefined：内联容器按 4:3 宽高比铺满父宽度（width:height = 4:3）
   * - 传具体值（如 `"100%"`、`clamp(...)`）→ 覆盖默认，用 inline style 设 height
   */
  inlineHeight?: string
  /** 附件解析完成后回调。`found=false` 时调用方可切到 abstract / "无 PDF" 等兜底视图。 */
  onAttachmentResolved?: (found: boolean) => void
  /** 自定义 "无 PDF" 占位渲染。未提供时使用默认文案。 */
  renderMissing?: () => React.ReactNode
  /** PDF 自身错误回调（覆盖默认 console.error）。 */
  onPdfError?: (err: Error) => void
}

interface PdfAttachment {
  path: string
  filename: string
  size?: number
}


/**
 * Library 侧把 pendingQuoteScroll / pendingEvidenceScroll 两个 atom 折叠成本组件接受的
 * `{ id, quote } | null` 形态的公共助手——避免调用方重复写 if/else。
 *   - pendingQuoteScroll(noteId)：从 highlights 列表反查 quote 字符串
 *   - pendingEvidenceScroll(quote, traceId)：直接用 quote + 合成 id
 */
export function resolvePendingScroll(
  pendingQuoteScroll: { noteId: string } | null,
  pendingEvidenceScroll: { quote: string; traceId: string } | null,
  highlights: ReadonlyArray<PaperPdfReaderHighlight>,
): { id: string; quote: string } | null {
  if (pendingQuoteScroll) {
    const hit = highlights.find((h) => h.id === pendingQuoteScroll.noteId)
    if (hit) return { id: hit.id, quote: hit.quote }
    return null
  }
  if (pendingEvidenceScroll) {
    return {
      id: `evidence:${pendingEvidenceScroll.traceId}`,
      quote: pendingEvidenceScroll.quote,
    }
  }
  return null
}

export function PaperPdfReader({
  zoteroKey,
  extraHighlights,
  pendingScroll,
  onScrollComplete,
  onHighlightClick,
  enableExpand = true,
  expanded: expandedProp,
  onExpandedChange,
  inlineHeight,
  onAttachmentResolved,
  renderMissing,
  onPdfError,
}: PaperPdfReaderProps): React.ReactElement | null {
  const { t } = useT('library')
  const [pdf, setPdf] = React.useState<PdfAttachment | null | 'missing'>(null)
  // 受控 / 非受控两种模式：传 expanded prop 时由父托管，否则用内部 state
  const [expandedState, setExpandedState] = React.useState(false)
  const isControlled = expandedProp !== undefined
  const expanded = isControlled ? expandedProp : expandedState
  const setExpanded = React.useCallback((next: boolean): void => {
    if (!isControlled) setExpandedState(next)
    onExpandedChange?.(next)
  }, [isControlled, onExpandedChange])

  // 抽屉滑入动画期间不让 PdfRenderer 按当前宽度定稿渲染：动画用 transform 平移，过程中
  // 容器虽已是最终 90vw，但 React commit / 量宽时机与浏览器布局/动画存在竞态，画布可能
  // 先按一个过渡宽度铺开再回缩（图：打开抽屉 PDF 先溢出再回缩）。改为"动画放完 → 容器
  // 完全落定在屏 → 再量最终宽度渲染并 fit"。expanded 翻 true 时标记动画中，slide-in 的
  // onAnimationEnd 清除；非展开（内联）无入场动画，恒为已落定。
  const [drawerAnimating, setDrawerAnimating] = React.useState(false)
  React.useEffect(() => {
    if (!expanded) { setDrawerAnimating(false); return }
    setDrawerAnimating(true)
    // 兜底：animationend 可能不触发（prefers-reduced-motion 禁用动画 / 事件错过），
    // duration-200 + 余量后强制解除，避免永久卡在 loading。
    const timer = setTimeout(() => setDrawerAnimating(false), 260)
    return () => clearTimeout(timer)
  }, [expanded])
  const containerSettled = !expanded || !drawerAnimating

  // 附件解析：zoteroKey 变化时重新探测；失败 / 不存在均视为 missing
  React.useEffect(() => {
    setPdf(null)
    if (!zoteroKey) {
      setPdf('missing')
      onAttachmentResolved?.(false)
      return
    }
    let cancelled = false
    window.electronAPI.zotero.library
      .getAttachmentPath({ itemKey: zoteroKey })
      .then((att) => {
        if (cancelled) return
        if (att.found && att.contentType === 'application/pdf') {
          setPdf({ path: att.path, filename: att.filename })
          onAttachmentResolved?.(true)
        } else {
          setPdf('missing')
          onAttachmentResolved?.(false)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.warn('[PaperPdfReader] getAttachmentPath failed:', err)
        setPdf('missing')
        onAttachmentResolved?.(false)
      })
    return () => {
      cancelled = true
    }
    // onAttachmentResolved 故意不进依赖，避免父组件传不稳定回调导致循环重探测
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoteroKey])

  // Esc 退出展开态
  React.useEffect(() => {
    if (!expanded) return
    const handle = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [expanded])

  // 切论文时收起内部展开态，避免遗留浮层；受控模式下交给父组件决定
  React.useEffect(() => {
    if (!isControlled) setExpandedState(false)
  }, [zoteroKey, isControlled])

  // 合并 pendingScroll 进高亮列表：PdfRenderer 只接 noteId，会反查 quoteHighlights 拿 quote
  const mergedHighlights = React.useMemo(() => {
    const base = extraHighlights ?? []
    if (!pendingScroll) return base
    if (base.some((h) => h.id === pendingScroll.id)) return base
    return [...base, { id: pendingScroll.id, quote: pendingScroll.quote, content: pendingScroll.content }]
  }, [extraHighlights, pendingScroll])

  const handlePdfError = React.useCallback((err: Error): void => {
    if (onPdfError) onPdfError(err)
    else console.error('[PaperPdfReader]', err)
  }, [onPdfError])

  if (pdf === null) {
    return (
      <div className="px-6 py-8 text-xs text-muted-foreground">
        {t('detail.pdf.loading')}
      </div>
    )
  }

  if (pdf === 'missing') {
    if (renderMissing) return <>{renderMissing()}</>
    return (
      <div className="px-6 py-8 text-xs text-muted-foreground/70">
        {t('notes.view.preview.noPdf')}
      </div>
    )
  }

  return (
    <>
      {expanded && (
        <div
          // 半透明遮罩点击关闭，对齐 EvidenceSetDetailSheet 的 Sheet 视觉模式。
          // !mt-0：祖先若是 space-y-* 容器会给非首个子节点加 margin-top，显式清零避免顶部缝隙
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] animate-in fade-in-0 !mt-0"
          onClick={() => setExpanded(false)}
          aria-hidden
        />
      )}
      <div
        data-pdf-expanded={expanded ? '' : undefined}
        className={cn(
          'relative overflow-hidden bg-muted/10',
          expanded
            // 全屏改为"右滑 Sheet"对齐 EvidenceSetDetailSheet 的视觉模式：
            // - fixed 在客户区右侧，w-[90vw] 比 ESD 默认（640-800px）更宽以适配 PDF
            // - border-l + shadow-xl 给出明显左边界，与左侧 backdrop 区隔
            // - animate-in slide-in-from-right 仅入场动画（YAGNI：退出动画后续再加）
            // - !mt-0：避免 space-y-* 祖先的顶部缝隙
            ? 'fixed right-0 top-0 bottom-0 w-[90vw] z-50 border-l border-border shadow-xl animate-in slide-in-from-right duration-200 !mt-0'
            : cn(
                'rounded-md border border-border',
                // inlineHeight 未传 → 4:3 比例铺满父宽度（默认行为）
                // 传了 → 用 inline style 受控（如 "100%" 让 EvidenceItemPreviewPane 填满）
                inlineHeight === undefined ? 'aspect-[4/3] w-full' : 'h-full',
              ),
        )}
        style={expanded || inlineHeight === undefined ? undefined : { height: inlineHeight }}
        // slide-in 动画结束 → 抽屉完全落定在屏 → 解除门控，让 PdfRenderer 量最终宽度渲染 fit。
        // 仅响应自身的入场动画（target===currentTarget），忽略子节点冒泡上来的动画事件。
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) setDrawerAnimating(false)
        }}
      >
      {enableExpand && !expanded && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setExpanded(true)}
          title={t('detail.pdf.openFullscreenTooltip')}
          aria-label={t('detail.pdf.openFullscreenTooltip')}
          className="absolute right-3 top-3 z-10 rounded-full bg-background/80 text-foreground/80 backdrop-blur hover:bg-background hover:text-foreground [&_svg]:size-3.5"
        >
          <Maximize2 className="size-3.5" />
        </Button>
      )}
      {expanded && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setExpanded(false)}
          title={t('detail.pdf.closeFullscreenTooltip')}
          aria-label={t('detail.pdf.closeFullscreenTooltip')}
          className="absolute right-3 top-3 z-10 rounded-full bg-background/80 text-foreground/80 backdrop-blur hover:bg-background hover:text-foreground [&_svg]:size-3.5"
        >
          <X className="size-3.5" />
        </Button>
      )}
      <PreviewErrorBoundary filePath={pdf.path}>
        <React.Suspense
          fallback={<div className="p-4 text-xs text-muted-foreground">{t('detail.pdf.loading')}</div>}
        >
          <PdfRenderer
            path={pdf.path}
            size={pdf.size ?? 0}
            onError={handlePdfError}
            quoteHighlights={mergedHighlights}
            onHighlightClick={onHighlightClick}
            pendingScrollNoteId={pendingScroll?.id ?? null}
            onScrollComplete={onScrollComplete}
            showOutline={expanded}
            containerSettled={containerSettled}
          />
        </React.Suspense>
      </PreviewErrorBoundary>
      </div>
    </>
  )
}
