/**
 * AnthropicAdapter 单测
 *
 * 重点覆盖 OpenRouter ranking header 的条件附加逻辑 —— 让 ASCI 出现在
 * https://openrouter.ai/rankings 上，且不污染原生 Anthropic / 其他兼容端点的请求。
 */
import { describe, expect, test } from 'bun:test'
import { AnthropicAdapter } from './anthropic-adapter.ts'
import type { StreamRequestInput } from './types.ts'

function baseInput(overrides: Partial<StreamRequestInput> = {}): StreamRequestInput {
  return {
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'sk-test',
    modelId: 'claude-sonnet-4-5-20250929',
    history: [],
    userMessage: 'hi',
    readImageAttachments: () => [],
    ...overrides,
  }
}

describe('AnthropicAdapter.buildStreamRequest — headers', () => {
  const adapter = new AnthropicAdapter()

  test('原生 Anthropic 端点：不附加 OpenRouter ranking header', () => {
    const req = adapter.buildStreamRequest(baseInput())
    expect(req.headers['HTTP-Referer']).toBeUndefined()
    expect(req.headers['X-Title']).toBeUndefined()
    // 保留基础 Anthropic header
    expect(req.headers['x-api-key']).toBe('sk-test')
    expect(req.headers['Authorization']).toBe('Bearer sk-test')
    expect(req.headers['anthropic-version']).toBe('2023-06-01')
  })

  test('OpenRouter (https://openrouter.ai/api)：附加 HTTP-Referer + X-Title', () => {
    const req = adapter.buildStreamRequest(
      baseInput({ baseUrl: 'https://openrouter.ai/api', modelId: 'anthropic/claude-sonnet-4.6' }),
    )
    expect(req.headers['HTTP-Referer']).toBe('https://github.com/OPENSCI-Labs/ASCI-Alpha')
    expect(req.headers['X-Title']).toBe('ASCI Alpha')
  })

  test('OpenRouter 自定义子域名也识别（hostname endsWith openrouter.ai）', () => {
    const req = adapter.buildStreamRequest(
      baseInput({ baseUrl: 'https://api.openrouter.ai/api', modelId: 'anthropic/claude-haiku-4.5' }),
    )
    expect(req.headers['HTTP-Referer']).toBe('https://github.com/OPENSCI-Labs/ASCI-Alpha')
    expect(req.headers['X-Title']).toBe('ASCI Alpha')
  })

  test('第三方兼容端点（moonshot / deepseek 等）：不附加 OpenRouter ranking header', () => {
    const moonshot = adapter.buildStreamRequest(
      baseInput({ baseUrl: 'https://api.moonshot.cn/anthropic' }),
    )
    expect(moonshot.headers['HTTP-Referer']).toBeUndefined()
    expect(moonshot.headers['X-Title']).toBeUndefined()

    const deepseek = adapter.buildStreamRequest(
      baseInput({ baseUrl: 'https://api.deepseek.com/anthropic' }),
    )
    expect(deepseek.headers['HTTP-Referer']).toBeUndefined()
    expect(deepseek.headers['X-Title']).toBeUndefined()
  })

  test('OpenRouter baseUrl 经 normalize 后正确指向 /api/v1/messages', () => {
    const req = adapter.buildStreamRequest(
      baseInput({ baseUrl: 'https://openrouter.ai/api', modelId: 'anthropic/claude-sonnet-4.6' }),
    )
    expect(req.url).toBe('https://openrouter.ai/api/v1/messages')
  })

  test('畸形 baseUrl 不抛错，回退为非 OpenRouter（不附加 ranking header）', () => {
    const req = adapter.buildStreamRequest(baseInput({ baseUrl: 'not-a-valid-url' }))
    expect(req.headers['HTTP-Referer']).toBeUndefined()
    expect(req.headers['X-Title']).toBeUndefined()
  })
})
