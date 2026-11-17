import { afterEach, expect, test } from 'bun:test'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { useReasoningEffort } from '../renderer/hooks/useReasoningEffort.ts'
import { resolveSessionEffort } from '../renderer/lib/session-effort.ts'
import { seedCredentialedState } from './bootstrap-state.ts'
import { agentChannelIdAtom, agentModelIdAtom, agentDefaultReasoningEffortAtom, agentReasoningEffortMapAtom, currentAgentWorkspaceIdAtom, agentWorkspacesAtom } from '../renderer/atoms/agent-atoms.ts'
import { createDesktopApi } from '../preload/api.ts'
import { createFormalTransport } from './transport.ts'
import type { NativeBridge, Bootstrap } from './protocol.ts'

const previous = window.electronAPI
afterEach(() => {
  cleanup()
  window.electronAPI = previous
})

test('managed fresh and reloaded original session state sends no effort, explicit unsupported effort remains visible to host', async () => {
  const calls: Record<string, unknown>[] = []
  const boot = {
    credentialedChannels: true,
    queueing: false,
    generation: 'g',
    activeRuns: [],
    platformSnapshot: {
      version: 1,
      revision: 0,
      settings: {},
      userProfile: {
        userName: 'Owned',
        avatar: 'icon:user'
      },
      workspaces: [],
      theme: {
        mode: 'system',
        isDark: false
      },
      chrome: {
        platform: 'darwin',
        fullscreen: false
      }
    }
  } as Bootstrap
  const bridge: NativeBridge = {
    listen: async () => () => {},
    request: async<T,>(r: Record<string, unknown>): Promise<T> => {
      calls.push(r)
      if (r.command === 'bootstrap') return boot as T
      if (r.channel === 'agent:get-reasoning-effort') return {
        value: ''
      } as T
      if (r.channel === 'agent:send-message' && (r.args as {
        effort?: string
      }[])[0]?.effort) throw {
        code: 'unsupportedEffort'
      }
      return {
        value: null
      } as T
    }
  }
  const t = await createFormalTransport(bridge, c => c)
  window.electronAPI = createDesktopApi(t)
  const store = createStore()
  seedCredentialedState(t.bootstrap, store)
  expect(store.get(agentChannelIdAtom)).toBeNull()
  expect(store.get(agentModelIdAtom)).toBeNull()
  expect(store.get(agentDefaultReasoningEffortAtom)).toBe('')
  function State({
    session
  }: {
    session: string
  }) {
    useReasoningEffort(session)
    return null
  }
  const mounted = render(<Provider store={store}><State session="fresh" /></Provider>)
  await waitFor(() => expect(store.get(agentReasoningEffortMapAtom).get('fresh')).toBe(''))
  await window.electronAPI.sendAgentMessage({
    sessionId: 'fresh',
    userMessage: 'owned',
    channelId: 'owned',
    modelId: 'plain',
    effort: resolveSessionEffort(store, 'fresh')
  })
  expect((calls.find(c => c.channel === 'agent:send-message')?.args as object[])[0]).toHaveProperty('effort', undefined)
  await act(async () => {
    store.set(agentWorkspacesAtom, [{
      id: 'w',
      slug: 'owned-workspace',
      name: 'Owned',
      createdAt: 0,
      updatedAt: 0
    }])
    store.set(currentAgentWorkspaceIdAtom, 'w')
  })
  mounted.rerender(<Provider store={store}><State session="reloaded" /></Provider>)
  await waitFor(() => expect(store.get(agentReasoningEffortMapAtom).get('reloaded')).toBe(''))
  await window.electronAPI.sendAgentMessage({
    sessionId: 'reloaded',
    userMessage: 'owned continuation',
    channelId: 'owned',
    modelId: 'plain',
    effort: resolveSessionEffort(store, 'reloaded')
  })
  store.set(agentReasoningEffortMapAtom, new Map([['reloaded', 'high']]))
  await expect(window.electronAPI.sendAgentMessage({
    sessionId: 'reloaded',
    userMessage: 'explicit',
    channelId: 'owned',
    modelId: 'plain',
    effort: resolveSessionEffort(store, 'reloaded')
  })).rejects.toThrow('unsupportedEffort')
  const explicitStore = createStore()
  seedCredentialedState({
    ...boot,
    platformSnapshot: {
      ...boot.platformSnapshot,
      settings: {
        agentEffort: 'high'
      }
    }
  }, explicitStore)
  expect(resolveSessionEffort(explicitStore, 'saved')).toBe('high')
  expect(calls.filter(c => c.command === 'bootstrap')).toHaveLength(1)
  t.dispose()
})

test('legacy session default remains high', () => {
  const store = createStore()
  expect(resolveSessionEffort(store, 'legacy')).toBe('high')
})
