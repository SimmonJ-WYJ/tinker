import { test, expect, describe } from 'bun:test'
import { minimaxProfile } from './minimax-profile.ts'

describe('minimaxProfile', () => {
  test('providerType 为 minimax', () => {
    expect(minimaxProfile.providerType).toBe('minimax')
  })

  test('defaultProbeModel 返回 claude-sonnet-4-5-20250929', () => {
    expect(minimaxProfile.defaultProbeModel('https://api.minimaxi.com/anthropic')).toBe(
      'claude-sonnet-4-5-20250929',
    )
  })

  test('extraHeaders 空对象', () => {
    expect(minimaxProfile.extraHeaders('https://api.minimaxi.com/anthropic', 'k')).toEqual({})
  })

  test('defaultCapabilities 支持 PDF document block', () => {
    expect(minimaxProfile.defaultCapabilities()).toEqual({ supportsPdfDocumentBlock: true })
  })

  test('fetchModels 返回静态清单（不调用 fetchFn）', async () => {
    let fetchCalled = false
    const fetchFn = async () => {
      fetchCalled = true
      return new Response('', { status: 200 })
    }
    const result = await minimaxProfile.fetchModels({
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'k',
      fetchFn,
    })
    expect(fetchCalled).toBe(false)
    expect(result.success).toBe(true)
    expect(result.models.length).toBeGreaterThan(0)
    expect(result.models.every((m) => typeof m.id === 'string' && m.enabled === true)).toBe(true)
  })
})
