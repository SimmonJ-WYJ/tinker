import { atom, useAtomValue, useStore } from 'jotai'
import type { AgentSessionMeta } from '@asci/shared'
import { activeViewAtom } from '@/atoms/active-view'
import { activeTabAtom } from '@/atoms/tab-atoms'
import { agentSessionsAtom, agentWorkspacesAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { useT } from '@/hooks/useT'
import { Button } from '@/components/ui/button'
import { importWarningCodes, type SessionImportReport } from '../../../tauri-formal/session-import'
import { SettingsCard, SettingsRow, SettingsSection } from './primitives'

const errorCodes = [
  'invalidImportFolder', 'invalidImportIndex', 'unsupportedImportVersion', 'importLimit',
  'unsafeImportPath', 'importReadFailed', 'dialogBusy', 'closing', 'unsupported', 'failed', 'refresh',
] as const

type ImportErrorCode = typeof errorCodes[number]

interface ImportState {
  busy: boolean
  report?: SessionImportReport
  error?: ImportErrorCode
}

/** 在切换页签时保留本次导入状态；不持久化文件名、目录或对话内容。 */
const importStateAtom = atom<ImportState>({ busy: false })

function publicError(error: unknown): ImportErrorCode {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  if (code === 'imageDialogBusy') return 'dialogBusy'
  return errorCodes.find(known => known === code) ?? 'failed'
}

/** 快照读取期间被删除或更改的行优先；其余行接受宿主最新项目归属。 */
function reconcile<T extends { id: string }>(
  before: T[], current: T[], incoming: T[],
  keepLocalChange?: (current: T, before?: T, incoming?: T) => T,
): T[] {
  if (current === before) return incoming
  const original = new Map(before.map(row => [row.id, row]))
  const latest = new Map(incoming.map(row => [row.id, row]))
  const existing = new Set(current.map(row => row.id))
  const preserved = current.map(row => row === original.get(row.id)
    ? latest.get(row.id) ?? row
    : keepLocalChange?.(row, original.get(row.id), latest.get(row.id)) ?? row)
  return [...preserved, ...incoming.filter(row => !existing.has(row.id) && !original.has(row.id))]
}

function keepLocalSession(current: AgentSessionMeta, before?: AgentSessionMeta, incoming?: AgentSessionMeta): AgentSessionMeta {
  return before && !before.workspaceId && !current.workspaceId && incoming?.workspaceId
    ? { ...current, workspaceId: incoming.workspaceId }
    : current
}

export function SessionImport(): React.ReactElement | null {
  const { t } = useT('settings')
  const state = useAtomValue(importStateAtom)
  const store = useStore()
  const importer = window.__TAURI_FORMAL__?.importSessions
  if (!importer) return null

  const projectImport = Boolean(window.__TAURI_FORMAL__?.bindProjectDirectory)
  const navigation = () => ({
    session: store.get(currentAgentSessionIdAtom),
    tab: store.get(activeTabAtom)?.sessionId,
    workspace: store.get(currentAgentWorkspaceIdAtom),
    view: store.get(activeViewAtom),
  })
  const updateRecent = async (report: SessionImportReport, started = navigation()): Promise<void> => {
    const before = store.get(agentSessionsAtom)
    const previousProjects = store.get(agentWorkspacesAtom)
    try {
      const [sessions, projects] = await Promise.all([
        window.electronAPI.listAgentSessions(),
        projectImport ? window.electronAPI.listAgentWorkspaces() : undefined,
      ])
      const stayedOnSession = () => {
        const current = navigation()
        return started.session && started.tab === started.session && started.view !== 'project'
          && current.tab === started.tab && current.session === started.session
          && current.view === started.view && current.workspace === started.workspace
      }
      const oldSession = before.find(row => row.id === started.session)
      const currentSession = store.get(agentSessionsAtom).find(row => row.id === started.session)
      const newOwner = sessions.find(row => row.id === started.session)?.workspaceId
      if (oldSession && !oldSession.workspaceId && currentSession && !currentSession.workspaceId
        && newOwner && projects?.some(row => row.id === newOwner) && stayedOnSession()) {
        // 先保存活动项目，确保立即退出并重启仍能恢复此会话页签。
        await window.electronAPI.updateSettings({ agentWorkspaceId: newOwner })
        if (stayedOnSession()) store.set(currentAgentWorkspaceIdAtom, newOwner)
      }
      if (projects) store.set(agentWorkspacesAtom, current => reconcile(previousProjects, current, projects))
      store.set(agentSessionsAtom, current => reconcile(before, current, sessions, projectImport ? keepLocalSession : undefined))
      store.set(importStateAtom, { busy: false, report })
    } catch {
      store.set(importStateAtom, { busy: false, report, error: 'refresh' })
    }
  }

  const pick = async (): Promise<void> => {
    const previous = store.get(importStateAtom)
    if (previous.busy) return
    store.set(importStateAtom, { busy: true })
    const started = navigation()
    try {
      const report = await importer()
      if (report.cancelled) store.set(importStateAtom, previous)
      else if (projectImport || report.imported || report.unchanged || report.unconfirmed) await updateRecent(report, started)
      else store.set(importStateAtom, { busy: false, report })
    } catch (error) {
      store.set(importStateAtom, { busy: false, error: publicError(error) })
    }
  }

  const refresh = (): void => {
    const previous = store.get(importStateAtom)
    if (!previous.report || previous.busy) return
    store.set(importStateAtom, { busy: true, report: previous.report })
    void updateRecent(previous.report)
  }

  const { report } = state
  const errorKey = projectImport && state.error === 'invalidImportFolder' ? 'invalidProjectImportFolder' : state.error
  return (
    <SettingsSection title={t('sessionImport.title')}>
      <SettingsCard divided={false}>
        <SettingsRow label={t('sessionImport.label')} description={t(projectImport ? 'sessionImport.projectDescription' : 'sessionImport.description')}>
          <Button type="button" variant="outline" size="sm" data-testid="native-session-import"
            disabled={state.busy} onClick={() => void pick()}>
            {t(state.busy ? 'sessionImport.working' : 'sessionImport.button')}
          </Button>
        </SettingsRow>
        {report && (
          <div role="status" className="px-4 pb-3 text-sm">
            <p>{t('sessionImport.result', { imported: report.imported, unchanged: report.unchanged, skipped: report.skipped })}</p>
            {Boolean(report.projectsImported || report.projectsUpdated) && <p>{t('sessionImport.projectResult', {
              imported: report.projectsImported ?? 0, updated: report.projectsUpdated ?? 0,
            })}</p>}
            {report.unconfirmed > 0 && <p>{t('sessionImport.unconfirmed', { count: report.unconfirmed })}</p>}
            {Object.keys(report.warnings).length > 0 && (
              <ul className="mt-1 list-disc ps-5 text-muted-foreground">
                {importWarningCodes.map(code => report.warnings[code] ? (
                  <li key={code}>{t('sessionImport.warningCount', {
                    label: t(`sessionImport.warnings.${code}`), count: report.warnings[code],
                  })}</li>
                ) : null)}
              </ul>
            )}
          </div>
        )}
        {errorKey && (
          <div role="alert" className="px-4 pb-3 text-sm">
            <p>{t(`sessionImport.errors.${errorKey}`)}</p>
            {state.error === 'refresh' && (
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={refresh}>
                {t('sessionImport.refresh')}
              </Button>
            )}
          </div>
        )}
      </SettingsCard>
    </SettingsSection>
  )
}
