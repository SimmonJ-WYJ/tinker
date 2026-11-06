/** Anthropic Messages ↔ OpenAI Chat Completions 的纯协议转换。 */
import { openAIOutputLimit, usesCompletionTokenLimit } from './openai-model-options.ts'
import { AGENT_RESPONSE_FAILURE } from '@asci/shared'

interface Block {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  source?: { type?: string; media_type?: string; data?: string; url?: string }
  tool_use_id?: string
  content?: string | Block[]
  is_error?: boolean
}
export interface AnthropicRequest {
  model: string
  messages: { role: string; content: string | Block[] }[]
  system?: string | Block[]
  tools?: { name: string; description?: string; input_schema?: unknown; type?: string }[]
  tool_choice?: { type: string; name?: string }
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop_sequences?: string[]
  stream?: boolean
}
interface OpenAIMessage {
  role: string
  content: unknown
  tool_call_id?: string
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
}
export interface OpenAIRequest {
  max_completion_tokens?: number
  model: string
  messages: OpenAIMessage[]
  tools?: { type: 'function'; function: { name: string; description?: string; parameters: unknown } }[]
  tool_choice?: unknown
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop?: string[]
  stream: boolean
  stream_options?: { include_usage: boolean }
}
function textContent(content: string | Block[] | undefined): string {
  if (typeof content === 'string') return content
  return (content ?? []).map(block => {
    if (block.type !== 'text') throw new Error(`Unsupported text content: ${block.type}`)
    return block.text ?? ''
  }).join('\n')
}
function userContent(blocks: Block[]): unknown {
  if (blocks.every(b => b.type === 'text')) return textContent(blocks)
  return blocks.map(block => {
    if (block.type === 'text') return { type: 'text', text: block.text ?? '' }
    if (block.type === 'image') {
      const source = block.source
      if (source?.type === 'base64' && source.media_type && source.data) {
        return { type: 'image_url', image_url: { url: `data:${source.media_type};base64,${source.data}` } }
      }
      if (source?.type === 'url' && source.url) return { type: 'image_url', image_url: { url: source.url } }
    }
    throw new Error(`Unsupported content block: ${block.type}`)
  })
}
export function toOpenAIRequest(input: AnthropicRequest): OpenAIRequest {
  const messages: OpenAIMessage[] = []
  if (input.system) messages.push({ role: 'system', content: textContent(input.system) })
  for (const message of input.messages) {
    if (typeof message.content === 'string') {
      messages.push({ role: message.role, content: message.content })
      continue
    }
    const blocks = message.content
    if (message.role === 'assistant') {
      const calls = blocks.filter(b => b.type === 'tool_use').map(b => {
        if (!b.id || !b.name) throw new Error('Tool call missing id or name')
        return { id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }
      })
      for (const b of blocks) {
        if (!['text', 'tool_use', 'thinking', 'redacted_thinking'].includes(b.type)) throw new Error(`Unsupported assistant block: ${b.type}`)
      }
      messages.push({ role: 'assistant', content: textContent(blocks.filter(b => b.type === 'text')) || null, ...(calls.length ? { tool_calls: calls } : {}) })
    } else {
      // OpenAI 要求全部 tool 结果紧接 assistant.tool_calls，再放同轮新增用户输入。
      const results = blocks.filter(b => b.type === 'tool_result')
      for (const block of results) {
        if (!block.tool_use_id) throw new Error('Tool result missing tool_use_id')
        const resultBlocks = typeof block.content === 'string' ? [{ type: 'text', text: block.content }] : (block.content ?? [])
        const images = resultBlocks.filter(item => item.type === 'image')
        const resultText = textContent(resultBlocks.filter(item => item.type === 'text'))
        messages.push({ role: 'tool', tool_call_id: block.tool_use_id, content: `${block.is_error ? 'Tool error: ' : ''}${resultText || (images.length ? '[Image attached after tool results]' : '')}` })
      }
      // Chat Completions 工具结果只接收文本；Read 返回的图片放到其后的 user 多模态消息。
      const toolImages = results.flatMap(result => typeof result.content === 'string' ? [] : (result.content ?? []).filter(item => item.type === 'image'))
      const rest = [...toolImages, ...blocks.filter(b => b.type !== 'tool_result')]
      if (rest.length) messages.push({ role: message.role, content: userContent(rest) })
    }
  }
  const output: OpenAIRequest = { model: input.model, messages, stream: input.stream === true }
  if (input.max_tokens != null) Object.assign(output, openAIOutputLimit(input.model, input.max_tokens))
  if (input.temperature != null && !usesCompletionTokenLimit(input.model)) output.temperature = input.temperature
  if (input.top_p != null && !usesCompletionTokenLimit(input.model)) output.top_p = input.top_p
  if (input.stop_sequences?.length) output.stop = input.stop_sequences
  if (input.tools?.length) output.tools = input.tools.map(tool => {
    if (tool.type && tool.type !== 'custom') throw new Error(`Unsupported server tool: ${tool.type}`)
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema ?? { type: 'object', properties: {} } } }
  })
  if (input.tool_choice) {
    const choice = input.tool_choice
    output.tool_choice = choice.type === 'tool' ? { type: 'function', function: { name: choice.name } }
      : choice.type === 'any' ? 'required' : choice.type
  }
  if (output.stream) output.stream_options = { include_usage: true }
  return output
}

interface OpenAIToolCall {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}
export interface OpenAIChunk {
  id?: string
  model?: string
  choices?: { delta?: { content?: string | null; tool_calls?: OpenAIToolCall[] }; message?: { content?: string | null; tool_calls?: OpenAIToolCall[] }; finish_reason?: string | null }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}
export interface AnthropicEvent {
  type: string
  index?: number
  content_block?: unknown
  delta?: unknown
  usage?: unknown
  message?: unknown
}
function stopReason(reason: string | null | undefined): string {
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  if (reason === 'content_filter') return 'refusal'
  return 'end_turn'
}
function parseArguments(raw: string): unknown {
  const value: unknown = JSON.parse(raw || '{}')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid tool arguments')
  return value
}
export function toAnthropicResponse(input: OpenAIChunk) {
  if (input.error) throw new Error(input.error.message ?? 'Upstream error')
  const choice = input.choices?.[0]
  if (!choice?.message) throw new Error('Invalid Chat Completions response')
  const content: unknown[] = []
  if (choice.message.content) content.push({ type: 'text', text: choice.message.content })
  for (const call of choice.message.tool_calls ?? []) {
    if (!call.id || !call.function?.name) throw new Error('Incomplete tool call')
    content.push({ type: 'tool_use', id: call.id, name: call.function.name, input: parseArguments(call.function.arguments ?? '{}') })
  }
  // 上游可能只返回推理用量；没有可交付内容不能伪装成成功结束。
  if (!choice.message.content?.trim() && !choice.message.tool_calls?.length) throw new Error(AGENT_RESPONSE_FAILURE.EMPTY)
  return { id: input.id ?? 'msg_bridge', type: 'message', role: 'assistant', model: input.model,
    content, stop_reason: stopReason(choice.finish_reason), stop_sequence: null,
    usage: { input_tokens: input.usage?.prompt_tokens ?? 0, output_tokens: input.usage?.completion_tokens ?? 0 },
  }
}

/** 每请求一个实例；文本实时转发，工具名/参数完整聚合后逐个输出，防止并行调用串线。 */
export class OpenAIStreamTranslator {
  private started = false
  private textStarted = false
  private hasVisibleText = false
  private nextIndex = 0
  private reason: string | null = null
  private completed = false
  private usage = { input_tokens: 0, output_tokens: 0 }
  private calls = new Map<number, { id: string; name: string; arguments: string }>()
  constructor(private model: string) {}
  push(chunk: OpenAIChunk): AnthropicEvent[] {
    if (chunk.error) throw new Error(chunk.error.message ?? 'Upstream stream error')
    const events: AnthropicEvent[] = []
    if (!this.started) {
      this.started = true
      events.push({ type: 'message_start', message: { id: chunk.id ?? 'msg_bridge', type: 'message', role: 'assistant', model: chunk.model ?? this.model, content: [], stop_reason: null, stop_sequence: null, usage: this.usage } })
    }
    if (chunk.usage) {
      this.usage = { input_tokens: chunk.usage.prompt_tokens ?? this.usage.input_tokens, output_tokens: chunk.usage.completion_tokens ?? this.usage.output_tokens }
    }
    const choice = chunk.choices?.[0]
    if (choice?.finish_reason) this.reason = choice.finish_reason
    const delta = choice?.delta
    if (delta?.content) {
      this.hasVisibleText ||= delta.content.trim().length > 0
      if (!this.textStarted) {
        this.textStarted = true
        events.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      }
      events.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta.content } })
    }
    for (const fragment of delta?.tool_calls ?? []) {
      if (fragment.index == null) throw new Error('Tool fragment missing index')
      const call = this.calls.get(fragment.index) ?? { id: '', name: '', arguments: '' }
      if (fragment.id) call.id = fragment.id
      call.name += fragment.function?.name ?? ''
      call.arguments += fragment.function?.arguments ?? ''
      this.calls.set(fragment.index, call)
    }
    return events
  }
  finish(): AnthropicEvent[] {
    if (this.completed) return []
    if (!this.started || !this.reason) throw new Error('Upstream stream ended before finish_reason')
    if (!this.hasVisibleText && this.calls.size === 0) throw new Error(AGENT_RESPONSE_FAILURE.EMPTY)
    this.completed = true
    const events: AnthropicEvent[] = []
    if (this.textStarted) {
      events.push({ type: 'content_block_stop', index: 0 })
      this.nextIndex = 1
    }
    for (const call of this.calls.values()) {
      if (!call.id || !call.name) throw new Error('Incomplete tool call')
      parseArguments(call.arguments)
      const index = this.nextIndex++
      events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} } },
        { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: call.arguments || '{}' } },
        { type: 'content_block_stop', index })
    }
    events.push({ type: 'message_delta', delta: { stop_reason: stopReason(this.reason), stop_sequence: null }, usage: this.usage }, { type: 'message_stop' })
    return events
  }
}
