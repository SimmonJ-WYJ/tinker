// apps/electron/src/renderer/lib/auth/auth-form-helpers.test.ts
import { test, expect, describe } from 'bun:test'
import { validateRegisterForm, validateLoginForm, parseAuthError } from './auth-form-helpers.ts'

describe('validateRegisterForm', () => {
  test('合法表单 → 无错误', () => {
    expect(
      validateRegisterForm({ email: 'a@x.com', password: 'pw123abc', confirmPassword: 'pw123abc' }),
    ).toEqual([])
  })
  test('邮箱格式错', () => {
    const errs = validateRegisterForm({
      email: 'notanemail',
      password: 'pw123abc',
      confirmPassword: 'pw123abc',
    })
    expect(errs.map((e) => e.field)).toContain('email')
  })
  test('两次密码不一致', () => {
    const errs = validateRegisterForm({
      email: 'a@x.com',
      password: 'pw123abc',
      confirmPassword: 'different',
    })
    expect(errs.map((e) => e.field)).toContain('confirmPassword')
  })
  test('弱密码', () => {
    const errs = validateRegisterForm({
      email: 'a@x.com',
      password: 'weak',
      confirmPassword: 'weak',
    })
    expect(errs.map((e) => e.field)).toContain('password')
  })
})

describe('validateLoginForm', () => {
  test('合法', () => {
    expect(validateLoginForm({ email: 'a@x.com', password: 'pw123abc' })).toEqual([])
  })
  test('空邮箱', () => {
    expect(validateLoginForm({ email: '', password: 'pw' }).map((e) => e.field)).toContain('email')
  })
})

describe('parseAuthError', () => {
  test('已知 code → 对应 i18n key', () => {
    expect(parseAuthError({ code: 'invalid-credentials', message: '' })).toBe(
      'auth:errors.invalid-credentials',
    )
  })
  test('未知 code → fallback unknown', () => {
    // @ts-expect-error 测试鲁棒性
    expect(parseAuthError({ code: 'never-seen', message: '' })).toBe('auth:errors.unknown')
  })
})
