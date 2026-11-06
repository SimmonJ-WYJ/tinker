/**
 * article 生成器调用 LLM 的轻封装
 *
 * 复用 channel-manager 的渠道与加密 key，统一走 Anthropic Messages API（所有 provider
 * 在 ASCI 中都使用 Anthropic 兼容端点）。
 *
 * 错误分类：网络/限流（可重试）、token 超限（切片后重试）、鉴权失败（不再自动重试）。
 */

import { safeStorage } from 'electron'
import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici'
import type { Channel } from '@asci/shared'
import { nowMs } from '@asci/shared'
import { normalizeAnthropicBaseUrl } from '@asci/core'
import { listChannels } from '../channel-manager'
import { getEffectiveProxyUrl } from '../proxy-settings-service'
import { parseSseStream, SseParseError, type SseAccumulator } from './sse-parser'

export type ArticleLlmErrorKind =
  | 'auth' // 鉴权失败，不再自动重试
  | 'token-overflow' // 上下文超限，可减半切片重试
  | 'rate-limit' // 429 限流，可重试
  | 'network' // 连接 / 5xx，可重试
  | 'no-channel' // 没有可用渠道（需用户配置）
  | 'invalid-response' // 协议层异常（非 JSON / 缺 content）
  | 'unknown'

export class ArticleLlmError extends Error {
  override readonly name = 'ArticleLlmError'
  readonly kind: ArticleLlmErrorKind
  readonly statusCode?: number

  constructor(kind: ArticleLlmErrorKind, message: string, statusCode?: number) {
    super(message)
    this.kind = kind
    this.statusCode = statusCode
  }
}

export interface LlmCallInput {
  channelId: string | null
  model: string | null
  systemPrompt: string
  userPrompt: string
  /** 单次调用 max_tokens 上限（输出长度上限） */
  maxTokens: number
  /** 整体超时（ms），默认 120s */
  timeoutMs?: number
}

export interface LlmCallResult {
  text: string
  channelId: string
  model: string
}

/**
 * 选定一个可用渠道
 *
 * - channelId 显式传入：必须是 enabled 才返回，否则视为该渠道不可用
 * - 否则取第一个 enabled 渠道
 */
export function pickChannel(channelId: string | null): Channel | null {
  const channels = listChannels()
  if (channelId) {
    return channels.find(c => c.id === channelId && c.enabled) ?? null
  }
  return channels.find(c => c.enabled) ?? null
}

/** 在指定渠道上挑选可用模型 */
export function pickModel(channel: Channel, modelId: string | null): string | null {
  if (modelId) {
    const m = channel.models.find(x => x.id === modelId && x.enabled)
    return m?.id ?? null
  }
  const first = channel.models.find(x => x.enabled)
  return first?.id ?? null
}

/**
 * 调用 Anthropic Messages API；返回拼接后的 text 内容。
 */
export async function callLlm(input: LlmCallInput): Promise<LlmCallResult> {
  const channel = pickChannel(input.channelId)
  if (!channel) {
    throw new ArticleLlmError('no-channel', '未找到可用渠道（请在设置 → 渠道里启用至少一个）')
  }

  const model = pickModel(channel, input.model)
  if (!model) {
    throw new ArticleLlmError('no-channel', `渠道 ${channel.name} 没有任何已启用的模型`)
  }

  const apiKey = decryptApiKey(channel.apiKey)
  const url = normalizeAnthropicBaseUrl(channel.baseUrl)
  const proxyUrl = await getEffectiveProxyUrl()
  const dispatcher = buildLongTimeoutDispatcher(proxyUrl)

  // streaming = true：让 Anthropic 端点走 SSE 流式响应。
  // 旧的非流式调用让上游网关 hold 一条 TCP 等模型把整篇 64K output 写完，
  // opencode / kimi 等聚合网关 idle 60-120s 就 502；streaming 后 first-byte
  // 通常 < 5s 就到，server 持续 push 增量 event，连接 keep-alive 由 SSE 自动续约，
  // 502 概率显著下降，附带还能在主进程日志看到生成进度。
  const body = {
    model,
    max_tokens: input.maxTokens,
    system: input.systemPrompt,
    messages: [{ role: 'user', content: input.userPrompt }],
    stream: true,
  }

  const ctrl = new AbortController()
  // 默认 10 分钟：article 生成不切片整篇丢给模型，加上 thinking + echo 长输出，
  // deepseek-v4 / kimi-k2 等模型实测可能跑 3-5 分钟。
  const timeoutMs = input.timeoutMs ?? 600000
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  const bodyJson = JSON.stringify(body)
  const bodyKb = (bodyJson.length / 1024).toFixed(1)
  console.log(
    `[Article LLM] ▶ POST ${url}/messages model=${model} system_chars=${input.systemPrompt.length} user_chars=${input.userPrompt.length} max_tokens=${input.maxTokens} body=${bodyKb}KB stream=true`,
  )

  // 等待期心跳：每 30s 报告一次 "still waiting"，避免长 LLM 调用时看似卡死
  const startTime = nowMs()
  const heartbeat = setInterval(() => {
    const elapsed = ((nowMs() - startTime) / 1000).toFixed(0)
    console.log(
      `[Article LLM] ⏳ 等待响应中 (${elapsed}s elapsed, timeout=${Math.floor(timeoutMs / 1000)}s) ...`,
    )
  }, 30_000)

  let response: Awaited<ReturnType<typeof undiciFetch>>
  try {
    response = await undiciFetch(`${url}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        Authorization: `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: bodyJson,
      signal: ctrl.signal,
      dispatcher,
    })
  } catch (err) {
    clearTimeout(timer)
    clearInterval(heartbeat)
    if (ctrl.signal.aborted) {
      throw new ArticleLlmError('network', `LLM 调用超时（${Math.floor(timeoutMs / 1000)}s 未返回）`)
    }
    // undici 的 "fetch failed" 把真正原因藏在 err.cause 里，必须层层剥出来
    const detail = describeFetchError(err)
    console.warn(`[Article LLM] fetch failed → ${detail.full}`)
    throw new ArticleLlmError('network', `网络异常: ${detail.short}`)
  }

  const headerElapsed = ((nowMs() - startTime) / 1000).toFixed(1)
  const reqId = response.headers.get('request-id') ?? response.headers.get('x-request-id') ?? ''
  console.log(
    `[Article LLM] ◀ HTTP ${response.status} ${response.statusText || ''} (${headerElapsed}s)${reqId ? ` request_id=${reqId}` : ''}`,
  )

  if (response.status === 401 || response.status === 403) {
    clearTimeout(timer)
    clearInterval(heartbeat)
    const text = await response.text().catch(() => '')
    throw new ArticleLlmError('auth', `鉴权失败 (${response.status})${text ? `: ${text.slice(0, 200)}` : ''}`, response.status)
  }
  if (response.status === 429) {
    clearTimeout(timer)
    clearInterval(heartbeat)
    throw new ArticleLlmError('rate-limit', '触发限流 (429)', 429)
  }

  if (!response.ok) {
    clearTimeout(timer)
    clearInterval(heartbeat)
    const text = await response.text().catch(() => '')
    console.warn(`[Article LLM] 错误响应体：${text.slice(0, 500)}`)
    if (looksLikeTokenOverflow(text, response.status)) {
      throw new ArticleLlmError('token-overflow', `上下文超限: ${text.slice(0, 200)}`, response.status)
    }
    if (response.status >= 500) {
      throw new ArticleLlmError('network', `服务端错误 (${response.status}): ${text.slice(0, 200)}`, response.status)
    }
    throw new ArticleLlmError('unknown', `请求失败 (${response.status}): ${text.slice(0, 200)}`, response.status)
  }

  // SSE 流解析：累积 content_block_delta 事件里的 text_delta，跟踪 stop_reason。
  // undici 把 body 类型标成 ReadableStream<any>；运行时实际就是 Uint8Array chunk 流。
  // 进度日志走 10s 节流 onProgress 回调（避免每 token 一行刷屏）。
  let parsed: SseAccumulator
  let lastProgressLog = nowMs()
  let firstByteLogged = false
  const onProgress: (acc: Readonly<SseAccumulator>) => void = acc => {
    if (!firstByteLogged) {
      const ftbe = ((nowMs() - startTime) / 1000).toFixed(1)
      console.log(`[Article LLM] ⌛ first-byte ${ftbe}s（SSE 开始接收）`)
      firstByteLogged = true
    }
    const now = nowMs()
    if (now - lastProgressLog > 10_000) {
      lastProgressLog = now
      const elapsed = ((now - startTime) / 1000).toFixed(0)
      console.log(
        `[Article LLM] ⋯ 流式累积中 (${elapsed}s, events=${acc.eventCount}, text_chars=${acc.text.length}${acc.thinking.length > 0 ? `, thinking_chars=${acc.thinking.length}` : ''})`,
      )
    }
  }
  try {
    parsed = await parseSseStream(
      response.body as ReadableStream<Uint8Array> | null,
      onProgress,
    )
  } catch (err) {
    clearTimeout(timer)
    clearInterval(heartbeat)
    if (ctrl.signal.aborted) {
      throw new ArticleLlmError('network', `LLM 调用超时（${Math.floor(timeoutMs / 1000)}s 未返回）`)
    }
    // SSE event 流里的 error 事件（rate-limit / network / unknown），直接重包成 ArticleLlmError
    if (err instanceof SseParseError) {
      const kind = err.kind === 'invalid-response' ? 'invalid-response' : err.kind
      throw new ArticleLlmError(kind, err.message)
    }
    const detail = describeFetchError(err)
    console.warn(`[Article LLM] SSE 解析失败 → ${detail.full}`)
    throw new ArticleLlmError('network', `SSE 流异常: ${detail.short}`)
  }
  clearTimeout(timer)
  clearInterval(heartbeat)

  const totalElapsed = ((nowMs() - startTime) / 1000).toFixed(1)

  if (!parsed.text) {
    console.warn(
      `[Article LLM] SSE 流结束但无 text 输出，stop_reason=${parsed.stopReason ?? 'unknown'}，thinking_chars=${parsed.thinking.length}，events=${parsed.eventCount}`,
    )
    if (parsed.thinking.length > 0) {
      throw new ArticleLlmError(
        'token-overflow',
        `推理模型只输出了 thinking 没有最终回答（stop_reason=${parsed.stopReason ?? 'unknown'}）；max_tokens 不够留给答案`,
      )
    }
    const stopReason = parsed.stopReason ? `（stop_reason=${parsed.stopReason}）` : ''
    throw new ArticleLlmError(
      'invalid-response',
      `响应无文本内容${stopReason}，请查看主进程日志了解详情`,
    )
  }

  console.log(
    `[Article LLM] ✓ SSE 流式完成 (${totalElapsed}s total) stop_reason=${parsed.stopReason ?? 'n/a'} events=${parsed.eventCount} extracted_chars=${parsed.text.length}${parsed.thinking.length > 0 ? ` thinking_chars=${parsed.thinking.length}` : ''}`,
  )

  return { text: parsed.text, channelId: channel.id, model }
}


function looksLikeTokenOverflow(body: string, status: number): boolean {
  const lower = body.toLowerCase()
  return (
    status === 400 &&
    (lower.includes('context_length') ||
      lower.includes('max_tokens') ||
      lower.includes('too long') ||
      lower.includes('token') && lower.includes('exceed'))
  )
}

/**
 * 给 article LLM 调用造一个长超时 undici dispatcher
 *
 * 默认 fetch（global / undici）的 headersTimeout 与 bodyTimeout 都是 5 分钟，
 * MiniMax / DeepSeek 跑 80K+ tokens 大输入时常常超过这个值，导致 UND_ERR_HEADERS_TIMEOUT。
 * 这里全部拉到 15 分钟，由我们自己的 AbortController 超时（默认 600s）做总闸。
 */
function buildLongTimeoutDispatcher(proxyUrl: string | undefined): Dispatcher {
  const opts = {
    headersTimeout: 15 * 60_000,
    bodyTimeout: 15 * 60_000,
    connectTimeout: 30_000,
  }
  if (proxyUrl && proxyUrl.trim()) {
    return new ProxyAgent({ uri: proxyUrl.trim(), ...opts })
  }
  return new Agent(opts)
}

function decryptApiKey(encryptedKey: string): string {
  if (!safeStorage.isEncryptionAvailable()) return encryptedKey
  try {
    return safeStorage.decryptString(Buffer.from(encryptedKey, 'base64'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new ArticleLlmError('auth', `解密 API Key 失败: ${msg}`)
  }
}

/**
 * undici 的 "fetch failed" 把真正错误藏在 err.cause 里（多层嵌套）。
 * 把 cause 链串成一行，给用户更可操作的错误信息。
 */
function describeFetchError(err: unknown): { short: string; full: string } {
  const causes: string[] = []
  let cur: unknown = err
  let depth = 0
  while (cur && depth < 5) {
    if (cur instanceof Error) {
      const code = (cur as NodeJS.ErrnoException).code
      causes.push(code ? `${cur.message} [${code}]` : cur.message)
      cur = (cur as { cause?: unknown }).cause
    } else {
      causes.push(String(cur))
      break
    }
    depth++
  }
  // 最后一层 cause 通常是真正的网络错误（ECONNRESET / ENETUNREACH / UND_ERR_xxx 等）
  const root = causes[causes.length - 1] ?? '未知'
  return {
    short: root,
    full: causes.join(' ← '),
  }
}
