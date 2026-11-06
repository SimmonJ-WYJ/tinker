// apps/electron/src/main/lib/auth-deeplink-parser.test.ts
import { test, expect, describe } from 'bun:test'
import { parseAsciUrl } from './auth-deeplink-parser.ts'

describe('parseAsciUrl', () => {
  test('OAuth callback 完整参数', () => {
    const r = parseAsciUrl('asci://oauth/callback?code=abc&state=xyz')
    expect(r).toEqual({ kind: 'oauth-callback', code: 'abc', state: 'xyz', error: null })
  })

  test('OAuth callback error 参数', () => {
    const r = parseAsciUrl('asci://oauth/callback?error=access_denied&state=xyz')
    expect(r).toEqual({ kind: 'oauth-callback', code: null, state: 'xyz', error: 'access_denied' })
  })

  test('verify 完整', () => {
    expect(parseAsciUrl('asci://verify?token=tk123')).toEqual({ kind: 'verify', token: 'tk123' })
  })

  test('reset 完整', () => {
    expect(parseAsciUrl('asci://reset?token=rt456')).toEqual({ kind: 'reset', token: 'rt456' })
  })

  test('verify 缺 token 返回 null', () => {
    expect(parseAsciUrl('asci://verify')).toBeNull()
  })

  test('未知 host 返回 null', () => {
    expect(parseAsciUrl('asci://unknown/path?x=1')).toBeNull()
  })

  test('非 asci:// scheme 返回 null', () => {
    expect(parseAsciUrl('https://example.com/x')).toBeNull()
  })

  test('畸形 URL 不抛异常返回 null', () => {
    expect(parseAsciUrl('not a url')).toBeNull()
    expect(parseAsciUrl('asci://')).toBeNull()
  })
})
