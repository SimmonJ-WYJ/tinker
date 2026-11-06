/**
 * skill-defaults 白名单常量与检查函数
 *
 * 验证新工作区初始启用策略：仅 'default' + 'general' 两个 category
 * 默认启用，其它 category 及无 category 的 skill 默认禁用。
 */

import { test, expect } from 'bun:test'
import { DEFAULT_ENABLED_CATEGORIES, isCategoryEnabledByDefault } from './skill-defaults'

test('DEFAULT_ENABLED_CATEGORIES 固定为 default + general', () => {
  expect(DEFAULT_ENABLED_CATEGORIES).toEqual(['default', 'general'])
})

test("isCategoryEnabledByDefault('default') === true", () => {
  expect(isCategoryEnabledByDefault('default')).toBe(true)
})

test("isCategoryEnabledByDefault('general') === true", () => {
  expect(isCategoryEnabledByDefault('general')).toBe(true)
})

test("isCategoryEnabledByDefault('custom') === false", () => {
  expect(isCategoryEnabledByDefault('custom')).toBe(false)
})

test('isCategoryEnabledByDefault 空值回退到 custom，返回 false', () => {
  expect(isCategoryEnabledByDefault('')).toBe(false)
  expect(isCategoryEnabledByDefault(undefined as unknown as string)).toBe(false)
})

test("isCategoryEnabledByDefault 对未知 category 返回 false", () => {
  expect(isCategoryEnabledByDefault('biology')).toBe(false)
  expect(isCategoryEnabledByDefault('machine-learning')).toBe(false)
})
