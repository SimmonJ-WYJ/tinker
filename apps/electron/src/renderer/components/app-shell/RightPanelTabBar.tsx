// apps/electron/src/renderer/components/app-shell/RightPanelTabBar.tsx
/**
 * 右栏 Tab 栏（Codex 风累积）：
 * - 累积：所有打开过的 tab 常驻、不主动清理；默认 tab（会话文件 / 检索论文）不可关闭但随其余 tab 一起滚动。
 * - 自适应宽度：tab 按内容宽度排列；极窄态按 max-width 截断标题，hover tooltip 显全名。
 * - 溢出：超出可视宽度横向滚动，两端按需出现 ‹ › 滚动箭头；激活 tab 自动滚入可视区。tab 不再隐藏进下拉。
 * - 定位辅助：右侧「🔍 标签搜索」popover 列出所有打开 tab，可过滤、点选跳转（Chrome tab search）。
 * - 关闭：不显示单 tab × 关闭按钮；右键单 tab → 关闭 / 关闭其他 / 关闭右侧标签（精细批量，无顶部一键全清）。
 * - 右侧 `⛶` 切 maximized。
 */
import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  FileText,
  BookOpen,
  BookMarked,
  Layers,
  FolderTree,
  Search,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  X,
  MessageSquare,
} from 'lucide-react'
import { TelescopeIcon } from '@/components/agent/result-card-icons'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import {
  currentSessionTabsAtom,
  rightPanelMaximizedAtom,
  rightPanelTabsBySessionAtom,
  closeOtherTabs,
  closeTabsToRight,
  isUnclosableTabId,
  type RightTab,
  type TabKind,
} from '@/atoms/right-panel-tabs'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { useCloseRightPanelTab } from '@/hooks/useCloseRightPanelTab'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  tabStripChipClassNames,
  tabStripIconClassNames,
  tabStripLabelClassNames,
  tabStripRootClassNames,
  tabStripScrollButtonClassNames,
} from '@/components/tabs/tab-strip-primitives.ts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const TAB_ICONS: Record<TabKind, React.ComponentType<{ className?: string }>> = {
  'session-files': FolderTree,
  'session-papers': Layers,
  'file-preview': FileText,
  'paper-detail': BookOpen,
  'paper-record': BookMarked,
  'research-gap-table': TelescopeIcon,
  'quote-chat': MessageSquare,
}

function TabChip({
  tab,
  active,
  label,
  closeable,
  onActivate,
  onClose,
  onContextMenu,
}: {
  tab: RightTab
  active: boolean
  label: string
  closeable: boolean
  onActivate: () => void
  onClose: () => void
  onContextMenu: (e: React.MouseEvent) => void
}): React.ReactElement {
  const { t } = useT('conversation')
  const Icon = TAB_ICONS[tab.kind]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="tab"
          aria-selected={active}
          data-tab-id={tab.id}
          onClick={onActivate}
          onContextMenu={onContextMenu}
          onAuxClick={(e) => { if (e.button === 1 && closeable) { e.preventDefault(); onClose() } }}
          className={cn(
            tabStripChipClassNames({ active, size: 'compact' }),
            'group shrink-0 max-w-[180px]',
          )}
        >
          <Icon className={tabStripIconClassNames('compact')} />
          {/* grid 双层占位：invisible 粗体撑住宽度，可见层切粗细不再造成宽度抖动 */}
          <span className="grid flex-1 min-w-0">
            <span className="col-start-1 row-start-1 invisible truncate font-medium" aria-hidden>{label}</span>
            <span className={tabStripLabelClassNames(active, 'col-start-1 row-start-1')}>{label}</span>
          </span>
          {closeable && (
            <Button
              type="button"
              variant="ghost"
              size="icon-2xs"
              aria-label={t('rightPanel.context.close')}
              onClick={(e) => { e.stopPropagation(); onClose() }}
              className={cn(
                'flex-shrink-0 rounded hover:bg-muted [&_svg]:!size-2.5',
                active ? 'opacity-100' : 'opacity-0 group-hover:opacity-70',
              )}
            >
              <X className="size-2.5" />
            </Button>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/** 横向滚动箭头（仅在该方向可滚时渲染） */
function ScrollArrow({
  dir,
  ariaLabel,
  onClick,
}: {
  dir: 'left' | 'right'
  ariaLabel: string
  onClick: () => void
}): React.ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={ariaLabel}
      onClick={onClick}
      className={tabStripScrollButtonClassNames('size-6')}
    >
      {dir === 'left' ? <ChevronLeft className="!size-3.5" /> : <ChevronRight className="!size-3.5" />}
    </Button>
  )
}

export function RightPanelTabBar(): React.ReactElement | null {
  const { t } = useT('conversation')
  const sessionId = useAtomValue(currentAgentSessionIdAtom)
  const state = useAtomValue(currentSessionTabsAtom)
  const setTabs = useSetAtom(rightPanelTabsBySessionAtom(sessionId ?? '__no_session__'))
  const [maximized, setMaximized] = useAtom(rightPanelMaximizedAtom)
  const closeTabHandler = useCloseRightPanelTab()

  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = React.useState(false)
  const [canRight, setCanRight] = React.useState(false)

  // 右键上下文菜单（受控 + 光标处虚拟锚点）与搜索 popover
  const [ctx, setCtx] = React.useState<{ tabId: string; x: number; y: number } | null>(null)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')

  const tabCount = state?.tabs.length ?? 0
  const activeId = state?.activeId ?? null

  // 滚动状态：是否可左 / 右滚（决定箭头是否出现）
  const updateScroll = React.useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setCanLeft(el.scrollLeft > 1)
    setCanRight(el.scrollLeft < max - 1)
  }, [])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateScroll()
    const ro = new ResizeObserver(updateScroll)
    ro.observe(el)
    el.addEventListener('scroll', updateScroll, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', updateScroll)
    }
  }, [updateScroll, tabCount])

  // 激活 tab 变化时滚入可视区
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || !activeId) return
    const chip = el.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeId)}"]`)
    chip?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeId, tabCount])

  if (!state) return null

  const activateTab = (id: string): void => {
    setTabs((prev) => ({ ...prev, activeId: id }))
  }

  const defaultTitleFor = (kind: TabKind): string => {
    switch (kind) {
      case 'session-files':
        return t('rightPanel.tabs.sessionFiles')
      case 'session-papers':
        return t('rightPanel.tabs.sessionPapers')
      case 'file-preview':
        return t('rightPanel.tabs.filePreview')
      case 'paper-detail':
        return t('rightPanel.tabs.paperDetail')
      case 'paper-record':
        return t('rightPanel.tabs.paperRecord')
      case 'research-gap-table':
        return t('rightPanel.tabs.researchGap')
      case 'quote-chat':
        return t('rightPanel.tabs.quoteChat')
    }
  }
  const titleFor = (tab: RightTab): string => tab.title || defaultTitleFor(tab.kind)

  const scrollBy = (delta: number): void => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  const ctxUnclosable = ctx ? isUnclosableTabId(ctx.tabId) : false
  // 右键目标右侧是否还有可关闭的 tab（决定「关闭右侧」是否可用）
  const ctxHasRight = ctx
    ? (() => {
        const idx = state.tabs.findIndex((tt) => tt.id === ctx.tabId)
        return idx >= 0 && state.tabs.slice(idx + 1).some((tt) => !isUnclosableTabId(tt.id))
      })()
    : false
  const ctxHasOthers = state.tabs.some((tt) => tt.id !== ctx?.tabId && !isUnclosableTabId(tt.id))

  // 搜索过滤：按标题大小写无关匹配
  const q = query.trim().toLowerCase()
  const filteredTabs = q
    ? state.tabs.filter((tab) => titleFor(tab).toLowerCase().includes(q))
    : state.tabs

  return (
    <div
      role="tablist"
      className={tabStripRootClassNames('h-10')}
    >
      {canLeft && <ScrollArrow dir="left" ariaLabel={t('rightPanel.scrollLeft')} onClick={() => scrollBy(-220)} />}

      <div
        ref={scrollRef}
        className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto scrollbar-none titlebar-drag-region"
      >
        {state.tabs.map((tab) => (
          <TabChip
            key={tab.id}
            tab={tab}
            active={state.activeId === tab.id}
            label={titleFor(tab)}
            closeable={!isUnclosableTabId(tab.id)}
            onActivate={() => activateTab(tab.id)}
            onClose={() => closeTabHandler(tab.id)}
            onContextMenu={(e) => { e.preventDefault(); setCtx({ tabId: tab.id, x: e.clientX, y: e.clientY }) }}
          />
        ))}
      </div>

      {canRight && <ScrollArrow dir="right" ariaLabel={t('rightPanel.scrollRight')} onClick={() => scrollBy(220)} />}

      <div className="flex items-center gap-1 flex-shrink-0 self-center titlebar-no-drag">
        {/* 标签搜索 / 列表：列出所有打开 tab，可过滤、点选跳转 */}
        <Popover
          open={searchOpen}
          onOpenChange={(o) => { setSearchOpen(o); if (!o) setQuery('') }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('rightPanel.tabSearch.trigger')}
                  className="size-[28px] rounded-xl text-muted-foreground hover:bg-muted"
                >
                  <Search className="!size-3.5" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            {!searchOpen && <TooltipContent side="bottom">{t('rightPanel.tabSearch.trigger')}</TooltipContent>}
          </Tooltip>
          <PopoverContent align="end" className="w-64 p-0">
            <div className="p-2 border-b border-border/60">
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('rightPanel.tabSearch.placeholder')}
                className="h-7 text-sm"
              />
            </div>
            <div role="listbox" className="max-h-72 overflow-y-auto scrollbar-thin py-1">
              {filteredTabs.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                  {t('rightPanel.tabSearch.empty')}
                </div>
              ) : (
                filteredTabs.map((tab) => {
                  const Icon = TAB_ICONS[tab.kind]
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="option"
                      aria-selected={state.activeId === tab.id}
                      onClick={() => { activateTab(tab.id); setSearchOpen(false); setQuery('') }}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                        state.activeId === tab.id ? 'bg-muted/70 text-foreground' : 'text-foreground/80 hover:bg-muted/50',
                      )}
                    >
                      <Icon className="size-3.5 flex-shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1">{titleFor(tab)}</span>
                    </button>
                  )
                })
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={maximized ? t('rightPanel.restore') : t('rightPanel.maximize')}
              onClick={() => setMaximized((m) => !m)}
              className="size-[28px] rounded-xl text-muted-foreground hover:bg-muted"
            >
              {maximized ? <Minimize2 className="!size-3.5" /> : <Maximize2 className="!size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {maximized ? t('rightPanel.restore') : t('rightPanel.maximize')}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* 右键上下文菜单：trigger 是定位在光标处的 0 尺寸锚点 */}
      <DropdownMenu open={!!ctx} onOpenChange={(o) => { if (!o) setCtx(null) }}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            style={{ position: 'fixed', left: ctx?.x ?? 0, top: ctx?.y ?? 0, width: 0, height: 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[160px]">
          <DropdownMenuItem
            disabled={ctxUnclosable}
            onSelect={() => { if (ctx) closeTabHandler(ctx.tabId) }}
            className="text-sm cursor-pointer"
          >
            {t('rightPanel.context.close')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!ctxHasOthers}
            onSelect={() => { if (ctx) setTabs((prev) => closeOtherTabs(prev, ctx.tabId)) }}
            className="text-sm cursor-pointer"
          >
            {t('rightPanel.context.closeOthers')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!ctxHasRight}
            onSelect={() => { if (ctx) setTabs((prev) => closeTabsToRight(prev, ctx.tabId)) }}
            className="text-sm cursor-pointer"
          >
            {t('rightPanel.context.closeRight')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
