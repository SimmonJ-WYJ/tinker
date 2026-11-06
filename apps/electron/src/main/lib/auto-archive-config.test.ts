import { test, expect } from 'bun:test'
import { resolveArchiveDays } from './auto-archive-config.ts'

test('archiveAfterDays 缺省(undefined) → 0(Disabled,新用户场景)', () => {
  expect(resolveArchiveDays({})).toBe(0)
})

test('archiveAfterDays 显式为 0 → 0(用户主动禁用)', () => {
  expect(resolveArchiveDays({ archiveAfterDays: 0 })).toBe(0)
})

test('archiveAfterDays 显式正整数 → 原值', () => {
  expect(resolveArchiveDays({ archiveAfterDays: 7 })).toBe(7)
  expect(resolveArchiveDays({ archiveAfterDays: 30 })).toBe(30)
})
