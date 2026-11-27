import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import type { SDKMessage } from '@asci/shared'
import { AgentSessionProvider } from '../renderer/contexts/session-context'
import { AgentMessages } from '../renderer/components/agent/AgentMessages'
import { TooltipProvider } from '../renderer/components/ui/tooltip'
import { currentAgentSessionIdAtom } from '../renderer/atoms/agent-atoms'
import { setAppLanguage } from '../renderer/lib/i18n'
import { reconcileNativeTaskMessages } from '../renderer/hooks/tool-run-snapshot'

const previous = window.__TAURI_FORMAL__
const previousApi = window.electronAPI
afterEach(async () => { cleanup(); window.__TAURI_FORMAL__ = previous; window.electronAPI = previousApi; await setAppLanguage('en') })
const sourceId = 'img-' + '1'.repeat(32)
const sourceFile = sourceId + '.png'
type Status = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
function rows(id: string, status: Status, edit = false, retryable = false): SDKMessage[] {
  const meta = { _agentRequestId: id, _desktopImageTaskRequestId: id, _desktopImageTaskKind: edit ? 'edit' : 'generate' }
  const records = [
    { ...meta, type: 'user', uuid: id+'-user', parent_tool_use_id: null,
      ...(edit && { imageEditReference: { imageId: sourceId, filename: sourceFile, mediaType: 'image/png', localPath: 's/' + sourceFile } }),
      message: { content: [{ type: 'text', text: edit ? 'Edit this image' : 'Generate an image' }] } },
    { ...meta, type: 'assistant', uuid: id+'-assistant', parent_tool_use_id: null, _desktopImageTaskStatus: status, _desktopTaskRetryable:retryable,
      message: { model: 'image-model', content: [{ type: 'tool_use', id: id+'-tool', name: 'mcp__asci-image__generate_image', input: {} }] } },
  ] as SDKMessage[]
  if (status !== 'running') records.push({ type: 'user', uuid: id+'-result', _agentRequestId: id, parent_tool_use_id: null,
    message: { content: [{ type: 'tool_result', tool_use_id: id+'-tool', is_error: status !== 'completed', content: status === 'completed'
      ? JSON.stringify({ imageId: id, generatedImage: { localPath: 's/'+id+'.png', filename: id+'.png', mediaType: 'image/png' } })
      : 'Synthetic incomplete result' }] } })
  return records
}
function fixture() {
  const retry = mock(async (_input: unknown) => {})
  const read = mock(async () => 'c3ludGhldGlj')
  window.electronAPI = { ...previousApi, readAttachment: read }
  window.__TAURI_FORMAL__ = { hydrated() {}, nativeImageTaskLifecycle: true, nativeImages: true, nativeTaskLifecycle: { retry, stop: async () => {} } }
  const store = createStore()
  store.set(currentAgentSessionIdAtom, 's')
  const show = (history: SDKMessage[], live: SDKMessage[] = []) => <Provider store={store}><AgentSessionProvider sessionId="s"><TooltipProvider>
    <AgentMessages sessionId="s" messages={[]} messagesLoaded persistedSDKMessages={history} liveMessages={live} streaming={false} />
  </TooltipProvider></AgentSessionProvider></Provider>
  return { retry, read, show }
}
test('reopened pending image edit shows the saved reference and Rust running state without submitting', async () => {
  const { retry, show, read } = fixture()
  const view = render(show(rows('run', 'running', true)))
  const status = view.container.querySelector('[data-native-task-kind="image"][data-native-task-status="running"]')
  expect(status).not.toBeNull()
  expect(view.container.querySelector('[data-image-task-state]')).toHaveTextContent('Image edit · Running')
  expect(view.queryByRole('button', {name:'Retry'})).toBeNull()
  await waitFor(() => expect(read).toHaveBeenCalledWith('s/' + sourceFile))
  fireEvent.click(await view.findByRole('img', {name:sourceFile}))
  expect(view.getByRole('dialog')).toBeInTheDocument()
  expect(retry).not.toHaveBeenCalled()
})
test('restored failed image edit retries the saved identity once; cancelled and superseded attempts never offer retry', async () => {
  const { retry, show } = fixture()
  const view = render(show([...rows('old','interrupted'), ...rows('stop','cancelled'), ...rows('latest','failed',true,true)]))
  const stopped = view.container.querySelector('[data-image-task-state="stopped"]')
  expect(stopped).toHaveTextContent(/provider may already have received/i)
  const buttons = view.getAllByRole('button', {name:'Retry'})
  expect(buttons).toHaveLength(1)
  expect(retry).not.toHaveBeenCalled()
  act(() => { fireEvent.click(buttons[0]!); fireEvent.click(buttons[0]!) })
  expect(retry).toHaveBeenCalledTimes(1)
  expect(retry.mock.calls[0]).toEqual([{sessionId:'s',requestId:expect.any(String),startedAt:expect.any(Number),retryOfRequestId:'latest'}])
  await act(async () => {})
})
test('restored image terminal beats delayed pending and exact result replay; unrelated repeated prompts survive', () => {
  const latest = rows('last', 'completed')
  const pending = rows('last', 'running')
  const optimistic: SDKMessage = { type:'user', _agentRequestId:'last', message:{content:[{type:'text',text:'Generate an image'}]} }
  const result = reconcileNativeTaskMessages([...rows('old','failed'), optimistic, ...latest, ...pending, latest.at(-1)!])
  expect(result.map(m => (m as Record<string,unknown>).uuid)).toEqual(['old-user','old-assistant','old-result','last-user','last-assistant','last-result'])
  expect(result[4]).toMatchObject({_desktopImageTaskStatus:'completed'})
})


test.each(['image', 'text'] as const)('clock-skewed history offers only the eligible %s retry in mixed image and text records', async kind => {
  const { show, retry } = fixture()
  const text: SDKMessage[] = [
    { type:'user',uuid:'t-user',_desktopTextTaskRequestId:'t',message:{content:[{type:'text',text:'An ordinary prompt'}]} },
    { type:'assistant',uuid:'t-assistant',_desktopTextTaskRequestId:'t',_desktopRuntimeStatus:'failed',
      _desktopTaskRetryable:kind==='text',parent_tool_use_id:null,message:{content:[{type:'text',text:'Partial text'}]} },
  ]
  const image = rows('i','interrupted',true,kind==='image')
  const view = render(show(kind==='text' ? [...text,...image] : [...image,...text]))
  const allowed = kind==='text' ? 't' : 'i'
  const buttons = view.getAllByRole('button',{name:'Retry'})
  expect(buttons).toHaveLength(1)
  expect(buttons[0]!.closest('[data-request-id]')).toHaveAttribute('data-request-id',allowed)
  fireEvent.click(buttons[0]!)
  expect(retry.mock.calls[0]?.[0]).toMatchObject({retryOfRequestId:allowed})
  await act(async () => {})
})

test('a native legacy status without a durable attempt identity cannot dispatch either generic retry', () => {
  fixture()
  const retry = mock(() => {})
  const view = render(<Provider store={createStore()}><TooltipProvider><AgentMessages sessionId="s" messagesLoaded
    messages={[{id:'legacy',role:'status',content:'Synthetic legacy error',errorCode:'prompt_too_long',createdAt:1}]}
    streaming={false} onRetry={retry} onRetryInNewSession={retry}/></TooltipProvider></Provider>)
  expect(view.queryAllByRole('button',{name:/retry/i})).toHaveLength(0)
})

test.each([['en','HTTP 402'],['zh','余额不足']] as const)('restored image failures explain the safe channel status in %s', async (language, expected) => {
  await setAppLanguage(language)
  const {show,retry}=fixture()
  const history=rows('failed-paid','failed',true,true)
  const assistant=history.find(m=>m.type==='assistant')!
  Object.assign(assistant,{_desktopImageTaskError:'channelPaymentRequired'})
  const view=render(show(history))
  expect(view.container.querySelector('[data-image-task-state="failed"] summary')).toHaveTextContent(expected)
  expect(retry).not.toHaveBeenCalled()
})
