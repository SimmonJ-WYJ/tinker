import { expect, test } from 'bun:test'
import { Window as TestWindow } from 'happy-dom'
import { getDefaultStore } from 'jotai'
import { tabsAtom, activeTabIdAtom, activeTabIdByWorkspaceAtom } from '../renderer/atoms/tab-atoms.ts'
import { sidebarProjectFilesExpandedMapAtom, agentSessionDraftsAtom, currentAgentWorkspaceIdAtom } from '../renderer/atoms/agent-atoms.ts'
import { installPersistence } from './persistence.ts'
import { createFormalTransport } from './transport.ts'
import type { NativeBridge, NativeEvent } from './protocol.ts'
import { withDeadline } from './deadline.ts'

interface CaptureCase { name: string; current: string | null; fallback: string; tabWorkspace?: string; active: string | null; expected: Record<string, string> }
const captureCases: CaptureCase[] = [
  { name: 'null atom uses trusted native workspace', current: null, fallback: 'local-mock-workspace-id', active: 'latest', expected: { 'local-mock-workspace-id': 'latest' } },
  { name: 'nonempty current workspace wins', current: 'local-mock-workspace-id', fallback: 'fallback-other', active: 'latest', expected: { 'local-mock-workspace-id': 'latest' } },
  { name: 'deleted active tab creates no mapping', current: null, fallback: 'local-mock-workspace-id', active: null, expected: { 'local-mock-workspace-id': 'stale' } },
  { name: 'explicit foreign tab is not reassigned', current: null, fallback: 'local-mock-workspace-id', active: 'latest', tabWorkspace: 'foreign', expected: { 'local-mock-workspace-id': 'stale' } },
]
test.each(captureCases)('真实 close participant 最新状态: $name', async (sample) => {
  const previousWindow = globalThis.window
  globalThis.window = new TestWindow() as unknown as typeof window
  const store = getDefaultStore()
  const previous = [store.get(tabsAtom), store.get(activeTabIdAtom), store.get(activeTabIdByWorkspaceAtom), store.get(sidebarProjectFilesExpandedMapAtom), store.get(agentSessionDraftsAtom), store.get(currentAgentWorkspaceIdAtom)] as const
  let emit: (event: NativeEvent) => void = () => {}
  const writes: unknown[] = []
  let done = () => {}
  const closed = new Promise<void>((resolve) => { done = resolve })
  const native: NativeBridge = {
    listen: async (callback) => { emit = callback; return () => {} },
    request: async <T>(request: Record<string, unknown>): Promise<T> => {
      const snapshot = { version: 1, revision: 0, settings: { agentWorkspaceId: sample.fallback }, userProfile: {}, workspaces: [], theme: { mode: 'system', isDark: false }, chrome: { platform: 'darwin', fullscreen: false } }
      let result: unknown = null
      if (request.command === 'bootstrap') result = { generation: 'document-1', activeRuns: [], platformSnapshot: snapshot }
      if (request.command === 'beginClose') result = { closeToken: 'close-1' }
      if (request.command === 'invoke' && request.channel === 'settings:update') {
        const patch = (request.args as Record<string, unknown>[])[0]; writes.push(patch)
        result = { value: patch, snapshot: { ...snapshot, revision: 1, settings: { ...snapshot.settings, ...patch } } }
      }
      if (request.command === 'closeReady') { expect(request.committedRevision).toBe(1); result = { closed: true } }
      if (request.command === 'closeWindow') done()
      return result as T
    },
  }
  const transport = await createFormalTransport(native, (code) => code)
  try {
    const participant = installPersistence(transport)
    participant.hydrated('settings')
    emit({ kind: 'action', action: 'close' })
    await Promise.resolve(); expect(writes).toEqual([])
    store.set(tabsAtom, sample.active ? [{ id: 'latest', sessionId: 'session-1', type: 'agent', title: '最新', ...(sample.tabWorkspace ? { workspaceId: sample.tabWorkspace } : {}) }] : [])
    store.set(activeTabIdAtom, sample.active)
    store.set(activeTabIdByWorkspaceAtom, { 'local-mock-workspace-id': 'stale' })
    store.set(currentAgentWorkspaceIdAtom, sample.current)
    store.set(agentSessionDraftsAtom, new Map([['session-1', 'latest typed draft café']]))
    store.set(sidebarProjectFilesExpandedMapAtom, new Map([['local-mock-workspace-id', true]]))
    participant.hydrated('tabs')
    await withDeadline(closed, 500)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(writes).toEqual([{ tabState: { tabs: store.get(tabsAtom), activeTabId: sample.active, activeTabIdByWorkspace: sample.expected }, sidebarProjectFilesExpandedByWorkspace: { 'local-mock-workspace-id': true }, sessionDrafts: { 'session-1': 'latest typed draft café' } }])
  } finally {
    transport.dispose()
    store.set(tabsAtom, previous[0]); store.set(activeTabIdAtom, previous[1]); store.set(activeTabIdByWorkspaceAtom, previous[2]); store.set(sidebarProjectFilesExpandedMapAtom, previous[3]); store.set(agentSessionDraftsAtom, previous[4]); store.set(currentAgentWorkspaceIdAtom, previous[5])
    globalThis.window = previousWindow
  }
})

test('hydrate 失败为终态：StrictMode 的迟到成功不能触发空 atoms 自动写回或关闭', async () => {
  const previousWindow = globalThis.window
  globalThis.window = new TestWindow() as unknown as typeof window
  let emit: (event: NativeEvent) => void = () => {}
  const writes: unknown[] = []; const commands: string[] = []
  const native: NativeBridge = {
    listen: async (callback) => { emit = callback; return () => {} },
    request: async <T>(request: Record<string, unknown>): Promise<T> => {
      commands.push(String(request.command))
      if (request.command === 'bootstrap') return { generation: 'document-1', activeRuns: [], platformSnapshot: { version: 1, revision: 7, settings: { tabState: { tabs: [{ id: 'durable' }] } }, theme: {}, chrome: {} } } as T
      if (request.command === 'invoke') writes.push(request.args)
      return {} as T
    },
  }
  const transport = await createFormalTransport(native, (code) => code)
  try {
    const participant = installPersistence(transport)
    participant.hydrated('settings')
    participant.hydrated('tabs', Error('读取失败'))
    participant.hydrated('tabs')
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect(writes).toEqual([])
    emit({ kind: 'action', action: 'close' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(commands).not.toContain('closeReady')
    expect(writes).toEqual([])
  } finally { transport.dispose(); globalThis.window = previousWindow }
})

test('closeReady 超时后晚到成功没有关闭权；再次原生 close 才提交 closeWindow', async () => {
  const previousWindow = globalThis.window
  globalThis.window = new TestWindow() as unknown as typeof window
  let emit: (event: NativeEvent) => void = () => {}; let release = () => {}; let ready = false; let closes = 0; let begins = 0
  const commands: string[] = []
  const native: NativeBridge = {
    listen: async (callback) => { emit = callback; return () => {} },
    request: async <T>(request: Record<string, unknown>): Promise<T> => {
      const name = String(request.command); commands.push(name)
      if (name === 'bootstrap') return { generation: 'document-1', activeRuns: [], platformSnapshot: { revision: 0, settings: {}, theme: {}, chrome: {} } } as T
      if (name === 'beginClose') { begins++; return { closeToken: 'one' } as T }
      if (name === 'invoke') return { value: {} } as T
      if (name === 'abortClose') throw { code: 'invalidCloseToken' }
      if (name === 'closeReady' && !ready) await new Promise<void>((resolve) => { release = () => { ready = true; resolve() } })
      if (name === 'closeWindow') closes++
      return {} as T
    },
  }
  const transport = await createFormalTransport(native, (code) => code, { commandTimeoutMs: 5 })
  try {
    const participant = installPersistence(transport); participant.hydrated('tabs'); participant.hydrated('settings')
    emit({ kind: 'action', action: 'close' })
    await new Promise((resolve) => setTimeout(resolve, 25))
    release(); await new Promise((resolve) => setTimeout(resolve, 0))
    expect(closes).toBe(0)
    await expect(transport.invoke('agent:list-sessions')).rejects.toThrow('closing')
    emit({ kind: 'action', action: 'close' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(closes).toBe(1); expect(begins).toBe(1)
    expect(commands.filter((name) => name === 'closeReady')).toHaveLength(2)
  } finally { transport.dispose(); globalThis.window = previousWindow }
})
