import { test, expect, describe } from 'bun:test'
import { moonshotProfile } from './moonshot-profile.ts'

describe('moonshotProfile', () => {
  test('providerType 为 moonshot', () => {
    expect(moonshotProfile.providerType).toBe('moonshot')
  })

  test('defaultCapabilities PDF document block 关闭', () => {
    expect(moonshotProfile.defaultCapabilities()).toEqual({ supportsPdfDocumentBlock: false })
  })

  test('validateEndpoint：Anthropic 端点合法', () => {
    expect(moonshotProfile.validateEndpoint!('https://api.moonshot.cn/anthropic')).toEqual({
      ok: true,
    })
  })

  test('validateEndpoint：OpenAI v1 端点拦截 + 给出 i18n key', () => {
    const result = moonshotProfile.validateEndpoint!('https://api.moonshot.cn/v1')
    expect(result.ok).toBe(false)
    expect(result.messageKey).toBe('errors.channelTest.moonshotOpenAIEndpoint')
  })

  test('validateEndpoint：.ai 域 OpenAI 端点也拦截', () => {
    const result = moonshotProfile.validateEndpoint!('https://api.moonshot.ai/v1')
    expect(result.ok).toBe(false)
  })

  test('fetchModels 返回静态清单', async () => {
    const result = await moonshotProfile.fetchModels({
      baseUrl: 'https://api.moonshot.cn/anthropic',
      apiKey: 'k',
      fetchFn: async () => new Response('', { status: 200 }),
    })
    expect(result.success).toBe(true)
    expect(result.models.length).toBeGreaterThan(0)
  })
})
