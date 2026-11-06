import { PanelRight } from 'lucide-react'
/** 首屏项目面包屑与可访问的文档面板开关。 */
import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { agentWorkspacesAtom, currentAgentWorkspaceIdAtom, currentAgentSessionIdAtom, currentSessionSidePanelOpenAtom, agentSidePanelOpenMapAtom } from '@/atoms/agent-atoms'
import { rightPanelMaximizedAtom } from '@/atoms/right-panel-tabs'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'

export function HomePanelToggle(): React.ReactElement {
  const { t } = useT('nav')
  const id = useAtomValue(currentAgentSessionIdAtom)
  const open = useAtomValue(currentSessionSidePanelOpenAtom)
  const setOpen = useSetAtom(agentSidePanelOpenMapAtom)
  const setMaximized = useSetAtom(rightPanelMaximizedAtom)
  return <Button type="button" variant="ghost" size="icon" className="home-panel-toggle titlebar-no-drag"
    disabled={!id} aria-expanded={open} aria-label={t(open ? 'shell.closePanel' : 'shell.openPanel')}
    onClick={() => { if (id) { setMaximized(false); setOpen((prev) => new Map(prev).set(id, !open)) } }}>
    <PanelRight strokeWidth={1.5} />
  </Button>
}

export function HomeHeader(): React.ReactElement {
  const { t } = useT('onboarding')
  const { t: tConv } = useT('conversation')
  const wsId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const ws = workspaces.find((item) => item.id === wsId)
  return <header className="home-header titlebar-drag-region">
    <div className="home-header__breadcrumb">{ws && <><span>{ws.slug === 'default' ? tConv('projectSwitcher.defaultName') : ws.name}</span><span aria-hidden="true">/</span></>}<strong>{t('home.newConversation')}</strong></div>
    <HomePanelToggle />
  </header>
}
