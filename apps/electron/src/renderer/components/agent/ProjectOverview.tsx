/** 项目概览复用真实工作区和会话；项目内容与侧栏树保持一致。 */
import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Folder, Search, Settings2, MessageSquare } from 'lucide-react'
import { agentWorkspacesAtom, currentAgentWorkspaceIdAtom, agentSessionsAtom } from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { useProjectTaskStatuses } from '@/hooks/useProjectTaskStatuses'
import { useOpenSession } from '@/hooks/useOpenSession'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { useT } from '@/hooks/useT'
import { Button } from '@/components/ui/button'
import { ProjectDirectory } from './ProjectDirectory'
import { ProjectManageDialog } from './ProjectManageDialog'

export function ProjectOverview(): React.ReactElement {
  const { t } = useT('nav')
  const { t: tConv } = useT('conversation')
  const id = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const drafts = useAtomValue(draftSessionIdsAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  const setView = useSetAtom(activeViewAtom)
  const openSession = useOpenSession()
  const [query, setQuery] = React.useState('')
  const [manage, setManage] = React.useState(false)
  React.useEffect(() => setQuery(''), [id])
  const workspace = workspaces.find(item => item.id === id)
  const name = workspace?.slug === 'default' ? tConv('projectSwitcher.defaultName') : workspace?.name
  const all = sessions.filter(item => item.workspaceId === id && !item.archived && !drafts.has(item.id))
  const tasks = useProjectTaskStatuses(id, all.map(session => session.id))
  const items = all.filter(item => item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt)
  return <section className="project-overview titlebar-no-drag">
    <header className="project-overview__header"><span>{name}</span><Button variant="ghost" size="icon-sm" aria-label={t('projectTree.open')} onClick={() => setManage(true)}><Settings2 size={18} /></Button></header>
    <div className="project-overview__intro"><span className="project-overview__icon"><Folder size={26} strokeWidth={1.5} /></span><div><h1>{name}</h1><p>{t('projectTree.description')}</p></div></div>
    <div className="project-overview__tabs">{t('projectTree.sessions')} <span>{all.length}</span></div>
    <div className="project-overview__body">
      {workspace?.directoryStatus && window.__TAURI_FORMAL__?.bindProjectDirectory &&
        <ProjectDirectory key={workspace.id} workspace={workspace} />}
      <label className="project-overview__search"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('projectTree.search')} aria-label={t('projectTree.search')} /></label>
      {tasks.unavailable && <p role="status" className="text-sm text-muted-foreground">{t('projectTask.unavailable')}</p>}
      {items.length === 0 ? <p className="project-overview__empty">{t(query ? 'projectTree.noResults' : 'projectTree.empty')}</p> : <div className="project-overview__sessions">{items.map(item => {
        const task = tasks.statuses?.get(item.id)
        return <button key={item.id} type="button" onClick={() => { openSession('agent', item.id, item.title, id ?? undefined); setView('conversations') }}>
          <MessageSquare size={17} strokeWidth={1.5} /><span>{item.title}</span>
          {task && <span data-task-kind={task.kind} data-task-status={task.status} title={t('projectTask.latest')} className="ml-auto text-xs text-muted-foreground">
            <span className="sr-only">{t('projectTask.latest')} </span>{t(`projectTask.kind.${task.kind}`)} · {t(`projectTask.${task.status}`)}
          </span>}
        </button>
      })}</div>}
    </div>
    <ProjectManageDialog open={manage} onOpenChange={setManage} />
  </section>
}
