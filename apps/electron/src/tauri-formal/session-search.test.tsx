import * as React from 'react'
import { afterEach, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import type { SDKMessage } from '@asci/shared'
import { createDesktopApi } from '../preload/api.ts'
import { RichTextInput } from '../renderer/components/ai-elements/rich-text-input.tsx'
import { AgentMessages } from '../renderer/components/agent/AgentMessages.tsx'
import { SearchDialog } from '../renderer/components/app-shell/SearchDialog.tsx'
import { TooltipProvider } from '../renderer/components/ui/tooltip.tsx'
import { agentSessionsAtom, currentAgentSessionIdAtom } from '../renderer/atoms/agent-atoms.ts'
import { searchDialogOpenAtom } from '../renderer/atoms/search-atoms.ts'
import { setAppLanguage } from '../renderer/lib/i18n.ts'
import { createFormalTransport } from './transport.ts'
import type { NativeBridge } from './protocol.ts'

const priorApi = window.electronAPI
const priorHost = window.__TAURI_FORMAL__
afterEach(() => {
  cleanup()
  window.electronAPI = priorApi
  window.__TAURI_FORMAL__ = priorHost
})

test('native content result opens archived session and focuses the matching queued user after history loads', async () => {
  await setAppLanguage('en')
  const requests: Record<string, unknown>[] = []
  const bridge: NativeBridge = {
    listen: async () => () => {},
    request: async <T,>(request: Record<string, unknown>): Promise<T> => {
      requests.push(request)
      if (request.command === 'bootstrap') return {
        generation: 'doc', activeRuns: [], platformSnapshot: { revision: 0, settings: {}, theme: {}, chrome: {} },
      } as T
      if (request.channel === 'agent:search-messages') return { value: [{
        sessionId: 'archived', sessionTitle: 'Weekend notes', archived: true,
        role: 'user', messageId: 'native-queue:["chain-b","same-id"]',
        snippet: '🌻unique phrase', matchStart: 2, matchLength: 6,
      }] } as T
      throw Error('unexpected request')
    },
  }
  const transport = await createFormalTransport(bridge, code => code)
  window.electronAPI = createDesktopApi(transport)
  window.__TAURI_FORMAL__ = { hydrated: () => {} }
  const store = createStore()
  store.set(searchDialogOpenAtom, true)
  const sdkMessages: SDKMessage[] = ['a', 'b'].map(chain => ({
    type: 'user', uuid: 'same-id', _desktopQueueUuid: 'same-id', _desktopQueueChainId: `chain-${chain}`,
    message: { content: [{ type: 'text', text: chain === 'b' ? '🌻unique phrase' : 'elsewhere' }] },
  }))
  const view = (loaded: boolean) => <Provider store={store}><TooltipProvider>
    <SearchDialog />
    <AgentMessages sessionId="archived" streaming={false} messages={[]} messagesLoaded={loaded}
      persistedSDKMessages={loaded ? sdkMessages : []} />
    {loaded && <RichTextInput value="" onChange={() => {}} onSubmit={() => {}} autoFocusTrigger="archived" />}
  </TooltipProvider></Provider>
  const result = render(view(false))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unique' } })
  const row = await screen.findByRole('button', { name: /Weekend notes/ })
  expect(row.querySelector('mark')?.textContent).toBe('unique')
  expect(requests.some(request => request.channel === 'agent:search-messages' &&
    JSON.stringify(request.args) === '["unique"]')).toBe(true)
  const searchInput = screen.getByRole('textbox')
  fireEvent.compositionStart(searchInput)
  expect(fireEvent.keyDown(searchInput, { key: 'Enter', cancelable: true })).toBe(true)
  expect(store.get(searchDialogOpenAtom)).toBe(true)
  fireEvent.compositionEnd(searchInput)
  fireEvent.change(searchInput, { target: { value: 'different query' } })
  fireEvent.keyDown(searchInput, { key: 'Enter' })
  expect(store.get(searchDialogOpenAtom)).toBe(true)
  expect(store.get(currentAgentSessionIdAtom)).not.toBe('archived')
  fireEvent.change(searchInput, { target: { value: 'unique' } })
  fireEvent.click(await screen.findByRole('button', { name: /Weekend notes/ }))
  expect(store.get(currentAgentSessionIdAtom)).toBe('archived')
  expect(store.get(searchDialogOpenAtom)).toBe(false)
  expect(store.get(agentSessionsAtom)).toHaveLength(0)
  result.rerender(view(true))
  await waitFor(() => expect(document.activeElement?.getAttribute('data-message-id'))
    .toBe('native-queue:["chain-b","same-id"]'))
  // 等待原编辑器的延迟自动聚焦执行，确保它不夺走显式搜索定位。
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)) })
  expect(document.activeElement?.getAttribute('data-message-id')).toBe('native-queue:["chain-b","same-id"]')
  expect(result.container.querySelector('[data-message-id]')).not.toBe(document.activeElement)
  await act(async () => transport.dispose())
})

test('native content search reports unavailable history separately from no matches and ignores an older reply', async () => {
  await setAppLanguage('en')
  const store = createStore()
  store.set(searchDialogOpenAtom, true)
  const requests: Array<string> = []
  let releaseOld: (() => void) | undefined
  const bridge: NativeBridge = {
    listen: async () => () => {},
    request: async <T,>(request: Record<string, unknown>): Promise<T> => {
      if (request.command === 'bootstrap') return {
        generation: 'doc', activeRuns: [], platformSnapshot: { revision: 0, settings: {}, theme: {}, chrome: {} },
      } as T
      if (request.channel !== 'agent:search-messages') throw Error('unexpected request')
      const query = (request.args as string[])[0]!
      requests.push(query)
      if (query === 'old') {
        await new Promise<void>(resolve => { releaseOld = resolve })
        return { value: [{ sessionId: 'old', sessionTitle: 'Superseded hit', messageId: 'x', role: 'user', snippet: 'old', matchStart: 0, matchLength: 3 }] } as T
      }
      if (query === 'unreadable') throw { code: 'storeIo' }
      return { value: [] } as T
    },
  }
  const transport = await createFormalTransport(bridge, code => code)
  window.electronAPI = createDesktopApi(transport)
  window.__TAURI_FORMAL__ = { hydrated: () => {} }
  render(<Provider store={store}><SearchDialog /></Provider>)
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'old' } })
  await waitFor(() => expect(requests).toEqual(['old']))
  fireEvent.change(input, { target: { value: 'unreadable' } })
  expect(await screen.findByRole('status')).toHaveTextContent('Could not search conversation messages.')
  expect(screen.queryByText('No matches found')).toBeNull()
  await act(async () => { releaseOld?.() })
  expect(screen.queryByRole('button', { name: /Superseded hit/ })).toBeNull()
  fireEvent.change(input, { target: { value: 'new' } })
  expect(await screen.findByText('No matches found')).toBeInTheDocument()
  expect(screen.queryByRole('status')).toBeNull()
  transport.dispose()
})

test('native search remains mounted while the narrow navigation drawer is closed', async () => {
  Object.assign(globalThis, { __APP_VERSION__: 'test', __TINKER_CANDIDATE__: true })
  const { AppShell } = await import('../renderer/components/app-shell/AppShell.tsx')
  const { activeViewAtom } = await import('../renderer/atoms/active-view.ts')
  const store = createStore()
  store.set(activeViewAtom, 'library')
  window.__TAURI_FORMAL__ = { hydrated: () => {} }
  const original = window.matchMedia
  window.matchMedia = (query: string) => {
    const result = original.call(window, query)
    if (query === '(max-width: 1100px)') Object.defineProperty(result, 'matches', { value: true })
    return result
  }
  try {
    render(<Provider store={store}><TooltipProvider><AppShell contextValue={{}} /></TooltipProvider></Provider>)
    await act(async () => { store.set(searchDialogOpenAtom, true) })
    expect(await screen.findByRole('dialog', { name: 'Search conversations' })).toBeInTheDocument()
    expect(screen.getAllByPlaceholderText('Search conversations...')).toHaveLength(1)
  } finally { window.matchMedia = original }
})
