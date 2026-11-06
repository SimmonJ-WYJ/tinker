/**
 * AppShell - 应用主布局容器
 *
 * 布局结构：[LeftSidebar 固定宽] | [MainArea 弹性宽] | [Splitter] | [RightSidePanel 比例宽]
 *
 * 右侧面板宽度由 effectiveRatioAtom 驱动，Splitter 拖拽时更新比例 atom。
 * MainArea 用 flex-1 吃掉剩余宽度，右侧面板按比例占固定宽（flex-shrink-0），
 * 左侧边栏自身固定宽度不参与比例。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { LeftSidebar } from './LeftSidebar'
import { RightSidePanel } from './RightSidePanel'
import { WorkspaceToolbar } from './WorkspaceToolbar'
import { sidebarCollapsedAtom, activeTabIdAtom } from '@/atoms/tab-atoms'
import * as Drawer from '@radix-ui/react-dialog'
import { PanelLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MainArea } from '@/components/tabs/MainArea'
import { AppShellProvider, type AppShellContextType } from '@/contexts/AppShellContext'
import { currentAgentSessionIdAtom, currentSessionSidePanelOpenAtom } from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import {
  effectiveRatioAtom,
  sidePanelRatioAtom,
  SIDE_PANEL_MIN_PX,
  SIDE_PANEL_MAX_RATIO,
} from '@/atoms/side-panel-layout'
import { rightPanelMaximizedAtom } from '@/atoms/right-panel-tabs'
import { Splitter } from '@/components/preview/Splitter'
import { SpotlightOverlay } from '@/components/onboarding/SpotlightOverlay'
import { ConceptSpotlightOverlay } from '@/components/onboarding/ConceptSpotlightOverlay'
import { useT } from '@/hooks/useT'
import { cn } from '@/lib/utils'
import '@/components/welcome/workspace-home.css'

export interface AppShellProps {
  /** Context 值，用于传递给子组件 */
  contextValue: AppShellContextType
}

export function AppShell({ contextValue }: AppShellProps): React.ReactElement {
  const { t } = useT('nav')
  const [collapsed] = useAtom(sidebarCollapsedAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const activeView = useAtomValue(activeViewAtom)
  const [narrow, setNarrow] = React.useState(() => window.matchMedia('(max-width: 1100px)').matches)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  React.useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)')
    const update = (): void => { setNarrow(media.matches); setDrawerOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  React.useEffect(() => { setDrawerOpen(false) }, [activeTabId, activeView])
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  // 右侧面板是「会话产物区」，只在会话视图有意义。其余整页视图（config / library / notes
  // 及未来新增）都应占满整个内容区，不残留对话产物面板 —— 故用正向判断而非排除列表，
  // 避免每加一个整页视图都要回来补 `!== 'xxx'`。
  const panelOpen = useAtomValue(currentSessionSidePanelOpenAtom)
  const showRightPanel = !!currentSessionId && activeView === 'conversations' && panelOpen

  const effectiveRatio = useAtomValue(effectiveRatioAtom)
  const maximized = useAtomValue(rightPanelMaximizedAtom)
  const setMaximized = useSetAtom(rightPanelMaximizedAtom)
  const setRatio = useSetAtom(sidePanelRatioAtom)

  // 离开会话视图（切到 config/library/notes 等整页视图）时复位右栏全屏态。
  // RightPanelTabHost 的复位 effect 仅在「右栏挂载且 session 变」时触发，整页视图下
  // 右栏被卸载，复位永不发生，残留的 maximized 会让主区 wrapper 始终 hidden → 内容空白。
  React.useEffect(() => {
    if (activeView !== 'conversations') setMaximized(false)
  }, [activeView, setMaximized])

  const shellRef = React.useRef<HTMLDivElement>(null)
  const [isResizing, setIsResizing] = React.useState(false)
  const [draftRatio, setDraftRatio] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (!isResizing) {
      setDraftRatio(null)
    }
  }, [effectiveRatio, isResizing])

  const clampRatioFromClientX = React.useCallback((clientX: number): number | null => {
    const rect = shellRef.current?.getBoundingClientRect()
    if (!rect) return null
    const totalWidth = rect.width
    if (totalWidth <= 0) return null
    const rightWidth = rect.right - clientX
    return Math.max(
      SIDE_PANEL_MIN_PX / totalWidth,
      Math.min(SIDE_PANEL_MAX_RATIO, rightWidth / totalWidth),
    )
  }, [])

  /** 处理 Splitter 水平拖拽，将 clientX 换算为面板宽度比例并写入 atom */
  const handleHorizontalDrag = React.useCallback((clientX: number): void => {
    const nextRatio = clampRatioFromClientX(clientX)
    if (nextRatio == null) return
    setDraftRatio(nextRatio)
  }, [clampRatioFromClientX])

  const handleResizeStart = React.useCallback((): void => {
    setDraftRatio(effectiveRatio)
    setIsResizing(true)
  }, [effectiveRatio])

  /** 拖拽结束；clientX 为 null 表示纯点击（指针未移动），不提交比例 ——
      否则最大化态（0.70）下点击会把存储比例改写成手动上限 0.60（#600） */
  const handleResizeEnd = React.useCallback((clientX: number | null): void => {
    setIsResizing(false)
    if (clientX == null) {
      setDraftRatio(null)
      return
    }
    const nextRatio = clampRatioFromClientX(clientX) ?? draftRatio ?? effectiveRatio
    setDraftRatio(nextRatio)
    setRatio(nextRatio)
  }, [clampRatioFromClientX, draftRatio, effectiveRatio, setRatio])

  const panelRatio = draftRatio ?? effectiveRatio

  return (
    <AppShellProvider value={contextValue}>



      <div
        ref={shellRef}
        className="workspace-shell h-screen w-screen flex flex-col overflow-hidden"
      >
        <WorkspaceToolbar narrow={narrow} drawerOpen={drawerOpen} onDrawerToggle={() => setDrawerOpen(prev => !prev)} />
        <div className="workspace-shell__body flex flex-1 min-h-0 relative">
        {!narrow && <div className="workspace-shell__sidebar relative z-[60]" data-collapsed={collapsed} aria-hidden={collapsed}>
          <div className="workspace-shell__sidebar-inner"><LeftSidebar width={248} forceExpanded /></div>
        </div>}

        {/* 主内容区域：flex-1 吃掉除 sidebar / 右栏之外的全部剩余宽度。
            不能写显式 width:(1-r)*100% —— 加上 sidebar 后三栏总宽 > 100%，溢出会被
            flex 同比压缩，右栏实际渲染宽度 < 比例宽度；点击分隔条时按实际像素回算
            的比例就会偏小，面板越点越窄（#600）。
            maximized（全宽覆盖对话区）时主区让出至 0：用 hidden 收起（保持挂载、不丢状态），
            右栏改 flex-1 填满 sidebar 之外的全部空间 —— 避免按整屏百分比给宽导致超宽裁出视口。 */}
        <div className={cn('workspace-shell__main min-w-0 relative z-[60]', maximized && showRightPanel ? 'hidden' : 'flex-1')}>
          <MainArea />
        </div>

        {/* 右侧面板：仅在「会话视图且有当前会话」时显示（config/library/notes 等整页视图不显示）
            Splitter 以 absolute 骑在面板左边缘，不参与布局流，确保左右两侧到主卡片的间距一致（均为 8px） */}
        {showRightPanel && (
          <div
            // 非全屏：min-w-0 让 width: % 严格生效（flex 默认 min-width:auto 会被长标题/DOI 撑宽）；
            // flex-shrink-0 保证渲染宽度严格 = 比例宽度，不被 flex 压缩（#600）。
            // 全屏：改 flex-1 填满 sidebar 之外剩余空间，不写百分比宽度 —— 否则 100% 整屏宽
            // 叠加固定左栏会超出容器，被 overflow-hidden 裁掉右缘（恢复按钮 / 内容溢出视口）。
            className={cn(
              'relative z-[60] p-2 pl-0 titlebar-drag-region min-w-0',
              // 全屏时对话区（提供左侧 8px 间距）被隐藏，需补回 pl-2 让内容与左栏留同样间隙
              maximized ? 'flex-1 pl-2' : 'flex-shrink-0',
            )}
            style={
              maximized
                ? undefined
                : {
                    width: `${panelRatio * 100}%`,
                    transition: isResizing ? 'none' : 'width 300ms ease-in-out',
                  }
            }
          >
            {/* 全屏（覆盖对话区）时隐藏 Splitter：此时对话区宽 0，拖拽无意义；收回只走右上角按钮 */}
            {/* titlebar-no-drag：Electron 拖拽区域按几何矩形计算（无视 z-index），
                顶部 50px 标题栏拖拽条会盖住分隔条顶端 —— 不抠掉的话在该区域按下
                会触发原生窗口拖拽，页面收不到 pointer 事件，拖拽态卡死（#592） */}
            {!maximized && (
              <Splitter
                orientation="vertical"
                onDrag={handleHorizontalDrag}
                onDragStart={handleResizeStart}
                onDragEnd={handleResizeEnd}
                title={t('shell.splitterTooltip')}
                className="absolute top-0 bottom-0 -left-1 w-1 z-10 titlebar-no-drag"
              />
            )}
            <RightSidePanel />
          </div>
        )}
        </div>
      </div>
      {narrow && <Drawer.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="workspace-drawer-overlay" />
          <Drawer.Content className="workspace-drawer" aria-describedby={undefined}
            onCloseAutoFocus={(event) => { event.preventDefault(); document.querySelector<HTMLElement>('[data-sidebar-toggle]')?.focus() }}>
            <Drawer.Title className="sr-only">{t('navigation.sidebar')}</Drawer.Title>
            <div className="workspace-drawer__toolbar titlebar-drag-region"><Drawer.Close asChild><Button variant="ghost" size="icon-sm" className="titlebar-no-drag" aria-label={t('sidebar.collapse')}><PanelLeft size={17} strokeWidth={1.5} /></Button></Drawer.Close></div>
            <div className="workspace-drawer__body" onClick={(event) => { if ((event.target as HTMLElement).closest('.home-sidebar__menu button, .home-projects__session, .home-projects__item, .home-recent-session')) setDrawerOpen(false) }}><LeftSidebar width={248} forceExpanded /></div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>}
      <SpotlightOverlay />
      <ConceptSpotlightOverlay />
    </AppShellProvider>
  )
}
