import { fetch as nodeFetch } from 'undici'
import { afterAll, expect, test } from 'bun:test'
import { createOpenAIBridge } from './openai-bridge.ts'

const cleanup: (() => void)[] = []
afterAll(() => cleanup.forEach(fn => fn()))

test('429 preserves rate-limit semantics and safe Retry-After', async () => {
 const bridge=await createOpenAIBridge({baseUrl:'https://relay.test',apiKey:'secret',fetchFn:async()=>new Response('secret sensitive error',{status:429,headers:{'retry-after':'3'}})})
 cleanup.push(bridge.close)
 const response=await nodeFetch(`${bridge.baseUrl}/v1/messages`,{method:'POST',headers:{'x-api-key':bridge.apiKey},body:JSON.stringify({model:'m',messages:[]})})
 expect(response.status).toBe(429)
 expect(response.headers.get('x-should-retry')).toBe('false')
 expect(response.headers.get('retry-after')).toBe('3')
 expect(await response.json()).toMatchObject({error:{type:'rate_limit_error',message:'Upstream HTTP 429'}})
})
for (const stream of [false,true]) test(`empty upstream fails explicitly stream=${stream}`, async()=>{
 let calls=0
 const bridge=await createOpenAIBridge({baseUrl:'https://relay.test',apiKey:'secret',fetchFn:async()=>{calls++;return stream
  ? new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})
  : Response.json({choices:[{message:{content:null},finish_reason:'stop'}]})}})
 cleanup.push(bridge.close)
 const response=await nodeFetch(`${bridge.baseUrl}/v1/messages`,{method:'POST',headers:{'x-api-key':bridge.apiKey},body:JSON.stringify({model:'m',stream,messages:[]})})
 const body=await response.text()
 expect(body).toContain('ASCI_EMPTY_RESPONSE')
 expect(body).not.toContain('secret')
 expect(body).not.toContain('event: message_stop')
 if(!stream) expect(response.status).toBe(422)
 expect(calls).toBe(1)
})

test('桥接仅认证本地请求，上游不携带本地 token；工具响应转换', async () => {
  let calls = 0
  let upstreamBody: Record<string, unknown> = {}
  const bridge = await createOpenAIBridge({ baseUrl: 'https://relay.test/v1', apiKey: 'upstream-secret', fetchFn: async (url, init) => {
    calls++
    expect(url).toBe('https://relay.test/v1/chat/completions')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer upstream-secret')
    upstreamBody = JSON.parse(String(init?.body))
    return Response.json({ id: 'x', model: 'm', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] })
  } })
  cleanup.push(bridge.close)
  expect((await nodeFetch(`${bridge.baseUrl}/v1/messages`, { method: 'POST', body: '{}' })).status).toBe(401)
  expect((await nodeFetch(`${bridge.baseUrl}/v1/messages`, { method: 'POST', headers: { 'x-api-key': bridge.apiKey, origin: 'https://evil.test' }, body: '{}' })).status).toBe(403)
  const response = await nodeFetch(`${bridge.baseUrl}/v1/messages`, { method: 'POST', headers: { 'x-api-key': bridge.apiKey }, body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }) })
  expect(response.status).toBe(200)
  expect((await response.json()).content).toEqual([{ type: 'text', text: 'OK' }])
  expect(upstreamBody.messages).toEqual([{ role: 'user', content: 'hi' }])
  expect(calls).toBe(1)
})

test('桥接把网络分片 SSE 转成 Anthropic 文本及工具事件', async () => {
  const frames = [
    { id: 'a', choices: [{ delta: { content: 'hello' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 't', function: { name: 'Read', arguments: '{"path":"x"}' } }] }, finish_reason: 'tool_calls' }] },
  ].map(c => `data: ${JSON.stringify(c)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n'
  const bytes = new TextEncoder().encode(frames)
  const bridge = await createOpenAIBridge({ baseUrl: 'https://relay.test', apiKey: 'secret', fetchFn: async () => new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
    controller.close()
  } }), { headers: { 'content-type': 'text/event-stream' } }) })
  cleanup.push(bridge.close)
  const result = await nodeFetch(`${bridge.baseUrl}/v1/messages`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.apiKey}` }, body: JSON.stringify({ model: 'm', stream: true, messages: [{ role: 'user', content: 'hi' }] }) })
  const text = await result.text()
  expect(text).toContain('event: message_start')
  expect(text).toContain('"text":"hello"')
  expect(text).toContain('"name":"Read"')
  expect(text).toContain('"stop_reason":"tool_use"')
  expect(text).toContain('event: message_stop')
})

test('上游失败状态不变为成功、不泄露上游 Key', async () => {
  const bridge = await createOpenAIBridge({ baseUrl: 'https://relay.test', apiKey: 'secret', fetchFn: async () => new Response('secret invalid', { status: 401 }) })
  cleanup.push(bridge.close)
  const result = await nodeFetch(`${bridge.baseUrl}/v1/messages`, { method: 'POST', headers: { 'x-api-key': bridge.apiKey }, body: JSON.stringify({ model: 'm', messages: [] }) })
  expect(result.status).toBe(401)
  expect(await result.text()).not.toContain('secret')
})
