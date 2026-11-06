// packages/core/src/providers/profiles/anthropic-profile.test.ts
import { test, expect, describe } from 'bun:test'
import { anthropicProfile } from './anthropic-profile.ts'

describe('anthropicProfile', () => {
  test('providerType 为 anthropic', () => {
    expect(anthropicProfile.providerType).toBe('anthropic')
  })

  test('defaultProbeModel 返回 claude-sonnet-4-5-20250929', () => {
    expect(anthropicProfile.defaultProbeModel('https://api.anthropic.com')).toBe(
      'claude-sonnet-4-5-20250929',
    )
  })

  test('extraHeaders 返回空对象', () => {
    expect(anthropicProfile.extraHeaders('https://api.anthropic.com', 'sk-test')).toEqual({})
  })

  test('validateEndpoint 未定义（Anthropic 原生无需预检）', () => {
    expect(anthropicProfile.validateEndpoint).toBeUndefined()
  })

  test('defaultCapabilities 支持 PDF document block', () => {
    expect(anthropicProfile.defaultCapabilities()).toEqual({
      supportsPdfDocumentBlock: true,
    })
  })

  test('fetchModels 远程拉取并过滤 type=model 项', async () => {
    const fetchFn = async (url: string, init?: { headers?: Record<string, string> }) => {
      expect(url).toBe('https://api.anthropic.com/v1/models')
      expect(init?.headers?.['x-api-key']).toBe('sk-test')
      expect(init?.headers?.['anthropic-version']).toBe('2023-06-01')
      return new Response(
        JSON.stringify({
          data: [
            { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5', type: 'model' },
            { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', type: 'model' },
            { id: 'not-a-model', display_name: 'Skip me', type: 'other' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    const result = await anthropicProfile.fetchModels({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-test',
      fetchFn,
    })
    expect(result.success).toBe(true)
    expect(result.models).toHaveLength(2)
    expect(result.models[0]).toEqual({
      id: 'claude-sonnet-4-5-20250929',
      name: 'Claude Sonnet 4.5',
      enabled: true,
    })
  })

  test('fetchModels 401 返回 API Key 无效', async () => {
    const fetchFn = async () =>
      new Response('Invalid key', { status: 401 })
    const result = await anthropicProfile.fetchModels({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'bad',
      fetchFn,
    })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/API Key 无效/)
  })
})
