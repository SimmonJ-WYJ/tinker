import { atom, useAtomValue, useStore } from 'jotai'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
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

export function SessionImport(): React.ReactElement | null {
  const { t } = useT('settings')
  const state = useAtomValue(importStateAtom)
  const store = useStore()
  const importer = window.__TAURI_FORMAL__?.importSessions
  if (!importer) return null

  const updateRecent = async (report: SessionImportReport): Promise<void> => {
    const before = store.get(agentSessionsAtom)
    try {
      const sessions = await window.electronAPI.listAgentSessions()
      store.set(agentSessionsAtom, current => {
        if (current === before) return sessions
        // 列表读取期间创建、归档或删除的会话优先，只追加此前不存在的导入项。
        const known = new Set([...before, ...current].map(session => session.id))
        return [...current, ...sessions.filter(session => !known.has(session.id))]
      })
      store.set(importStateAtom, { busy: false, report })
    } catch {
      store.set(importStateAtom, { busy: false, report, error: 'refresh' })
    }
  }

  const pick = async (): Promise<void> => {
    const previous = store.get(importStateAtom)
    if (previous.busy) return
    store.set(importStateAtom, { busy: true })
    try {
      const report = await importer()
      if (report.cancelled) store.set(importStateAtom, previous)
      else if (report.imported || report.unchanged || report.unconfirmed) await updateRecent(report)
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
  return (
    <SettingsSection title={t('sessionImport.title')}>
      <SettingsCard divided={false}>
        <SettingsRow label={t('sessionImport.label')} description={t('sessionImport.description')}>
          <Button type="button" variant="outline" size="sm" data-testid="native-session-import"
            disabled={state.busy} onClick={() => void pick()}>
            {t(state.busy ? 'sessionImport.working' : 'sessionImport.button')}
          </Button>
        </SettingsRow>
        {report && (
          <div role="status" className="px-4 pb-3 text-sm">
            <p>{t('sessionImport.result', { imported: report.imported, unchanged: report.unchanged, skipped: report.skipped })}</p>
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
        {state.error && (
          <div role="alert" className="px-4 pb-3 text-sm">
            <p>{t(`sessionImport.errors.${state.error}`)}</p>
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
