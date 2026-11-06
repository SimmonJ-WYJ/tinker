/**
 * TabBar — 顶部标签栏
 *
 * 主对话流顶部标签栏。当前只显示当前会话 tab，避免与左侧会话列表形成重复导航。
 *
 * 支持：
 * - 中键关闭标签
 * - 拖拽入口保留（当前单 tab 呈现下不会触发重排）
 * - 横向滚动兜底（长标题 / 极窄宽度时仍可用）
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  tabsAtom,
  activeTabIdAtom,
  tabIndicatorMapAtom,
  visibleTabsAtom,
  closeTab,
} from '@/atoms/tab-atoms'
import type { TabItem } from '@/atoms/tab-atoms'
import type { SessionIndicatorStatus } from '@/atoms/agent-atoms'
import {
  agentSidePanelOpenMapAtom,
  agentSessionsAtom,
  agentChannelIdAtom,
  currentAgentSessionIdAtom,
  currentAgentWorkspaceIdAtom,
  unviewedCompletedSessionIdsAtom,
  workingDoneSessionIdsAtom,
} from '@/atoms/agent-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { TabBarItem } from './TabBarItem'
import { useSyncActiveTabSideEffects } from '@/hooks/useSyncActiveTabSideEffects'
import { useDisplaySessionTitle } from '@/hooks/useDisplaySessionTitle'
import { useT } from '@/hooks/useT'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { tabStripRootClassNames, tabStripScrollButtonClassNames } from './tab-strip-primitives.ts'

export function selectTopConversationTabs(tabs: TabItem[], activeTabId: string | null): TabItem[] {
  if (tabs.length === 0) return []
  const activeTab = activeTabId ? tabs.find((tab) => tab.id === activeTabId) : undefined
  return [activeTab ?? tabs[0]!]
}

export function conversationTabBarRootClassName(): string {
  return tabStripRootClassNames('h-10 relative items-center border-b border-border/60 gap-0')
}

export function TabBar(): React.ReactElement {
  const [tabs, setTabs] = useAtom(tabsAtom)
  const visibleTabs = useAtomValue(visibleTabsAtom)
  const [activeTabId, setActiveTabId] = useAtom(activeTabIdAtom)
  const indicatorMap = useAtomValue(tabIndicatorMapAtom)

  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)
  const setWorkingDone = useSetAtom(workingDoneSessionIdsAtom)

  const syncActiveTabSideEffects = useSyncActiveTabSideEffects()
  const [draftSessionIds, setDraftSessionIds] = useAtom(draftSessionIdsAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)

  const setAgentSidePanelOpen = useSetAtom(agentSidePanelOpenMapAtom)

  /** 清理关闭标签对应的 per-session Map atoms 条目 */
  const cleanupMapAtoms = React.useCallback((tabId: string) => {
    const deleteKey = <T,>(prev: Map<string, T>): Map<string, T> => {
      if (!prev.has(tabId)) return prev
      const map = new Map(prev)
      map.delete(tabId)
      return map
    }
    setAgentSidePanelOpen(deleteKey)
  }, [setAgentSidePanelOpen])

  // 拖拽状态
  const dragState = React.useRef<{
    dragging: boolean
    tabId: string
    startX: number
    startIndex: number
  } | null>(null)

  const handleActivate = React.useCallback((tabId: string) => {
    setActiveTabId(tabId)

    const tab = tabs.find((t) => t.id === tabId)
    if (!tab) return

    setCurrentAgentSessionId(tab.sessionId)

    setUnviewedCompleted((prev) => {
      if (!prev.has(tab.sessionId)) return prev
      const next = new Set(prev)
      next.delete(tab.sessionId)
      return next
    })

    const session = agentSessions.find((s) => s.id === tab.sessionId)
    if (session?.workspaceId) {
      setCurrentAgentWorkspaceId(session.workspaceId)
      window.electronAPI.updateSettings({
        agentWorkspaceId: session.workspaceId,
      }).catch(console.error)
    }
  }, [setActiveTabId, tabs, agentSessions, setCurrentAgentSessionId, setCurrentAgentWorkspaceId, setUnviewedCompleted])

  /** 关闭标签后的公共清理：per-session Map atoms + Working Done 集合 */
  const cleanupClosedTab = React.useCallback((tabId: string) => {
    cleanupMapAtoms(tabId)
    setWorkingDone((prev) => {
      if (!prev.has(tabId)) return prev
      const next = new Set(prev)
      next.delete(tabId)
      return next
    })
  }, [cleanupMapAtoms, setWorkingDone])

  const handleClose = React.useCallback((tabId: string) => {
    const closingTab = tabs.find((t) => t.id === tabId)
    // "末个标签"按当前工作区可见集判定：其他工作区的 tab 仍可能存活于全局数组
    const isLastTab = visibleTabs.length === 1 && visibleTabs[0]?.id === tabId && closingTab

    // 关闭最后一个标签且其会话已是草稿（未发送消息）时，当前画面已等同"新建任务"
    // 的欢迎屏；直接 no-op，避免销毁旧草稿再建一个完全相同的新草稿造成无谓重渲染
    if (isLastTab && draftSessionIds.has(closingTab.sessionId)) {
      return
    }

    // 关闭最后一个标签（非草稿）：行为与"新建任务"一致。复用工作区下已有的空会话
    // （没有才新建），避免反复关闭堆积大量"新 Agent 会话"；再用单次 setTabs 把旧标签
    // 换成草稿标签——tabs 永不经过空数组，避免闪现 WelcomeView。
    if (isLastTab) {
      void (async () => {
        try {
          const meta = await window.electronAPI.getOrCreateDraftAgentSession(
            agentChannelId || undefined,
            currentWorkspaceId || undefined,
          )
          const newTab: TabItem = {
            id: meta.id,
            type: 'agent',
            sessionId: meta.id,
            title: meta.title,
            workspaceId: meta.workspaceId ?? currentWorkspaceId ?? undefined,
          }
          // 原子替换：旧标签直接被草稿标签顶掉，渲染上不出现空态；
          // 只移除被关闭的 tab，保留其他工作区仍存活的 tab
          setTabs((prev) => [...prev.filter((t) => t.id !== tabId), newTab])
          setActiveTabId(newTab.id)
          // 复用场景下会话可能已在列表中，去重后前插，避免侧边栏出现重复条目
          setAgentSessions((prev) => [meta, ...prev.filter((s) => s.id !== meta.id)])
          setDraftSessionIds((prev) => {
            const next = new Set(prev)
            next.add(meta.id)
            return next
          })
          setCurrentAgentSessionId(meta.id)
          setActiveView('conversations')
          cleanupClosedTab(tabId)
        } catch (error) {
          console.error('[TabBar] 关闭最后标签后切到草稿会话失败:', error)
        }
      })()
      return
    }

    const wasActive = activeTabId === tabId
    const result = closeTab(tabs, activeTabId, tabId, currentWorkspaceId)
    setTabs(result.tabs)
    setActiveTabId(result.activeTabId)

    // 若关闭的是当前活跃标签，将 appMode/currentXxxId 等同步到新激活的标签
    if (wasActive) {
      const newActiveTab = result.activeTabId
        ? result.tabs.find((t) => t.id === result.activeTabId) ?? null
        : null
      syncActiveTabSideEffects(newActiveTab)
    }

    cleanupClosedTab(tabId)
  }, [tabs, visibleTabs, activeTabId, setTabs, setActiveTabId, cleanupClosedTab, syncActiveTabSideEffects, draftSessionIds, agentChannelId, currentWorkspaceId, setAgentSessions, setDraftSessionIds, setCurrentAgentSessionId, setActiveView])

  const handleDragStart = React.useCallback((tabId: string, e: React.PointerEvent) => {
    if (e.button !== 0) return // 只处理左键
    const idx = tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return

    dragState.current = {
      dragging: false,
      tabId,
      startX: e.clientX,
      startIndex: idx,
    }

    const handleMove = (me: PointerEvent): void => {
      if (!dragState.current) return
      const dx = Math.abs(me.clientX - dragState.current.startX)
      if (dx > 5) dragState.current.dragging = true
    }

    const handleUp = (): void => {
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
      dragState.current = null
    }

    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }, [tabs])

  if (visibleTabs.length === 0) return <div className="h-[38px] titlebar-drag-region" />

  // 仅渲染当前工作区可见的 tab（#458）。
  // 显示顺序与左侧 Workspace 列表保持一致：按对应 session.updatedAt 倒序，
  // 找不到对应 session 的 tab（非 agent 或已被删除）排在末尾，保留原插入顺序
  const updatedAtBySessionId = new Map(agentSessions.map((s) => [s.id, s.updatedAt]))
  const insertIndexByTabId = new Map(visibleTabs.map((t, i) => [t.id, i]))
  const displayTabs = [...visibleTabs].sort((a, b) => {
    const sa = updatedAtBySessionId.get(a.sessionId)
    const sb = updatedAtBySessionId.get(b.sessionId)
    if (sa == null && sb == null) return insertIndexByTabId.get(a.id)! - insertIndexByTabId.get(b.id)!
    if (sa == null) return 1
    if (sb == null) return -1
    return sb - sa
  })

  const topTabs = selectTopConversationTabs(displayTabs, activeTabId)

  return (
    <TabBarInner
      tabs={topTabs}
      activeTabId={activeTabId}
      streamingMap={indicatorMap}
      onActivate={handleActivate}
      onClose={handleClose}
      onDragStart={handleDragStart}
    />
  )
}

/** 内部组件：管理全局 hover 状态，确保同一时刻只有一个预览面板 */
function TabBarInner({
  tabs,
  activeTabId,
  streamingMap,
  onActivate,
  onClose,
  onDragStart,
}: {
  tabs: TabItem[]
  activeTabId: string | null
  streamingMap: Map<string, SessionIndicatorStatus>
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onDragStart: (tabId: string, e: React.PointerEvent) => void
}): React.ReactElement {
  const displayTitle = useDisplaySessionTitle()
  const [hoveredTabId, setHoveredTabId] = React.useState<string | null>(null)
  const [isLeaving, setIsLeaving] = React.useState(false)
  const enterTimerRef = React.useRef<ReturnType<typeof setTimeout>>()
  const leaveTimerRef = React.useRef<ReturnType<typeof setTimeout>>()
  const fadeTimerRef = React.useRef<ReturnType<typeof setTimeout>>()

  React.useEffect(() => {
    return () => {
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current)
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [])

  const handleTabHoverEnter = React.useCallback((tabId: string) => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    if (enterTimerRef.current) clearTimeout(enterTimerRef.current)
    setIsLeaving(false)

    // 如果已经有面板打开（从一个 Tab 滑到另一个），立即切换
    if (hoveredTabId) {
      setHoveredTabId(tabId)
    } else {
      // 首次 hover，延迟 300ms
      enterTimerRef.current = setTimeout(() => setHoveredTabId(tabId), 300)
    }
  }, [hoveredTabId])

  const handleTabHoverLeave = React.useCallback(() => {
    if (enterTimerRef.current) clearTimeout(enterTimerRef.current)
    leaveTimerRef.current = setTimeout(() => {
      setIsLeaving(true)
      fadeTimerRef.current = setTimeout(() => {
        setHoveredTabId(null)
        setIsLeaving(false)
      }, 80)
    }, 200)
  }, [])

  // 面板的 hover 进入（阻止关闭）
  const handlePanelHoverEnter = React.useCallback(() => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    setIsLeaving(false)
  }, [])

  const { t } = useT('nav')
  const scrollerRef = React.useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = React.useState({ left: false, right: false })
  const showScrollButtons = tabs.length > 1

  const recomputeOverflow = React.useCallback((): void => {
    const el = scrollerRef.current
    if (!el) return
    // 无溢出时强制 scrollLeft=0，避免标签关闭/窗口放大后残留偏移导致首个 tab 视觉上左移
    if (el.scrollWidth <= el.clientWidth + 1 && el.scrollLeft !== 0) {
      el.scrollLeft = 0
    }
    const left = el.scrollLeft > 0
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setOverflow((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])

  // 监听容器尺寸变化（窗口 resize / 侧栏宽度变化）触发溢出重算
  React.useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => recomputeOverflow())
    ro.observe(el)
    recomputeOverflow()
    return () => ro.disconnect()
  }, [recomputeOverflow])

  // 标签数量变化时重算（新增/关闭）
  React.useEffect(() => {
    recomputeOverflow()
  }, [tabs.length, recomputeOverflow])

  // 切换 active 时把对应 Tab 滚入视野；
  // 同时依赖 tabs，覆盖应用启动后 tabs 异步水合的场景：
  // 之前若 activeTabId 早于 tabs 列表到位，effect 只会运行一次而查询不到元素，导致启动后活跃 Tab 不可见。
  // 自定义 scroll 计算：左右两侧的箭头按钮（w-12 = 48px）以 absolute 覆盖在 scroller 边缘，
  // 浏览器的 `scrollIntoView({inline:'nearest'})` 不知道 tab 被箭头遮挡，会把"部分可见"判定为已到位。
  // 这里改为：若 tab 任意一侧被箭头遮挡，则手动 scrollLeft 到让其完全离开箭头区域。
  // 首次到位时用 'auto'（不动画），之后切换才用 'smooth'。
  const didInitialScrollRef = React.useRef(false)

  // 单独的滚动执行函数：根据当前 active tab 计算并直接写 scrollLeft（不依赖 smooth 行为）
  const scrollActiveIntoView = React.useCallback((smooth: boolean): boolean => {
    const scroller = scrollerRef.current
    if (!scroller || !activeTabId) return false
    const el = scroller.querySelector<HTMLDivElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`)
    if (!el || scroller.clientWidth === 0 || el.offsetWidth === 0) return false

    const CHEVRON_BUFFER = 48
    const scrollerWidth = scroller.clientWidth
    const elLeftInScroller = el.offsetLeft
    const elRight = elLeftInScroller + el.offsetWidth
    const visibleLeft = scroller.scrollLeft + CHEVRON_BUFFER
    const visibleRight = scroller.scrollLeft + scrollerWidth - CHEVRON_BUFFER

    let nextScrollLeft: number | null = null
    if (elLeftInScroller < visibleLeft) {
      nextScrollLeft = Math.max(0, elLeftInScroller - CHEVRON_BUFFER)
    } else if (elRight > visibleRight) {
      nextScrollLeft = Math.max(0, elRight - scrollerWidth + CHEVRON_BUFFER)
    }

    if (nextScrollLeft != null) {
      if (smooth) {
        scroller.scrollTo({ left: nextScrollLeft, behavior: 'smooth' })
      } else {
        scroller.scrollLeft = nextScrollLeft
      }
    }
    return true
  }, [activeTabId])

  // 首次挂载：等待 tabs 渲染完成（scrollWidth 在连续两帧保持稳定）再触发一次滚动定位。
  // 不依赖 scrollIntoView / smooth scroll，避免启动布局抖动期间被覆盖或忽略。
  React.useEffect(() => {
    if (didInitialScrollRef.current) return
    if (!activeTabId || tabs.length === 0) return

    let cancelled = false
    let rafId: number | null = null
    let lastScrollWidth = -1
    let stableFrames = 0

    const waitForStableLayout = (): void => {
      if (cancelled) return
      const scroller = scrollerRef.current
      if (!scroller || scroller.clientWidth === 0) {
        rafId = requestAnimationFrame(waitForStableLayout)
        return
      }
      const currentScrollWidth = scroller.scrollWidth
      if (currentScrollWidth === lastScrollWidth && currentScrollWidth > 0) {
        stableFrames += 1
      } else {
        stableFrames = 0
        lastScrollWidth = currentScrollWidth
      }
      // 连续 2 帧 scrollWidth 没变 → 视为 tabs 渲染完成
      if (stableFrames >= 2) {
        if (scrollActiveIntoView(false)) {
          didInitialScrollRef.current = true
          return
        }
      }
      rafId = requestAnimationFrame(waitForStableLayout)
    }
    rafId = requestAnimationFrame(waitForStableLayout)

    return () => {
      cancelled = true
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [activeTabId, tabs, scrollActiveIntoView])

  // 后续 active 切换：直接平滑滚动，无需等待
  React.useEffect(() => {
    if (!didInitialScrollRef.current) return
    scrollActiveIntoView(true)
  }, [activeTabId, scrollActiveIntoView])

  return (
    <div className={conversationTabBarRootClassName()}>
      <div className="absolute inset-0 titlebar-drag-region" />

      <div className="relative flex h-full min-w-0 flex-1 items-center">
        {showScrollButtons && (
          <ChevronScrollButton
            direction="left"
            visible={overflow.left}
            scrollerRef={scrollerRef}
            label={t('tabs.scrollLeft')}
          />
        )}
        <div
          ref={scrollerRef}
          onScroll={recomputeOverflow}
          className="flex h-full min-w-0 flex-1 items-center overflow-x-auto scrollbar-none titlebar-drag-region"
        >
          {tabs.map((tab) => (
            <TabBarItem
              key={tab.id}
              id={tab.id}
              type={tab.type}
              title={tab.type === 'agent' ? displayTitle(tab.title) : tab.title}
              isActive={tab.id === activeTabId}
              isStreaming={streamingMap.get(tab.id) ?? 'idle'}
              isHovered={hoveredTabId === tab.id}
              isLeaving={hoveredTabId === tab.id && isLeaving}
              onActivate={() => onActivate(tab.id)}
              onClose={() => onClose(tab.id)}
              onMiddleClick={() => onClose(tab.id)}
              onDragStart={(e) => onDragStart(tab.id, e)}
              onHoverEnter={() => handleTabHoverEnter(tab.id)}
              onHoverLeave={handleTabHoverLeave}
              onPanelHoverEnter={handlePanelHoverEnter}
              onPanelHoverLeave={handleTabHoverLeave}
            />
          ))}
        </div>
        {showScrollButtons && (
          <ChevronScrollButton
            direction="right"
            visible={overflow.right}
            scrollerRef={scrollerRef}
            label={t('tabs.scrollRight')}
          />
        )}
      </div>
    </div>
  )
}

/**
 * 滚动箭头按钮：溢出时显示，点击 scrollBy ±150，hover 持续滚动（rAF）
 * 不可见时仍挂载但 opacity-0 + pointer-events-none，避免溢出状态闪烁导致动画卡顿
 */
function ChevronScrollButton({
  direction,
  visible,
  scrollerRef,
  label,
}: {
  direction: 'left' | 'right'
  visible: boolean
  scrollerRef: React.RefObject<HTMLDivElement | null>
  label: string
}): React.ReactElement {
  const rafRef = React.useRef<number | null>(null)
  const delayRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopAutoScroll = React.useCallback((): void => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (delayRef.current != null) {
      clearTimeout(delayRef.current)
      delayRef.current = null
    }
  }, [])

  React.useEffect(() => stopAutoScroll, [stopAutoScroll])

  // 溢出消失（滚到底了）时也应该停掉持续滚动，避免按钮 fade 时仍在 rAF
  React.useEffect(() => {
    if (!visible) stopAutoScroll()
  }, [visible, stopAutoScroll])

  const dir = direction === 'left' ? -1 : 1

  const handleClick = (): void => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: dir * 150, behavior: 'smooth' })
  }

  const handlePointerEnter = (): void => {
    stopAutoScroll()
    delayRef.current = setTimeout(() => {
      const step = (): void => {
        const el = scrollerRef.current
        if (!el) return
        el.scrollLeft += dir * 3
        rafRef.current = requestAnimationFrame(step)
      }
      rafRef.current = requestAnimationFrame(step)
    }, 250)
  }

  const Icon = direction === 'left' ? ChevronLeft : ChevronRight

  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={handleClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={stopAutoScroll}
      onPointerCancel={stopAutoScroll}
      onPointerUp={stopAutoScroll}
      tabIndex={visible ? 0 : -1}
      className={cn(
        'absolute top-px z-10 h-full w-12 rounded-none px-0',
        tabStripScrollButtonClassNames('hover:text-foreground hover:bg-transparent'),
        'bg-gradient-to-r transition-opacity duration-150',
        direction === 'left'
          ? 'left-0 justify-start pl-1.5 from-background from-60% to-transparent'
          : 'right-0 justify-end pr-1.5 from-transparent to-background to-40%',
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
      )}
    >
      <Icon className="size-4" />
    </Button>
  )
}
