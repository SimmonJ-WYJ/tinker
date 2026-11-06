import { test, expect, describe } from 'bun:test'
import { openrouterProfile } from './openrouter-profile.ts'

describe('openrouterProfile', () => {
  test('providerType 为 openrouter', () => {
    expect(openrouterProfile.providerType).toBe('openrouter')
  })

  test('defaultProbeModel 返回 anthropic/claude-haiku-4.5（namespaced）', () => {
    expect(openrouterProfile.defaultProbeModel('https://openrouter.ai/api')).toBe(
      'anthropic/claude-haiku-4.5',
    )
  })

  test('extraHeaders 包含 ranking headers', () => {
    const headers = openrouterProfile.extraHeaders('https://openrouter.ai/api', 'k')
    expect(headers['HTTP-Referer']).toBe('https://github.com/OPENSCI-Labs/ASCI-Alpha')
    expect(headers['X-Title']).toBe('ASCI Alpha')
  })

  test('defaultCapabilities 支持 PDF document block（Anthropic Skin 透传）', () => {
    expect(openrouterProfile.defaultCapabilities()).toEqual({ supportsPdfDocumentBlock: true })
  })

  test('fetchModels 远程拉取 /api/v1/models 并仅返回 anthropic/* 前缀', async () => {
    const fetchFn = async (url: string, init?: { headers?: Record<string, string> }) => {
      expect(url).toBe('https://openrouter.ai/api/v1/models')
      expect(init?.headers?.['Authorization']).toBe('Bearer k')
      expect(init?.headers?.['HTTP-Referer']).toBeDefined()
      return new Response(
        JSON.stringify({
          data: [
            { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
            { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
            { id: 'openai/gpt-5', name: 'GPT-5 (filtered)' },
            { id: 'google/gemini-2.5', name: 'Gemini 2.5 (filtered)' },
          ],
        }),
        { status: 200 },
      )
    }
    const result = await openrouterProfile.fetchModels({
      baseUrl: 'https://openrouter.ai/api',
      apiKey: 'k',
      fetchFn,
    })
    expect(result.success).toBe(true)
    expect(result.models.length).toBe(2)
    expect(result.models.every((m) => m.id.startsWith('anthropic/'))).toBe(true)
  })

  test('fetchModels 401 返回 API Key 无效', async () => {
    const fetchFn = async () => new Response('bad', { status: 401 })
    const result = await openrouterProfile.fetchModels({
      baseUrl: 'https://openrouter.ai/api',
      apiKey: 'bad',
      fetchFn,
    })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/API Key 无效|无效/)
  })
})
