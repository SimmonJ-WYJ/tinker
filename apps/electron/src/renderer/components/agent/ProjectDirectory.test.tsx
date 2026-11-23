import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createStore, Provider, useAtomValue } from 'jotai'
import type { AgentWorkspace } from '@asci/shared'
import { setAppLanguage } from '@/lib/i18n'
import { agentWorkspacesAtom } from '@/atoms/agent-atoms'
import { ProjectDirectory } from './ProjectDirectory'

const marker = window.__TAURI_FORMAL__
const api = window.electronAPI
afterEach(async () => {
  cleanup()
  window.__TAURI_FORMAL__ = marker
  window.electronAPI = api
  await setAppLanguage('en')
})
const project = (id: string, status: AgentWorkspace['directoryStatus']): AgentWorkspace => ({
  id, slug: id, name: 'Shared name', createdAt: 1, updatedAt: 1, directoryStatus: status,
})
function Selected({ id }: { id: string }) {
  const rows = useAtomValue(agentWorkspacesAtom)
  return <ProjectDirectory key={id} workspace={rows.find(row => row.id === id)!} />
}
test('rechecks binding on focus, scopes the picker to one project ID and shows unavailable files without leaving history', async () => {
  await setAppLanguage('en')
  const store = createStore()
  const first = project('first', 'unbound')
  const second = project('second', 'unbound')
  store.set(agentWorkspacesAtom, [first, second])
  const list = mock(async () => [first, second])
  const bind = mock(async (_id: string) => false)
  window.__TAURI_FORMAL__ = { hydrated() {}, bindProjectDirectory: bind }
  window.electronAPI = { listAgentWorkspaces: list } as unknown as Window['electronAPI']
  render(<Provider store={store}><Selected id="second" /></Provider>)
  await waitFor(() => expect(list).toHaveBeenCalled())
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choose folder' })) })
  expect(bind.mock.calls).toEqual([['second']])
  expect(screen.getByRole('status')).toHaveTextContent('No folder selected')
  list.mockImplementation(async () => [first, project('second', 'bound')])
  bind.mockImplementation(async () => true)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choose folder' })) })
  expect(screen.getByRole('status')).toHaveTextContent('Folder connected')
  list.mockImplementation(async () => [first, project('second', 'unavailable')])
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(screen.getByRole('status')).toHaveTextContent('Folder unavailable')
  expect(screen.getByRole('button', { name: 'Choose another folder' })).toBeEnabled()
  expect(store.get(agentWorkspacesAtom)[0]).toBe(first)
})

test('changing projects while the picker is open cannot apply the result to the new selection', async () => {
  const store = createStore()
  const first = project('first', 'unbound')
  const second = project('second', 'unbound')
  store.set(agentWorkspacesAtom, [first, second])
  let finish!: (changed: boolean) => void
  const bind = mock((_id: string) => new Promise<boolean>(resolve => { finish = resolve }))
  const list = mock(async () => [first, second])
  window.__TAURI_FORMAL__ = { hydrated() {}, bindProjectDirectory: bind }
  window.electronAPI = { listAgentWorkspaces: list } as unknown as Window['electronAPI']
  const tree = (id: string) => <Provider store={store}><Selected id={id} /></Provider>
  const view = render(tree('first'))
  await act(async () => { fireEvent.click(screen.getByRole('button')) })
  view.rerender(tree('second'))
  expect(screen.getByRole('button')).toBeDisabled()
  list.mockImplementation(async () => [project('first', 'bound'), second])
  await act(async () => { finish(true) })
  expect(bind.mock.calls).toEqual([['first']])
  expect(screen.getByRole('status')).toHaveTextContent('No folder selected')
  await act(async () => { await setAppLanguage('zh') })
  expect(screen.getByRole('button', { name: '选择文件夹' })).toBeEnabled()
})

test('rejecting an unsafe folder does not disclose its path or show an error on another project', async () => {
  await setAppLanguage('en')
  const store = createStore()
  const first = project('first', 'unbound')
  const second = project('second', 'unbound')
  store.set(agentWorkspacesAtom, [first, second])
  let reject!: (error: unknown) => void
  const bind = mock((_id: string) => new Promise<boolean>((_, fail) => { reject = fail }))
  window.__TAURI_FORMAL__ = { hydrated() {}, bindProjectDirectory: bind }
  window.electronAPI = { listAgentWorkspaces: async () => [first, second] } as unknown as Window['electronAPI']
  const tree = (workspace: AgentWorkspace) => <Provider store={store}><ProjectDirectory workspace={workspace} /></Provider>
  const view = render(tree(first))
  fireEvent.click(screen.getByRole('button'))
  await act(async () => { reject({ code: 'unsafeImportPath', message: '/private/user' }) })
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a different local folder')
  fireEvent.click(screen.getByRole('button'))
  view.rerender(tree(second))
  await act(async () => { reject({ code: 'unsafeImportPath', message: '/private/user' }) })
  expect(screen.queryByRole('alert')).toBeNull()
})
