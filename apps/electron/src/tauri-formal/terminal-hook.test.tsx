import { afterEach, expect, spyOn, test } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { createDesktopApi } from '../preload/api.ts'
import { createFormalTransport } from './transport.ts'
import type { NativeBridge, NativeEvent } from './protocol.ts'
import { useGlobalAgentListeners } from '../renderer/hooks/useGlobalAgentListeners.ts'
import { agentStreamingStatesAtom, agentMessageRefreshAtom } from '../renderer/atoms/agent-atoms.ts'
import { registerAgentAttempt } from '../renderer/lib/agent-attempt.ts'
import * as notifications from '../renderer/atoms/notifications.ts'

afterEach(cleanup)
test('StrictMode receipt 重放不会重新开启已完成请求，也不会触发 refresh 循环；新请求仍工作', async () => {
  let emit: (event: NativeEvent) => void = () => {}
  const bridge: NativeBridge = {
    listen: async (cb) => { emit = cb; return () => {} },
    request: async <T,>(request: Record<string, unknown>): Promise<T> => {
      const result = request.command === 'bootstrap' ? { generation: 'document-1', activeRuns: [], platformSnapshot: { version: 1, revision: 0, settings: {}, userProfile: {}, workspaces: [], theme: { mode: 'system', isDark: false }, chrome: { platform: 'darwin', fullscreen: false } } } : request.command === 'invoke' ? { value: [] } : { attached: true, activeRuns: [] }
      return result as T
    },
  }
  const transport = await createFormalTransport(bridge, (code) => code)
  window.electronAPI = createDesktopApi(transport)
  const store = createStore()
  const notify = spyOn(notifications, 'sendDesktopNotification').mockImplementation(() => {})
  function Listeners() { useGlobalAgentListeners(); return null }
  try {
    const mounted = render(<Provider store={store}><Listeners /></Provider>)
    const packet = (sequence: number, requestId: string, complete = false) => emit({ version: 1, generation: 'document-1', deliverySequence: sequence, channel: complete ? 'agent:stream:complete' : 'agent:stream:event', payload: { sessionId: 's', requestId, startedAt: 100, ...(complete ? { resultSubtype: 'success' } : { payload: { kind: 'asci_event', event: { type: 'text_snapshot', text: requestId } } }) } })
    await act(async () => { packet(1, 'old'); packet(2, 'old', true) })
    expect(store.get(agentStreamingStatesAtom).get('s')?.running ?? false).toBe(false)
    const refresh = store.get(agentMessageRefreshAtom)
    store.set(agentStreamingStatesAtom, new Map())
    mounted.unmount()
    render(<Provider store={store}><Listeners /></Provider>)
    await act(async () => packet(3, 'old'))
    expect(store.get(agentStreamingStatesAtom).get('s')?.running ?? false).toBe(false)
    await act(async () => packet(4, 'old', true))
    expect(store.get(agentStreamingStatesAtom).get('s')?.running ?? false).toBe(false)
    expect(store.get(agentMessageRefreshAtom)).toBe(refresh)
    expect(notify).toHaveBeenCalledTimes(1)
    const newId = registerAgentAttempt(store, 's')!
    store.set(agentStreamingStatesAtom, new Map([['s', { running: true, content: '', toolActivities: [], teammates: [], startedAt: 100 }]]))
    await act(async () => packet(5, newId))
    expect(store.get(agentStreamingStatesAtom).get('s')?.content).toBe(newId)
    expect(store.get(agentStreamingStatesAtom).get('s')?.running).toBe(true)
    await act(async () => packet(6, newId, true))
    expect(store.get(agentStreamingStatesAtom).get('s')?.running ?? false).toBe(false)
  } finally { cleanup(); transport.dispose(); notify.mockRestore() }
})
