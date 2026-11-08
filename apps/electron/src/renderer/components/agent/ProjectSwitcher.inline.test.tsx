/** 侧栏平铺项目列表：切换/创建仍复用真实工作区入口。 */
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { agentWorkspacesAtom, currentAgentWorkspaceIdAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { setAppLanguage } from '@/lib/i18n'
import type { AgentWorkspace } from '@asci/shared'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { ProjectSwitcher } from './ProjectSwitcher'
const workspace = (id: string, name: string): AgentWorkspace => ({ id, name, slug: id, createdAt: 1, updatedAt: 1 })
const updateSettings = mock(async () => undefined)
const createWorkspace = mock(async () => workspace('new', 'New project'))
beforeEach(async () => {
  await setAppLanguage('en')
  updateSettings.mockClear(); createWorkspace.mockClear()
  window.electronAPI = { updateSettings, createAgentWorkspace: createWorkspace } as unknown as Window['electronAPI']
})
afterEach(cleanup)
function mount() {
  const store = createStore()
  store.set(agentWorkspacesAtom, [workspace('first', 'Finance'), workspace('second', 'My actual project')])
  store.set(currentAgentWorkspaceIdAtom, 'first')
  render(<Provider store={store}><ProjectSwitcher variant="list" /></Provider>)
  return store
}
test('项目直接可见，点击切换真实工作区并持久化', () => {
  const store = mount()
  fireEvent.click(screen.getByRole('button', { name: 'My actual project' }))
  expect(store.get(currentAgentWorkspaceIdAtom)).toBe('second')
  expect(updateSettings).toHaveBeenCalledWith({ agentWorkspaceId: 'second' })
  expect(screen.queryByText('Tesla')).not.toBeInTheDocument()
})
test('加号创建项目后将新项目加入列表并选中', async () => {
  const store = mount()
  fireEvent.click(screen.getByRole('button', { name: 'New project' }))
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'New project' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(store.get(currentAgentWorkspaceIdAtom)).toBe('new'))
  expect(createWorkspace).toHaveBeenCalledWith('New project', 'first')
  expect(screen.getByRole('button', { name: 'New project', current: 'page' })).toBeInTheDocument()
})

test('项目箭头独立展开空会话提示，不切换工作区', () => {
  const store = mount()
  const toggle = screen.getByRole('button', { name: 'Expand My actual project' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('No sessions in project')).toBeInTheDocument()
  expect(store.get(currentAgentWorkspaceIdAtom)).toBe('first')
  fireEvent.click(toggle)
  expect(screen.queryByText('No sessions in project')).not.toBeInTheDocument()
})

test('输入框项目选择回调独立于导航，不直接切换当前项目', async () => {
 const store = createStore()
 store.set(agentWorkspacesAtom, [workspace('first', 'Finance'), workspace('second', 'New workspace')])
 store.set(currentAgentWorkspaceIdAtom, 'first')
 const choose = mock(() => {})
 render(<Provider store={store}><ProjectSwitcher variant="composer" onSelectProject={choose} /></Provider>)
 fireEvent.click(screen.getByRole('button', { name: 'Finance' }))
 fireEvent.click(await screen.findByRole('button', { name: 'New workspace' }))
 expect(choose).toHaveBeenCalledWith(expect.objectContaining({ id: 'second' }))
 expect(store.get(currentAgentWorkspaceIdAtom)).toBe('first')
})


test('项目行加号创建该项目草稿，连续点击只发起一次创建', async () => {
  const store = mount()
  const session = { id: 'project-draft', workspaceId: 'second', title: 'New session', createdAt: 1, updatedAt: 1 }
  let finish: ((value: typeof session) => void) | undefined
  const createSession = mock(() => new Promise<typeof session>(resolve => { finish = resolve }))
  window.electronAPI.createAgentSession = createSession
  const row = screen.getByRole('button', { name: 'My actual project' }).closest('.home-projects__row')
  const add = row?.querySelector<HTMLButtonElement>('.home-projects__create')
  expect(add).toBeTruthy()
  fireEvent.click(add!)
  fireEvent.click(add!)
  expect(createSession).toHaveBeenCalledTimes(1)
  expect(createSession).toHaveBeenCalledWith(undefined, undefined, 'second')
  expect(screen.getByRole('button', { name: 'Expand My actual project' })).toHaveAttribute('aria-expanded', 'false')
  expect(add).toBeDisabled()
  finish!(session)
  await waitFor(() => expect(store.get(currentAgentSessionIdAtom)).toBe('project-draft'))
  expect(store.get(currentAgentWorkspaceIdAtom)).toBe('second')
  expect(store.get(draftSessionIdsAtom).has('project-draft')).toBe(true)
  await waitFor(() => expect(add).not.toBeDisabled())
})
