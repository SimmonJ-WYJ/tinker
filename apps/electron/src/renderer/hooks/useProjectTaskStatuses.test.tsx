import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { AgentStreamCompletePayload, AgentStreamEvent } from '@asci/shared'
import { useProjectTaskStatuses } from './useProjectTaskStatuses'

const originalMarker = window.__TAURI_FORMAL__
const originalApi = window.electronAPI
afterEach(() => {
  cleanup()
  window.__TAURI_FORMAL__ = originalMarker
  window.electronAPI = originalApi
})

test('restores project statuses once, ignores foreign events and token fragments, and refreshes on completion', async () => {
  let event!: (ev: AgentStreamEvent) => void
  let complete!: (ev: AgentStreamCompletePayload) => void
  window.electronAPI = {
    onAgentStreamEvent(cb: typeof event) { event = cb; return () => {} },
    onAgentStreamComplete(cb: typeof complete) { complete = cb; return () => {} },
  } as unknown as Window['electronAPI']
  const read = mock(async (_project: string) => [{ sessionId: 's', requestId: 'r', status: 'running' as const }])
  window.__TAURI_FORMAL__ = { hydrated() {}, projectTaskStatuses: read }
  const ids = ['s']
  const view = renderHook(() => useProjectTaskStatuses('p', ids))
  await waitFor(() => expect(view.result.current.statuses?.get('s')).toBe('running'))
  const send = (s: string, id: string) => event({ sessionId:s, requestId:id } as AgentStreamEvent)
  await act(async () => { send('other','x'); send('s','new'); send('s','new'); send('s','new') })
  expect(read).toHaveBeenCalledTimes(2)
  await act(async () => { complete({ sessionId:'s', requestId:'new' }) })
  expect(read).toHaveBeenCalledTimes(3)
  expect(read.mock.calls.every(([p]) => p === 'p')).toBe(true)
})

test('late results from a previous project cannot replace the selected project', async () => {
  let finish!: (value: []) => void
  window.electronAPI = {
    onAgentStreamEvent: () => () => {}, onAgentStreamComplete: () => () => {},
  } as unknown as Window['electronAPI']
  const read = mock(async (project: string) => project === 'a' ? new Promise<[]>(r => { finish = r }) : [{ sessionId:'b', requestId:'r', status:'interrupted' as const }])
  window.__TAURI_FORMAL__ = { hydrated() {}, projectTaskStatuses:read }
  const view = renderHook(({id}) => useProjectTaskStatuses(id,[id]), {initialProps:{id:'a'}})
  view.rerender({id:'b'})
  await waitFor(() => expect(view.result.current.statuses?.get('b')).toBe('interrupted'))
  await act(async () => { finish([]) })
  expect(view.result.current.statuses?.get('b')).toBe('interrupted')
})

test('recovers from a failed read on focus without requiring another send', async () => {
  window.electronAPI = {
    onAgentStreamEvent: () => () => {}, onAgentStreamComplete: () => () => {},
  } as unknown as Window['electronAPI']
  const read = mock(async () => [{ sessionId: 's', requestId: 'r', status: 'completed' as const }])
  read.mockImplementationOnce(async () => { throw new Error('runtimeUnavailable') })
  window.__TAURI_FORMAL__ = { hydrated() {}, projectTaskStatuses: read }
  const view = renderHook(() => useProjectTaskStatuses('project', ['s']))
  await waitFor(() => expect(view.result.current.unavailable).toBe(true))
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(view.result.current.unavailable).toBeUndefined()
  expect(view.result.current.statuses?.get('s')).toBe('completed')
  expect(read).toHaveBeenCalledTimes(2)
})

test('the default Electron host registers no native task listeners', () => {
  window.__TAURI_FORMAL__ = undefined
  const subscribe = mock(() => () => {})
  window.electronAPI = {
    onAgentStreamEvent: subscribe, onAgentStreamComplete: subscribe,
  } as unknown as Window['electronAPI']
  const view = renderHook(() => useProjectTaskStatuses('project', ['s']))
  expect(view.result.current).toEqual({})
  expect(subscribe).not.toHaveBeenCalled()
})
