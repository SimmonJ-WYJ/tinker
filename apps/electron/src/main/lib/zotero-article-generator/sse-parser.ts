/**
 * Anthropic Messages API SSE 流解析（纯函数，无 Electron 依赖）
 *
 * 设计目标：
 *   - 兼容标准 Anthropic 端点 + 推理模型（DeepSeek V4 / Claude extended thinking）
 *   - 兼容代理端点的非标 delta 字段（content / output_text）
 *   - chunk 在 SSE 帧中间切开仍能正确还原
 *   - 错误事件自动归类为 rate-limit / network / unknown，便于上层 retry 决策
 *
 * 抽到独立文件是为了让 bun test 不用加载 Electron（llm-client.ts 用了 safeStorage）。
 * llm-client.ts 仅复用本文件导出的 parseSseStream + SseAccumulator + 错误类。
 */

/**
 * SSE 解析过程中识别的错误分类（与 ArticleLlmErrorKind 子集对齐）。
 *
 * 上层 llm-client.ts 拿到 SseParseError 后包装成 ArticleLlmError，
 * 保持原本的 kind 语义一致。
 */
export type SseErrorKind = 'rate-limit' | 'network' | 'unknown' | 'invalid-response'

/**
 * SSE 解析过程中出现的错误。
 *
 * 故意不复用 ArticleLlmError 是为了让本文件零外部依赖（便于单测）。
 */
export class SseParseError extends Error {
  override readonly name = 'SseParseError'
  readonly kind: SseErrorKind

  constructor(kind: SseErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

/**
 * SSE 流累积器：边读边攒 text / thinking / stop_reason，最终给 callLlm 返回。
 */
export interface SseAccumulator {
  text: string
  thinking: string
  stopReason: string | null
  eventCount: number
}

/**
 * 单条 SSE 解析后的 event（仅本文件内部使用）。
 */
interface SseEvent {
  /** SSE 帧的 `event:` 行，可能为空（仅 data 也合法） */
  event: string
  /** 解析后的 JSON 数据 */
  data: ParsedEventData
}

/**
 * Anthropic SSE 事件携带的 data 字段（已 JSON.parse）。
 *
 * 涵盖类型：
 *   - message_start / message_delta / message_stop
 *   - content_block_start / content_block_delta / content_block_stop
 *   - ping
 *   - error
 *
 * 字段都用可选避免某些兼容端点漏字段时 TS 报错；运行时再按 type 走。
 */
interface ParsedEventData {
  type?: string
  index?: number
  content_block?: { type?: string; text?: string; thinking?: string }
  delta?: {
    type?: string
    text?: string
    thinking?: string
    stop_reason?: string
    /** 部分兼容端点（如某些 deepseek/qwen 网关）非标 delta 字段 */
    content?: string
    output_text?: string
  }
  error?: { type?: string; message?: string }
  /** 兼容个别端点把 message_start 的整段 message 平铺给我们 */
  message?: { content?: Array<{ type?: string; text?: string }> }
}

/**
 * 流式进度回调（可选）。每攒到一段就触发，便于主进程打日志或 UI 反映进度。
 */
export type SseProgressCallback = (acc: Readonly<SseAccumulator>) => void

/**
 * 解析 Anthropic SSE 流，累积 text / thinking / stop_reason。
 *
 * 兼容形态：
 *   - 标准 Anthropic：content_block_delta + delta.text_delta / thinking_delta
 *   - DeepSeek V4 / Claude extended thinking：thinking_delta + text_delta 交错
 *   - 兜底：delta.content / delta.output_text 字段（少数代理端点）
 *
 * SSE 解析按 \n\n 拆 event 帧，逐帧解析 event: / data: 行，data 行 JSON.parse。
 *
 * @param body undici fetch().body —— Web ReadableStream<Uint8Array>
 * @param onProgress 每条 event 应用后回调，用于上层 throttle 日志
 */
export async function parseSseStream(
  body: ReadableStream<Uint8Array> | null,
  onProgress?: SseProgressCallback,
): Promise<SseAccumulator> {
  if (!body) {
    throw new SseParseError('invalid-response', 'SSE 响应无 body')
  }
  const acc: SseAccumulator = { text: '', thinking: '', stopReason: null, eventCount: 0 }
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  // 用 reader 而不是 for-await 是为了显式控制 cancel：上层 AbortController 触发时
  // body 会自动 throw AbortError，再由 callLlm 的 catch 转 ArticleLlmError。
  const reader = body.getReader()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    buffer += decoder.decode(value, { stream: true })

    // SSE 以 \n\n 分帧。处理掉缓冲区里所有已完整的帧，保留尾部不完整片段。
    let sepIdx: number
    while ((sepIdx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, sepIdx)
      buffer = buffer.slice(sepIdx + 2)
      const ev = parseSseFrame(frame)
      if (!ev) continue
      acc.eventCount++
      applyEvent(ev, acc)
      onProgress?.(acc)
    }
  }
  // 流结束时如果还有残帧（无尾部 \n\n），也尝试解一次
  if (buffer.trim().length > 0) {
    const ev = parseSseFrame(buffer)
    if (ev) {
      acc.eventCount++
      applyEvent(ev, acc)
      onProgress?.(acc)
    }
  }
  return acc
}

/**
 * 解一帧 SSE。一帧含若干行：
 *   event: content_block_delta
 *   data: {"type":"content_block_delta",...}
 *
 * data 可能跨多行（按 SSE 规范 join '\n'），但 Anthropic 实际单行 data 居多。
 * 非 JSON 数据（例如 `: heartbeat`）返回 null。
 */
function parseSseFrame(frame: string): SseEvent | null {
  const lines = frame.split('\n')
  let event = ''
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith(':')) continue  // 注释心跳
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('event ')) {
      // 容忍个别端点用 'event ' 空格代替冒号
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    } else if (line.startsWith('data ')) {
      dataLines.push(line.slice(5).trim())
    }
    // 其他字段（id: / retry:）忽略
  }
  if (dataLines.length === 0) return null
  const dataStr = dataLines.join('\n')
  if (dataStr === '[DONE]') return null  // 某些 OpenAI 兼容端点的结束标记
  try {
    const data = JSON.parse(dataStr) as ParsedEventData
    return { event, data }
  } catch {
    return null
  }
}

/**
 * 把单条 SSE event 应用到累积器。按 data.type 分发：
 *   - content_block_delta + delta.text_delta → 累积到 text
 *   - content_block_delta + delta.thinking_delta → 累积到 thinking
 *   - content_block_start：某些端点首条 content_block 直接带初始 text/thinking
 *   - message_start：兜底，某些代理把整段 message 平铺过来（非流式回落）
 *   - message_delta：可能含 delta.stop_reason
 *   - error：直接 throw SseParseError
 *   - ping / message_stop / content_block_stop：忽略
 */
function applyEvent(ev: SseEvent, acc: SseAccumulator): void {
  const t = ev.data.type
  if (t === 'error') {
    const msg = ev.data.error?.message ?? '未知错误'
    const kind = ev.data.error?.type ?? 'unknown'
    // overloaded_error / rate_limit_error 视为 rate-limit，api_error 视为 network
    if (kind === 'rate_limit_error' || kind === 'overloaded_error') {
      throw new SseParseError('rate-limit', `SSE error: ${kind} ${msg}`)
    }
    if (kind === 'api_error' || kind === 'overloaded') {
      throw new SseParseError('network', `SSE error: ${kind} ${msg}`)
    }
    throw new SseParseError('unknown', `SSE error: ${kind} ${msg}`)
  }
  if (t === 'content_block_start') {
    const cb = ev.data.content_block
    if (cb?.type === 'text' && cb.text) acc.text += cb.text
    else if (cb?.type === 'thinking' && cb.thinking) acc.thinking += cb.thinking
    return
  }
  if (t === 'content_block_delta') {
    const d = ev.data.delta
    if (!d) return
    // 标准：text_delta + delta.text；thinking_delta + delta.thinking
    if (d.type === 'text_delta' && typeof d.text === 'string') {
      acc.text += d.text
    } else if (d.type === 'thinking_delta' && typeof d.thinking === 'string') {
      acc.thinking += d.thinking
    } else if (typeof d.text === 'string') {
      // 兜底：兼容端点 delta.text 不带 type
      acc.text += d.text
    } else if (typeof d.content === 'string') {
      acc.text += d.content
    } else if (typeof d.output_text === 'string') {
      acc.text += d.output_text
    }
    return
  }
  if (t === 'message_delta') {
    const sr = ev.data.delta?.stop_reason
    if (typeof sr === 'string' && sr.length > 0) acc.stopReason = sr
    return
  }
  if (t === 'message_start') {
    // 兜底：极个别代理在 message_start 里直接平铺整段 content（非真正 streaming）
    const blocks = ev.data.message?.content ?? []
    for (const b of blocks) {
      if (b.type === 'text' && typeof b.text === 'string') acc.text += b.text
    }
    return
  }
  // ping / content_block_stop / message_stop / unknown → 忽略
}
