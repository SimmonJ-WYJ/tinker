/**
 * SSE 流解析单测
 *
 * 重点覆盖：
 * - 标准 Anthropic：content_block_delta + text_delta 累积
 * - 推理模型：thinking_delta 与 text_delta 交错，最终只取 text
 * - 兼容端点：delta.content / delta.output_text 兜底
 * - 分帧抖动：chunk 在帧中间切开 / data 跨多行 / 注释心跳
 * - 错误事件：error type=rate_limit_error → 抛 SseParseError(rate-limit)
 * - [DONE] 结束标记 / message_stop / ping 全部忽略
 *
 * 用 ReadableStream from chunks 模拟 fetch response.body 的流式输入。
 */

import { test, expect } from 'bun:test'
import { parseSseStream, SseParseError } from './sse-parser'

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(enc.encode(chunks[i]!))
      i++
    },
  })
}

test('SSE 解析: 标准 Anthropic text_delta 流式累积', async () => {
  const stream = makeStream([
    'event: message_start\n',
    'data: {"type":"message_start","message":{"id":"x","content":[]}}\n\n',
    'event: content_block_start\n',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
    'event: content_block_delta\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n',
    'event: message_delta\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
    'event: message_stop\n',
    'data: {"type":"message_stop"}\n\n',
  ])
  const acc = await parseSseStream(stream)
  expect(acc.text).toBe('Hello world')
  expect(acc.thinking).toBe('')
  expect(acc.stopReason).toBe('end_turn')
  expect(acc.eventCount).toBeGreaterThan(0)
})

test('SSE 解析: thinking + text 交错（DeepSeek V4 / Claude extended thinking）', async () => {
  const stream = makeStream([
    'event: content_block_delta\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"reasoning..."}}\n\n',
    'event: content_block_delta\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"final answer"}}\n\n',
  ])
  const acc = await parseSseStream(stream)
  expect(acc.text).toBe('final answer')
  expect(acc.thinking).toBe('reasoning...')
})

test('SSE 解析: 兼容端点 delta.content / output_text 兜底', async () => {
  const stream = makeStream([
    'event: content_block_delta\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"content":"part1"}}\n\n',
    'event: content_block_delta\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"output_text":"part2"}}\n\n',
  ])
  const acc = await parseSseStream(stream)
  expect(acc.text).toBe('part1part2')
})

test('SSE 解析: chunk 在帧中间切开仍能正确还原', async () => {
  // 把同一条 data 拆成 3 个 chunk，分帧边界（\n\n）跨 chunk
  const stream = makeStream([
    'event: content_block_delta\ndata: {"type":"content_block',
    '_delta","index":0,"delta":{"type":"text_delta","text":"chunked"}}',
    '\n\n',
  ])
  const acc = await parseSseStream(stream)
  expect(acc.text).toBe('chunked')
})

test('SSE 解析: 注释心跳 (`: ...`) 与 ping 事件被忽略', async () => {
  const stream = makeStream([
    ': keep-alive\n\n',
    'event: ping\n',
    'data: {"type":"ping"}\n\n',
    'event: content_block_delta\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}\n\n',
  ])
  const acc = await parseSseStream(stream)
  expect(acc.text).toBe('OK')
})

test('SSE 解析: error 事件 rate_limit_error 抛 rate-limit 错', async () => {
  const stream = makeStream([
    'event: error\n',
    'data: {"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}\n\n',
  ])
  let caught: unknown = null
  try {
    await parseSseStream(stream)
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(SseParseError)
  expect((caught as SseParseError).kind).toBe('rate-limit')
})

test('SSE 解析: error 事件 overloaded_error 也归类 rate-limit', async () => {
  const stream = makeStream([
    'event: error\n',
    'data: {"type":"error","error":{"type":"overloaded_error","message":"server busy"}}\n\n',
  ])
  let caught: unknown = null
  try {
    await parseSseStream(stream)
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(SseParseError)
  expect((caught as SseParseError).kind).toBe('rate-limit')
})

test('SSE 解析: api_error 归类 network', async () => {
  const stream = makeStream([
    'event: error\n',
    'data: {"type":"error","error":{"type":"api_error","message":"upstream down"}}\n\n',
  ])
  let caught: unknown = null
  try {
    await parseSseStream(stream)
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(SseParseError)
  expect((caught as SseParseError).kind).toBe('network')
})

test('SSE 解析: [DONE] 标记被忽略（OpenAI 兼容端点）', async () => {
  const stream = makeStream([
    'event: content_block_delta\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"answer"}}\n\n',
    'data: [DONE]\n\n',
  ])
  const acc = await parseSseStream(stream)
  expect(acc.text).toBe('answer')
})

test('SSE 解析: message_start 平铺 content（非真流式回落）', async () => {
  const stream = makeStream([
    'event: message_start\n',
    'data: {"type":"message_start","message":{"content":[{"type":"text","text":"flat output"}]}}\n\n',
    'event: message_stop\n',
    'data: {"type":"message_stop"}\n\n',
  ])
  const acc = await parseSseStream(stream)
  expect(acc.text).toBe('flat output')
})

test('SSE 解析: 空 body 抛 invalid-response', async () => {
  let caught: unknown = null
  try {
    await parseSseStream(null)
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(SseParseError)
  expect((caught as SseParseError).kind).toBe('invalid-response')
})

test('SSE 解析: content_block_start 携带初始 text', async () => {
  const stream = makeStream([
    'event: content_block_start\n',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"initial "}}\n\n',
    'event: content_block_delta\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"rest"}}\n\n',
  ])
  const acc = await parseSseStream(stream)
  expect(acc.text).toBe('initial rest')
})

test('SSE 解析: onProgress 回调每条事件触发', async () => {
  const stream = makeStream([
    'event: content_block_delta\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"A"}}\n\n',
    'event: content_block_delta\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"B"}}\n\n',
    'event: message_stop\n',
    'data: {"type":"message_stop"}\n\n',
  ])
  const progressLog: string[] = []
  await parseSseStream(stream, acc => progressLog.push(acc.text))
  expect(progressLog).toEqual(['A', 'AB', 'AB'])
})
