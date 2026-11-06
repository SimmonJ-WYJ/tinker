/**
 * Profile 契约验收测试
 *
 * 保证每个 ProviderType 在 registry 中有对应 profile，
 * 且 profile 必需字段齐全（防止后续新增 provider 时漏注册）。
 */
import { test, expect, describe } from 'bun:test'
import { ALL_PROVIDER_TYPES, getProfile, getAllProfiles } from '../index.ts'

describe('Profile 契约验收', () => {
  test('每个 ProviderType 都有对应 profile，且 providerType 字段自洽', () => {
    for (const type of ALL_PROVIDER_TYPES) {
      const profile = getProfile(type)
      expect(profile.providerType).toBe(type)
    }
  })

  test('每个 profile 都有必需方法字段', () => {
    for (const profile of getAllProfiles()) {
      expect(typeof profile.defaultProbeModel).toBe('function')
      expect(typeof profile.extraHeaders).toBe('function')
      expect(typeof profile.defaultCapabilities).toBe('function')
      expect(typeof profile.fetchModels).toBe('function')
    }
  })

  test('每个 profile 的 defaultCapabilities 返回完整 ChannelCapabilities', () => {
    for (const profile of getAllProfiles()) {
      const caps = profile.defaultCapabilities()
      expect(typeof caps.supportsPdfDocumentBlock).toBe('boolean')
    }
  })

  test('内置渠道提供默认探针，自定义渠道要求用户选择模型', () => {
    for (const profile of getAllProfiles()) {
      const model = profile.defaultProbeModel('https://example.com')
      expect(typeof model).toBe('string')
      if (profile.providerType.startsWith('custom-')) expect(model).toBe('')
      else expect(model.length).toBeGreaterThan(0)
    }
  })

  test('extraHeaders 返回对象（可能为空）', () => {
    for (const profile of getAllProfiles()) {
      const headers = profile.extraHeaders('https://example.com', 'k')
      expect(typeof headers).toBe('object')
      expect(headers).not.toBeNull()
    }
  })
})
