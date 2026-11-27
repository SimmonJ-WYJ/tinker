import { afterEach, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { AgentView } from '../renderer/components/agent/AgentView.tsx'
import { TooltipProvider } from '../renderer/components/ui/tooltip.tsx'
import { setAppLanguage } from '../renderer/lib/i18n.ts'
import { createFormalTransport } from './transport.ts'
import { createDesktopApi } from '../preload/api.ts'
import { seedCredentialedState } from './bootstrap-state.ts'
import { channelsAtom, channelsLoadedAtom } from '../renderer/atoms/channels-atoms.ts'
import { agentChannelIdAtom, agentChannelIdsAtom, agentModelIdAtom, agentSessionDraftsAtom, agentPendingPromptAtom, agentStreamingStatesAtom, agentSessionsAtom, agentSessionChannelMapAtom, agentSessionModelMapAtom } from '../renderer/atoms/agent-atoms.ts'
import type { NativeBridge } from './protocol.ts'

const previousMarker = window.__TAURI_FORMAL__
const previous = window.electronAPI
const previousPreview = window.__DESKTOP_RUNTIME_PREVIEW__; const previousQueue = window.__TAURI_QUEUEING__
afterEach(() => {
  cleanup()
  window.__TAURI_FORMAL__ = previousMarker
  window.electronAPI = previous
  window.__DESKTOP_RUNTIME_PREVIEW__ = previousPreview
  window.__TAURI_QUEUEING__ = previousQueue
})

async function setup() {
  await setAppLanguage('en')
  const calls: Record<string, unknown>[] = []
  const channel = {
    id: 'owned',
    name: 'Owned',
    provider: 'custom-openai' as const,
    baseUrl: 'https://owned.invalid/v1',
    apiKey: '',
    hasCredential: true,
    models: [{
      id: 'plain',
      name: 'Plain',
      enabled: true,
      supportedEfforts: []
    }],
    enabled: true,
    createdAt: 0,
    updatedAt: 0
  }
  const bridge: NativeBridge = {
    listen: async () => () => {},
    request: async<T,>(r: Record<string, unknown>): Promise<T> => {
      calls.push(r)
      let value: unknown = {
        value: null
      }
      if (r.command === 'bootstrap') value = {
        credentialedChannels: true,
        queueing: false,
        generation: 'g',
        activeRuns: [],
        platformSnapshot: {
          version: 1,
          revision: 0,
          settings: {},
          theme: {},
          chrome: {}
        }
      }
      else if (r.command === 'restore') value = {
        restoreToken: 'r',
        deliverySequence: 0,
        messages: [],
        sdkMessages: [],
        activeSnapshot: null,
        cursor: 0
      }
      else if (r.channel === 'channel:list') value = {
        value: [channel]
      }
      else if (r.channel === 'agent:get-reasoning-effort') value = {
        value: ''
      }
      else if (r.channel === 'settings:get') value = {
        value: {}
      }
      return value as T
    }
  }
  const transport = await createFormalTransport(bridge, c => c)
  window.electronAPI = createDesktopApi(transport)
  window.__DESKTOP_RUNTIME_PREVIEW__ = true
  window.__TAURI_QUEUEING__ = transport.bootstrap.queueing === true
  for (const name of ['agent:stream:event', 'agent:stream:complete', 'agent:stream:error']) transport.subscribe(name, () => {})
  const store = createStore()
  seedCredentialedState(transport.bootstrap, store)
  store.set(channelsLoadedAtom, true)
  return { transport, store, channel, calls }
}

test('actual original AgentView disables unconfigured sends and sends fresh/continuation without high fallback', async () => {
  const { transport, store, channel, calls } = await setup()
  const view = render(<Provider store={store}><TooltipProvider><AgentView sessionId="fresh" /></TooltipProvider></Provider>)
  expect(screen.getByRole('button', {
    name: 'Send message'
  })).toBeDisabled()
  expect(calls.some(c => c.channel === 'agent:send-message')).toBe(false)
  await act(async () => {
    store.set(channelsAtom, [channel])
    store.set(agentChannelIdAtom, 'owned')
    store.set(agentChannelIdsAtom, ['owned'])
    store.set(agentModelIdAtom, 'plain')
    store.set(agentSessionDraftsAtom, new Map([['fresh', 'Owned first turn']]))
  })
  await waitFor(() => expect(screen.getByRole('button', {
    name: 'Send message'
  })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', {
    name: 'Send message'
  }))
  await waitFor(() => expect(calls.filter(c => c.channel === 'agent:send-message')).toHaveLength(1))
  expect(screen.getByRole('button', {
    name: 'Reasoning effort'
  })).toHaveTextContent('Default')
  expect((calls.find(c => c.channel === 'agent:send-message')?.args as {
    effort?: string
  }[])[0]?.effort).toBeUndefined()
  await act(async () => {
    store.set(agentSessionDraftsAtom, new Map([['fresh', 'Owned queued attempt']]))
  })
  fireEvent.click(screen.getByRole('button', {
    name: 'Send message'
  }))
  expect(calls.some(c => c.channel === 'agent:queue-message')).toBe(false)
  expect(store.get(agentSessionDraftsAtom).get('fresh')).toBe('Owned queued attempt')
  await act(async () => {
    store.set(agentSessionDraftsAtom, new Map())
    store.set(agentStreamingStatesAtom, new Map())
    store.set(agentPendingPromptAtom, {
      sessionId: 'fresh',
      message: 'Owned continuation'
    })
  })
  await waitFor(() => expect(calls.filter(c => c.channel === 'agent:send-message')).toHaveLength(2))
  expect((calls.filter(c => c.channel === 'agent:send-message')[1]?.args as {
    effort?: string
  }[])[0]?.effort).toBeUndefined()
  view.unmount()
  transport.dispose()
})

test('restored edit waits for its child metadata, preserves literal text and submits only to its original route', async () => {
  const { transport, store, channel, calls } = await setup()
  const prompt = 'Example <b>literal</b> with #mcp:example'
  const route = { channelId: 'owned', modelId: 'plain', configRevision: 'source-revision' }
  window.__TAURI_FORMAL__ = { hydrated() {}, prepareRevision: async () => { throw new Error('unexpected preparation') } }
  store.set(channelsAtom, [channel])
  store.set(agentChannelIdAtom, 'another-channel')
  store.set(agentChannelIdsAtom, ['owned', 'another-channel'])
  store.set(agentModelIdAtom, 'another-model')
  store.set(agentSessionDraftsAtom, new Map([['parked', prompt]]))
  const view = render(<Provider store={store}><TooltipProvider><AgentView sessionId="parked" /></TooltipProvider></Provider>)
  try {
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    await act(async () => {
      store.set(agentSessionsAtom, [{ id: 'parked', title: 'Branch', createdAt: 1, updatedAt: 1, nativeRevisionRoute: route }])
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).not.toBeDisabled())
    // 设置页可能自动替换全局/per-session 模型。这不代表用户在此草稿中另选了渠道。
    await act(async () => {
      store.set(agentSessionChannelMapAtom, new Map([['parked', 'substituted-channel']]))
      store.set(agentSessionModelMapAtom, new Map([['parked', 'substituted-model']]))
    })
    expect(view.container.querySelector('.ProseMirror')).toHaveTextContent('Example <b>literal</b>')
    expect(calls.filter(c => c.channel === 'agent:send-message')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(calls.filter(c => c.channel === 'agent:send-message')).toHaveLength(1))
    expect(calls.find(c => c.channel === 'agent:send-message')?.args).toEqual([{
      sessionId: 'parked', workspaceId: undefined, userMessage: prompt, channelId: 'owned', modelId: 'plain',
      expectedConfigRevision: 'source-revision', requestId: expect.any(String), startedAt: expect.any(Number),
    }])
  } finally { view.unmount(); transport.dispose() }
})
