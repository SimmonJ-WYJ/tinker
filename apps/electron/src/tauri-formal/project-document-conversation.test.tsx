import { expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import type { AgentSendInput } from '@asci/shared'
import { createDesktopApi } from '../preload/api'
import { agentChannelIdAtom, agentChannelIdsAtom, agentModelIdAtom, agentSessionDraftsAtom, agentSessionsAtom } from '../renderer/atoms/agent-atoms'
import { channelsAtom, channelsLoadedAtom } from '../renderer/atoms/channels-atoms'
import { AgentView } from '../renderer/components/agent/AgentView'
import { TooltipProvider } from '../renderer/components/ui/tooltip'
import { setAppLanguage } from '../renderer/lib/i18n'
import { createFormalTransport } from './transport'

for (const pdf of [false, true]) test(`sending a ${pdf ? 'PDF' : 'text'} citation consumes consent even when dispatch fails`, async () => {
  const previousApi = window.electronAPI, previousMarker = window.__TAURI_FORMAL__
  const requests: AgentSendInput[] = []
  let fail!: (error: Error) => void
  const transport = await createFormalTransport({
    listen: async () => () => {},
    request: async <T,>(call: Record<string, unknown>): Promise<T> => {
      if (call.command === 'bootstrap') return { generation: 'g', activeRuns: [], platformSnapshot: { revision: 0, settings: {}, theme: {}, chrome: {} } } as T
      if (call.command === 'restore') return { restoreToken: 'r', deliverySequence: 0, messages: [], sdkMessages: [], activeSnapshot: null } as T
      return { value: null } as T
    },
  }, code => code)
  try {
    await setAppLanguage('en')
    for (const channel of ['event', 'complete', 'error']) transport.subscribe('agent:stream:' + channel, () => {})
    const document = { filename: pdf ? 'owned.pdf' : 'owned.md', ...(pdf && { pageLineCounts: [0, 1] }), documentId: 'doc-one', lineCount: 1, byteLength: 5 }
    window.__TAURI_FORMAL__ = { hydrated() {}, projectDocuments: {
      list: async () => [document], pick: async () => null,
      read: async (_workspace, { page }) => ({ document, page, startLine: 1, endLine: 1, text: 'owned' }),
    } }
    window.electronAPI = { ...createDesktopApi(transport), sendAgentMessage: async input => {
      requests.push(input)
      if (requests.length === 1) await new Promise<void>((_, reject) => { fail = reject })
    } }
    const store = createStore()
    store.set(channelsAtom, [{ id: 'ch', name: 'Local', enabled: true, createdAt: 0, updatedAt: 0, provider: 'custom-openai',
      baseUrl: 'https://owned.invalid', apiKey: '', models: [{ id: 'text', name: 'Text', enabled: true }] }])
    store.set(channelsLoadedAtom, true)
    store.set(agentChannelIdAtom, 'ch')
    store.set(agentChannelIdsAtom, ['ch'])
    store.set(agentModelIdAtom, 'text')
    store.set(agentSessionsAtom, [{ id: 's', title: 'Owned', workspaceId: 'w', createdAt: 0, updatedAt: 0 }])
    store.set(agentSessionDraftsAtom, new Map([['s', 'First question']]))
    const view = render(<Provider store={store}><TooltipProvider><AgentView sessionId="s" /></TooltipProvider></Provider>)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Project documents' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: document.filename })) })
    if (pdf) await act(async () => { fireEvent.change(screen.getByRole('combobox', { name: 'Page' }), { target: { value: '2' } }) })
    fireEvent.click(screen.getByRole('button', { name: 'Attach these lines' }))
    expect(view.container.querySelector('[data-document-draft]')).toHaveTextContent(pdf ? 'owned.pdf · page 2 · lines 1–1' : 'owned.md · lines 1–1')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send message' })) })
    expect(requests[0]?.nativeDocumentReference).toEqual({ documentId: 'doc-one', ...(pdf && { page: 2 }), startLine: 1, endLine: 1 })
    expect(!!view.container.querySelector('[data-document-draft]')).toBe(false)
    await act(async () => { fail(new Error('Rejected by local fixture')) })
    await act(async () => { store.set(agentSessionDraftsAtom, new Map([['s', 'Unrelated question']])) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send message' })) })
    expect(requests).toHaveLength(2)
    expect(requests[1]?.nativeDocumentReference).toBeUndefined()
  } finally {
    cleanup(); transport.dispose()
    window.electronAPI = previousApi
    window.__TAURI_FORMAL__ = previousMarker
  }
})
