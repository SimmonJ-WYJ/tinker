/** 侧栏平铺项目列表：切换/创建仍复用真实工作区入口。 */
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { agentSessionsAtom, agentWorkspacesAtom, currentAgentWorkspaceIdAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { setAppLanguage } from '@/lib/i18n'
import type { AgentWorkspace } from '@asci/shared'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { ProjectManageDialog } from './ProjectManageDialog'
import { ProjectOverview } from './ProjectOverview'
import { activeViewAtom } from '@/atoms/active-view'
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

test('原生在同名项目中明确新建和打开会话，不继承另外项目或复制目录配置', async () => {
  const marker = window.__TAURI_FORMAL__
  const api = window.electronAPI
  try {
    window.__TAURI_FORMAL__ = { hydrated() {}, bindProjectDirectory: async () => false }
    const store = createStore()
    const first = workspace('a', 'Shared')
    const second = workspace('b', 'Shared')
    store.set(agentWorkspacesAtom, [first, second])
    store.set(currentAgentWorkspaceIdAtom, 'a')
    const session = { id: 'chat-b', title: 'In B', workspaceId: 'b', createdAt: 1, updatedAt: 1 }
    store.set(agentSessionsAtom, [session])
    window.electronAPI = { updateSettings, createAgentWorkspace: createWorkspace } as unknown as Window['electronAPI']
    render(<Provider store={store}><ProjectSwitcher variant="list" /><ProjectOverview /></Provider>)
    fireEvent.click(screen.getAllByRole('button', { name: 'Shared' })[1]!)
    expect(store.get(currentAgentWorkspaceIdAtom)).toBe('b')
    expect(store.get(activeViewAtom)).toBe('project')
    fireEvent.click(screen.getAllByRole('button', { name: 'In B' }).at(-1)!)
    expect(store.get(currentAgentSessionIdAtom)).toBe('chat-b')
    expect(store.get(currentAgentWorkspaceIdAtom)).toBe('b')
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    const input = screen.getByPlaceholderText('Project name...')
    fireEvent.change(input, { target: { value: 'New project' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(createWorkspace).toHaveBeenCalledWith('New project', undefined))
    expect(store.get(activeViewAtom)).toBe('project')
    expect(store.get(currentAgentWorkspaceIdAtom)).toBe('new')
  } finally {
    window.__TAURI_FORMAL__ = marker
    window.electronAPI = api
  }
})

test('native project management offers renaming only for persisted projects', async () => {
  const marker = window.__TAURI_FORMAL__
  try {
    window.__TAURI_FORMAL__ = { hydrated() {}, bindProjectDirectory: async () => false }
    const store = createStore()
    const project: AgentWorkspace = { ...workspace('local', 'Original'), projectOrigin: 'native' }
    store.set(agentWorkspacesAtom, [workspace('default', 'Local Mock'), project])
    const rename = mock(async () => ({ ...project, name: 'Updated' }))
    window.electronAPI.updateAgentWorkspace = rename
    render(<Provider store={store}><ProjectManageDialog open onOpenChange={() => {}} /></Provider>)
    expect(screen.queryAllByTitle('Delete')).toHaveLength(0)
    expect(screen.getAllByTitle('Rename')).toHaveLength(1)
    expect(screen.getByText('Original').closest('[draggable]')).toHaveAttribute('draggable', 'false')
    fireEvent.click(screen.getByTitle('Rename'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Updated' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('Updated')).toBeInTheDocument())
    expect(rename).toHaveBeenCalledWith('local', { name: 'Updated' })
  } finally {
    window.__TAURI_FORMAL__ = marker
  }
})

test('collapsed native sidebar opens the selected or newly created project overview from a conversation', async () => {
  const previous = window.__TAURI_FORMAL__
  try {
    window.__TAURI_FORMAL__ = { hydrated() {}, bindProjectDirectory: async () => false }
    const store = createStore()
    store.set(agentWorkspacesAtom, [workspace('a', 'A'), workspace('b', 'B')])
    store.set(currentAgentWorkspaceIdAtom, 'a')
    store.set(currentAgentSessionIdAtom, 'a-conversation')
    store.set(activeViewAtom, 'conversations')
    render(<Provider store={store}><ProjectSwitcher variant="icon" /></Provider>)

    fireEvent.click(screen.getByRole('button', { name: 'Switch project' }))
    fireEvent.click(await screen.findByRole('button', { name: 'B' }))
    expect(store.get(currentAgentWorkspaceIdAtom)).toBe('b')
    expect(store.get(activeViewAtom)).toBe('project')
    expect(store.get(currentAgentSessionIdAtom)).toBe('a-conversation')

    store.set(activeViewAtom, 'conversations')
    fireEvent.click(screen.getByRole('button', { name: 'Switch project' }))
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }))
    const input = screen.getByPlaceholderText('Project name...')
    fireEvent.change(input, { target: { value: 'New project' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(store.get(currentAgentWorkspaceIdAtom)).toBe('new'))
    expect(store.get(activeViewAtom)).toBe('project')
    expect(createWorkspace).toHaveBeenCalledWith('New project', undefined)
  } finally {
    window.__TAURI_FORMAL__ = previous
  }
})

test('同一项目的改图与文字行在语言切换后仍指向各自会话', async () => {
  const marker = window.__TAURI_FORMAL__
  const api = window.electronAPI
  try {
    window.__TAURI_FORMAL__ = {
      hydrated() {},
      async projectTaskStatuses() {
        return [
          { sessionId: 'image', requestId: 'edit', kind: 'imageEdit', status: 'interrupted' },
          { sessionId: 'chat', requestId: 'text', kind: 'text', status: 'completed' },
        ]
      },
    }
    window.electronAPI = {
      ...api, onAgentStreamEvent: () => () => {}, onAgentStreamComplete: () => () => {},
    }
    const store = createStore()
    store.set(agentWorkspacesAtom, [workspace('studio', 'Studio')])
    store.set(currentAgentWorkspaceIdAtom, 'studio')
    store.set(agentSessionsAtom, ['image', 'chat'].map(id => ({
      id, title: id, workspaceId: 'studio', createdAt: 1, updatedAt: 2,
    })))
    render(<Provider store={store}><ProjectOverview /></Provider>)
    expect(await screen.findByRole('button', { name: /image.*Image edit.*Interrupted/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /chat.*Text.*Completed/ })).toBeVisible()
    await act(async () => { await setAppLanguage('zh') })
    const row = await screen.findByRole('button', { name: /image.*改图.*已中断/ })
    fireEvent.click(row)
    expect(store.get(currentAgentSessionIdAtom)).toBe('image')
    expect(store.get(currentAgentWorkspaceIdAtom)).toBe('studio')
  } finally {
    cleanup()
    await setAppLanguage('en')
    window.__TAURI_FORMAL__ = marker
    window.electronAPI = api
  }
})
