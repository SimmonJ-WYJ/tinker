// packages/shared/src/auth-password-policy.test.ts
import { test, expect, describe } from 'bun:test'
import { checkPasswordPolicy } from './auth-password-policy.ts'

describe('checkPasswordPolicy', () => {
  test('8 位以下返回 too-short', () => {
    const r = checkPasswordPolicy('abc12')
    expect(r.map((v) => v.code)).toContain('too-short')
  })

  test('长度 7 (boundary - 1) 返回 too-short', () => {
    const r = checkPasswordPolicy('abc1234')  // exactly 7 chars
    expect(r.map((v) => v.code)).toContain('too-short')
  })

  test('纯字母返回 missing-digit', () => {
    const r = checkPasswordPolicy('abcdefgh')
    expect(r.map((v) => v.code)).toContain('missing-digit')
  })

  test('纯数字返回 missing-letter', () => {
    const r = checkPasswordPolicy('12345678')
    expect(r.map((v) => v.code)).toContain('missing-letter')
  })

  test('字母+数字 ≥ 8 位通过', () => {
    expect(checkPasswordPolicy('abcd1234')).toHaveLength(0)
  })

  test('强密码多种字符', () => {
    expect(checkPasswordPolicy('Str0ng!Pass')).toHaveLength(0)
  })

  test('空字符串多违反', () => {
    const r = checkPasswordPolicy('')
    expect(r.map((v) => v.code)).toEqual(
      expect.arrayContaining(['too-short', 'missing-letter', 'missing-digit']),
    )
  })
})
