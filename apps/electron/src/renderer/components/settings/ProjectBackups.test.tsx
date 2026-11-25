import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { AgentSessionMeta, AgentWorkspace } from '@asci/shared'
import { agentSessionsAtom, agentWorkspacesAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { setAppLanguage } from '@/lib/i18n'
import { ProjectBackups } from './ProjectBackups'

const native = { id: 'native', name: 'Existing', projectOrigin: 'native' } as AgentWorkspace
const restored = { id: 'restored', name: 'Example', projectOrigin: 'native' } as AgentWorkspace
const existingSession = { id: 'existing-session', workspaceId: 'native' } as AgentSessionMeta
const restoredSession = { id: 'restored-session', workspaceId: 'restored' } as AgentSessionMeta
const inspection = { token: 'approved-token', projectName: 'Example', sessionCount: 2, documentCount: 3, imageCount: 4 }
const originalMarker = window.__TAURI_FORMAL__
const originalApi = window.electronAPI

afterEach(async () => {
  cleanup()
  window.__TAURI_FORMAL__ = originalMarker
  window.electronAPI = originalApi
  await setAppLanguage('en')
})

function setup() {
  const store = createStore()
  store.set(agentWorkspacesAtom, [native])
  store.set(agentSessionsAtom, [existingSession])
  store.set(currentAgentWorkspaceIdAtom, native.id)
  const backups = {
    exportBackup: mock(async (_id: string) => false),
    pick: mock(async () => inspection as typeof inspection | null),
    restore: mock(async (_token: string) => ({ workspaceId: restored.id, alreadyRestored: false })),
    discard: mock(async (_token: string) => {}),
  }
  const listAgentSessions = mock(async () => [existingSession, restoredSession])
  const listAgentWorkspaces = mock(async () => [native, restored])
  window.__TAURI_FORMAL__ = { hydrated: () => {}, projectBackups: backups }
  window.electronAPI = { listAgentSessions, listAgentWorkspaces } as unknown as Window['electronAPI']
  const view = () => <Provider store={store}><ProjectBackups /></Provider>
  return { backups, listAgentWorkspaces, listAgentSessions, store, view }
}

test('isolates the controls to native preview and requires selecting a project before export', async () => {
  const { backups, view } = setup()
  const marker = window.__TAURI_FORMAL__
  delete window.__TAURI_FORMAL__
  const { rerender } = render(view())
  expect(screen.queryByRole('button')).toBeNull()
  window.__TAURI_FORMAL__ = marker
  rerender(view())
  const save = screen.getByTestId('native-project-backup-export')
  expect(save).toBeDisabled()
  fireEvent.change(screen.getByTestId('native-project-backup-project'), { target: { value: native.id } })
  await act(async () => { fireEvent.click(save) })
  expect(backups.exportBackup.mock.calls).toEqual([[native.id]])
  expect(screen.queryByRole('status')).toBeNull()
})

test('cancels both native picking and preflight confirmation without restoring', async () => {
  const { backups, listAgentWorkspaces, view } = setup()
  backups.pick.mockResolvedValueOnce(null)
  render(view())
  await act(async () => { fireEvent.click(screen.getByTestId('native-project-backup-pick')) })
  expect(screen.queryByTestId('native-project-backup-preview')).toBeNull()
  fireEvent.click(screen.getByTestId('native-project-backup-pick'))
  expect(await screen.findByTestId('native-project-backup-preview')).toHaveTextContent('Conversations (2) · Documents (3) · Images (4)')
  expect(backups.restore).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByTestId('native-project-backup-cancel')) })
  expect(backups.discard.mock.calls).toEqual([[inspection.token]])
  expect(listAgentWorkspaces).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).toBeNull()
})

test('restores once, preserves current navigation and describes repeat restores', async () => {
  const { backups, store, view } = setup()
  backups.restore.mockResolvedValueOnce({ workspaceId: restored.id, alreadyRestored: false })
  backups.restore.mockResolvedValueOnce({ workspaceId: restored.id, alreadyRestored: true })
  render(view())
  for (const result of ['Project restored.', 'This project backup was already restored.']) {
    fireEvent.click(screen.getByTestId('native-project-backup-pick'))
    const confirm = await screen.findByTestId('native-project-backup-confirm')
    await act(async () => {
      fireEvent.click(confirm)
      fireEvent.click(confirm)
    })
    expect(screen.getByRole('status')).toHaveTextContent(result)
  }
  expect(backups.restore.mock.calls).toEqual([[inspection.token], [inspection.token]])
  expect(store.get(agentWorkspacesAtom)).toEqual([native, restored])
  expect(store.get(agentSessionsAtom)).toEqual([existingSession, restoredSession])
  expect(store.get(currentAgentWorkspaceIdAtom)).toBe(native.id)
  await act(async () => { await setAppLanguage('zh') })
  expect(screen.getByRole('status')).toHaveTextContent('此项目备份已恢复过。')
})

test('reports validation errors without exposing paths and retries a refresh without re-restoring', async () => {
  const { backups, listAgentSessions, view } = setup()
  backups.pick.mockRejectedValueOnce({ code: 'archiveChecksumMismatch', message: '/private/path' })
  listAgentSessions.mockRejectedValueOnce(new Error('/private/path'))
  render(view())
  fireEvent.click(screen.getByTestId('native-project-backup-pick'))
  expect(await screen.findByRole('alert')).toHaveTextContent('The backup failed its integrity check.')
  expect(screen.getByRole('alert')).not.toHaveTextContent('/private/path')
  fireEvent.click(screen.getByTestId('native-project-backup-pick'))
  fireEvent.click(await screen.findByTestId('native-project-backup-confirm'))
  expect(await screen.findByRole('alert')).toHaveTextContent('the project list could not refresh')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh projects' })) })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(backups.restore).toHaveBeenCalledTimes(1)
})
