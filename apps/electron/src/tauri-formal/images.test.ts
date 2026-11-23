import { expect, test } from 'bun:test'
import type { SDKMessage } from '@asci/shared'
import { createFormalTransport } from './transport.ts'
import type { NativeBridge } from './protocol.ts'

const sid = 'session-a'
const input = (text: string, imageEditReferenceId?: string) => ({
  sessionId: sid, userMessage: text, ...(imageEditReferenceId && { imageEditReferenceId }),
})
function imageTurn(sessionId: string, id: string, failed = false): SDKMessage[] {
  return [
    { type: 'user', uuid: 'user-' + id, message: { content: [{ type: 'text', text: 'Generate an image' }] } },
    { type: 'assistant', uuid: 'assistant-' + id, message: { content: [{ type: 'tool_use', id, name: 'mcp__asci-image__generate_image', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: failed, content: JSON.stringify({
      imageId: id, generatedImage: { localPath: sessionId + '/' + id + '.png', filename: id + '.png', mediaType: 'image/png' },
    }) }] } },
  ] as SDKMessage[]
}
async function fixture(history: SDKMessage[], nativeImages = true) {
  const sent: unknown[] = []
  let restores = 0
  let changes = 0
  const bridge: NativeBridge = {
    listen: async () => () => {},
    request: async <T,>(req: Record<string, unknown>): Promise<T> => {
      if (req.command === 'bootstrap') return { generation: 'document', nativeImages, nativeTaskLifecycle: true, nativeImageTaskLifecycle: true, activeRuns: [], platformSnapshot: { revision: 1, settings: {} } } as T
      if (req.command === 'restore') {
        restores++
        return { restoreToken: 'restore', deliverySequence: 0, messages: [], sdkMessages: history, activeSnapshot: null } as T
      }
      if (req.channel === 'agent:send-message') {
        const payload = (req.args as Record<string, unknown>[])[0]!
        sent.push(payload)
        if (payload.retryOfRequestId && payload.retryOfRequestId !== 'stopped-edit') throw { code: 'requestConflict' }
      }
      return { value: null } as T
    },
  }
  const t = await createFormalTransport(bridge, code => code)
  for (const event of ['event','complete','error']) t.subscribe('agent:stream:' + event, () => {})
  t.subscribe('agent:workspace-files-changed', () => { changes++ })
  const restore = () => t.invoke('agent:get-sdk-messages', sid)
  const send = (text: string, id?: string) => t.invoke('agent:send-message', input(text, id))
  return { t, sent, restore, send, counts: () => ({ restores, changes }) }
}

test('explicit native image request uses the original send and refreshes Session Files', async () => {
  const f = await fixture([])
  await f.send('Generate an image of a yellow bicycle')
  expect(f.sent).toEqual([{ ...input('Generate an image of a yellow bicycle'), nativeImageAction: 'generate' }])
  expect(f.counts()).toEqual({ restores: 0, changes: 1 })
})
test('reopened image history makes no sends; edits prefer an explicitly selected older version', async () => {
  const history = [...imageTurn(sid, 'older'), ...imageTurn(sid, 'newer')]
  for (const selected of [undefined, 'older']) {
    const f = await fixture(history)
    await f.restore()
    expect(f.sent).toHaveLength(0)
    await f.send('Edit this image to change its background', selected)
    expect(f.sent).toEqual([{ ...input('Edit this image to change its background', selected ?? 'newer'), nativeImageAction: 'edit' }])
    expect(f.counts()).toEqual({ restores: 1, changes: 1 })
  }
})
test('new generation after an image is independent, whereas an explicit selected source stays bound', async () => {
  for (const selected of [undefined, 'older']) {
    const f = await fixture(imageTurn(sid, 'older'))
    await f.restore()
    await f.send('Generate a poster of the skyline', selected)
    expect(f.sent).toEqual([{ ...input('Generate a poster of the skyline', selected), nativeImageAction: selected ? 'edit' : 'generate' }])
  }
})
test('discussion, failed or unrelated previous turns and a foreign session cannot imply another image operation', async () => {
  for (const [history, prompt] of [
    [imageTurn(sid, 'old'), 'How much would it cost to edit this image?'],
    [imageTurn(sid, 'other', true), '再次生成'],
    [[...imageTurn(sid, 'old'), {type:'user',message:{content:'Explain the poem'}}], '再次生成'],
    [imageTurn('another-session', 'foreign'), '再次生成'],
  ] as const) {
    const f = await fixture([...history] as SDKMessage[])
    await f.restore()
    await f.send(prompt)
    expect(f.sent).toEqual([input(prompt)])
    expect(f.counts().changes).toBe(0)
  }
})
test('previews without the capability continue their text-only send path', async () => {
  const f = await fixture([], false)
  await f.send('帮我生图')
  expect(f.sent).toEqual([input('帮我生图')])
  expect(f.counts().changes).toBe(0)
})

test('short visual revisions bind the confirmed source; scoped instructions do not swallow discussion or withdrawal', async () => {
  const history = imageTurn(sid, 'source')
  for (const [prompt, edit] of [
    ['换成英文版', true],
    ['Change the background to blue', true],
    ['基于上一张图，生成一张蓝色海报', true],
    ['Generate an image using the previous image as reference', true],
    ['不要改背景，先讨论一下', false],
    ['How do I change the background to blue?', false],
  ] as const) {
    const f = await fixture(history)
    await f.restore()
    await f.send(prompt)
    expect(f.sent).toEqual([edit ? { ...input(prompt, 'source'), nativeImageAction: 'edit' } : input(prompt)])
  }
})

test('selected source plus a pricing question sends only text; visual inspection keeps the draft available without a provider request', async () => {
  const f = await fixture(imageTurn(sid, 'older'))
  await f.restore()
  const text = 'How much does it cost to generate an image?'
  await f.send(text, 'older')
  expect(f.sent).toEqual([input(text)])
  await expect(f.send('Describe what is in this image', 'older')).rejects.toMatchObject({code:'imageEditOnly'})
  expect(f.sent).toHaveLength(1)
  expect(f.counts().changes).toBe(0)
})
test('coding and methods stay text-only even after a successful image task', async () => {
  const f = await fixture(imageTurn(sid, 'source'))
  await f.restore()
  const text = 'Generate a Python script to draw a poster'
  await f.send(text)
  expect(f.sent).toEqual([input(text)])
})

test('a new committed image immediately replaces the older source despite late restore completion', async () => {
  let beginRead = () => {}, finishRead = () => {}
  const reading = new Promise<void>(resolve => { beginRead = resolve })
  const pending = new Promise<void>(resolve => { finishRead = resolve })
  const calls: Record<string,unknown>[] = []
  const t = await createFormalTransport({
    listen: async () => () => {},
    request: async <T,>(request: Record<string,unknown>): Promise<T> => {
      if (request.command === 'bootstrap') return { generation:'g',nativeImages:true,activeRuns:[],platformSnapshot:{revision:0,settings:{}} } as T
      if (request.command === 'restore') {
        beginRead()
        await pending
        return { restoreToken:'r',deliverySequence:0,activeSnapshot:null,messages:[],sdkMessages:imageTurn(sid,'older') } as T
      }
      if (request.channel === 'agent:send-message') calls.push((request.args as Record<string,unknown>[])[0]!)
      return { value:null,imageId:'new-image' } as T
    },
  }, code=>code)
  for (const event of ['event','complete','error']) t.subscribe('agent:stream:' + event, () => {})
  const restored = t.invoke('agent:get-sdk-messages',sid)
  await reading
  await t.invoke('agent:send-message',input('帮我生图'))
  finishRead()
  await restored
  await t.invoke('agent:send-message',input('换成英文版'))
  expect(calls[1]).toEqual({ ...input('换成英文版','new-image'),nativeImageAction:'edit' })
  t.dispose()
})

test('quoted slogans and fenced instructions do not implicitly select a prior version', async () => {
  for (const text of [
    'Generate an image with the words "using the previous image as reference"',
    '生成一张海报，写上“基于上一张图”',
    'Generate a poster containing `from the last photo`',
  ]) {
    const f = await fixture(imageTurn(sid,'previous'))
    await f.restore()
    await f.send(text)
    expect(f.sent).toEqual([{...input(text), nativeImageAction:'generate'}])
  }
})


test('rejected stale text retry preserves the newer image reference and never dispatches an image action', async () => {
  const f = await fixture(imageTurn(sid, 'current'))
  await f.restore()
  const retry = { sessionId: sid, requestId: 'new', startedAt: 1, retryOfRequestId: 'old-text' }
  await expect(f.t.invoke('agent:send-message', retry)).rejects.toMatchObject({ code: 'requestConflict' })
  await f.send('Change the background to blue')
  expect(f.sent).toEqual([retry, { ...input('Change the background to blue', 'current'), nativeImageAction: 'edit' }])
  expect(f.counts().changes).toBe(1)
  f.t.dispose()
})

test('an identity-only image retry updates open files and only its session’s subsequent implicit edit source', async () => {
  const sent: Record<string, unknown>[] = []
  const changes: unknown[] = []
  const t = await createFormalTransport({
    listen: async () => () => {},
    request: async <T,>(r: Record<string, unknown>): Promise<T> => {
      if (r.command === 'bootstrap') return { generation:'g', nativeImages:true, nativeTaskLifecycle:true, nativeImageTaskLifecycle:true, activeRuns:[], platformSnapshot:{revision:0,settings:{}} } as T
      if (r.channel !== 'agent:send-message') return {value:null} as T
      const payload = (r.args as Record<string,unknown>[])[0]!
      sent.push(payload)
      return { value:null, imageId: payload.retryOfRequestId ? 'retried' : 'other' } as T
    },
  }, c => c)
  t.subscribe('agent:workspace-files-changed', event => changes.push(event))
  const retry = { sessionId:sid, requestId:'fresh', retryOfRequestId:'failed-edit', startedAt:4 }
  await t.invoke('agent:send-message', retry)
  expect(sent[0]).toEqual(retry)
  expect(changes).toHaveLength(1)
  await t.invoke('agent:send-message', {sessionId:'different',userMessage:'Change the background to blue'})
  expect(sent[1]?.nativeImageAction).toBeUndefined()
  await t.invoke('agent:send-message', input('Change the background to blue'))
  expect(sent[2]).toEqual({...input('Change the background to blue','retried'),nativeImageAction:'edit'})
  await t.invoke('agent:send-message', input('Change the background to blue','explicit'))
  expect(sent[3]).toEqual({...input('Change the background to blue','explicit'),nativeImageAction:'edit'})
  t.dispose()
})


test('a locally stopped retry has no image receipt and keeps the previous source without refreshing files', async () => {
  const f = await fixture(imageTurn(sid,'source'))
  await f.restore()
  await f.t.invoke('agent:send-message',{sessionId:sid,requestId:'new',startedAt:5,retryOfRequestId:'stopped-edit'})
  expect(f.counts().changes).toBe(0)
  await f.send('Change the background to blue')
  expect(f.sent[1]).toEqual({...input('Change the background to blue','source'),nativeImageAction:'edit'})
  f.t.dispose()
})

test('a late successful image retry receipt cannot overwrite a newer confirmed source', async () => {
  let finish!: (result: {value:null;imageId:string}) => void
  const sent: Record<string,unknown>[] = []
  const t = await createFormalTransport({
    listen:async()=>()=>{},
    request:async<T,>(r:Record<string,unknown>):Promise<T>=>{
      if(r.command==='bootstrap')return { generation:'g',nativeImages:true,nativeTaskLifecycle:true,nativeImageTaskLifecycle:true,activeRuns:[],platformSnapshot:{revision:0,settings:{}} } as T
      if(r.channel!=='agent:send-message')return {value:null} as T
      const payload=(r.args as Record<string,unknown>[])[0]!
      sent.push(payload)
      if(payload.retryOfRequestId)return await new Promise<{value:null;imageId:string}>(resolve=>{finish=resolve}) as T
      return {value:null,imageId:'newer'} as T
    },
  },code=>code)
  const retry=t.invoke('agent:send-message',{sessionId:sid,requestId:'new',startedAt:7,retryOfRequestId:'old-edit'})
  await t.invoke('agent:send-message',input('Generate an image of a blue tree'))
  finish({value:null,imageId:'late'})
  await retry
  await t.invoke('agent:send-message',input('Change the background to blue'))
  expect(sent[2]?.imageEditReferenceId).toBe('newer')
  t.dispose()
})
