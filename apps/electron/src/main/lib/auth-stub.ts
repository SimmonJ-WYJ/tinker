// apps/electron/src/main/lib/auth-stub.ts
/**
 * 本地 stub 实现 - spec §七
 *
 * disk-based 模拟服务端：~/.asci/auth-stub/ 下 6 个 JSON 文件 + mail-outbox/
 * 接口与未来真服务端一一对应，服务端就绪后只换 main/index.ts 一处构造调用。
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes, randomUUID, createHmac } from 'node:crypto'
import type {
  AuthProvider,
  AuthErrorCode,
  LoginRequest,
  RegisterRequest,
  Result,
  User,
} from '@asci/shared'
import { checkPasswordPolicy, nowIso, nowMs, toIso, toMs } from '@asci/shared'
import { hashPassword, verifyPassword } from './auth-hash.ts'

// ─── disk schema ─────────────────────────────────────────────

interface StubCredentials {
  passwordHash: string
}

interface StubToken {
  uid: string
  email: string
  kind: 'email-verify' | 'password-reset'
  createdAt: string
  expiresAt: string
  used: boolean
}

interface StubSession {
  uid: string
  createdAt: string
  lastUsedAt: string
  rotatedFrom: string | null
  revokedAt: string | null
}

const FILE_USERS = 'users.json'
const FILE_CREDS = 'credentials.json'
const FILE_OAUTH_LINKS = 'oauth-links.json'
const FILE_VERIFY_TOKENS = 'email-verify-tokens.json'
const FILE_RESET_TOKENS = 'password-reset-tokens.json'
const FILE_SESSIONS = 'sessions.json'
const FILE_JWT_SECRET = '.dev-jwt-secret'
const DIR_MAIL_OUTBOX = 'mail-outbox'

const TTL_VERIFY_MS = 24 * 60 * 60 * 1000
const TTL_RESET_MS = 60 * 60 * 1000

const FIXTURE_UID = 'dev-fixture-uid-0001'
const FIXTURE_EMAIL = 'dev@asci.local'
const FIXTURE_PW = 'dev1234'

// ─── interface ───────────────────────────────────────────────

export interface AuthStubConfig {
  basePath: string
}

export interface AuthStub {
  init(): Promise<void>

  register(req: RegisterRequest): Promise<Result<{ uid: string; verifyToken: string }>>
  confirmEmailVerify(token: string): Promise<Result<void>>
  login(req: LoginRequest): Promise<Result<{ user: User; refreshToken: string }>>
  rotateRefreshToken(old: string): Promise<Result<{ accessToken: string; refreshToken: string }>>
  revokeRefreshToken(token: string): Promise<Result<void>>
  revokeAllSessions(uid: string): Promise<Result<void>>
  /** 删除账户（DO-3）：删 user/cred/oauth-link 记录 + revoke 全部 session */
  deleteAccount(uid: string): Promise<Result<void>>

  requestPasswordReset(email: string): Promise<Result<{ resetToken: string | null }>>
  confirmPasswordReset(token: string, newPassword: string): Promise<Result<void>>

  oauthExchange(
    provider: Exclude<AuthProvider, 'email'>,
    stubCode: string,
    fixture: { email: string; subjectId: string },  // stub 模式下"OAuth 同意页"传入的 fixture
  ): Promise<Result<{ user: User; refreshToken: string }>>

  getUserByEmail(email: string): Promise<User | null>
  getUserByUid(uid: string): Promise<User | null>
  ensureDevFixture(): Promise<User | null>

  writeMailOutbox(to: string, kind: 'verify' | 'reset', token: string): Promise<void>

  /** 给 auth-service 用于 token 文件落地 */
  mintAccessToken(uid: string): Promise<string>
  /** Profile 字段更新 */
  updateUser(uid: string, patch: Partial<Pick<User, 'nickname' | 'institution' | 'field' | 'preferredLanguage'>>): Promise<Result<User>>

  // 测试 hook
  __forceExpireToken(token: string): Promise<void>
}

// ─── 实现 ────────────────────────────────────────────────────

export function createAuthStub(config: AuthStubConfig): AuthStub {
  const base = config.basePath

  // helpers
  const fp = (name: string): string => path.join(base, name)

  async function readJson<T>(filename: string, fallback: T): Promise<T> {
    try {
      const buf = await fs.readFile(fp(filename), 'utf-8')
      return JSON.parse(buf) as T
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return fallback
      throw err
    }
  }

  async function writeJson(filename: string, data: unknown): Promise<void> {
    await fs.mkdir(base, { recursive: true })
    await fs.writeFile(fp(filename), JSON.stringify(data, null, 2), 'utf-8')
  }

  function err(code: AuthErrorCode, message: string): Result<never> {
    return { ok: false, error: { code, message } }
  }

  function ok<T>(value: T): Result<T> {
    return { ok: true, value }
  }

  function mintRandomToken(): string {
    return randomBytes(32).toString('base64url')
  }

  function nowISO(): string {
    return nowIso()
  }

  function isExpired(iso: string): boolean {
    return toMs(iso) < nowMs()
  }

  async function getJwtSecret(): Promise<string> {
    try {
      return await fs.readFile(fp(FILE_JWT_SECRET), 'utf-8')
    } catch {
      const secret = randomBytes(32).toString('base64url')
      await fs.mkdir(base, { recursive: true })
      await fs.writeFile(fp(FILE_JWT_SECRET), secret, 'utf-8')
      return secret
    }
  }

  async function mintAccessToken(uid: string): Promise<string> {
    // 类 JWT：header.payload.signature；stub 用 HMAC-SHA256 + 本地 secret
    const secret = await getJwtSecret()
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({
        sub: uid,
        iat: Math.floor(nowMs() / 1000),
        exp: Math.floor(nowMs() / 1000) + 15 * 60,  // 15 min
      }),
    ).toString('base64url')
    const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
    return `${header}.${payload}.${sig}`
  }

  async function createSessionFor(uid: string, rotatedFrom: string | null): Promise<{
    accessToken: string
    refreshToken: string
  }> {
    const refreshToken = mintRandomToken()
    const sessions = await readJson<Record<string, StubSession>>(FILE_SESSIONS, {})
    sessions[refreshToken] = {
      uid,
      createdAt: nowISO(),
      lastUsedAt: nowISO(),
      rotatedFrom,
      revokedAt: null,
    }
    await writeJson(FILE_SESSIONS, sessions)
    const accessToken = await mintAccessToken(uid)
    return { accessToken, refreshToken }
  }

  function userFromInternal(user: User): User {
    // shallow clone 防止外部改动污染内部状态
    return { ...user, linkedProviders: [...user.linkedProviders] }
  }

  // ─── public methods ─────────────────────────────────────

  return {
    async init() {
      await fs.mkdir(base, { recursive: true })
      await fs.mkdir(fp(DIR_MAIL_OUTBOX), { recursive: true })
    },

    async register(req) {
      const violations = checkPasswordPolicy(req.password)
      if (violations.length > 0) return err('weak-password', violations.map((v) => v.code).join(','))

      const users = await readJson<Record<string, User>>(FILE_USERS, {})
      const existing = Object.values(users).find((u) => u.email === req.email)
      if (existing) return err('email-already-exists', `email ${req.email} already exists`)

      const uid = `uid-${randomUUID()}`
      const user: User = {
        uid,
        email: req.email,
        emailVerified: false,
        nickname: req.nickname ?? null,
        avatarUrl: null,
        institution: req.institution ?? null,
        field: req.field ?? null,
        preferredLanguage: req.preferredLanguage ?? null,
        linkedProviders: ['email'],
        linkedOpenSciId: null,
        createdAt: nowISO(),
        lastLoginAt: nowISO(),
      }
      users[uid] = user
      await writeJson(FILE_USERS, users)

      const creds = await readJson<Record<string, StubCredentials>>(FILE_CREDS, {})
      creds[uid] = { passwordHash: await hashPassword(req.password) }
      await writeJson(FILE_CREDS, creds)

      // 生成验证 token + 写 mail outbox
      const verifyToken = mintRandomToken()
      const tokens = await readJson<Record<string, StubToken>>(FILE_VERIFY_TOKENS, {})
      tokens[verifyToken] = {
        uid,
        email: req.email,
        kind: 'email-verify',
        createdAt: nowISO(),
        expiresAt: toIso(nowMs() + TTL_VERIFY_MS),
        used: false,
      }
      await writeJson(FILE_VERIFY_TOKENS, tokens)
      await this.writeMailOutbox(req.email, 'verify', verifyToken)

      return ok({ uid, verifyToken })
    },

    async confirmEmailVerify(token) {
      const tokens = await readJson<Record<string, StubToken>>(FILE_VERIFY_TOKENS, {})
      const entry = tokens[token]
      if (!entry || entry.used) return err('invalid-token', 'token not found or already used')
      if (isExpired(entry.expiresAt)) return err('token-expired', 'verify token expired')

      const users = await readJson<Record<string, User>>(FILE_USERS, {})
      const user = users[entry.uid]
      if (!user) return err('invalid-token', 'user gone')
      user.emailVerified = true
      await writeJson(FILE_USERS, users)

      entry.used = true
      tokens[token] = entry
      await writeJson(FILE_VERIFY_TOKENS, tokens)
      return ok(undefined)
    },

    async login(req) {
      const users = await readJson<Record<string, User>>(FILE_USERS, {})
      const user = Object.values(users).find((u) => u.email === req.email)
      if (!user) return err('invalid-credentials', 'no such user')  // 防枚举

      const creds = await readJson<Record<string, StubCredentials>>(FILE_CREDS, {})
      const cred = creds[user.uid]
      if (!cred) return err('invalid-credentials', 'no creds (oauth-only user trying password)')

      const valid = await verifyPassword(req.password, cred.passwordHash)
      if (!valid) return err('invalid-credentials', 'bad password')

      if (!user.emailVerified) return err('email-not-verified', 'verify email first')

      user.lastLoginAt = nowISO()
      await writeJson(FILE_USERS, users)

      const { refreshToken } = await createSessionFor(user.uid, null)
      return ok({ user: userFromInternal(user), refreshToken })
    },

    async rotateRefreshToken(old) {
      const sessions = await readJson<Record<string, StubSession>>(FILE_SESSIONS, {})
      const oldSession = sessions[old]
      if (!oldSession || oldSession.revokedAt) {
        return err('invalid-token', 'refresh token not found or revoked')
      }
      // 立刻 revoke 旧的（U5）
      oldSession.revokedAt = nowISO()
      sessions[old] = oldSession
      await writeJson(FILE_SESSIONS, sessions)

      const { accessToken, refreshToken } = await createSessionFor(oldSession.uid, old)
      return ok({ accessToken, refreshToken })
    },

    async revokeRefreshToken(token) {
      const sessions = await readJson<Record<string, StubSession>>(FILE_SESSIONS, {})
      const s = sessions[token]
      if (s && !s.revokedAt) {
        s.revokedAt = nowISO()
        sessions[token] = s
        await writeJson(FILE_SESSIONS, sessions)
      }
      return ok(undefined)
    },

    async revokeAllSessions(uid) {
      const sessions = await readJson<Record<string, StubSession>>(FILE_SESSIONS, {})
      const now = nowISO()
      for (const [tok, s] of Object.entries(sessions)) {
        if (s.uid === uid && !s.revokedAt) {
          sessions[tok] = { ...s, revokedAt: now }
        }
      }
      await writeJson(FILE_SESSIONS, sessions)
      return ok(undefined)
    },

    async deleteAccount(uid) {
      // 删身份记录（users / credentials / oauth-links），不动任何本地研究库
      const users = await readJson<Record<string, User>>(FILE_USERS, {})
      if (users[uid]) {
        delete users[uid]
        await writeJson(FILE_USERS, users)
      }
      const creds = await readJson<Record<string, StubCredentials>>(FILE_CREDS, {})
      if (creds[uid]) {
        delete creds[uid]
        await writeJson(FILE_CREDS, creds)
      }
      const links = await readJson<Record<string, string>>(FILE_OAUTH_LINKS, {})
      let linksChanged = false
      for (const [key, linkedUid] of Object.entries(links)) {
        if (linkedUid === uid) {
          delete links[key]
          linksChanged = true
        }
      }
      if (linksChanged) await writeJson(FILE_OAUTH_LINKS, links)
      // 吊销该账户全部 session
      return this.revokeAllSessions(uid)
    },

    async requestPasswordReset(email) {
      const users = await readJson<Record<string, User>>(FILE_USERS, {})
      const user = Object.values(users).find((u) => u.email === email)
      if (!user) return ok({ resetToken: null })  // 防枚举

      const resetToken = mintRandomToken()
      const tokens = await readJson<Record<string, StubToken>>(FILE_RESET_TOKENS, {})
      tokens[resetToken] = {
        uid: user.uid,
        email,
        kind: 'password-reset',
        createdAt: nowISO(),
        expiresAt: toIso(nowMs() + TTL_RESET_MS),
        used: false,
      }
      await writeJson(FILE_RESET_TOKENS, tokens)
      await this.writeMailOutbox(email, 'reset', resetToken)
      return ok({ resetToken })
    },

    async confirmPasswordReset(token, newPassword) {
      const violations = checkPasswordPolicy(newPassword)
      if (violations.length > 0) return err('weak-password', violations.map((v) => v.code).join(','))

      const tokens = await readJson<Record<string, StubToken>>(FILE_RESET_TOKENS, {})
      const entry = tokens[token]
      if (!entry || entry.used) return err('invalid-token', 'token used or not found')
      if (isExpired(entry.expiresAt)) return err('token-expired', 'reset token expired')

      const creds = await readJson<Record<string, StubCredentials>>(FILE_CREDS, {})
      creds[entry.uid] = { passwordHash: await hashPassword(newPassword) }
      await writeJson(FILE_CREDS, creds)

      entry.used = true
      tokens[token] = entry
      await writeJson(FILE_RESET_TOKENS, tokens)
      return ok(undefined)
    },

    async oauthExchange(provider, _stubCode, fixture) {
      const linkKey = `${provider}:${fixture.subjectId}`
      const links = await readJson<Record<string, string>>(FILE_OAUTH_LINKS, {})
      const users = await readJson<Record<string, User>>(FILE_USERS, {})

      let user: User | undefined = links[linkKey] ? users[links[linkKey]] : undefined

      if (!user) {
        // 看邮箱是否已存在 → 链接到现有账户（U3）
        user = Object.values(users).find((u) => u.email === fixture.email)
      }

      if (!user) {
        // 新用户
        const uid = `uid-${randomUUID()}`
        user = {
          uid,
          email: fixture.email,
          emailVerified: true,  // OAuth 邮箱默认已验证
          nickname: null,
          avatarUrl: null,
          institution: null,
          field: null,
          preferredLanguage: null,
          linkedProviders: [provider],
          linkedOpenSciId: null,
          createdAt: nowISO(),
          lastLoginAt: nowISO(),
        }
        users[uid] = user
      } else {
        // 现有用户绑定新 provider
        if (!user.linkedProviders.includes(provider)) {
          user.linkedProviders = [...user.linkedProviders, provider]
        }
        user.lastLoginAt = nowISO()
      }

      links[linkKey] = user.uid
      users[user.uid] = user
      await writeJson(FILE_OAUTH_LINKS, links)
      await writeJson(FILE_USERS, users)

      const { refreshToken } = await createSessionFor(user.uid, null)
      return ok({ user: userFromInternal(user), refreshToken })
    },

    async getUserByEmail(email) {
      const users = await readJson<Record<string, User>>(FILE_USERS, {})
      return Object.values(users).find((u) => u.email === email) ?? null
    },

    async getUserByUid(uid) {
      const users = await readJson<Record<string, User>>(FILE_USERS, {})
      return users[uid] ?? null
    },

    async ensureDevFixture() {
      const users = await readJson<Record<string, User>>(FILE_USERS, {})
      if (users[FIXTURE_UID]) return userFromInternal(users[FIXTURE_UID])

      const user: User = {
        uid: FIXTURE_UID,
        email: FIXTURE_EMAIL,
        emailVerified: true,
        nickname: 'ASCI Dev',
        avatarUrl: null,
        institution: 'ASCI Dev Lab',
        field: 'Computer Science',
        preferredLanguage: 'zh',
        linkedProviders: ['email'],
        linkedOpenSciId: null,
        createdAt: nowISO(),
        lastLoginAt: nowISO(),
      }
      users[FIXTURE_UID] = user
      await writeJson(FILE_USERS, users)

      const creds = await readJson<Record<string, StubCredentials>>(FILE_CREDS, {})
      creds[FIXTURE_UID] = { passwordHash: await hashPassword(FIXTURE_PW) }
      await writeJson(FILE_CREDS, creds)

      return userFromInternal(user)
    },

    async writeMailOutbox(to, kind, token) {
      const slug = to.replace(/[^a-zA-Z0-9]/g, '_')
      const ts = nowISO().replace(/[:.]/g, '-')
      const filename = `${ts}-${kind}-${slug}.txt`
      const link = `asci://${kind === 'verify' ? 'verify' : 'reset'}?token=${token}`
      const subject =
        kind === 'verify' ? '验证你的 ASCI 账户邮箱' : '重置你的 ASCI 账户密码'
      const body = `To: ${to}
From: ASCI <noreply@asci.local>
Subject: ${subject}
Date: ${nowISO()}

点击下面的链接${kind === 'verify' ? '验证你的邮箱' : '重置你的密码'}：

${link}

如果按钮无法点击，请复制完整链接到地址栏。
${kind === 'verify' ? '(24 小时内有效)' : '(1 小时内有效)'}

—— ASCI 团队
`
      await fs.writeFile(path.join(base, DIR_MAIL_OUTBOX, filename), body, 'utf-8')
    },

    mintAccessToken: (uid) => mintAccessToken(uid),

    async updateUser(uid, patch) {
      const users = await readJson<Record<string, User>>(FILE_USERS, {})
      const user = users[uid]
      if (!user) return err('invalid-token', 'user not found')
      const updated: User = {
        ...user,
        ...(patch.nickname !== undefined && { nickname: patch.nickname }),
        ...(patch.institution !== undefined && { institution: patch.institution }),
        ...(patch.field !== undefined && { field: patch.field }),
        ...(patch.preferredLanguage !== undefined && { preferredLanguage: patch.preferredLanguage }),
      }
      users[uid] = updated
      await writeJson(FILE_USERS, users)
      return ok(userFromInternal(updated))
    },

    async __forceExpireToken(token) {
      const tokens = await readJson<Record<string, StubToken>>(FILE_VERIFY_TOKENS, {})
      if (tokens[token]) {
        tokens[token].expiresAt = toIso(nowMs() - 1000)
        await writeJson(FILE_VERIFY_TOKENS, tokens)
      }
      const reset = await readJson<Record<string, StubToken>>(FILE_RESET_TOKENS, {})
      if (reset[token]) {
        reset[token].expiresAt = toIso(nowMs() - 1000)
        await writeJson(FILE_RESET_TOKENS, reset)
      }
    },
  }
}
