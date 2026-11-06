import { test, expect, describe } from 'bun:test'
import { getProfile, getAllProfiles } from './profile-registry.ts'
import { ALL_PROVIDER_TYPES } from './profile.ts'

describe('profileRegistry', () => {
  test('getProfile 返回每个 ProviderType 对应的 profile', () => {
    for (const provider of ALL_PROVIDER_TYPES) {
      const profile = getProfile(provider)
      expect(profile.providerType).toBe(provider)
    }
  })

  test('getProfile 对未注册的 provider 抛出明确错误', () => {
    // @ts-expect-error 故意传入非法值，验证抛错路径
    expect(() => getProfile('nonexistent')).toThrow(/不支持的供应商/)
  })

  test('getAllProfiles 返回与 ALL_PROVIDER_TYPES 一一对应的 profile', () => {
    const profiles = getAllProfiles()
    expect(profiles.length).toBe(ALL_PROVIDER_TYPES.length)
    const types = profiles.map((p) => p.providerType).sort()
    expect(types).toEqual([...ALL_PROVIDER_TYPES].sort())
  })
})
