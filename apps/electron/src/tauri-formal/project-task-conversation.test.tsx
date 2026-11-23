import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import type { SDKAssistantMessage, SDKMessage } from '@asci/shared'
import { AgentMessages } from '../renderer/components/agent/AgentMessages'
import { TooltipProvider } from '../renderer/components/ui/tooltip'
import { agentStreamingStatesAtom, agentStreamErrorsAtom } from '../renderer/atoms/agent-atoms'
import { currentAgentAttempt } from '../renderer/lib/agent-attempt'
import { setAppLanguage } from '../renderer/lib/i18n'

const original = window.__TAURI_FORMAL__
afterEach(async () => { cleanup(); window.__TAURI_FORMAL__ = original; await setAppLanguage('en') })

function turn(requestId: string, status: SDKAssistantMessage['_desktopRuntimeStatus'], text: string): SDKMessage[] {
  return [
    { type: 'user', uuid: requestId + '-user', message: { content: [{ type: 'text', text: 'Synthetic prompt' }] }, parent_tool_use_id: null },
    { type: 'assistant', uuid: requestId + '-assistant', _desktopTextTaskRequestId: requestId, _desktopRuntimeStatus: status,
      ...(status === 'failed' || status === 'interrupted' ? { error: { message: 'The Rust response could not finish.' } } : {}),
      parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } },
  ]
}
function conversation(sdkMessages: SDKMessage[]) {
  const store = createStore()
  const view = render(<Provider store={store}><TooltipProvider><AgentMessages sessionId="s1" messages={[]} messagesLoaded
    persistedSDKMessages={sdkMessages} streaming={false} /></TooltipProvider></Provider>)
  return { store, view }
}
test('restored native text outcomes keep partial and empty turns; only the latest failure can be explicitly retried', async () => {
  const retry = mock<NonNullable<NonNullable<typeof original>['nativeTaskLifecycle']>['retry']>(async () => {})
  window.__TAURI_FORMAL__ = { hydrated() {}, nativeTaskLifecycle: { retry, stop: async () => {} } }
  const { view, store } = conversation([...turn('older', 'failed', 'Synthetic partial'), ...turn('last', 'interrupted', '')])
  expect(view.container.textContent).toContain('Synthetic partial')
  expect(view.container.querySelector('[data-native-task-status="failed"]')).not.toBeNull()
  expect(view.container.querySelector('[data-native-task-status="interrupted"]')).toHaveTextContent('Interrupted')
  const buttons = view.container.querySelectorAll<HTMLButtonElement>('[data-native-task-retry]')
  expect(buttons).toHaveLength(1)
  expect(retry).not.toHaveBeenCalled()
  act(() => { fireEvent.click(buttons[0]!); fireEvent.click(buttons[0]!) })
  expect(retry).toHaveBeenCalledTimes(1)
  expect(retry.mock.calls[0]).toEqual([{ sessionId: 's1', requestId: expect.any(String), startedAt: expect.any(Number), retryOfRequestId: 'last' }])
  expect(retry.mock.calls[0]?.[0].requestId).toBe(currentAgentAttempt(store, 's1'))
  expect(store.get(agentStreamingStatesAtom).get('s1')?.running).toBe(true)
})
test('a rejected native retry releases its own running state and reports the error', async () => {
  window.__TAURI_FORMAL__ = { hydrated() {}, nativeTaskLifecycle: { retry: async () => { throw new Error('Synthetic rejection') }, stop: async () => {} } }
  const { view, store } = conversation(turn('last', 'failed', ''))
  fireEvent.click(view.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(store.get(agentStreamErrorsAtom).get('s1')).toBe('Synthetic rejection'))
  expect(store.get(agentStreamingStatesAtom).get('s1')?.running).not.toBe(true)
})
test('completed, cancelled and superseded turns cannot be retried', async () => {
  await setAppLanguage('zh')
  window.__TAURI_FORMAL__ = { hydrated() {}, nativeTaskLifecycle: { retry: async () => {}, stop: async () => {} } }
  const { view } = conversation([...turn('a', 'failed', ''), ...turn('b', 'cancelled', ''), ...turn('c', 'completed', '')])
  expect(view.container.querySelector('[data-native-task-status="completed"]')).toHaveTextContent('已完成')
  expect(view.container.querySelector('[data-native-task-status="cancelled"]')).toHaveTextContent('已停止')
  expect(view.container.querySelector('[data-native-task-retry]')).toBeNull()
})
test('ordinary Electron or an older native host retains its existing renderer', () => {
  delete window.__TAURI_FORMAL__
  const { view } = conversation(turn('last', 'failed', ''))
  expect(view.container.querySelector('[data-native-task-status]')).toBeNull()
  expect(view.container.querySelector('[data-native-task-retry]')).toBeNull()
})

test('returning to the original composer stops only its displayed attempt and waits for a native terminal', async () => {
  const { AgentView } = await import('../renderer/components/agent/AgentView')
  const { createFormalTransport } = await import('./transport')
  const { createDesktopApi } = await import('../preload/api')
  const { agentSessionDraftsAtom, stoppedByUserSessionsAtom } = await import('../renderer/atoms/agent-atoms')
  const { restoreAgentAttempt } = await import('../renderer/lib/agent-attempt')
  const priorApi = window.electronAPI
  const calls: Record<string, unknown>[] = []
  const transport = await createFormalTransport({
    listen: async () => () => {},
    request: async <T,>(call: Record<string, unknown>): Promise<T> => {
      calls.push(call)
      if (call.command === 'bootstrap') return { generation: 'g', activeRuns: [], platformSnapshot: { revision: 0, settings: {}, theme: {}, chrome: {} } } as T
      if (call.command === 'restore') return { restoreToken: 'r', deliverySequence: 0, messages: [], sdkMessages: [], activeSnapshot: null } as T
      return { value: null } as T
    },
  }, code => code)
  try {
    window.electronAPI = createDesktopApi(transport)
    for (const channel of ['event', 'complete', 'error']) transport.subscribe('agent:stream:' + channel, () => {})
    window.__TAURI_FORMAL__ = { hydrated() {}, nativeTaskLifecycle: {
      retry: input => transport.invoke('agent:send-message', input),
      stop: (sid, expected) => transport.invoke('agent:stop', sid, expected),
    } }
    const store = createStore()
    restoreAgentAttempt(store, 's1', 'original')
    store.set(agentStreamingStatesAtom, new Map([['s1', { running: true, content: 'Still running', toolActivities: [], teammates: [], startedAt: 3 }]]))
    store.set(agentSessionDraftsAtom, new Map([['s1', 'Unsent draft']]))
    const mount = () => render(<Provider store={store}><TooltipProvider><AgentView sessionId="s1" /></TooltipProvider></Provider>)
    mount().unmount()
    const returned = mount()
    const stop = await returned.findByRole('button', { name: 'Stop generation' })
    fireEvent.click(stop)
    fireEvent.click(stop)
    await waitFor(() => expect(calls.filter(c => c.channel === 'agent:stop').map(c => c.args)).toEqual([['s1', 'original']]))
    expect(store.get(agentStreamingStatesAtom).get('s1')?.running).toBe(true)
    expect(store.get(stoppedByUserSessionsAtom).has('s1')).toBe(false)
    restoreAgentAttempt(store, 's1', 'successor')
    fireEvent.click(stop)
    expect(calls.filter(c => c.channel === 'agent:stop')).toHaveLength(1)
    expect(calls.filter(c => c.channel === 'agent:send-message')).toHaveLength(0)
  } finally { cleanup(); transport.dispose(); window.electronAPI = priorApi }
})

test('a confirmed native user echo replaces only its optimistic copy across history and live replay', async () => {
  window.__TAURI_FORMAL__ = { hydrated() {}, nativeTaskLifecycle: { retry: async () => {}, stop: async () => {} } }
  const earlier = turn('old', 'completed', 'Earlier result')
  const confirmed = { ...turn('new', undefined, '')[0]!, _desktopTextTaskRequestId: 'new' } as SDKMessage
  const optimistic: SDKMessage = { type: 'user', _agentRequestId: 'new', message: { content: [{ type: 'text', text: 'Synthetic prompt' }] }, parent_tool_use_id: null }
  const view = render(<Provider store={createStore()}><TooltipProvider><AgentMessages sessionId="s1" messages={[]} messagesLoaded
    persistedSDKMessages={[...earlier, optimistic, confirmed]} liveMessages={[{ ...confirmed }]} streaming /></TooltipProvider></Provider>)
  await act(async () => {})
  const rows = view.container.querySelectorAll('[data-message-role="user"]')
  expect([...rows].map(row => row.getAttribute('data-message-id'))).toEqual(['old-user', 'new-user'])
})

test.each(['cancelled', 'interrupted'] as const)('a new native delta after a %s turn reaches the conversation when WebKit pauses frames', async status => {
  window.__TAURI_FORMAL__ = { hydrated() {}, nativeTaskLifecycle: { retry: async () => {}, stop: async () => {} } }
  const raf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = () => 3
  try {
    const store = createStore()
    const props = { sessionId: 's1', messages: [], messagesLoaded: true, persistedSDKMessages: [...turn('old', status, 'Prior response'), turn('new', undefined, '')[0]!] , streaming: true }
    const show = (content: string) => <Provider store={store}><TooltipProvider><AgentMessages {...props}
      streamState={{ running: true, content, toolActivities: [], teammates: [], startedAt: 10 }} /></TooltipProvider></Provider>
    const view = render(show(''))
    await act(async () => { view.rerender(show('Authoritative native delta')) })
    expect(view.container).toHaveTextContent('Authoritative native delta')
  } finally { globalThis.requestAnimationFrame = raf }
})

test('a restored native transcript is painted without a frame or opacity transition', async () => {
  window.__TAURI_FORMAL__ = { hydrated() {}, nativeTaskLifecycle: { retry: async () => {}, stop: async () => {} } }
  const raf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = () => 3
  try {
    const { view } = conversation(turn('restore', 'interrupted', 'Recovered visible text'))
    const log = view.getByRole('log')
    expect(log).toHaveTextContent('Recovered visible text')
    expect(log).not.toHaveClass('opacity-0')
    expect(log).not.toHaveClass('transition-opacity')
    await act(async () => {})
  } finally { globalThis.requestAnimationFrame = raf }
})
