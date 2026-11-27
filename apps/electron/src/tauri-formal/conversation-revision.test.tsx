import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, renderHook } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import type { AgentSendInput } from '@asci/shared'
import type { AppSettings } from '../types'
import type { PropsWithChildren } from 'react'
import {
  agentMessageRefreshAtom, agentPendingMentionsAtom, agentSessionChannelMapAtom, agentSessionDraftsAtom,
  agentSessionModelMapAtom, agentSessionsAtom, agentStreamErrorsAtom, currentAgentSessionIdAtom,
} from '../renderer/atoms/agent-atoms'
import { useOpenSession } from '../renderer/hooks/useOpenSession'
import { useNativeConversationRevision } from '../renderer/components/agent/use-native-conversation-revision'

const original = window.__TAURI_FORMAL__
const originalApi = window.electronAPI
afterEach(() => { cleanup(); window.__TAURI_FORMAL__ = original; window.electronAPI = originalApi })
const prepared = {
  session: { id: 'child', title: 'Branch', workspaceId: 'project', createdAt: 1, updatedAt: 1,
    nativeRevisionRoute: { channelId: 'old-channel', modelId: 'old-model', configRevision: 'old-binding' } },
  effort: 'medium' as const, prompt: 'Original question',
}
function fixture(prepare = mock(async () => prepared), send = mock(async (_input: AgentSendInput) => {})) {
  const store = createStore()
  store.set(currentAgentSessionIdAtom, 'source')
  store.set(agentSessionDraftsAtom, new Map([['source', 'Unsent source draft']]))
  window.__TAURI_FORMAL__ = { hydrated() {}, prepareRevision: prepare }
  window.electronAPI = { ...originalApi, sendAgentMessage: send, updateSettings: mock(async () => ({} as AppSettings)) }
  const view = renderHook(() => useNativeConversationRevision('source', useOpenSession()), {
    wrapper: ({children}: PropsWithChildren) => <Provider store={store}>{children}</Provider>,
  })
  return { view, store, prepare, send }
}
test('编辑只打开子分支的草稿，原输入和原路由独立保留', async () => {
  const { view, store, prepare, send } = fixture()
  await act(async () => { await view.result.current?.('answer', 'edit') })
  expect(prepare).toHaveBeenCalledWith({ sessionId: 'source', upToMessageUuid: 'answer' })
  expect(store.get(currentAgentSessionIdAtom)).toBe('child')
  expect(store.get(agentSessionDraftsAtom)).toEqual(new Map([['source','Unsent source draft'],['child','Original question']]))
  expect(store.get(agentSessionChannelMapAtom).get('child')).toBe('old-channel')
  expect(store.get(agentSessionModelMapAtom).get('child')).toBe('old-model')
  expect(send).not.toHaveBeenCalled()
})
test('重复选择重新生成只提交原问题及源路由；失败归属子分支', async () => {
  const send = mock(async (_input: AgentSendInput) => { throw Object.assign(new Error('Original model unavailable'), { code: 'sourceChannelUnavailable' }) })
  const { view, store, prepare } = fixture(undefined, send)
  await act(async () => { await Promise.all([view.result.current?.('answer', 'regenerate'), view.result.current?.('answer', 'regenerate')]) })
  expect(prepare).toHaveBeenCalledTimes(1)
  expect(send.mock.calls).toEqual([[{
    sessionId: 'child', workspaceId: 'project', userMessage: 'Original question', channelId:'old-channel',
    modelId:'old-model', expectedConfigRevision:'old-binding', effort:'medium', requestId: expect.any(String), startedAt: expect.any(Number),
  }]])
  expect(store.get(agentStreamErrorsAtom).get('child')).toBe('Original model unavailable')
  expect(store.get(agentSessionDraftsAtom).get('child')).toBe('Original question')
  expect(store.get(agentSessionDraftsAtom).get('source')).toBe('Unsent source draft')
})
test('准备期间切换会话时只登记已建的分支，回看原会话也不会重发', async () => {
  let finish!: (value: typeof prepared) => void
  const { view, store, send } = fixture(mock(() => new Promise(resolve => { finish = resolve })))
  await act(async () => {
    const running = view.result.current?.('answer','regenerate')
    store.set(currentAgentSessionIdAtom,'other')
    store.set(currentAgentSessionIdAtom,'source')
    finish(prepared)
    await running
  })
  expect(store.get(currentAgentSessionIdAtom)).toBe('source')
  expect(store.get(agentSessionsAtom).map(s=>s.id)).toContain('child')
  expect(send).not.toHaveBeenCalled()
})
test('编辑前有待发送的全局附件提及时保留其归属', async () => {
  const { view, store, prepare } = fixture()
  store.set(agentPendingMentionsAtom,[{kind:'file',id:'private',label:'Private'}])
  await act(async () => { await view.result.current?.('answer','edit') })
  expect(prepare).not.toHaveBeenCalled()
  expect(store.get(agentPendingMentionsAtom)).toHaveLength(1)
})

test('宿主已记录失败轮次时不把原提问重复还原为未发送草稿', async () => {
  const { view, store, send } = fixture(undefined, mock(async (_input: AgentSendInput) => {
    throw Object.assign(new Error('Synthetic provider failure'), { code: 'responseFailed' })
  }))
  const history = mock(async () => [{
    type: 'user' as const, parent_tool_use_id: null, _desktopTextTaskRequestId: send.mock.calls[0]?.[0].requestId,
    message: { content: [{ type: 'text' as const, text: prepared.prompt }] },
  }])
  window.electronAPI.getAgentSessionSDKMessages = history
  await act(async () => { await view.result.current?.('answer', 'regenerate') })
  expect(send).toHaveBeenCalledTimes(1)
  expect(store.get(agentMessageRefreshAtom).get('child')).toBe(1)
  expect(history).toHaveBeenCalledTimes(1)
  expect(store.get(agentSessionDraftsAtom).has('child')).toBe(false)
  expect(store.get(agentSessionsAtom).find(s => s.id === 'child')?.nativeRevisionRoute).toBeUndefined()
})

test.each(['edit', 'regenerate'] as const)('a cited %s opens an editable branch without sending or copying an attachment', async action => {
  const source = { documentId: 'pdf-1', filename: 'Guide.pdf', page: 2, startLine: 4, endLine: 5 }
  const cited = { ...prepared, session: { ...prepared.session, nativeRevisionDocument: source } }
  const { view, store, send } = fixture(mock(async () => cited))
  await act(async () => { await view.result.current?.('answer', action) })
  expect(send).not.toHaveBeenCalled()
  expect(store.get(currentAgentSessionIdAtom)).toBe('child')
  expect(store.get(agentSessionDraftsAtom).get('child')).toBe(prepared.prompt)
  expect(store.get(agentSessionsAtom)[0]?.nativeRevisionDocument).toEqual(source)
})

test.each(['edit', 'regenerate'] as const)('a managed image %s parks an unsent child draft', async action => {
  const image = { imageId: 'ref-a', filename: 'ref-a.png', localPath: 'child/ref-a.png', mediaType: 'image/png' }
  const result = { ...prepared, session: { ...prepared.session, nativeRevisionImage: image } }
  const { view, store, send } = fixture(mock(async () => result))
  await act(async () => { await view.result.current?.('answer', action) })
  expect(send).not.toHaveBeenCalled()
  expect(store.get(currentAgentSessionIdAtom)).toBe('child')
  expect(store.get(agentSessionDraftsAtom).get('child')).toBe(prepared.prompt)
})
