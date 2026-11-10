/**
 * 内嵌预览容器
 *
 * 根据 currentPreviewAtom 的类型 dispatch：
 * - kind === 'file' → 从注册表找对应 renderer → 懒加载 + 渲染
 * - kind === 'paper' → 直接渲染 PaperDetailRenderer
 *
 * 职责：
 * - 顶部工具栏（标题 / 类型徽章 / 另开 / 关闭）
 * - 错误边界包裹
 * - 骨架屏（Suspense fallback）
 */
import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Maximize2, ExternalLink, FolderSearch, X, ChevronUp, ChevronDown, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { currentPreviewAtom, previewPaperSiblingsAtom, previewFlashMessageAtom } from '@/atoms/side-panel-layout'
import { currentActiveTabAtom, isPreviewKind } from '@/atoms/right-panel-tabs'
import { useOpenInRightPanel } from '@/hooks/useOpenInRightPanel'
import { useCloseRightPanelTab } from '@/hooks/useCloseRightPanelTab'
import { PreviewErrorBoundary } from './PreviewErrorBoundary'
import { EmptyPreview } from './EmptyPreview'
import { resolveRenderer } from './preview-registry'
import { shouldIgnoreKeyboardEvent } from './preview-sibling-helpers'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useIsDevMode } from '@/lib/dev-mode'
import { useT } from '@/hooks/useT'
import { sanitizeText } from '@asci/shared'

// 懒加载 PaperDetailRenderer（Task 23 会替换为完整实现）
const PaperDetailRenderer = React.lazy(() => import('./renderers/PaperDetailRenderer'))
// 懒加载 PaperEntryDetailPanel（工作区论文条目详情）
const PaperEntryDetailPanel = React.lazy(() =>
  import('./renderers/PaperEntryDetailPanel').then((m) => ({ default: m.PaperEntryDetailPanel })),
)

export function InlinePreview(): React.ReactElement | null {
  const { t } = useT('nav')
  const { t: tPreview } = useT('preview')
  const { t: tCommon } = useT('common')
  const isDevMode = useIsDevMode()
  const currentPreview = useAtomValue(currentPreviewAtom)
  const openInRightPanel = useOpenInRightPanel()
  const closeTab = useCloseRightPanelTab()
  const activeTab = useAtomValue(currentActiveTabAtom)
  const [paperSiblings, setPaperSiblings] = useAtom(previewPaperSiblingsAtom)

  // 放大预览 Dialog：复用右栏同一 renderer 子树，纯 CSS 放大，不另开 Electron 窗口
  const [expanded, setExpanded] = React.useState(false)

  // 居中浮层提示（切换 / 翻页 / 端点反馈），约 1 秒自动消失
  const [flashState, setFlashState] = useAtom(previewFlashMessageAtom)
  const flashMessage = flashState?.text ?? null
  React.useEffect(() => {
    if (!flashState) return
    const timer = setTimeout(() => setFlashState(null), 1000)
    return () => clearTimeout(timer)
  }, [flashState, setFlashState])
  const triggerFlash = React.useCallback((text: string): void => {
    setFlashState({ text })
  }, [setFlashState])

  // 论文 ↑↓ 导航：单一全表兄弟池，跨「已入库 entry」与「仅 record」流转。
  // 目标项有 entry → 开 paper-entry 详情；否则 → 开 paper 详情。计数器分母 = 全表长度。
  const navigateToPaperSibling = React.useCallback(
    (delta: -1 | 1): void => {
      if (!paperSiblings) return
      const { items, currentIndex } = paperSiblings
      if (currentIndex < 0) return
      const targetIdx = currentIndex + delta
      if (targetIdx < 0 || targetIdx >= items.length) return
      const target = items[targetIdx]
      if (!target) return
      setPaperSiblings({ items, currentIndex: targetIdx })
      // ↑↓ 快速浏览：原地替换当前 tab（仅改内容+标题），不为每篇论文累积新 tab
      if (target.entry) {
        openInRightPanel({ kind: 'paper-entry', entry: target.entry }, { replaceActive: true })
      } else {
        openInRightPanel({ kind: 'paper', record: target.record }, { replaceActive: true })
      }
      triggerFlash(tPreview('nav.switchedPaper'))
    },
    [paperSiblings, setPaperSiblings, openInRightPanel, triggerFlash],
  )

  React.useEffect(() => {
    if (!paperSiblings || paperSiblings.currentIndex < 0) return
    if (currentPreview?.kind !== 'paper' && currentPreview?.kind !== 'paper-entry') return
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      if (shouldIgnoreKeyboardEvent(e.target)) return
      const { currentIndex, items } = paperSiblings
      const atTopEdge = e.key === 'ArrowUp' && currentIndex === 0
      const atBottomEdge = e.key === 'ArrowDown' && currentIndex === items.length - 1
      if (atTopEdge || atBottomEdge) {
        e.preventDefault()
        triggerFlash(tPreview('nav.noMorePapers'))
        return
      }
      e.preventDefault()
      navigateToPaperSibling(e.key === 'ArrowUp' ? -1 : 1)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [paperSiblings, currentPreview, navigateToPaperSibling, triggerFlash])

  if (!currentPreview) return null

  const handleClose = (): void => {
    if (activeTab && isPreviewKind(activeTab.kind)) {
      closeTab(activeTab.id)
    }
  }

  // 点「放大」图标：不再开新 Electron 窗口（previewFile），改为应用内放大 Dialog
  const handleExpand = (): void => {
    if (currentPreview.kind === 'file') setExpanded(true)
  }

  // 放大 Dialog 内：用系统默认应用打开（OPEN_FILE 已含富 HTML 主题烤入，路径限工作区）
  const handleOpenWithDefaultApp = (): void => {
    if (currentPreview.kind === 'file') {
      window.electronAPI.openFile(currentPreview.path).catch(console.error)
    }
  }

  // 放大 Dialog 内：在 Finder / 文件管理器中显示
  const handleRevealInFinder = (): void => {
    if (currentPreview.kind === 'file') {
      window.electronAPI.showInFolder(currentPreview.path).catch(console.error)
    }
  }

  /** 当前预览文件是不是综述 reviews/*.html（决定是否显示「解析」按钮） */
  const isReviewHtml =
    currentPreview.kind === 'file' &&
    /(?:^|[/\\])reviews[/\\]/.test(currentPreview.path) &&
    currentPreview.path.toLowerCase().endsWith('.html')

  const [reparsing, setReparsing] = React.useState(false)
  const handleReparseCitations = async (): Promise<void> => {
    if (currentPreview.kind !== 'file' || reparsing) return
    setReparsing(true)
    try {
      const res = await window.electronAPI.reviewReparseCitations(currentPreview.path)
      const summary = `已落 ${res.refCount} 条引用，涉及 ${res.paperCount} 篇论文`
      const details: string[] = []
      if (res.replacedExisting) details.push('（覆盖了旧 evidence_set）')
      if (res.papersNotInDb.length > 0) {
        details.push(`${res.papersNotInDb.length} 篇论文未入库已跳过`)
      }
      if (res.citesUnresolved.length > 0) {
        details.push(`正文 cite 在 §7 找不到：[${res.citesUnresolved.join(',')}]`)
      }
      if (res.refsMissingPaper.length > 0) {
        details.push(`§7 缺 paper 标识：[${res.refsMissingPaper.join(',')}]`)
      }
      if (res.refCount === 0) {
        toast.warning(summary, {
          description:
            details.length > 0 ? details.join(' · ') : '可能无 cite，或全部 paper 未入库',
        })
      } else {
        toast.success(summary, {
          description: details.length > 0 ? details.join(' · ') : undefined,
        })
      }
    } catch (err) {
      toast.error('解析失败', { description: (err as Error).message })
    } finally {
      setReparsing(false)
    }
  }

  // 顶部工具栏（兄弟导航 + 标题 + 类型 + 按钮）
  const renderHeader = (
    title: string,
    badge: string,
    badgeClass = 'bg-destructive/10 text-destructive',
    showNav = true,
    // paper / paper-entry 正文已大标题展示同一标题,工具栏不再重复(传 false);file 仍需文件名
    showTitle = true,
  ): React.ReactElement => {
    // 兄弟翻页只用于 paper 详情（单槽预览）：单一全表兄弟池，分母 = 检索论文完整列表。
    // 文件已是每文件独立 tab（#444），不再做兄弟翻页，故不显示 1/N 计数器。
    const navState = (() => {
      if (!showNav) return null
      const isPaper = currentPreview?.kind === 'paper' || currentPreview?.kind === 'paper-entry'
      if (isPaper && paperSiblings && paperSiblings.currentIndex >= 0 && paperSiblings.items.length > 0) {
        return {
          currentIndex: paperSiblings.currentIndex,
          total: paperSiblings.items.length,
          prevTitle: tPreview('nav.prevPaper'),
          nextTitle: tPreview('nav.nextPaper'),
          onPrev: () => navigateToPaperSibling(-1),
          onNext: () => navigateToPaperSibling(1),
        }
      }
      return null
    })()
    const nav = navState ? (
      <div className="flex items-center gap-0.5 mr-1.5">
        <Button
          type="button"
          variant="subtle"
          className="h-auto p-0.5 disabled:opacity-30 disabled:hover:text-muted-foreground [&_svg]:!size-3"
          title={navState.prevTitle}
          disabled={navState.currentIndex === 0}
          onClick={navState.onPrev}
        >
          <ChevronUp className="size-3" />
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground min-w-[32px] text-center">
          {navState.currentIndex + 1}/{navState.total}
        </span>
        <Button
          type="button"
          variant="subtle"
          className="h-auto p-0.5 disabled:opacity-30 disabled:hover:text-muted-foreground [&_svg]:!size-3"
          title={navState.nextTitle}
          disabled={navState.currentIndex === navState.total - 1}
          onClick={navState.onNext}
        >
          <ChevronDown className="size-3" />
        </Button>
      </div>
    ) : null

    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b border-border flex-shrink-0">
        {nav}
        {showTitle ? (
          <span className="text-sm font-medium text-foreground truncate flex-1" title={title}>{title}</span>
        ) : (
          <span className="flex-1" aria-hidden />
        )}
        <span className={cn('text-badge px-1.5 py-0.5 rounded-md font-normal tracking-wider', badgeClass)}>
          {badge}
        </span>
        {isDevMode && isReviewHtml && (
          <Button
            type="button"
            variant="subtle"
            className={cn(
              'h-auto p-0.5 gap-1 [&_svg]:!size-3',
              reparsing && 'opacity-50 cursor-wait',
            )}
            title="解析 cite/q 并落库 evidence_refs / evidence_set"
            onClick={handleReparseCitations}
            disabled={reparsing}
          >
            <Sparkles className="size-3" />
            <span className="text-sm">{reparsing ? '解析中…' : '解析'}</span>
          </Button>
        )}
        {currentPreview.kind === 'file' && (
          <Button
            type="button"
            variant="subtle"
            className="h-auto p-0.5 [&_svg]:!size-3"
            title={t('preview.expand')}
            onClick={handleExpand}
          >
            <Maximize2 className="size-3" />
          </Button>
        )}
        <Button
          type="button"
          variant="subtle"
          className="h-auto p-0.5 [&_svg]:!size-3"
          title={t('preview.close')}
          onClick={handleClose}
        >
          <X className="size-3" />
        </Button>
      </div>
    )
  }

  // 居中浮层：切换成功 / 无更多文件
  const flashOverlay = flashMessage ? (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
      <div className="bg-foreground/85 text-background text-xs font-medium px-4 py-2 rounded-lg shadow-lg animate-in fade-in zoom-in-95 duration-150">
        {flashMessage}
      </div>
    </div>
  ) : null

  // Paper 目标直接 dispatch 到 PaperDetailRenderer
  if (currentPreview.kind === 'paper') {
    return (
      <div className="relative flex flex-col h-full overflow-hidden">
        {renderHeader(sanitizeText(currentPreview.record.title), 'PAPER', 'bg-info/10 text-info', true, false)}
        <PreviewErrorBoundary>
          <React.Suspense fallback={<div className="p-4 text-xs text-muted-foreground">{tCommon('loading')}</div>}>
            <PaperDetailRenderer record={currentPreview.record} readOnly />
          </React.Suspense>
        </PreviewErrorBoundary>
        {flashOverlay}
      </div>
    )
  }

  // paper-entry 目标 — 工作区论文库条目详情
  if (currentPreview.kind === 'paper-entry') {
    return (
      <div className="relative flex flex-col h-full overflow-hidden">
        {renderHeader(sanitizeText(currentPreview.entry.title), 'PAPER', 'bg-info/10 text-info', true, false)}
        <PreviewErrorBoundary>
          <React.Suspense fallback={<div className="p-4 text-xs text-muted-foreground">{tCommon('loading')}</div>}>
            <PaperEntryDetailPanel entry={currentPreview.entry} readOnly />
          </React.Suspense>
        </PreviewErrorBoundary>
        {flashOverlay}
      </div>
    )
  }

  // File 目标走注册表
  const renderer = resolveRenderer(currentPreview)
  const fileName = currentPreview.path.split('/').pop() ?? currentPreview.path
  const badgeLabel = currentPreview.ext.toUpperCase() || 'FILE'
  const filePath = currentPreview.path

  // renderer 内容主体（不含顶栏）：右栏与放大 Dialog 共用同一子树，Dialog 即纯 CSS 放大
  const renderRendererBody = (): React.ReactElement => {
    if (!renderer) {
      return (
        <EmptyPreview
          variant={currentPreview.size > 0 ? 'too-large' : 'unsupported'}
          filePath={filePath}
        />
      )
    }
    const Renderer = renderer.Component
    return (
      <div className="flex-1 min-h-0 overflow-hidden">
        {/* key 绑定文件路径：切换文件时整个 ErrorBoundary + Renderer 重新挂载，清空上一个文件的错误 state */}
        <PreviewErrorBoundary key={filePath} filePath={filePath}>
          <React.Suspense fallback={<div className="p-4 text-xs text-muted-foreground">{tCommon('loading')}</div>}>
            <RendererHost path={filePath} size={currentPreview.size} Renderer={Renderer} />
          </React.Suspense>
        </PreviewErrorBoundary>
      </div>
    )
  }

  // 放大 Dialog：同一 renderer 子树撑满大窗口；顶部精简动作栏（标题 + 用默认应用打开 + 在 Finder 显示）
  const expandDialog = (
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <DialogContent className="max-w-none w-[90vw] h-[88vh] p-0 gap-0 flex flex-col overflow-hidden" aria-describedby={undefined}>
        <div className="flex items-center gap-2 h-12 pl-6 pr-12 bg-muted/30 border-b border-border flex-shrink-0">
          <span className="text-xs font-medium text-foreground truncate flex-1" title={fileName}>{fileName}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 [&_svg]:size-3.5"
            onClick={handleOpenWithDefaultApp}
          >
            <ExternalLink />
            {tPreview('actions.openWithDefaultApp')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 [&_svg]:size-3.5"
            onClick={handleRevealInFinder}
          >
            <FolderSearch />
            {tPreview('actions.revealInFinder')}
          </Button>
        </div>
        {/* 内容区不加外层 px，让滚动条贴 Dialog 右边框；额外内边距加在滚动容器内部（prose），滚动条仍贴边 */}
        {expanded && (
          <div className="flex-1 min-h-0 flex flex-col [&>div>div]:!p-12">
            {renderRendererBody()}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
      {renderHeader(fileName, badgeLabel)}
      {renderRendererBody()}
      {flashOverlay}
      {expandDialog}
    </div>
  )
}

/**
 * 将 renderer 的 async onError 回调桥接到 ErrorBoundary：
 * - onError 触发 setState
 * - 下次 render 时 throw，由上层 PreviewErrorBoundary 捕获
 */
function RendererHost({
  path,
  size,
  Renderer,
}: {
  path: string
  size: number
  Renderer: React.FC<{ path: string; size: number; onError: (err: Error) => void }>
}): React.ReactElement {
  const [error, setError] = React.useState<Error | null>(null)
  // 路径变化时清空错误，让用户切到新文件时能重试
  React.useEffect(() => { setError(null) }, [path])
  if (error) throw error
  return <Renderer path={path} size={size} onError={setError} />
}
