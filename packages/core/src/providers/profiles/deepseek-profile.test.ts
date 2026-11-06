import { test, expect, describe } from 'bun:test'
import { deepseekProfile } from './deepseek-profile.ts'

describe('deepseekProfile', () => {
  test('providerType 为 deepseek', () => {
    expect(deepseekProfile.providerType).toBe('deepseek')
  })

  test('defaultProbeModel 返回 claude-sonnet-4-5-20250929', () => {
    expect(deepseekProfile.defaultProbeModel('https://api.deepseek.com/anthropic')).toBe(
      'claude-sonnet-4-5-20250929',
    )
  })

  test('extraHeaders 空对象', () => {
    expect(deepseekProfile.extraHeaders('https://api.deepseek.com/anthropic', 'k')).toEqual({})
  })

  test('defaultCapabilities 支持 PDF document block', () => {
    expect(deepseekProfile.defaultCapabilities()).toEqual({ supportsPdfDocumentBlock: true })
  })

  test('fetchModels 返回静态清单', async () => {
    const result = await deepseekProfile.fetchModels({
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiKey: 'k',
      fetchFn: async () => new Response('', { status: 200 }),
    })
    expect(result.success).toBe(true)
    expect(result.models.length).toBeGreaterThan(0)
  })
})
