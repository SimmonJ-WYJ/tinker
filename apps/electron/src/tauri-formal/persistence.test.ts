import { expect, test } from 'bun:test'
import { Window as TestWindow } from 'happy-dom'
import { getDefaultStore } from 'jotai'
import { tabsAtom, activeTabIdAtom, activeTabIdByWorkspaceAtom } from '../renderer/atoms/tab-atoms.ts'
import { sidebarProjectFilesExpandedMapAtom } from '../renderer/atoms/agent-atoms.ts'
import { installPersistence } from './persistence.ts'
import { createFormalTransport } from './transport.ts'
import type { NativeBridge, NativeEvent } from './protocol.ts'
import { withDeadline } from './deadline.ts'

test('真实 close participant 在防抖前读取同一 Jotai 最新 tabs/工作区记忆/sidebar，等待两个 hydrate', async () => {
  const previousWindow = globalThis.window
  globalThis.window = new TestWindow() as unknown as typeof window
  const store = getDefaultStore()
  const previous = [store.get(tabsAtom), store.get(activeTabIdAtom), store.get(activeTabIdByWorkspaceAtom), store.get(sidebarProjectFilesExpandedMapAtom)] as const
  let emit: (event: NativeEvent) => void = () => {}
  const writes: unknown[] = []
  let done = () => {}
  const closed = new Promise<void>((resolve) => { done = resolve })
  const native: NativeBridge = {
    listen: async (callback) => { emit = callback; return () => {} },
    request: async <T>(request: Record<string, unknown>): Promise<T> => {
      const snapshot = { version: 1, revision: 0, settings: {}, userProfile: {}, workspaces: [], theme: { mode: 'system', isDark: false }, chrome: { platform: 'darwin', fullscreen: false } }
      let result: unknown = null
      if (request.command === 'bootstrap') result = { generation: 'document-1', activeRuns: [], platformSnapshot: snapshot }
      if (request.command === 'beginClose') result = { closeToken: 'close-1' }
      if (request.command === 'invoke' && request.channel === 'settings:update') {
        const patch = (request.args as unknown[])[0]; writes.push(patch)
        result = { value: patch, snapshot: { ...snapshot, revision: 1, settings: patch } }
      }
      if (request.command === 'closeReady') { expect(request.committedRevision).toBe(1); done(); result = { closed: true } }
      return result as T
    },
  }
  const transport = await createFormalTransport(native, (code) => code)
  try {
    const participant = installPersistence(transport)
    participant.hydrated('settings')
    emit({ kind: 'action', action: 'close' })
    await Promise.resolve(); expect(writes).toEqual([])
    store.set(tabsAtom, [{ id: 'latest', sessionId: 'session-1', type: 'agent', title: '最新' }])
    store.set(activeTabIdAtom, 'latest')
    store.set(activeTabIdByWorkspaceAtom, { 'local-mock-workspace-id': 'latest' })
    store.set(sidebarProjectFilesExpandedMapAtom, new Map([['local-mock-workspace-id', true]]))
    participant.hydrated('tabs')
    await withDeadline(closed, 500)
    expect(writes).toEqual([{ tabState: { tabs: store.get(tabsAtom), activeTabId: 'latest', activeTabIdByWorkspace: { 'local-mock-workspace-id': 'latest' } }, sidebarProjectFilesExpandedByWorkspace: { 'local-mock-workspace-id': true } }])
  } finally {
    transport.dispose()
    store.set(tabsAtom, previous[0]); store.set(activeTabIdAtom, previous[1]); store.set(activeTabIdByWorkspaceAtom, previous[2]); store.set(sidebarProjectFilesExpandedMapAtom, previous[3])
    globalThis.window = previousWindow
  }
})
