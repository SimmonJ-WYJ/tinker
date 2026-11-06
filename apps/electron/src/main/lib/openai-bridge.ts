/** 仅本机可达的 Anthropic → OpenAI 桥接；上游凭据只留在主进程。 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { AGENT_RESPONSE_FAILURE } from '@asci/shared'
import { normalizeOpenAIBaseUrl, validateCustomEndpoint, toOpenAIRequest, toAnthropicResponse, OpenAIStreamTranslator } from '@asci/core'
import type { AnthropicRequest, AnthropicEvent, OpenAIChunk } from '@asci/core'

interface BridgeOptions {
  baseUrl: string
  apiKey: string
  fetchFn?: typeof globalThis.fetch
}
export interface OpenAIBridge {
  baseUrl: string
  apiKey: string
  close(): void
}
const MAX_BODY_BYTES = 24 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000

function authorized(request: IncomingMessage, token: string): boolean {
  const value = request.headers['x-api-key'] ?? request.headers.authorization?.replace(/^Bearer /, '')
  if (typeof value !== 'string') return false
  const bytes = Buffer.from(value)
  const expected = Buffer.from(token)
  return bytes.length === expected.length && timingSafeEqual(bytes, expected)
}
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}
async function readBody(req: IncomingMessage): Promise<AnthropicRequest> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk as Uint8Array)
    length += bytes.length
    if (length > MAX_BODY_BYTES) throw new Error('Request body too large')
    chunks.push(bytes)
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as AnthropicRequest
  if (!body || typeof body.model !== 'string' || !Array.isArray(body.messages)) throw new Error('Invalid Messages request')
  return body
}
async function writeEvent(res: ServerResponse, event: AnthropicEvent): Promise<void> {
  if (res.destroyed) throw new Error('Client disconnected')
  if (!res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => { res.off('drain', drained); res.off('close', closed); res.off('error', closed) }
      const drained = (): void => { cleanup(); resolve() }
      const closed = (): void => { cleanup(); reject(new Error('Client disconnected')) }
      res.once('drain', drained); res.once('close', closed); res.once('error', closed)
    })
  }
}
async function relayStream(response: Response, res: ServerResponse, model: string): Promise<void> {
  if (!response.body) throw new Error('Empty upstream response')
  const stream = new OpenAIStreamTranslator(model)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let done = false
  const line = async (raw: string): Promise<void> => {
    const trimmed = raw.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (!data) return
    if (data === '[DONE]') { done = true; return }
    for (const event of stream.push(JSON.parse(data) as OpenAIChunk)) await writeEvent(res, event)
  }
  try {
    while (!done) {
      const chunk = await reader.read()
      if (chunk.done) {
        buffer += decoder.decode()
        if (buffer.trim()) await line(buffer)
        break
      }
      buffer += decoder.decode(chunk.value, { stream: true })
      if (buffer.length > MAX_BODY_BYTES) throw new Error('Upstream frame too large')
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        await line(raw)
        if (done) break
      }
    }
    for (const event of stream.finish()) await writeEvent(res, event)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
export async function createOpenAIBridge(options: BridgeOptions): Promise<OpenAIBridge> {
  validateCustomEndpoint(options.baseUrl)
  const apiKey = randomBytes(32).toString('hex')
  const fetchFn = options.fetchFn ?? fetch
  const server = createServer((req, res) => {
    void (async () => {
      if (req.headers.origin) { json(res, 403, { error: { type: 'permission_error', message: 'Browser access denied' } }); return }
      if (!authorized(req, apiKey)) { json(res, 401, { error: { type: 'authentication_error', message: 'Invalid bridge credential' } }); return }
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
      if (req.method !== 'POST' || !['/v1/messages', '/v1/messages/count_tokens'].includes(pathname)) {
        json(res, 404, { error: { type: 'not_found_error', message: 'Unknown endpoint' } }); return
      }
      let input: AnthropicRequest
      try { input = await readBody(req) } catch {
        json(res, 400, { error: { type: 'invalid_request_error', message: 'Invalid or oversized Messages request' } }); return
      }
      let body
      try { body = toOpenAIRequest(input) } catch (error) {
        json(res, 400, { error: { type: 'invalid_request_error', message: error instanceof Error ? error.message : 'Unsupported request' } }); return
      }
      if (pathname.endsWith('/count_tokens')) {
        // OpenAI 兼容 API 无统一计数接口；保守估算供 SDK 预算使用，不作为计费依据。
        json(res, 200, { input_tokens: Math.ceil(JSON.stringify({ messages: body.messages, tools: body.tools }).length / 2) }); return
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      res.on('close', () => { if (!res.writableEnded) controller.abort() })
      try {
        const response = await fetchFn(`${normalizeOpenAIBaseUrl(options.baseUrl)}/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
          body: JSON.stringify(body), signal: controller.signal, redirect: 'error',
        })
        if (!response.ok) {
          await response.body?.cancel()
          // 仅透传受限的重试间隔，绝不转发上游错误正文或任意响应头。
          const retryAfter = response.headers.get('retry-after')
          if (response.status === 429 && retryAfter && /^\d{1,4}$/.test(retryAfter)) res.setHeader('Retry-After', retryAfter)
          // 限流由编排层展示并有界重试，避免SDK在内部长时间静默退避。
          if (response.status === 429) res.setHeader('x-should-retry', 'false')
          const type = response.status === 429 ? 'rate_limit_error' : response.status === 529 ? 'overloaded_error' : 'api_error'
          json(res, response.status, { type: 'error', error: { type, message: `Upstream HTTP ${response.status}` } }); return
        }
        if (!input.stream) { json(res, 200, toAnthropicResponse(await response.json() as OpenAIChunk)); return }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Expected upstream SSE')
        await relayStream(response, res, input.model)
        res.end()
      } catch (error) {
        if (res.destroyed) return
        // 空响应必须显式失败；422避免SDK自动重放可能已经执行的计费操作。
        const empty = error instanceof Error && error.message === AGENT_RESPONSE_FAILURE.EMPTY
        const message = empty ? AGENT_RESPONSE_FAILURE.EMPTY : 'Upstream request failed or unsupported response'
        const type = empty ? 'invalid_request_error' : 'api_error'
        if (res.headersSent) {
          res.end(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type, message } })}\n\n`)
        } else json(res, empty ? 422 : 502, { type: 'error', error: { type, message } })
      } finally { clearTimeout(timeout) }
    })().catch(() => { if (!res.destroyed && !res.headersSent) json(res, 500, { error: { type: 'api_error', message: 'Bridge request failed' } }) })
  })
  server.requestTimeout = REQUEST_TIMEOUT_MS
  server.headersTimeout = 30_000
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  server.unref()
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Bridge listen failed')
  return { baseUrl: `http://127.0.0.1:${address.port}`, apiKey, close: () => { server.closeAllConnections(); server.close() } }
}
