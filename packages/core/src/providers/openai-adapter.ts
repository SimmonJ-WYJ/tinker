/** 直接 Chat 请求的 OpenAI 兼容适配器；Agent 则走主进程本地桥接。 */
import { AnthropicAdapter } from './anthropic-adapter.ts'
import { normalizeOpenAIBaseUrl } from './custom-providers.ts'
import { toOpenAIRequest, OpenAIStreamTranslator } from './openai-compat.ts'
import type { AnthropicRequest, OpenAIChunk } from './openai-compat.ts'
import type { ProviderAdapter, StreamRequestInput, ProviderRequest, StreamEvent } from './types.ts'

export class OpenAIAdapter implements ProviderAdapter {
  readonly providerType = 'custom-openai' as const
  private translator = new OpenAIStreamTranslator('')
  private parser = new AnthropicAdapter()
  private ended = false
  buildStreamRequest(input: StreamRequestInput): ProviderRequest {
    this.translator = new OpenAIStreamTranslator(input.modelId)
    this.ended = false
    const anthropic = this.parser.buildStreamRequest(input)
    return {
      url: `${normalizeOpenAIBaseUrl(input.baseUrl)}/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify(toOpenAIRequest(JSON.parse(anthropic.body) as AnthropicRequest)),
    }
  }
  parseSSELine(line: string): StreamEvent[] {
    if (this.ended || line === '[DONE]') return []
    try {
      const chunk = JSON.parse(line) as OpenAIChunk
      const events = this.translator.push(chunk)
      if (chunk.choices?.[0]?.finish_reason) {
        this.ended = true
        events.push(...this.translator.finish())
      }
      return events.flatMap(event => this.parser.parseSSELine(JSON.stringify(event)))
    } catch {
      this.ended = true
      return [{ type: 'error', error: 'Invalid OpenAI stream response' }]
    }
  }
}
