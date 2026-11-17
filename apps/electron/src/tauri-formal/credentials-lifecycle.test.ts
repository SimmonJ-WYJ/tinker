import { expect, spyOn, test } from 'bun:test'
import { Window as TestWindow } from 'happy-dom'
import { getDefaultStore } from 'jotai'
import { createDesktopApi } from '../preload/api.ts'
import {
  activeTabIdAtom,
  activeTabIdByWorkspaceAtom,
  tabsAtom,
} from '../renderer/atoms/tab-atoms.ts'
import {
  agentSessionDraftsAtom,
  currentAgentWorkspaceIdAtom,
  sidebarProjectFilesExpandedMapAtom,
} from '../renderer/atoms/agent-atoms.ts'
import { withDeadline } from './deadline.ts'
import { installPersistence } from './persistence.ts'
import type { LifecycleCapture, NativeBridge, NativeEvent, PlatformSnapshot } from './protocol.ts'
import { createFormalTransport } from './transport.ts'

type Outcome = 'close' | 'reload' | 'failure'
type Loss = 'stage' | 'final'

async function fixture(loss: Loss) {
  const previousWindow = globalThis.window
  globalThis.window = new TestWindow() as unknown as typeof window
  const store = getDefaultStore()
  const previous = {
    tabs: store.get(tabsAtom),
    active: store.get(activeTabIdAtom),
    byWorkspace: store.get(activeTabIdByWorkspaceAtom),
    sidebar: store.get(sidebarProjectFilesExpandedMapAtom),
    drafts: store.get(agentSessionDraftsAtom),
    workspace: store.get(currentAgentWorkspaceIdAtom),
  }
  const channel = {
    id: 'owned',
    name: 'Owned',
    provider: 'custom-openai' as const,
    baseUrl: 'https://owned.invalid/v1',
    apiKey: '',
    hasCredential: true,
    models: [{ id: 'plain', name: 'Plain', enabled: true }],
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  }
  let current: PlatformSnapshot = {
    version: 1,
    revision: 0,
    settings: {
      agentWorkspaceId: 'owned-workspace',
      tabState: { tabs: [], activeTabId: null, activeTabIdByWorkspace: {} },
      sidebarProjectFilesExpandedByWorkspace: {},
      sessionDrafts: {},
    },
    userProfile: { userName: 'Owned', avatar: 'icon:user' },
    workspaces: [],
    theme: { mode: 'system', isDark: false },
    chrome: { platform: 'darwin', fullscreen: false },
  }
  const calls: Record<string, unknown>[] = []
  const receipts = new Map<string, unknown>()
  let emitted: (event: NativeEvent) => void = () => {}
  let settle: (outcome: Outcome) => void = () => {}
  let lost = false
  let gatePreparing = false
  let hostFrozen = false
  let loseCapture = false
  let afterBegin: (() => void) | undefined
  let releaseSend: (() => void) | undefined
  const failures: unknown[] = []
  const originalError = console.error.bind(console)
  const logged = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const error = args[1]
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : undefined
    if (args[0] === '[原生预览] 保存失败' && ['mutationPending', 'recoveryRequired', 'runtimeUnavailable'].includes(code ?? '')) {
      failures.push(error)
      settle('failure')
      return
    }
    originalError(...args)
  })
  const reloaded = spyOn(window.location, 'reload').mockImplementation(() => settle('reload'))
  const native: NativeBridge = {
    listen: async callback => {
      emitted = callback
      return () => {}
    },
    request: async <T,>(request: Record<string, unknown>): Promise<T> => {
      calls.push(structuredClone(request))
      if (request.command === 'bootstrap') {
        return {
          credentialedChannels: true,
          queueing: false,
          generation: 'document-1',
          activeRuns: [],
          platformSnapshot: structuredClone(current),
        } as T
      }
      if (request.command === 'beginClose') {
        gatePreparing = true
        afterBegin?.()
        return { closeToken: `close-${calls.filter(call => call.command === 'beginClose').length}` } as T
      }
      if (request.command === 'abortClose') {
        gatePreparing = false
        return {} as T
      }
      if (request.command === 'closeReady') {
        expect(gatePreparing).toBe(true)
        expect(request.committedRevision).toBe(current.revision)
        releaseSend?.()
        return {} as T
      }
      if (request.command === 'closeWindow') {
        settle('close')
        return {} as T
      }
      if (request.command !== 'invoke') return {} as T
      if (request.channel === 'channel:list') return { value: [channel] } as T
      if (request.channel === 'agent:send-message') {
        await new Promise<void>(resolve => { releaseSend = resolve })
        return { value: null } as T
      }
      if (request.channel === 'channel:stage') {
        expect(gatePreparing).toBe(false)
        const input = (request.args as { request: { args: { credential: unknown }[] } }[])[0]!
        const normalized = structuredClone(input.request)
        normalized.args[0]!.credential = { replace: 'd'.repeat(32) }
        if (loss === 'stage' && !lost) {
          lost = true
          throw { code: 'runtimeUnavailable' }
        }
        return { value: normalized } as T
      }
      if (request.channel === 'channel:update' || request.channel === 'settings:update') {
        if (hostFrozen) throw { code: 'recoveryRequired' }
        if (gatePreparing) throw { code: 'closing' }
        const mutation = request.mutation as { mutationId: string; expectedRevision: number }
        if (!receipts.has(mutation.mutationId)) {
          expect(mutation.expectedRevision).toBe(current.revision)
          if (request.channel === 'settings:update') {
            const patch = (request.args as PlatformSnapshot['settings'][])[0]!
            current = { ...current, settings: { ...current.settings, ...patch } }
          }
          current = { ...current, revision: current.revision + 1 }
          receipts.set(mutation.mutationId, request)
        }
        if (request.channel === 'channel:update' && loss === 'final' && !lost) {
          lost = true
          throw { code: 'runtimeUnavailable' }
        }
        if (request.channel === 'settings:update' && loseCapture) {
          loseCapture = false
          throw { code: 'runtimeUnavailable' }
        }
        return { value: channel, snapshot: structuredClone(current) } as T
      }
      return { value: null } as T
    },
  }
  const transport = await createFormalTransport(native, code => code, { commandTimeoutMs: 100 })
  const api = createDesktopApi(transport)
  await api.listChannels()
  const marker = installPersistence(transport)
  store.set(tabsAtom, [])
  store.set(activeTabIdAtom, null)
  store.set(activeTabIdByWorkspaceAtom, {})
  store.set(sidebarProjectFilesExpandedMapAtom, new Map())
  store.set(currentAgentWorkspaceIdAtom, 'owned-workspace')
  marker.hydrated('settings')
  marker.hydrated('tabs')

  function dirty(text = 'Owned dirty draft café') {
    store.set(tabsAtom, [{ id: 'draft-tab', sessionId: 'draft-session', type: 'agent', title: 'Owned draft', workspaceId: 'owned-workspace' }])
    store.set(activeTabIdAtom, 'draft-tab')
    store.set(agentSessionDraftsAtom, new Map([['draft-session', text]]))
    store.set(sidebarProjectFilesExpandedMapAtom, new Map([['owned-workspace', true]]))
  }
  return {
    api,
    transport,
    calls,
    failures,
    store,
    dirty,
    snapshot: () => current,
    freezeHost: () => { hostFrozen = true },
    isHostFrozen: () => hostFrozen,
    loseCapture: () => { loseCapture = true },
    afterBegin: (callback: () => void) => { afterBegin = callback },
    async loseCredentialAck() {
      await expect(api.updateChannel('owned', {
        apiKey: 'owned-synthetic-replacement',
        credentialIntentId: 'abandoned-original-intent',
      })).rejects.toThrow('runtimeUnavailable')
    },
    async run(action: 'close' | 'reload') {
      const outcome = new Promise<Outcome>(resolve => { settle = resolve })
      emitted({ kind: 'action', action })
      const result = await withDeadline(outcome, 500)
      await new Promise(resolve => setTimeout(resolve, 0))
      return result
    },
    cleanup() {
      if ('dispose' in marker && typeof marker.dispose === 'function') marker.dispose()
      transport.dispose()
      reloaded.mockRestore()
      logged.mockRestore()
      store.set(tabsAtom, previous.tabs)
      store.set(activeTabIdAtom, previous.active)
      store.set(activeTabIdByWorkspaceAtom, previous.byWorkspace)
      store.set(sidebarProjectFilesExpandedMapAtom, previous.sidebar)
      store.set(agentSessionDraftsAtom, previous.drafts)
      store.set(currentAgentWorkspaceIdAtom, previous.workspace)
      globalThis.window = previousWindow
    },
  }
}

for (const action of ['close', 'reload'] as const) {
  test(`uncertain credential stage preserves dirty capture before ${action}`, async () => {
    const f = await fixture('stage')
    try {
      await f.loseCredentialAck()
      f.dirty()
      await expect(f.api.updateSettings({ language: 'zh' })).rejects.toThrow('mutationPending')
      expect(await f.run(action)).toBe(action)
      expect(f.failures).toEqual([])
      expect(f.snapshot().settings.sessionDrafts).toEqual({ 'draft-session': 'Owned dirty draft café' })
      expect(f.snapshot().settings.tabState?.activeTabId).toBe('draft-tab')
      expect(f.snapshot().settings.sidebarProjectFilesExpandedByWorkspace).toEqual({ 'owned-workspace': true })
      expect(f.calls.filter(call => call.channel === 'channel:stage')).toHaveLength(1)
      expect(f.calls.filter(call => call.channel === 'channel:update')).toHaveLength(0)
      await expect(f.api.updateSettings({ language: 'zh' })).rejects.toThrow('mutationPending')
      expect(f.calls.filter(call => call.command === 'bootstrap')).toHaveLength(1)
    } finally {
      f.cleanup()
    }
  })

  test(`host freeze rejects uncertain credential stage recovery during ${action} without losing draft`, async () => {
    const f = await fixture('stage')
    try {
      await f.loseCredentialAck()
      f.dirty()
      f.freezeHost()
      expect(await f.run(action)).toBe('failure')
      expect(f.isHostFrozen()).toBe(true)
      expect(f.failures).toMatchObject([{ code: 'recoveryRequired' }])
      expect(f.store.get(agentSessionDraftsAtom).get('draft-session')).toBe('Owned dirty draft café')
      expect(f.snapshot().settings.sessionDrafts).toEqual({})
      expect(f.calls.some(call => call.command === 'beginClose' || call.command === 'closeWindow')).toBe(false)
      expect(f.calls.filter(call => call.channel === 'channel:stage')).toHaveLength(1)
      expect(f.calls.filter(call => call.channel === 'channel:update')).toHaveLength(0)
      await expect(f.api.updateSettings({ language: 'zh' })).rejects.toThrow('mutationPending')
    } finally {
      f.cleanup()
    }
  })
}

test('abandoned form final ack is reconciled once by exact normalized request before dirty close', async () => {
  const f = await fixture('final')
  try {
    await f.loseCredentialAck()
    f.dirty()
    expect(await f.run('close')).toBe('close')
    const finals = f.calls.filter(call => call.channel === 'channel:update')
    expect(finals).toHaveLength(2)
    expect(finals[1]).toEqual(finals[0])
    expect(f.calls.filter(call => call.channel === 'channel:stage')).toHaveLength(1)
    const capture = f.calls.find(call => call.channel === 'settings:update')!
    expect(capture.mutation).toMatchObject({ expectedRevision: 1 })
    expect(f.transport.revision).toBe(2)
    expect(f.snapshot().settings.sessionDrafts).toEqual({ 'draft-session': 'Owned dirty draft café' })
    expect(f.failures).toEqual([])
  } finally {
    f.cleanup()
  }
})

test('beginClose dirty capture aborts and reflushes while the real managed gate is open', async () => {
  const f = await fixture('stage')
  try {
    await f.loseCredentialAck()
    f.dirty()
    let first = true
    f.afterBegin(() => {
      if (first) {
        first = false
        f.dirty('Owned newer captured draft')
      }
    })
    expect(await f.run('close')).toBe('close')
    expect(f.snapshot().settings.sessionDrafts).toEqual({ 'draft-session': 'Owned newer captured draft' })
    expect(f.calls.filter(call => call.command === 'beginClose')).toHaveLength(2)
    expect(f.calls.filter(call => call.command === 'abortClose')).toHaveLength(1)
    expect(f.calls.filter(call => call.channel === 'settings:update')).toHaveLength(2)
    expect(f.calls.filter(call => call.channel === 'channel:stage')).toHaveLength(1)
    expect(f.calls.filter(call => call.channel === 'channel:update')).toHaveLength(0)
  } finally {
    f.cleanup()
  }
})

test('credential recovery drain does not wait for the entire active model reply', async () => {
  const f = await fixture('stage')
  try {
    await f.loseCredentialAck()
    f.dirty()
    let completed = false
    const run = f.api.sendAgentMessage({ sessionId: 'active', userMessage: 'Owned active run', channelId: 'owned', modelId: 'plain' }).then(() => { completed = true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(completed).toBe(false)
    expect(await f.run('close')).toBe('close')
    await withDeadline(run, 100)
    expect(completed).toBe(true)
    expect(f.snapshot().settings.sessionDrafts).toEqual({ 'draft-session': 'Owned dirty draft café' })
  } finally {
    f.cleanup()
  }
})

test('lost capture ack replays only that capture then persists a changed draft before close', async () => {
  const f = await fixture('stage')
  try {
    await f.loseCredentialAck()
    f.dirty()
    f.loseCapture()
    expect(await f.run('close')).toBe('failure')
    f.dirty('Owned newer after capture timeout')
    expect(await f.run('close')).toBe('close')
    const captures = f.calls.filter(call => call.channel === 'settings:update')
    expect(captures).toHaveLength(3)
    expect(captures[1]).toEqual(captures[0])
    expect(captures[2]?.mutation).toMatchObject({ expectedRevision: 1 })
    expect(f.snapshot().settings.sessionDrafts).toEqual({ 'draft-session': 'Owned newer after capture timeout' })
    expect(f.calls.filter(call => call.channel === 'channel:stage')).toHaveLength(1)
    expect(f.calls.filter(call => call.channel === 'channel:update')).toHaveLength(0)
  } finally {
    f.cleanup()
  }
})

test('lifecycle capture rejects ordinary access and any fields beyond the exact three UI fields', async () => {
  const f = await fixture('stage')
  try {
    await f.loseCredentialAck()
    const capture: LifecycleCapture = {
      tabState: { tabs: [], activeTabId: null, activeTabIdByWorkspace: {} },
      sidebarProjectFilesExpandedByWorkspace: {},
      sessionDrafts: { 'draft-session': 'Owned capture' },
    }
    await expect(f.transport.persistCapture(capture)).rejects.toThrow('invalidParams')
    f.transport.setClosing(true)
    await expect(f.transport.persistCapture({ ...capture, agentEffort: 'high' } as LifecycleCapture)).rejects.toThrow('invalidParams')
    await expect(f.transport.persistCapture({ sessionDrafts: {} } as LifecycleCapture)).rejects.toThrow('invalidParams')
    expect(f.calls.filter(call => call.channel === 'settings:update')).toHaveLength(0)
    await expect(f.api.updateSettings({ language: 'en' })).rejects.toThrow('mutationPending')
  } finally {
    f.cleanup()
  }
})

test('host freeze also rejects exact abandoned final reconciliation without clearing credential uncertainty', async () => {
  const f = await fixture('final')
  try {
    await f.loseCredentialAck()
    f.dirty()
    f.freezeHost()
    expect(await f.run('close')).toBe('failure')
    expect(f.isHostFrozen()).toBe(true)
    const finals = f.calls.filter(call => call.channel === 'channel:update')
    expect(finals).toHaveLength(2)
    expect(finals[1]).toEqual(finals[0])
    expect(f.failures).toMatchObject([{ code: 'recoveryRequired' }])
    expect(f.calls.some(call => call.channel === 'settings:update' || call.command === 'beginClose')).toBe(false)
    expect(f.store.get(agentSessionDraftsAtom).get('draft-session')).toBe('Owned dirty draft café')
    await expect(f.api.updateChannel('owned', { name: 'New intent' })).rejects.toThrow('mutationPending')
    expect(f.calls.filter(call => call.channel === 'channel:stage')).toHaveLength(1)
  } finally {
    f.cleanup()
  }
})
