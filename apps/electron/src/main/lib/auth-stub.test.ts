// apps/electron/src/main/lib/auth-stub.test.ts
import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAuthStub, type AuthStub } from './auth-stub.ts'

let stubDir: string
let stub: AuthStub

beforeEach(async () => {
  stubDir = mkdtempSync(path.join(tmpdir(), 'asci-stub-'))
  stub = createAuthStub({ basePath: stubDir })
  await stub.init()
})

afterEach(() => {
  rmSync(stubDir, { recursive: true, force: true })
})

describe('register', () => {
  test('U2: 邮箱已存在 → email-already-exists', async () => {
    await stub.register({ email: 'a@x.com', password: 'pw123abc' })
    const r = await stub.register({ email: 'a@x.com', password: 'pw456def' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('email-already-exists')
  })

  test('U2: 弱密码 → weak-password', async () => {
    const r = await stub.register({ email: 'b@x.com', password: 'short' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('weak-password')
  })

  test('U2: 成功 → 返回 verifyToken, emailVerified=false', async () => {
    const r = await stub.register({ email: 'c@x.com', password: 'pw123abc' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.uid).toMatch(/^uid-/)
      expect(r.value.verifyToken).toHaveLength(43)  // base64url 32 bytes
    }
  })
})

describe('confirmEmailVerify', () => {
  test('U2: 有效 token → emailVerified=true', async () => {
    const reg = await stub.register({ email: 'd@x.com', password: 'pw123abc' })
    if (!reg.ok) throw new Error('register failed')
    const r = await stub.confirmEmailVerify(reg.value.verifyToken)
    expect(r.ok).toBe(true)
    const user = await stub.getUserByEmail('d@x.com')
    expect(user?.emailVerified).toBe(true)
  })

  test('U2: 二次使用 → invalid-token', async () => {
    const reg = await stub.register({ email: 'e@x.com', password: 'pw123abc' })
    if (!reg.ok) throw new Error('register failed')
    await stub.confirmEmailVerify(reg.value.verifyToken)
    const r2 = await stub.confirmEmailVerify(reg.value.verifyToken)
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('invalid-token')
  })

  test('U2: 未知 token → invalid-token', async () => {
    const r = await stub.confirmEmailVerify('nonexistent')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('invalid-token')
  })

  test('U2: 过期 token → token-expired', async () => {
    const reg = await stub.register({ email: 'f@x.com', password: 'pw123abc' })
    if (!reg.ok) throw new Error('register failed')
    // 通过 stub 测试 hook 把 token 设为已过期
    await stub.__forceExpireToken(reg.value.verifyToken)
    const r = await stub.confirmEmailVerify(reg.value.verifyToken)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('token-expired')
  })
})

describe('login', () => {
  test('U2: 未验证邮箱 → email-not-verified', async () => {
    await stub.register({ email: 'g@x.com', password: 'pw123abc' })
    const r = await stub.login({ email: 'g@x.com', password: 'pw123abc' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('email-not-verified')
  })

  test('U1: 密码错 → invalid-credentials', async () => {
    const reg = await stub.register({ email: 'h@x.com', password: 'pw123abc' })
    if (!reg.ok) throw new Error('register failed')
    await stub.confirmEmailVerify(reg.value.verifyToken)
    const r = await stub.login({ email: 'h@x.com', password: 'WRONG999' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('invalid-credentials')
  })

  test('U1: 邮箱不存在 → invalid-credentials（同密码错，防枚举）', async () => {
    const r = await stub.login({ email: 'noone@x.com', password: 'anything1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('invalid-credentials')
  })

  test('U1: 成功 → user + refreshToken', async () => {
    const reg = await stub.register({ email: 'i@x.com', password: 'pw123abc' })
    if (!reg.ok) throw new Error('register failed')
    await stub.confirmEmailVerify(reg.value.verifyToken)
    const r = await stub.login({ email: 'i@x.com', password: 'pw123abc' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.user.email).toBe('i@x.com')
      expect(r.value.refreshToken).toHaveLength(43)
    }
  })
})

describe('U5 refresh token rotation', () => {
  test('rotate 后旧 token 立即失效', async () => {
    const reg = await stub.register({ email: 'j@x.com', password: 'pw123abc' })
    if (!reg.ok) throw new Error('register failed')
    await stub.confirmEmailVerify(reg.value.verifyToken)
    const login = await stub.login({ email: 'j@x.com', password: 'pw123abc' })
    if (!login.ok) throw new Error('login failed')
    const refreshA = login.value.refreshToken

    const rot = await stub.rotateRefreshToken(refreshA)
    expect(rot.ok).toBe(true)
    if (!rot.ok) throw new Error('rotate failed')
    const refreshB = rot.value.refreshToken
    expect(refreshB).not.toEqual(refreshA)

    // 旧 token 再用 → 失败
    const rot2 = await stub.rotateRefreshToken(refreshA)
    expect(rot2.ok).toBe(false)
    if (!rot2.ok) expect(rot2.error.code).toBe('invalid-token')
  })
})

describe('U3 同邮箱多 OAuth 绑定', () => {
  test('Google → ORCID 同邮箱 → 同账户', async () => {
    const a = await stub.oauthExchange('google', 'stub-code', { email: 'k@x.com', subjectId: 'g123' })
    const b = await stub.oauthExchange('orcid', 'stub-code', { email: 'k@x.com', subjectId: 'o456' })
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(b.value.user.uid).toEqual(a.value.user.uid)
      expect(b.value.user.linkedProviders).toContain('google')
      expect(b.value.user.linkedProviders).toContain('orcid')
    }
  })
})

describe('OWASP password reset', () => {
  test('未知邮箱 requestPasswordReset → ok=true, token=null', async () => {
    const r = await stub.requestPasswordReset('noone@x.com')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.resetToken).toBeNull()
  })

  test('已知邮箱 → ok=true, token 非 null', async () => {
    const reg = await stub.register({ email: 'l@x.com', password: 'pw123abc' })
    if (!reg.ok) throw new Error()
    await stub.confirmEmailVerify(reg.value.verifyToken)
    const r = await stub.requestPasswordReset('l@x.com')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.resetToken).not.toBeNull()
  })

  test('confirmPasswordReset 二次使用 → invalid-token', async () => {
    const reg = await stub.register({ email: 'm@x.com', password: 'pw123abc' })
    if (!reg.ok) throw new Error()
    await stub.confirmEmailVerify(reg.value.verifyToken)
    const req = await stub.requestPasswordReset('m@x.com')
    if (!req.ok || !req.value.resetToken) throw new Error()
    await stub.confirmPasswordReset(req.value.resetToken, 'newpw123')
    const second = await stub.confirmPasswordReset(req.value.resetToken, 'another1')
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.code).toBe('invalid-token')
  })
})

describe('ensureDevFixture 幂等', () => {
  test('多次调用不重复创建', async () => {
    const f1 = await stub.ensureDevFixture()
    const f2 = await stub.ensureDevFixture()
    expect(f1?.uid).toEqual(f2?.uid)
    expect(f1?.uid).toBe('dev-fixture-uid-0001')
  })
})

describe('updateUser', () => {
  test('更新 nickname / institution 持久化', async () => {
    const reg = await stub.register({ email: 'u@x.com', password: 'pw123abc' })
    if (!reg.ok) throw new Error()
    const r = await stub.updateUser(reg.value.uid, { nickname: 'Updated', institution: 'MIT' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.nickname).toBe('Updated')
      expect(r.value.institution).toBe('MIT')
    }
    const fresh = await stub.getUserByUid(reg.value.uid)
    expect(fresh?.nickname).toBe('Updated')
  })

  test('未知 uid → invalid-token', async () => {
    const r = await stub.updateUser('nonexistent-uid', { nickname: 'X' })
    expect(r.ok).toBe(false)
  })
})

describe('deleteAccount (DO-3)', () => {
  test('删除后用户记录消失 + session 全 revoke', async () => {
    const reg = await stub.register({ email: 'del@x.com', password: 'pw123abc' })
    if (!reg.ok) throw new Error('register failed')
    await stub.confirmEmailVerify(reg.value.verifyToken)
    const login = await stub.login({ email: 'del@x.com', password: 'pw123abc' })
    if (!login.ok) throw new Error('login failed')
    const refresh = login.value.refreshToken

    const r = await stub.deleteAccount(reg.value.uid)
    expect(r.ok).toBe(true)

    // 用户记录已删
    expect(await stub.getUserByUid(reg.value.uid)).toBeNull()
    expect(await stub.getUserByEmail('del@x.com')).toBeNull()

    // session 已 revoke：refresh token 不再可旋转
    const rot = await stub.rotateRefreshToken(refresh)
    expect(rot.ok).toBe(false)
    if (!rot.ok) expect(rot.error.code).toBe('invalid-token')

    // 凭据已删：原密码无法再登录
    const relogin = await stub.login({ email: 'del@x.com', password: 'pw123abc' })
    expect(relogin.ok).toBe(false)
  })

  test('删除 OAuth 绑定账户 → 链接清除', async () => {
    const a = await stub.oauthExchange('google', 'stub-code', { email: 'oauthdel@x.com', subjectId: 'g999' })
    if (!a.ok) throw new Error('oauth failed')
    const r = await stub.deleteAccount(a.value.user.uid)
    expect(r.ok).toBe(true)
    expect(await stub.getUserByUid(a.value.user.uid)).toBeNull()
    // 同 subject 再登录 → 视为全新用户（不复用旧 uid）
    const b = await stub.oauthExchange('google', 'stub-code', { email: 'oauthdel@x.com', subjectId: 'g999' })
    expect(b.ok).toBe(true)
    if (b.ok) expect(b.value.user.uid).not.toBe(a.value.user.uid)
  })

  test('未知 uid → ok（幂等，无可删即视为已删）', async () => {
    const r = await stub.deleteAccount('nonexistent-uid')
    expect(r.ok).toBe(true)
  })
})

describe('mintAccessToken', () => {
  test('返回三段 JWT 格式', async () => {
    const t = await stub.mintAccessToken('any-uid')
    expect(t.split('.')).toHaveLength(3)
  })

  test('payload 含 sub uid', async () => {
    const t = await stub.mintAccessToken('uid-xyz')
    const [, payloadB64] = t.split('.')
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
    expect(payload.sub).toBe('uid-xyz')
  })
})
