import { SidebarGlyph } from '../app-shell/SidebarGlyph'
import { useCreateSession } from '@/hooks/useCreateSession'
/**
 * ProjectSwitcher — 科研项目切换入口
 *
 * 入口按钮（或图标）+ Popover：
 * - 列表展示所有项目，点击切换
 * - 底部"新建项目" inline 输入
 * - "管理项目..." 入口打开 ProjectManageDialog
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Folder, FolderOpen, Plus, Settings2, ChevronDown, Check } from 'lucide-react'
import { ProjectIcon } from '../app-shell/sidebar-icons'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  agentWorkspacesAtom, agentSessionsAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { AgentWorkspace } from '@asci/shared'
import { ProjectManageDialog } from './ProjectManageDialog'
import { useT } from '@/hooks/useT'
import { activeViewAtom } from '@/atoms/active-view'
import { activeTabIdAtom } from '@/atoms/tab-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'

interface ProjectSwitcherProps {
  /** 触发器形态：button 文本按钮 / icon 仅图标（收起状态用） */
  variant?: 'button' | 'icon' | 'list' | 'composer'
  onSelectProject?: (workspace: AgentWorkspace) => void
}

export function ProjectSwitcher({ variant = 'button', onSelectProject }: ProjectSwitcherProps): React.ReactElement {
  const { t } = useT('nav')
  const { t: tConv } = useT('conversation')
  const [workspaces, setWorkspaces] = useAtom(agentWorkspacesAtom)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useAtom(currentAgentWorkspaceIdAtom)

  /** default 工作区名称按当前语言显示，其余项目名称保留用户自填值 */
  const displayName = (ws: { slug: string; name: string }): string =>
    ws.slug === 'default' ? tConv('projectSwitcher.defaultName') : ws.name

  const drafts = useAtomValue(draftSessionIdsAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const activeView = useAtomValue(activeViewAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const openSession = useOpenSession()
  const { createAgent } = useCreateSession()
  const sessionCreateInFlight = React.useRef(false)
  const [pendingSessionWorkspace, setPendingSessionWorkspace] = React.useState<string | null>(null)
  const handleCreateInProject = async (workspaceId: string): Promise<void> => {
    if (sessionCreateInFlight.current) return
    sessionCreateInFlight.current = true
    setPendingSessionWorkspace(workspaceId)
    try { await createAgent({ draft: true, workspaceId }) }
    finally { sessionCreateInFlight.current = false; setPendingSessionWorkspace(null) }
  }
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())
  const [open, setOpen] = React.useState(false)
  const [manageOpen, setManageOpen] = React.useState(false)

  // 新建状态
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const createInputRef = React.useRef<HTMLInputElement>(null)
  const createInFlightRef = React.useRef(false)

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId) ?? workspaces[0] ?? null

  const handleSelect = (ws: AgentWorkspace): void => {
    if (onSelectProject) { onSelectProject(ws); setOpen(false); return }
    setCurrentWorkspaceId(ws.id)
    window.electronAPI.updateSettings({
      agentWorkspaceId: ws.id,
    }).catch(console.error)
    setOpen(false)
    if (variant === 'list') {
      setActiveView('project')
      setExpanded(prev => new Set([...prev, ws.id]))
    }
  }

  const handleStartCreate = (): void => {
    setCreating(true)
    setNewName('')
    requestAnimationFrame(() => createInputRef.current?.focus())
  }

  const handleCreate = async (): Promise<void> => {
    const trimmed = newName.trim()
    if (!trimmed) {
      setCreating(false)
      return
    }
    if (createInFlightRef.current) return
    createInFlightRef.current = true

    try {
      // 把当前工作区作为来源，让新项目继承已配置的 MCP 服务器
      const ws = await window.electronAPI.createAgentWorkspace(trimmed, currentWorkspace?.slug)
      setWorkspaces((prev) => [ws, ...prev])
      if (onSelectProject) onSelectProject(ws)
      else {
        setCurrentWorkspaceId(ws.id)
        window.electronAPI.updateSettings({ agentWorkspaceId: ws.id }).catch(console.error)
      }
      setCreating(false)
      setOpen(false)
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('projectSwitcher.createFailed')
      toast.error(msg)
      setCreating(false)
    } finally {
      createInFlightRef.current = false
    }
  }

  const handleCreateKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      handleCreate()
    } else if (e.key === 'Escape') {
      setCreating(false)
    }
  }

  if (variant === 'list') {
    return (
      <section className="home-projects" aria-label={t('sidebar.projects')}>
        <div className="home-projects__heading">
          <Button variant="subtle" size="inline" aria-label={t('projectSwitcher.manage')} onClick={() => setManageOpen(true)}>{t('sidebar.projects')}</Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('projectSwitcher.createNew')} onClick={handleStartCreate}>
            <Plus strokeWidth={1.5} />
          </Button>
        </div>
        <div className="home-projects__list">
          {workspaces.map((ws) => {
            const items = sessions.filter(item => item.workspaceId === ws.id && !item.archived && !drafts.has(item.id)).sort((a, b) => b.updatedAt - a.updatedAt)
            const isExpanded = expanded.has(ws.id)
            return <div key={ws.id} className="home-projects__branch">
              <div className={cn('home-projects__row', ws.id === currentWorkspaceId && activeView === 'project' && 'home-projects__item--active')}>
                <Button type="button" variant="ghost" size="row"
                  aria-current={ws.id === currentWorkspaceId ? 'page' : undefined}
                  className="home-projects__item" onClick={() => handleSelect(ws)}>
                  <span className="home-sidebar__nav-icon" aria-hidden="true" /><span className="truncate">{displayName(ws)}</span>
                </Button>
                <button type="button" className="home-projects__toggle" aria-expanded={isExpanded}
                  aria-label={t('projectTree.expand', { name: displayName(ws) })}
                  onClick={() => setExpanded(prev => { const next = new Set(prev); if (next.has(ws.id)) next.delete(ws.id); else next.add(ws.id); return next })}>
                  <SidebarGlyph name={isExpanded || ws.id === currentWorkspaceId ? "folderOpen" : "folder"} />
                </button>
                <button type="button" className="home-projects__create" aria-label={t('sidebar.newTask')} disabled={pendingSessionWorkspace !== null}
                  onClick={() => { void handleCreateInProject(ws.id) }}>
                  <SidebarGlyph name="projectAdd" />
                </button>
              </div>
              {isExpanded && <div className="home-projects__children">
                {items.length === 0 ? <p>{t('projectTree.empty')}</p> : items.map(item => <button key={item.id} type="button"
                  className={cn('home-projects__session', item.id === activeTabId && activeView === 'conversations' && 'home-projects__item--active')}
                  onClick={() => { openSession('agent', item.id, item.title, ws.id); setActiveView('conversations') }}>
                  <span className="truncate">{item.title}</span>
                </button>)}
              </div>}
            </div>
          })}
          {workspaces.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">{t('projectSwitcher.empty')}</p>}
          {creating && (
            <input ref={createInputRef} value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleCreateKeyDown} placeholder={t('projectSwitcher.createPlaceholder')}
              aria-label={t('projectSwitcher.createPlaceholder')} maxLength={50}
              className="home-projects__input" />
          )}
        </div>
        <ProjectManageDialog open={manageOpen} onOpenChange={setManageOpen} />
      </section>
    )
  }

  const trigger = variant === 'composer' ? (
    <Button type="button" variant="ghost" className="coding-project-picker">
      <Folder size={15} strokeWidth={1.5} />
      <span>{currentWorkspace && currentWorkspace.slug !== 'default' ? displayName(currentWorkspace) : t('projectTree.choose')}</span>
      <ChevronDown size={13} />
    </Button>
  ) : variant === 'icon' ? (
    <Button
      type="button"
      variant="ghost"
      className="h-auto w-auto p-2 rounded-[10px] text-foreground/60 hover:bg-foreground/[0.04] hover:text-foreground titlebar-no-drag [&_svg]:size-[18px]"
      aria-label={t('projectSwitcher.switchAria')}
    >
      <ProjectIcon size={18} />
    </Button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="row"
      className="flex-1 min-w-0 w-auto h-8 gap-2 p-2 rounded-[10px] text-sm leading-4 bg-foreground text-background hover:bg-foreground hover:text-background [&_svg]:size-3.5 titlebar-no-drag"
    >
      <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
        <ProjectIcon size={14} className="text-background/70" />
      </span>
      <span className="flex-1 min-w-0 truncate text-left">
        {currentWorkspace ? displayName(currentWorkspace) : t('projectSwitcher.noneSelected')}
      </span>
      <ChevronDown size={12} className="!size-3 flex-shrink-0 text-background/60" />
    </Button>
  )

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          className="w-64 p-0"
          align={variant === 'icon' ? 'start' : 'start'}
          side={variant === 'icon' ? 'right' : 'bottom'}
          sideOffset={8}
        >
          {/* 项目列表 */}
          <div className="py-1 max-h-[360px] overflow-y-auto scrollbar-thin">
            {workspaces.length === 0 && !creating && (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                {t('projectSwitcher.empty')}
              </div>
            )}
            {workspaces.map((ws) => {
              const isActive = ws.id === currentWorkspaceId
              return (
                <Button
                  key={ws.id}
                  type="button"
                  variant="list"
                  size="row"
                  onClick={() => handleSelect(ws)}
                  className={cn(
                    'py-1.5 text-sm [&_svg]:size-[13px]',
                    isActive ? 'bg-primary/5 text-foreground' : 'text-foreground/80 hover:bg-foreground/[0.04] hover:text-foreground',
                  )}
                >
                  <Check
                    size={13}
                    className={cn(
                      'flex-shrink-0',
                      isActive ? 'text-primary' : 'text-transparent',
                    )}
                  />
                  <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />
                  <span className="flex-1 min-w-0 truncate">{displayName(ws)}</span>
                </Button>
              )
            })}
          </div>

          {/* 新建 inline 输入 */}
          {creating ? (
            <div className="border-t border-border/60 px-3 py-2 flex items-center gap-2">
              <Plus size={13} className="flex-shrink-0 text-foreground/50" />
              <input
                ref={createInputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={handleCreateKeyDown}
                onBlur={() => {
                  if (!newName.trim()) setCreating(false)
                  else handleCreate()
                }}
                placeholder={t('projectSwitcher.createPlaceholder')}
                className="flex-1 min-w-0 bg-transparent text-sm text-foreground border-b border-primary/50 outline-none px-0.5"
                maxLength={50}
              />
            </div>
          ) : (
            <Button
              type="button"
              variant="list"
              size="row"
              onClick={handleStartCreate}
              className="border-t border-border/60 text-sm text-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground [&_svg]:size-[13px]"
            >
              <Plus size={13} className="flex-shrink-0" />
              <span>{t('projectSwitcher.createNew')}</span>
            </Button>
          )}

          {/* 管理入口 */}
          {workspaces.length > 0 && (
            <Button
              type="button"
              variant="list"
              size="row"
              onClick={() => {
                setOpen(false)
                setManageOpen(true)
              }}
              className="border-t border-border/60 text-sm text-foreground/60 hover:bg-foreground/[0.04] hover:text-foreground [&_svg]:size-[13px]"
            >
              <Settings2 size={13} className="flex-shrink-0" />
              <span>{t('projectSwitcher.manage')}</span>
            </Button>
          )}
        </PopoverContent>
      </Popover>

      <ProjectManageDialog open={manageOpen} onOpenChange={setManageOpen} />
    </>
  )
}
