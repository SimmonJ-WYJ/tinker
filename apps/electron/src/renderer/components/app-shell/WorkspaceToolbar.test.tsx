import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { WorkspaceToolbar } from './WorkspaceToolbar'
import { agentSessionsAtom, agentWorkspacesAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { activeTabIdAtom, tabsAtom, sidebarCollapsedAtom } from '@/atoms/tab-atoms'
import { setAppLanguage } from '@/lib/i18n'
afterEach(cleanup)
test('工具栏控制侧栏，并按真实访问顺序后退前进', async () => {
 await setAppLanguage('en')
 window.electronAPI = { updateSettings: mock(async () => {}) } as unknown as Window['electronAPI']
 const store = createStore()
 store.set(agentWorkspacesAtom, [{ id: 'w', slug: 'w', name: 'Workspace', createdAt: 1, updatedAt: 1 }])
 store.set(currentAgentWorkspaceIdAtom, 'w')
 store.set(agentSessionsAtom, [{ id: 'a', title: 'First', workspaceId: 'w', createdAt: 1, updatedAt: 1 }, { id: 'b', title: 'Second', workspaceId: 'w', createdAt: 1, updatedAt: 1 }])
 store.set(tabsAtom, [{ id: 'a', sessionId: 'a', title: 'First', type: 'agent', workspaceId: 'w' }, { id: 'b', sessionId: 'b', title: 'Second', type: 'agent', workspaceId: 'w' }])
 store.set(activeTabIdAtom, 'a')
 store.set(sidebarCollapsedAtom, false)
 const toggle = mock(() => {})
 const view = render(<Provider store={store}><WorkspaceToolbar narrow={false} drawerOpen={false} onDrawerToggle={toggle} /></Provider>)
 expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
 fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
 expect(store.get(sidebarCollapsedAtom)).toBe(true)
 act(() => store.set(activeTabIdAtom, 'b'))
 fireEvent.click(screen.getByRole('button', { name: 'Back' }))
 expect(store.get(activeTabIdAtom)).toBe('a')
 fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
 expect(store.get(activeTabIdAtom)).toBe('b')
 view.rerender(<Provider store={store}><WorkspaceToolbar narrow drawerOpen={false} onDrawerToggle={toggle} /></Provider>)
 fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
 expect(toggle).toHaveBeenCalledTimes(1)
})
