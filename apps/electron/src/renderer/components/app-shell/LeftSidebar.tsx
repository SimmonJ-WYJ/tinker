import { SidebarGlyph } from './SidebarGlyph'
/**
 * LeftSidebar - 左侧导航栏
 *
 * 结构：
 * - 顶部：项目切换器 + 折叠侧边栏按钮
 * - 顶部菜单：搜索 / 配置 / 文献库 / 新建任务
 * - 工作区会话列表（扁平，按 updatedAt 倒序，不分组）
 * - 底部：用户资料 + 设置入口
 *
 * 折叠态保持简洁图标布局。
 */

import * as React from 'react'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import { toast } from 'sonner'
import {
  Plus,
  PanelLeftOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { SearchDialog } from './SearchDialog'
import { UpdateBadge } from './UpdateBadge'
import { UserAvatar } from '@/components/common/UserAvatar'
import { activeViewAtom } from '@/atoms/active-view'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import {
  agentSessionsAtom,
  agentSessionIndicatorMapAtom,
  unviewedCompletedSessionIdsAtom,
  workingDoneSessionIdsAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentSessionChannelMapAtom,
  agentSessionModelMapAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
} from '@/atoms/agent-atoms'
import {
  tabsAtom,
  activeTabIdAtom,
  sidebarCollapsedAtom,
  closeTab,
  updateTabTitle,
} from '@/atoms/tab-atoms'
import { userProfileAtom, useDisplayUserName } from '@/atoms/user-profile'
import { searchDialogOpenAtom } from '@/atoms/search-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { hasUpdateAtom } from '@/atoms/updater'
import { useOpenSession } from '@/hooks/useOpenSession'
import { ReviewSidebarItem } from './ReviewSidebarItem'
import { sessionReviewsAtom, isReviewSessionId } from '@/atoms/session-reviews-atoms'
import { LOGIN_ENABLED } from '@/lib/dev-mode'
import type { AgentSessionMeta } from '@asci/shared'
import { useCleanupSessionState } from '@/hooks/useCleanupSessionState'
import { useSyncActiveTabSideEffects } from '@/hooks/useSyncActiveTabSideEffects'
import { useT } from '@/hooks/useT'
import { ProjectSwitcher } from '@/components/agent/ProjectSwitcher'
import { AgentSessionItem } from '@/components/agent/AgentSessionItem'
import { AccountMenu } from '@/components/auth/AccountMenu'
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

interface SidebarMenuItemProps {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick?: () => void
  /** 右侧插槽：用于展示 badge、数字、指示器等 */
  trailing?: React.ReactNode
  /** Spotlight 引导目标值（挂在 button 元素上） */
  spotlightTarget?: string
  /** Concept-spotlight 引导目标值（与 spotlightTarget 共存，互不影响） */
  conceptSpotlightTarget?: string
}

/** 顶部菜单项：图标 + 文字的水平按钮 */
export function SidebarMenuItem({ icon, label, active, onClick, trailing, spotlightTarget, conceptSpotlightTarget }: SidebarMenuItemProps): React.ReactElement {
  return (
    <Button
      variant="ghost"
      size="row"
      onClick={onClick}
      data-spotlight-target={spotlightTarget}
      data-concept-spotlight-target={conceptSpotlightTarget}
      className={cn(
        'h-8 gap-2 p-2 rounded-[10px] text-sm leading-4 duration-100 titlebar-no-drag',
        active
          ? 'bg-primary/10 text-foreground hover:bg-primary/10 hover:text-foreground'
          : 'text-foreground hover:bg-primary/5 hover:text-foreground',
      )}
    >
      <span className="home-sidebar__nav-icon flex-shrink-0 w-4 h-4 flex items-center justify-center">{icon}</span>
      <span>{label}</span>
      {trailing ? <span className="ml-auto flex items-center -mr-1">{trailing}</span> : null}
    </Button>
  )
}

interface ZoteroConnectBadgeProps {
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void
}

export function ZoteroConnectBadge({ onClick }: ZoteroConnectBadgeProps): React.ReactElement {
  const { t } = useT('nav')

  return (
    <Badge
      tone="info"
      variant="soft"
      className="p-1 cursor-pointer hover:bg-info/15"
      onClick={onClick}
    >
      {t('sidebar.connectZotero')}
    </Badge>
  )
}

export interface LeftSidebarProps {
  width?: number
  forceExpanded?: boolean
}

export function leftSidebarHeaderGridClassName(): string {
  return 'grid grid-cols-[minmax(0,1fr)_36px] items-center gap-1.5 px-2'
}

export function leftSidebarMenuClassName(): string {
  return 'px-2 pt-2 flex flex-col gap-0.5'
}

export function leftSidebarWorkspaceLabelClassName(): string {
  return 'px-4 pt-4 pb-1 text-sm font-medium text-foreground/30 select-none flex-shrink-0'
}

export function leftSidebarSessionListClassName(): string {
  return 'flex-1 overflow-y-auto px-2 pb-3 scrollbar-none min-h-0'
}

export function leftSidebarSessionListInnerClassName(): string {
  return 'flex flex-col gap-0.5'
}

export function leftSidebarBottomClassName(className = ''): string {
  return ['px-2 pb-2', className].filter(Boolean).join(' ')
}

export function LeftSidebar({ width, forceExpanded = false }: LeftSidebarProps): React.ReactElement {
  const { t } = useT('nav')
  const [activeView, setActiveView] = useAtom(activeViewAtom)
  const reviewSessions = useAtomValue(sessionReviewsAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)
  const [hoveredId, setHoveredId] = React.useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)
  const [userProfile, setUserProfile] = useAtom(userProfileAtom)
  const displayUserName = useDisplayUserName()
  const hasUpdate = useAtomValue(hasUpdateAtom)

  const [agentSessions, setAgentSessions] = useAtom(agentSessionsAtom)
  const agentIndicatorMap = useAtomValue(agentSessionIndicatorMapAtom)
  const setUnviewedCompleted = useSetAtom(unviewedCompletedSessionIdsAtom)
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const agentModelId = useAtomValue(agentModelIdAtom)
  const setSessionChannelMap = useSetAtom(agentSessionChannelMapAtom)
  const setSessionModelMap = useSetAtom(agentSessionModelMapAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)

  const [tabs, setTabs] = useAtom(tabsAtom)
  const [activeTabId, setActiveTabId] = useAtom(activeTabIdAtom)
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  const openSession = useOpenSession()

  const setSearchDialogOpen = useSetAtom(searchDialogOpenAtom)

  const setWorkingDone = useSetAtom(workingDoneSessionIdsAtom)
  const cleanupSessionState = useCleanupSessionState()
  const syncActiveTabSideEffects = useSyncActiveTabSideEffects()

  /**
   * 最近未归档会话跨项目显示，按 updatedAt 倒序。
   * 列表顶部前置所有 review session（按 createdAt 倒序）—— 仅开发期演示用，
   * 数据来自 sessionReviewsAtom，刷新/重启会丢失；打包产物中被剥离。
   */
  const workspaceSessions = React.useMemo(() => {
    const real = agentSessions
      .filter((s) => !draftSessionIds.has(s.id))
      .filter((s) => !s.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    if (!currentWorkspaceId) return real
    const reviewProjections: AgentSessionMeta[] = reviewSessions
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        id: r.id,
        title: r.title,
        workspaceId: currentWorkspaceId,
        createdAt: r.createdAt,
        updatedAt: r.createdAt,
        archived: false,
      }))
    return [...reviewProjections, ...real]
  }, [agentSessions, currentWorkspaceId, draftSessionIds, reviewSessions])

  // 初始加载用户档案 + Agent 会话
  React.useEffect(() => {
    window.electronAPI.getUserProfile().then(setUserProfile).catch(console.error)
    window.electronAPI.listAgentSessions().then(setAgentSessions).catch(console.error)
  }, [setUserProfile, setAgentSessions])

  // 窗口聚焦时重新同步列表，修复长时间后前后端不一致
  React.useEffect(() => {
    const handleFocus = (): void => {
      window.electronAPI.listAgentSessions().then(setAgentSessions).catch(console.error)
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [setAgentSessions])

  /** 请求删除会话（弹出确认框） */
  const handleRequestDelete = (id: string): void => setPendingDeleteId(id)

  /** 确认删除 Agent 会话 */
  const handleConfirmDelete = async (): Promise<void> => {
    if (!pendingDeleteId) return
    const wasActive = activeTabId === pendingDeleteId
    const tabResult = closeTab(tabs, activeTabId, pendingDeleteId, currentWorkspaceId)
    setTabs(tabResult.tabs)
    setActiveTabId(tabResult.activeTabId)

    // 若关闭的是当前活跃标签，把 currentAgentSessionId 等同步到下一个标签，
    // 避免右侧面板因 currentAgentSessionId 被置空而消失
    if (wasActive) {
      const newActiveTab = tabResult.activeTabId
        ? tabResult.tabs.find((t) => t.id === tabResult.activeTabId) ?? null
        : null
      syncActiveTabSideEffects(newActiveTab)
    }

    setDraftSessionIds((prev: Set<string>) => {
      if (!prev.has(pendingDeleteId)) return prev
      const next = new Set(prev)
      next.delete(pendingDeleteId)
      return next
    })

    cleanupSessionState(pendingDeleteId)

    try {
      await window.electronAPI.deleteAgentSession(pendingDeleteId)
      const sessions = await window.electronAPI.listAgentSessions()
      setAgentSessions(sessions)
    } catch (error) {
      console.error('[侧边栏] 删除 Agent 会话失败:', error)
      setAgentSessions((prev) => prev.filter((s) => s.id !== pendingDeleteId))
    } finally {
      setPendingDeleteId(null)
    }
  }

  /** 创建新 Agent 会话（若当前活动标签已是空草稿会话则直接复用，避免重复打开同名标签） */
  const handleNewAgentSession = async (): Promise<void> => {
    try {
      const meta = await window.electronAPI.getOrCreateDraftAgentSession(agentChannelId || undefined, undefined)
      setAgentSessions((prev) => {
        if (prev.some((s) => s.id === meta.id)) return prev
        return [meta, ...prev]
      })
      if (agentChannelId) {
        setSessionChannelMap((prev) => {
          if (prev.get(meta.id) === agentChannelId) return prev
          const map = new Map(prev)
          map.set(meta.id, agentChannelId)
          return map
        })
      }
      if (agentModelId) {
        setSessionModelMap((prev) => {
          if (prev.get(meta.id) === agentModelId) return prev
          const map = new Map(prev)
          map.set(meta.id, agentModelId)
          return map
        })
      }
      openSession('agent', meta.id, meta.title, meta.workspaceId)
      setActiveView('conversations')
    } catch (error) {
      console.error('[侧边栏] 创建 Agent 会话失败:', error)
    }
  }

  /** 选择 Agent 会话（打开或聚焦标签页） */
  const handleSelectAgentSession = (id: string, title: string): void => {
    openSession('agent', id, title)
    setActiveView('conversations')
    setUnviewedCompleted((prev: Set<string>) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  /** 重命名 Agent 会话标题 */
  const handleAgentRename = async (id: string, newTitle: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.updateAgentSessionTitle(id, newTitle)
      setAgentSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      setTabs((prev) => updateTabTitle(prev, id, newTitle))
    } catch (error) {
      console.error('[侧边栏] 重命名 Agent 会话失败:', error)
    }
  }

  /** 切换 Agent 会话归档状态 */
  const handleToggleArchiveAgent = async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.toggleArchiveAgentSession(id)
      setAgentSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      if (updated.archived) {
        const wasActive = activeTabId === id
        const tabResult = closeTab(tabs, activeTabId, id, currentWorkspaceId)
        setTabs(tabResult.tabs)
        setActiveTabId(tabResult.activeTabId)
        if (wasActive) {
          const newActiveTab = tabResult.activeTabId
            ? tabResult.tabs.find((t) => t.id === tabResult.activeTabId) ?? null
            : null
          syncActiveTabSideEffects(newActiveTab)
        }
        setWorkingDone((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
      toast.success(updated.archived ? t('sidebar.toast.archived') : t('sidebar.toast.unarchived'))
    } catch (error) {
      console.error('[侧边栏] 切换 Agent 会话归档失败:', error)
    }
  }


  const deleteDialog = (
    <AlertDialog
      open={pendingDeleteId !== null}
      onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}
    >
      <AlertDialogContent
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirmDelete() } }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('sidebar.deleteConversation.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('sidebar.deleteConversation.description')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirmDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t('common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  // ===== 折叠态：精简图标视图 =====
  if (sidebarCollapsed && !forceExpanded) {
    return (
      <div
        className="home-sidebar-rail relative h-full flex flex-col items-center transition-[width] duration-300"
        style={{ width: 72, flexShrink: 0 }}
      >
        {/* 顶部 30px 留给 traffic lights，整条作为窗口拖动区 */}
        <div className="absolute top-0 left-0 right-0 h-[30px] titlebar-drag-region" />
        {/* 顶部留空避开 macOS 红绿灯 */}
        <div className="pt-[50px]" />

        {/* 展开按钮 */}
        <div className="pt-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('sidebar.expand')}
                onClick={() => setSidebarCollapsed(false)}
                className="h-auto w-auto p-2 rounded-[10px] text-foreground/60 hover:bg-foreground/[0.04] hover:text-foreground titlebar-no-drag"
              >
                <PanelLeftOpen size={18} className="!size-[18px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('sidebar.expand')}</TooltipContent>
          </Tooltip>
        </div>

        {/* 科研项目入口 */}
        <div className="pt-2">
          <ProjectSwitcher variant="icon" />
        </div>

        {/* 新会话按钮 */}
        <div className="pt-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleNewAgentSession}
                className="h-auto w-auto p-2 rounded-[10px] text-foreground/70 bg-primary/5 hover:bg-primary/10 hover:text-foreground/70 titlebar-no-drag border border-dashed border-[hsl(var(--dashed-border))] hover:border-[hsl(var(--dashed-border-hover))]"
              >
                <Plus size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('sidebar.newTask')}</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex-1" />

        {/* 用户头像（点击打开设置 · 跳到 About 页） */}
        <div className="pb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSettingsOpen(true)}
                className="relative h-auto w-auto p-1 rounded-[10px] titlebar-no-drag hover:bg-foreground/5"
              >
                <UserAvatar avatar={userProfile.avatar} size={28} />
                <UpdateBadge variant="dot" className="absolute -bottom-0.5 -right-0.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {hasUpdate ? t('sidebar.settingsWithUpdate') : t('sidebar.settings')}
            </TooltipContent>
          </Tooltip>
        </div>

        {deleteDialog}
  
        <SearchDialog />
      </div>
    )
  }

  // 展开态：侧栏直接从新建和搜索入口开始。
  return (
    <div className="home-sidebar relative h-full flex flex-col transition-[width] duration-300"
      style={{ width: width ?? 'var(--workspace-sidebar-width)', flexShrink: 0 }}>
      <div className="home-sidebar__menu">
        <SidebarMenuItem icon={<SidebarGlyph name="plus" />} label={t('sidebar.newTask')}
          active={activeView === 'conversations' && !!activeTabId && draftSessionIds.has(activeTabId)}
          onClick={handleNewAgentSession} spotlightTarget="new-task" conceptSpotlightTarget="new-task-nav" />
        <SidebarMenuItem icon={<SidebarGlyph name="search" />} label={t('sidebar.search')} onClick={() => setSearchDialogOpen(true)} />

      </div>
      <ProjectSwitcher variant="list" />
      <div className="home-sidebar__recent-label">{t('sidebar.recent')}</div>
      <div className="home-sidebar__sessions scrollbar-none">
        {workspaceSessions.map((session) => isReviewSessionId(session.id) ? (
          <ReviewSidebarItem key={session.id} title={session.title} active={session.id === activeTabId}
            onSelect={() => handleSelectAgentSession(session.id, session.title)} />
        ) : (
          <AgentSessionItem key={session.id} session={session} appearance="home" active={activeView === 'conversations' && session.id === activeTabId}
            hovered={session.id === hoveredId} indicatorStatus={agentIndicatorMap.get(session.id) ?? 'idle'}
            onSelect={() => handleSelectAgentSession(session.id, session.title)} onRequestDelete={() => handleRequestDelete(session.id)}
            onRename={handleAgentRename} onToggleArchive={handleToggleArchiveAgent}
            onMouseEnter={() => setHoveredId(session.id)} onMouseLeave={() => setHoveredId(null)} />
        ))}
        {workspaceSessions.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">{t('sidebar.emptySessions')}</p>}
      </div>
      {LOGIN_ENABLED ? <div className="home-sidebar__account"><AccountMenu /></div> : (
        <div className="home-sidebar__account"><Button variant="ghost" className="sidebar-account-trigger" onClick={() => setSettingsOpen(true)}>
          <UserAvatar avatar={userProfile.avatar} size={36} /><span className="flex-1 truncate text-left">{displayUserName}</span>
          <span className="sidebar-account-chevron"><SidebarGlyph name="chevron" /></span>
        </Button></div>
      )}
      {deleteDialog}<SearchDialog />
    </div>
  )
}
