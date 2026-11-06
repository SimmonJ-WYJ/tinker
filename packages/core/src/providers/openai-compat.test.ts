import { expect, test } from 'bun:test'
import { toOpenAIRequest, toAnthropicResponse, OpenAIStreamTranslator } from './openai-compat.ts'

test('empty or whitespace responses must not become successful replies', () => {
 for (const content of [null, '', ' \n ']) {
  expect(() => toAnthropicResponse({choices:[{message:{content},finish_reason:'stop'}]})).toThrow('ASCI_EMPTY_RESPONSE')
 }
})
test('role and usage only streams must not finish silently', () => {
 const stream = new OpenAIStreamTranslator('m')
 stream.push({choices:[{delta:{content:' \n '},finish_reason:'stop'}],usage:{completion_tokens:52}})
 expect(() => stream.finish()).toThrow('ASCI_EMPTY_RESPONSE')
})
test('visible text and tool-only streams still complete', () => {
 const text = new OpenAIStreamTranslator('m')
 text.push({choices:[{delta:{content:'OK'},finish_reason:'stop'}]})
 expect(text.finish().at(-1)?.type).toBe('message_stop')
 const tool = new OpenAIStreamTranslator('m')
 tool.push({choices:[{delta:{tool_calls:[{index:0,id:'t',function:{name:'edit',arguments:'{}'}}]},finish_reason:'tool_calls'}]})
 expect(tool.finish().at(-1)?.type).toBe('message_stop')
})

test('文本、图片、工具调用与工具结果完整转换', () => {
  const body = toOpenAIRequest({ model: 'private', max_tokens: 1024, system: [{ type: 'text', text: 'System' }], messages: [
    { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } }] },
    { role: 'assistant', content: [{ type: 'text', text: 'checking' }, { type: 'tool_use', id: 'call_1', name: 'Read', input: { path: 'a' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: [{ type: 'text', text: 'result' }] }, { type: 'text', text: 'continue' }] },
  ], tools: [{ name: 'Read', description: 'read', input_schema: { type: 'object' } }] })
  expect(body.messages).toEqual([
    { role: 'system', content: 'System' },
    { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } }] },
    { role: 'assistant', content: 'checking', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{"path":"a"}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'result' }, { role: 'user', content: 'continue' },
  ])
  expect(body.tools).toEqual([{ type: 'function', function: { name: 'Read', description: 'read', parameters: { type: 'object' } } }])
})
test('不支持的 PDF 与未知内容明确失败，不能静默丢弃', () => {
  expect(() => toOpenAIRequest({ model: 'm', messages: [{ role: 'user', content: [{ type: 'document', source: {} }] }] })).toThrow()
})
test('非流式工具调用可让 SDK 续接', () => {
  const response = toAnthropicResponse({ id: 'c', model: 'm', choices: [{ message: { content: null, tool_calls: [{ id: 't', function: { name: 'Read', arguments: '{"path":"a"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 12, completion_tokens: 3 } })
  expect(response.stop_reason).toBe('tool_use')
  expect(response.content).toEqual([{ type: 'tool_use', id: 't', name: 'Read', input: { path: 'a' } }])
  expect(response.usage).toMatchObject({ input_tokens: 12, output_tokens: 3 })
})
test('并行工具参数分片按 OpenAI index 分开，直到流结束才停止', () => {
  const stream = new OpenAIStreamTranslator('m')
  const events = [
    ...stream.push({ choices: [{ delta: { content: 'Hello' }, finish_reason: null }] }),
    ...stream.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'Read', arguments: '{"p":' } }, { index: 1, id: 'b', function: { name: 'Bash', arguments: '{"c":' } }] } }] }),
    ...stream.push({ choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '"ls"}' } }, { index: 0, function: { arguments: '"a"}' } }] }, finish_reason: 'tool_calls' }] }),
    ...stream.push({ choices: [], usage: { prompt_tokens: 6, completion_tokens: 8 } }),
    ...stream.finish(),
  ]
  expect(events[0]?.type).toBe('message_start')
  const starts = events.filter(e => e.type === 'content_block_start')
  expect(starts.map(e => e.content_block)).toContainEqual({ type: 'tool_use', id: 'a', name: 'Read', input: {} })
  expect(starts.map(e => e.content_block)).toContainEqual({ type: 'tool_use', id: 'b', name: 'Bash', input: {} })
  expect(events.find(e => e.type === 'message_delta')).toMatchObject({ delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8, input_tokens: 6 } })
  expect(events.at(-1)?.type).toBe('message_stop')
})

test('推理模型输出上限字段和采样参数符合 OpenAI 协议', () => {
  const request = toOpenAIRequest({ model: 'gpt-5-mini', max_tokens: 1000, temperature: 0.4, top_p: 0.9, messages: [] })
  expect(request.max_completion_tokens).toBe(1000)
  expect(request.max_tokens).toBeUndefined()
  expect(request.temperature).toBeUndefined()
  expect(request.top_p).toBeUndefined()
})

test('Read 工具图片作为视觉输入保留且工具结果顺序完整', () => {
 const result = toOpenAIRequest({ model: 'vision', messages: [
  { role: 'assistant', content: [{ type: 'tool_use', id: 'read1', name: 'Read', input: {} }, { type: 'tool_use', id: 'read2', name: 'Read', input: {} }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } }] }, { type: 'tool_result', tool_use_id: 'read2', content: 'done' }] },
 ] })
 expect(result.messages.map(message => message.role)).toEqual(['assistant', 'tool', 'tool', 'user'])
 expect(JSON.stringify(result.messages[3])).toContain('data:image/png;base64,YWJj')
})
