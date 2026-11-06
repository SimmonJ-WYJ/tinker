import { test, expect, describe } from 'bun:test'
import { kimiProfile } from './kimi-profile.ts'

describe('kimiProfile', () => {
  test('providerType 为 kimi', () => {
    expect(kimiProfile.providerType).toBe('kimi')
  })

  test('defaultCapabilities PDF document block 关闭', () => {
    expect(kimiProfile.defaultCapabilities()).toEqual({ supportsPdfDocumentBlock: false })
  })

  test('validateEndpoint：标准 /coding 端点合法', () => {
    expect(kimiProfile.validateEndpoint!('https://api.kimi.com/coding')).toEqual({ ok: true })
  })

  test('validateEndpoint：/coding/v1 也合法', () => {
    expect(kimiProfile.validateEndpoint!('https://api.kimi.com/coding/v1')).toEqual({ ok: true })
  })

  test('validateEndpoint：非 kimi.com 主机不强制（返回 ok）', () => {
    expect(kimiProfile.validateEndpoint!('https://example.com/v1')).toEqual({ ok: true })
  })

  test('formatAuthError：有 body 时返回 i18n key + 截断的 detail snippet', () => {
    const result = kimiProfile.formatAuthError!('https://api.kimi.com/coding', '权限不足，请联系管理员')
    expect(result).toEqual({
      baseMessageKey: 'errors.channelTest.kimiCodeAuth',
      detailSnippet: '权限不足，请联系管理员',
    })
  })

  test('formatAuthError：空 body 时 detailSnippet 为 undefined', () => {
    const result = kimiProfile.formatAuthError!('https://api.kimi.com/coding', '')
    expect(result).toEqual({
      baseMessageKey: 'errors.channelTest.kimiCodeAuth',
      detailSnippet: undefined,
    })
  })

  test('formatAuthError：非 kimi.com 端点返回 null', () => {
    const result = kimiProfile.formatAuthError!('https://example.com/v1', '错误')
    expect(result).toBeNull()
  })

  test('formatAuthError：body 超过 150 字时截断 detailSnippet', () => {
    const longBody = 'x'.repeat(300)
    const result = kimiProfile.formatAuthError!('https://api.kimi.com/coding', longBody)
    expect(result?.detailSnippet?.length).toBe(150)
  })

  test('fetchModels 返回静态清单', async () => {
    const result = await kimiProfile.fetchModels({
      baseUrl: 'https://api.kimi.com/coding',
      apiKey: 'k',
      fetchFn: async () => new Response('', { status: 200 }),
    })
    expect(result.success).toBe(true)
    expect(result.models.length).toBeGreaterThan(0)
  })

  test('fetchModels 清单包含 kimi-for-coding', async () => {
    const result = await kimiProfile.fetchModels({
      baseUrl: 'https://api.kimi.com/coding',
      apiKey: 'k',
      fetchFn: async () => new Response('', { status: 200 }),
    })
    expect(result.models[0]).toEqual({ id: 'kimi-for-coding', name: 'Kimi for Coding', enabled: true })
  })
})
