import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { AgentSessionMeta } from '@asci/shared'
import type { SessionImporter, SessionImportReport } from '../../../tauri-formal/session-import'
import { agentSessionsAtom, agentWorkspacesAtom, currentAgentWorkspaceIdAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { tabsAtom, activeTabIdAtom, backfillTabWorkspaceIds, filterVisibleTabs } from '@/atoms/tab-atoms'
import { setAppLanguage } from '@/lib/i18n'
import { SessionImport } from './SessionImport'

const empty: SessionImportReport = { cancelled: false, unconfirmed: 0, imported: 0, unchanged: 0, skipped: 0, warnings: {} }
const originalMarker = window.__TAURI_FORMAL__
const originalApi = window.electronAPI

afterEach(async () => {
  cleanup()
  window.__TAURI_FORMAL__ = originalMarker
  window.electronAPI = originalApi
  await setAppLanguage('en')
})

function setup(importSessions: SessionImporter, list: () => Promise<AgentSessionMeta[]>) {
  const store = createStore()
  window.__TAURI_FORMAL__ = { hydrated: () => {}, importSessions }
  window.electronAPI = { listAgentSessions: list } as unknown as Window['electronAPI']
  const view = () => <Provider store={store}><SessionImport /></Provider>
  return { store, view }
}

test('normal Electron has no import control; dismissing the picker does not refresh Recent', async () => {
  await setAppLanguage('en')
  const list = mock(async () => [])
  const { view } = setup(async () => ({ ...empty, cancelled: true }), list)
  const marker = window.__TAURI_FORMAL__
  delete window.__TAURI_FORMAL__
  const { rerender } = render(view())
  expect(screen.queryByRole('button')).toBeNull()
  window.__TAURI_FORMAL__ = marker
  rerender(view())
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Import conversations' })) })
  expect(list).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).toBeNull()
})

test('switching settings leaves one import, updates Recent, and preserves the open conversation', async () => {
  await setAppLanguage('en')
  let resolve!: (result: SessionImportReport) => void
  const run = mock(() => new Promise<SessionImportReport>(done => { resolve = done }))
  const returned = [{ id: 'restored', title: 'Imported example' }] as AgentSessionMeta[]
  const { view, store } = setup(run, async () => returned)
  store.set(currentAgentSessionIdAtom, 'active')
  const panel = render(view())
  fireEvent.click(screen.getByRole('button'))
  panel.unmount()
  render(view())
  expect(screen.getByRole('button')).toBeDisabled()
  fireEvent.click(screen.getByRole('button'))
  expect(run).toHaveBeenCalledTimes(1)
  await act(async () => { resolve({ ...empty, imported: 1, skipped: 1, warnings: { missingAttachment: 2 } }) })
  expect(screen.getByRole('status')).toHaveTextContent('Imported 1')
  expect(screen.getByRole('status')).toHaveTextContent('Missing attachments')
  expect(store.get(agentSessionsAtom)).toEqual(returned)
  expect(store.get(currentAgentSessionIdAtom)).toBe('active')
  await act(async () => { await setAppLanguage('zh') })
  expect(screen.getByRole('status')).toHaveTextContent('缺失的附件')
})

test('duplicate import refreshes saved conversations; refreshing after a list error does not import twice', async () => {
  const run = mock(async () => ({ ...empty, unchanged: 1 }))
  const list = mock(async (): Promise<AgentSessionMeta[]> => { throw Error('untrusted/path') })
  const { view } = setup(run, list)
  render(view())
  fireEvent.click(screen.getByRole('button'))
  expect(await screen.findByRole('alert')).not.toHaveTextContent('untrusted/path')
  expect(screen.getByRole('status')).toHaveTextContent('already imported 1')
  list.mockImplementation(async () => [])
  fireEvent.click(screen.getByRole('button', { name: 'Refresh conversations' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(list).toHaveBeenCalledTimes(2)
  expect(run).toHaveBeenCalledTimes(1)
})

test('picker errors display localized instructions without raw paths or error details', async () => {
  await setAppLanguage('zh')
  const { view } = setup(async () => { throw { code: 'invalidImportFolder', message: '/private/user' } }, async () => [])
  render(view())
  fireEvent.click(screen.getByRole('button'))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('agent-sessions.json')
  expect(alert).not.toHaveTextContent('/private/user')
})

test('an unconfirmed write stays distinct from skipped conversations, and Recent can reconcile it', async () => {
  await setAppLanguage('en')
  const list = mock(async () => [])
  const { view } = setup(async () => ({ ...empty, unconfirmed: 1, skipped: 1, warnings: { importStopped: 1 } }), list)
  render(view())
  fireEvent.click(screen.getByRole('button', { name: 'Import conversations' }))
  const report = await screen.findByRole('status')
  expect(report).toHaveTextContent('Imported 0 · already imported 0 · skipped 1')
  expect(report).toHaveTextContent('Unconfirmed 1')
  expect(list).toHaveBeenCalledTimes(1)
})

test('a late refresh keeps sessions created, changed, or removed while it was in flight', async () => {
  const sessions = (...ids: string[]) => ids.map(id => ({ id, title: id })) as AgentSessionMeta[]
  let finish!: (rows: AgentSessionMeta[]) => void
  const list = mock(() => new Promise<AgentSessionMeta[]>(resolve => { finish = resolve }))
  const { view, store } = setup(async () => ({ ...empty, imported: 1 }), list)
  store.set(agentSessionsAtom, sessions('deleted', 'renamed'))
  render(view())
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
  const newer = sessions('renamed', 'new')
  newer[0]!.title = 'New title'
  store.set(agentSessionsAtom, newer)
  await act(async () => { finish(sessions('deleted', 'renamed', 'imported')) })
  expect(store.get(agentSessionsAtom)).toEqual([...newer, ...sessions('imported')])
})

test('project-only imports and unchanged retries refresh authoritative project rows without changing the selected conversation', async () => {
  const report = { ...empty, projectsImported: 2, projectsUpdated: 1 }
  const { view, store } = setup(async () => report, async () => [])
  window.__TAURI_FORMAL__!.bindProjectDirectory = async () => false
  const projects = ['project-a', 'project-b'].map(id => ({ id, name: 'Shared name', slug: id, createdAt: 1, updatedAt: 1 }))
  const list = mock(async () => projects)
  window.electronAPI.listAgentWorkspaces = list
  store.set(currentAgentSessionIdAtom, 'open-chat')
  render(view())
  fireEvent.click(screen.getByRole('button'))
  expect(await screen.findByRole('status')).toHaveTextContent('Projects imported 2 · updated 1')
  expect(store.get(agentWorkspacesAtom).map(workspace => workspace.id)).toEqual(['project-a', 'project-b'])
  expect(store.get(currentAgentSessionIdAtom)).toBe('open-chat')
  expect(list).toHaveBeenCalledTimes(1)
})


test.each([false, true])('reimport persists a newly linked active tab only while navigation is unchanged (switch=%s)', async switched => {
  let finish!: (rows: AgentSessionMeta[]) => void
  const list = mock(() => new Promise<AgentSessionMeta[]>(resolve => { finish = resolve }))
  const { store, view } = setup(async () => ({ ...empty, unchanged: 1 }), list)
  window.__TAURI_FORMAL__!.bindProjectDirectory = async () => false
  const workspace = { id: 'project-b', name: 'B', slug: 'b', createdAt: 1, updatedAt: 1 }
  window.electronAPI.listAgentWorkspaces = async () => [workspace]
  let savedWorkspace: string | null = null
  const save = mock(async (settings: { agentWorkspaceId?: string }) => {
    savedWorkspace = settings.agentWorkspaceId ?? null
    return settings
  })
  window.electronAPI.updateSettings = save
  const legacy = { id: 'b', title: 'Previously global', createdAt: 1, updatedAt: 1 }
  const tab = { id: 'b', sessionId: 'b', type: 'agent' as const, title: legacy.title }
  store.set(tabsAtom, [tab])
  store.set(activeTabIdAtom, 'b')
  store.set(currentAgentSessionIdAtom, 'b')
  store.set(agentSessionsAtom, [legacy])
  render(view())
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
  if (switched) store.set(currentAgentWorkspaceIdAtom, 'other-project')
  await act(async () => { finish([{ ...legacy, workspaceId: workspace.id }]) })
  expect(store.get(agentSessionsAtom)[0]?.workspaceId).toBe(workspace.id)
  if (switched) {
    expect(save).not.toHaveBeenCalled()
    expect(store.get(currentAgentWorkspaceIdAtom)).toBe('other-project')
  } else {
    expect(save).toHaveBeenCalledWith({ agentWorkspaceId: workspace.id })
    expect(store.get(currentAgentWorkspaceIdAtom)).toBe(workspace.id)
    const reloadTabs = backfillTabWorkspaceIds(store.get(tabsAtom), store.get(agentSessionsAtom))
    expect(filterVisibleTabs(reloadTabs, savedWorkspace).map(row => row.id)).toEqual(['b'])
    expect(store.get(activeTabIdAtom)).toBe('b')
  }
})
