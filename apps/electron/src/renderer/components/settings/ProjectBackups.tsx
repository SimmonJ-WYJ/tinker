import { atom, useAtomValue, useStore } from 'jotai'
import { useState } from 'react'
import { agentSessionsAtom, agentWorkspacesAtom } from '@/atoms/agent-atoms'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import type { ProjectBackupPreview, ProjectBackupReceipt } from '../../../tauri-formal/project-backups'
import { SettingsCard, SettingsRow, SettingsSection } from './primitives'

const publicErrors = [
  'backupFileExists', 'backupFileUnavailable', 'backupTooLarge', 'backupSelectionExpired',
  'invalidProjectArchive', 'archiveChecksumMismatch', 'unsupportedVersion', 'storageLimit',
  'projectConflict', 'recoveryRequired', 'projectArchiveBusy', 'missingArchiveAsset', 'imageDialogBusy',
] as const

interface BackupState {
  busy?: 'export' | 'pick' | 'restore' | 'discard' | 'refresh'
  preview?: ProjectBackupPreview
  exported?: boolean
  receipt?: ProjectBackupReceipt
  error?: typeof publicErrors[number] | 'failed' | 'refresh'
}

/** 设置切换不丢失一次预检或重复打开系统面板。 */
const backupStateAtom = atom<BackupState>({})

export function ProjectBackups(): React.ReactElement | null {
  const { t } = useT('settings')
  const backups = window.__TAURI_FORMAL__?.projectBackups
  const state = useAtomValue(backupStateAtom)
  const projects = useAtomValue(agentWorkspacesAtom).filter(workspace => workspace.projectOrigin)
  const store = useStore()
  const [selectedId, setSelectedId] = useState('')
  const workspaceId = projects.some(project => project.id === selectedId) ? selectedId : ''
  if (!backups) return null

  const refresh = async (receipt: ProjectBackupReceipt): Promise<BackupState> => {
    try {
      const [workspaces, sessions] = await Promise.all([
        window.electronAPI.listAgentWorkspaces(),
        window.electronAPI.listAgentSessions(),
      ])
      const restored = workspaces.find(workspace => workspace.id === receipt.workspaceId)
      if (!restored) throw new Error('restoredProjectUnavailable')
      store.set(agentWorkspacesAtom, current => current.some(workspace => workspace.id === restored.id) ? current : [...current, restored])
      store.set(agentSessionsAtom, current => {
        const existing = new Set(current.map(session => session.id))
        const additions = sessions.filter(session => session.workspaceId === restored.id && !existing.has(session.id))
        return additions.length ? [...current, ...additions] : current
      })
      return { receipt }
    } catch {
      return { receipt, error: 'refresh' }
    }
  }

  const run = async (action: NonNullable<BackupState['busy']>): Promise<void> => {
    const previous = store.get(backupStateAtom)
    const { preview, receipt } = previous
    if (previous.busy || (preview && action !== 'restore' && action !== 'discard')) return
    store.set(backupStateAtom, { ...previous, busy: action })
    try {
      if (action === 'export' && workspaceId) {
        store.set(backupStateAtom, await backups.exportBackup(workspaceId) ? { exported: true } : previous)
      } else if (action === 'pick') {
        const picked = await backups.pick()
        store.set(backupStateAtom, picked ? { preview: picked } : previous)
      } else if (action === 'discard' && preview) {
        await backups.discard(preview.token)
        store.set(backupStateAtom, {})
      } else if (action === 'restore' && preview) {
        store.set(backupStateAtom, await refresh(await backups.restore(preview.token)))
      } else if (action === 'refresh' && receipt) {
        store.set(backupStateAtom, await refresh(receipt))
      } else {
        store.set(backupStateAtom, previous)
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      store.set(backupStateAtom, { error: publicErrors.find(known => known === code) ?? 'failed' })
    }
  }

  return (
    <SettingsSection title={t('projectBackups.title')}>
      <SettingsCard divided>
        <SettingsRow label={t('projectBackups.exportLabel')} description={t('projectBackups.exportDescription')}>
          <div className="flex items-center gap-2">
            <select
              aria-label={t('projectBackups.project')}
              data-testid="native-project-backup-project"
              className="h-8 max-w-36 truncate rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={workspaceId}
              disabled={Boolean(state.busy || state.preview)}
              onChange={event => setSelectedId(event.currentTarget.value)}
            >
              <option value="">{t('projectBackups.selectProject')}</option>
              {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <Button type="button" variant="outline" size="sm" data-testid="native-project-backup-export"
              disabled={Boolean(state.busy || state.preview || !workspaceId)} onClick={() => void run('export')}>
              {t('projectBackups.export')}
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow label={t('projectBackups.restoreLabel')} description={t('projectBackups.restoreDescription')}>
          <Button type="button" variant="outline" size="sm" data-testid="native-project-backup-pick"
            disabled={Boolean(state.busy || state.preview)} onClick={() => void run('pick')}>
            {t('projectBackups.pick')}
          </Button>
        </SettingsRow>
        {state.preview && (
          <div className="space-y-2 px-4 py-3 text-sm" data-testid="native-project-backup-preview">
            <p className="break-words font-medium">{state.preview.projectName}</p>
            <p>{t('projectBackups.counts', {
              sessions: state.preview.sessionCount, documents: state.preview.documentCount, images: state.preview.imageCount,
            })}</p>
            <p className="text-muted-foreground">{t('projectBackups.rebind')}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" data-testid="native-project-backup-cancel"
                disabled={Boolean(state.busy)} onClick={() => void run('discard')}>
                {t('projectBackups.cancel')}
              </Button>
              <Button type="button" size="sm" data-testid="native-project-backup-confirm"
                disabled={Boolean(state.busy)} onClick={() => void run('restore')}>
                {t('projectBackups.confirm')}
              </Button>
            </div>
          </div>
        )}
        {(state.busy || state.exported || state.receipt) && (
          <p role="status" data-testid="native-project-backup-status" className="px-4 py-3 text-sm">
            {t(state.busy ? 'projectBackups.working' : state.exported ? 'projectBackups.saved'
              : state.receipt?.alreadyRestored ? 'projectBackups.duplicate' : 'projectBackups.restored')}
          </p>
        )}
        {state.error && (
          <div role="alert" data-testid="native-project-backup-error" className="px-4 py-3 text-sm">
            <p>{t(`projectBackups.errors.${state.error}`)}</p>
            {state.error === 'refresh' && (
              <Button type="button" variant="outline" size="sm" className="mt-2" disabled={Boolean(state.busy)}
                onClick={() => void run('refresh')}>
                {t('projectBackups.refresh')}
              </Button>
            )}
          </div>
        )}
      </SettingsCard>
    </SettingsSection>
  )
}
