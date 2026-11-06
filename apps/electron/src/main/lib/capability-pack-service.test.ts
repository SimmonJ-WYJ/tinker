import { describe, expect, test } from 'bun:test'

import { hasUsableSummary, isBuiltinMissingSummary } from './capability-pack-service.ts'

describe('hasUsableSummary', () => {
  test('任一语言非空 → true', () => {
    expect(hasUsableSummary({ zh: '摘要' })).toBe(true)
    expect(hasUsableSummary({ en: 'summary' })).toBe(true)
  })
  test('缺省 / 全空白 → false', () => {
    expect(hasUsableSummary(undefined)).toBe(false)
    expect(hasUsableSummary({})).toBe(false)
    expect(hasUsableSummary({ zh: '   ', en: '' })).toBe(false)
  })
})

describe('isBuiltinMissingSummary（安全边界 #710）', () => {
  test('内置包缺摘要 → true（应标 invalid，不回退路由 prompt）', () => {
    expect(isBuiltinMissingSummary('lit-search', undefined)).toBe(true)
    expect(isBuiltinMissingSummary('lit-review', { zh: '  ' })).toBe(true)
  })
  test('内置包有摘要 → false', () => {
    expect(isBuiltinMissingSummary('lit-search', { en: 'Find papers' })).toBe(false)
  })
  test('用户自建包不受约束（缺摘要也 false，UI 走中性占位）', () => {
    expect(isBuiltinMissingSummary('my-custom-pack', undefined)).toBe(false)
  })
})
