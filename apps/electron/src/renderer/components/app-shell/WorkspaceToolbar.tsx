/** 常驻窗口工具栏：侧栏抽屉、真实页面历史；不调用 Electron 网页 history。 */
import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { ArrowLeft, ArrowRight, PanelLeft } from 'lucide-react'
import { TabBar } from '@/components/tabs/TabBar'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import { activeViewAtom } from '@/atoms/active-view'
import { agentSessionsAtom, agentWorkspacesAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { activeTabIdAtom, tabsAtom, sidebarCollapsedAtom, openTab } from '@/atoms/tab-atoms'
import { navigationHistoryAtom, recordNavigationAtom } from '@/atoms/navigation-history'
interface WorkspaceToolbarProps { narrow: boolean; drawerOpen: boolean; onDrawerToggle: () => void }
export function WorkspaceToolbar({ narrow, drawerOpen, onDrawerToggle }: WorkspaceToolbarProps): React.ReactElement {
 const { t } = useT('nav')
 const [chrome, setChrome] = React.useState(() => window.electronAPI?.getWindowChromeState?.() ?? { platform: navigator.platform.includes('Mac') ? 'darwin' : 'other', fullscreen: window.outerHeight >= window.screen.height })
 React.useEffect(() => window.electronAPI?.onWindowChromeChanged?.(setChrome), [])
 const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom)
 const [view, setView] = useAtom(activeViewAtom)
 const [workspaceId, setWorkspace] = useAtom(currentAgentWorkspaceIdAtom)
 const [tabId, setTabId] = useAtom(activeTabIdAtom)
 const [tabs, setTabs] = useAtom(tabsAtom)
 const setSession = useSetAtom(currentAgentSessionIdAtom)
 const sessions = useAtomValue(agentSessionsAtom)
 const workspaces = useAtomValue(agentWorkspacesAtom)
 const [history, setHistory] = useAtom(navigationHistoryAtom)
 const record = useSetAtom(recordNavigationAtom)
 const active = tabs.find(item => item.id === tabId)
 const title = view === 'project' ? workspaces.find(item => item.id === workspaceId)?.name ?? t('sidebar.projects') : active?.title ?? t('sidebar.newTask')
 React.useEffect(() => {
   // 初始化完成前不记空页，避免加载后第一个后退跳回无效页面。
   if (!workspaceId || (view === 'conversations' && !active)) return
   record({ view, workspaceId, sessionId: view === 'conversations' ? active?.sessionId ?? null : null, title })
 }, [view, workspaceId, active?.sessionId, title, record])
 const navigate = (direction: -1 | 1): void => {
   let index = history.index + direction
   while (index >= 0 && index < history.entries.length) {
     const target = history.entries[index]!
     const session = target.sessionId ? sessions.find(item => item.id === target.sessionId) : null
     const tab = target.sessionId ? tabs.find(item => item.sessionId === target.sessionId) : null
     if ((!target.workspaceId || workspaces.some(item => item.id === target.workspaceId)) && (!target.sessionId || session || tab)) {
       setHistory(prev => ({ ...prev, index }))
       if (target.sessionId) {
         const result = openTab(tabs, { type: 'agent', sessionId: target.sessionId, title: session?.title ?? tab?.title ?? target.title, workspaceId: target.workspaceId ?? undefined })
         setTabs(result.tabs); setTabId(result.activeTabId); setSession(target.sessionId)
       }
       setView(target.view)
       setWorkspace(target.workspaceId)
       if (target.workspaceId) window.electronAPI.updateSettings({ agentWorkspaceId: target.workspaceId }).catch(console.error)
       return
     }
     index += direction
   }
 }
 const expanded = narrow ? drawerOpen : !collapsed
 return <header className="workspace-toolbar titlebar-drag-region" data-mac-windowed={chrome.platform === 'darwin' && !chrome.fullscreen} data-sidebar-collapsed={narrow || collapsed}>
   <div className="workspace-toolbar__controls titlebar-no-drag">
     <Button type="button" variant="ghost" size="icon-sm" data-sidebar-toggle aria-expanded={expanded} aria-label={t(expanded ? 'sidebar.collapse' : 'sidebar.expand')} onClick={() => narrow ? onDrawerToggle() : setCollapsed(!collapsed)}><PanelLeft size={17} strokeWidth={1.5} /></Button>
     <Button type="button" variant="ghost" size="icon-sm" aria-label={t('navigation.back')} disabled={history.index <= 0} onClick={() => navigate(-1)}><ArrowLeft size={17} strokeWidth={1.5} /></Button>
     <Button type="button" variant="ghost" size="icon-sm" aria-label={t('navigation.forward')} disabled={history.index >= history.entries.length - 1} onClick={() => navigate(1)}><ArrowRight size={17} strokeWidth={1.5} /></Button>
   </div>
   <div className="workspace-toolbar__title">{view === 'conversations' ? <TabBar /> : title}</div>
 </header>
}
