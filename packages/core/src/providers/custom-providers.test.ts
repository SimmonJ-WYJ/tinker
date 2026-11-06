import { describe, expect, test } from 'bun:test'
import { getAdapter, getProfile } from './index.ts'
import { buildCustomProbe, normalizeOpenAIBaseUrl } from './custom-providers.ts'

describe('自定义中转站', () => {
  test('OpenAI 根路径、版本路径及完整 chat 地址不会重复拼接', () => {
    expect(normalizeOpenAIBaseUrl('https://relay.test/')).toBe('https://relay.test/v1')
    expect(normalizeOpenAIBaseUrl('https://relay.test/api/v2/')).toBe('https://relay.test/api/v2')
    expect(normalizeOpenAIBaseUrl('https://relay.test/v1/chat/completions/')).toBe('https://relay.test/v1')
  })
  test('测试请求使用手填模型及正确协议，不使用官方预设模型', () => {
    const request = buildCustomProbe('custom-openai', 'https://relay.test/v1', 'key', 'private-model')
    expect(request.url).toBe('https://relay.test/v1/chat/completions')
    expect(request.headers.Authorization).toBe('Bearer key')
    expect(JSON.parse(request.body).model).toBe('private-model')
    expect(() => buildCustomProbe('custom-anthropic', 'https://relay.test', 'key', '')).toThrow()
  })
  for (const provider of ['custom-anthropic', 'custom-openai'] as const) {
    test(`${provider} 拉取非官方模型并复用实际配置`, async () => {
      const profile = getProfile(provider)
      let called = ''
      const result = await profile.fetchModels({ baseUrl: 'https://relay.test', apiKey: 'key', fetchFn: async (url) => {
        called = url
        return Response.json({ data: [{ id: 'private-model', name: 'Private' }] })
      } })
      expect(called).toBe('https://relay.test/v1/models')
      expect(result.models).toEqual([{ id: 'private-model', name: 'Private', enabled: true }])
      expect(getAdapter(provider)).toBeDefined()
      expect(profile.defaultCapabilities().supportsPdfDocumentBlock).toBe(false)
    })
  }
})

test('OpenAI 自定义适配器使用 Chat Completions 并解析工具调用', () => {
  const adapter = getAdapter('custom-openai')
  const request = adapter.buildStreamRequest({ baseUrl: 'https://relay.test', apiKey: 'k', modelId: 'm', history: [], userMessage: 'hi', readImageAttachments: () => [] })
  expect(request.url).toBe('https://relay.test/v1/chat/completions')
  expect(adapter.parseSSELine(JSON.stringify({ id: 'x', choices: [{ delta: { content: 'hi' } }] }))).toContainEqual({ type: 'chunk', delta: 'hi' })
})

test('OpenAI 推理模型使用 max_completion_tokens，旧兼容模型保留 max_tokens', () => {
  const reasoning = JSON.parse(buildCustomProbe('custom-openai', 'https://relay.test', 'k', 'openai/o3-mini').body)
  expect(reasoning.max_completion_tokens).toBe(1)
  expect(reasoning.max_tokens).toBeUndefined()
  const legacy = JSON.parse(buildCustomProbe('custom-openai', 'https://relay.test', 'k', 'private-model').body)
  expect(legacy.max_tokens).toBe(1)
})

test('模型清单请求禁止携带 x-api-key 跟随重定向，并设置超时', async () => {
  await getProfile('custom-anthropic').fetchModels({ baseUrl: 'https://relay.test', apiKey: 'key', fetchFn: async (_url, init) => {
    expect(init?.redirect).toBe('error')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    return Response.json({ data: [] })
  } })
})
