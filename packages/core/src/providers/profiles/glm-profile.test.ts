import { test, expect, describe } from 'bun:test'
import { glmProfile } from './glm-profile.ts'

const BASE_URL = 'https://open.bigmodel.cn/api/anthropic'

describe('glmProfile', () => {
  test('providerType 为 glm', () => {
    expect(glmProfile.providerType).toBe('glm')
  })

  test('defaultProbeModel 返回 glm-4.6', () => {
    expect(glmProfile.defaultProbeModel(BASE_URL)).toBe('glm-4.6')
  })

  test('defaultCapabilities 支持 PDF document block', () => {
    expect(glmProfile.defaultCapabilities()).toEqual({ supportsPdfDocumentBlock: true })
  })

  test('fetchModels 远程 ∪ seed 按 id 去重合并', async () => {
    const fetchFn = async (url: string, init?: { headers?: Record<string, string> }) => {
      expect(url).toBe('https://open.bigmodel.cn/api/anthropic/v1/models')
      expect(init?.headers?.['Authorization']).toBe('Bearer k')
      return new Response(
        JSON.stringify({
          data: [
            { id: 'glm-4.6', display_name: 'GLM-4.6 (remote)' }, // 与 seed 重复 → 去重，保留 seed 展示名
            { id: 'glm-4.7-flash', display_name: 'GLM-4.7-Flash' }, // 远程独有 → 追加
          ],
        }),
        { status: 200 },
      )
    }
    const result = await glmProfile.fetchModels({ baseUrl: BASE_URL, apiKey: 'k', fetchFn })
    expect(result.success).toBe(true)
    const ids = result.models.map((m) => m.id)
    // 4 个 seed + 1 个远程独有，glm-4.6 不重复
    expect(ids).toEqual(['glm-4.7', 'glm-4.6', 'glm-4.5', 'glm-4.5-air', 'glm-4.7-flash'])
    // seed 的展示名优先于远程
    expect(result.models.find((m) => m.id === 'glm-4.6')?.name).toBe('GLM-4.6')
  })

  test('fetchModels 远程非 2xx 回退到 seed 清单（success=true）', async () => {
    const fetchFn = async () => new Response('not found', { status: 404 })
    const result = await glmProfile.fetchModels({ baseUrl: BASE_URL, apiKey: 'k', fetchFn })
    expect(result.success).toBe(true)
    expect(result.models.map((m) => m.id)).toEqual(['glm-4.7', 'glm-4.6', 'glm-4.5', 'glm-4.5-air'])
  })

  test('fetchModels 网络异常回退到 seed 清单（success=true）', async () => {
    const fetchFn = async () => {
      throw new Error('network down')
    }
    const result = await glmProfile.fetchModels({ baseUrl: BASE_URL, apiKey: 'k', fetchFn })
    expect(result.success).toBe(true)
    expect(result.models.length).toBe(4)
  })

  test('fetchModels 401 返回 API Key 无效', async () => {
    const fetchFn = async () => new Response('bad', { status: 401 })
    const result = await glmProfile.fetchModels({ baseUrl: BASE_URL, apiKey: 'bad', fetchFn })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/API Key 无效|无效/)
  })
})
