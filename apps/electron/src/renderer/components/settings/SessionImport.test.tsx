import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { AgentSessionMeta } from '@asci/shared'
import type { SessionImporter, SessionImportReport } from '../../../tauri-formal/session-import'
import { agentSessionsAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
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
