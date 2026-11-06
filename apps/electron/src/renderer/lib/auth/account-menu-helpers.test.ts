// apps/electron/src/renderer/lib/auth/account-menu-helpers.test.ts
import { test, expect, describe } from 'bun:test'
import { formatUserDisplay, formatAvatarFallback } from './account-menu-helpers.ts'
import type { User } from '@asci/shared'

function mockUser(over: Partial<User> = {}): User {
  return {
    uid: 'u1',
    email: 'alice@example.com',
    emailVerified: true,
    nickname: null,
    avatarUrl: null,
    institution: null,
    field: null,
    preferredLanguage: null,
    linkedProviders: ['email'],
    linkedOpenSciId: null,
    createdAt: '',
    lastLoginAt: '',
    ...over,
  }
}

describe('formatUserDisplay', () => {
  test('nickname 优先', () => {
    expect(formatUserDisplay(mockUser({ nickname: 'Alice' }))).toBe('Alice')
  })
  test('无 nickname fallback 邮箱本地部分', () => {
    expect(formatUserDisplay(mockUser({ nickname: null }))).toBe('alice')
  })
})

describe('formatAvatarFallback', () => {
  test('nickname 首字符', () => {
    expect(formatAvatarFallback(mockUser({ nickname: 'Bob' }))).toBe('B')
  })
  test('fallback 邮箱首字符', () => {
    expect(formatAvatarFallback(mockUser({ nickname: null }))).toBe('A')
  })
})
