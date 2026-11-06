/**
 * auth-opensci-client 纯逻辑单测（OpensciProfile claims v1 → User 映射）
 *
 * loopback / token 交换网络与存储副作用依赖 Electron，不在此单测覆盖（见 auth-oidc.test.ts 覆盖纯解析）。
 */

import { describe, test, expect, it } from 'bun:test'
import { opensciProfileToUser, getAsciServerBaseUrl } from './auth-opensci-client.ts'
import type { OpensciProfile } from './auth-oidc.ts'

const NOW_ISO = '2026-06-12T00:00:00.000Z'

function profile(overrides: Partial<OpensciProfile> = {}): OpensciProfile {
  return {
    uid: 'uid-1',
    authMethod: 'orcid',
    nickname: 'Nick',
    avatarUrl: 'https://x/a.png',
    syncedAt: 0,
    ...overrides,
  }
}

describe('opensciProfileToUser（claims v1）', () => {
  test('字段映射：uid→linkedOpenSciId，provider 固定 opensci；v1 无 email/机构/学科 → 空值收敛', () => {
    expect(opensciProfileToUser(profile(), NOW_ISO)).toEqual({
      uid: 'uid-1',
      email: '',
      emailVerified: true,
      nickname: 'Nick',
      avatarUrl: 'https://x/a.png',
      institution: null,
      field: null,
      preferredLanguage: null,
      linkedProviders: ['opensci'],
      linkedOpenSciId: 'uid-1',
      createdAt: NOW_ISO,
      lastLoginAt: NOW_ISO,
    })
  })

  test('首登缺 name/picture：昵称兜底 sub（profile 层已兜底）、头像 null', () => {
    const user = opensciProfileToUser(profile({ nickname: 'uid-1', avatarUrl: null }), NOW_ISO)
    expect(user.nickname).toBe('uid-1')
    expect(user.avatarUrl).toBeNull()
  })
})

describe('getAsciServerBaseUrl', () => {
  it('返回默认测试环境 base URL（带尾斜杠）', () => {
    const url = getAsciServerBaseUrl()
    expect(url).toBe('https://asci-test.opensci.io/')
  })
})
