// apps/electron/src/main/lib/auth-service.test.ts
/**
 * AuthService.deleteAccount（DO-3）编排测试
 *
 * 聚焦删除流程的本地态副作用与失败回退（spec §4.2 D8）：
 *  - 成功 → 清 token + 发 account-deleted 事件
 *  - 服务端失败 → 保留本地态、不发事件（让用户重试）
 * 用最小 fake stub / tokenStore 注入，不触达真实磁盘 / OIDC。
 */
import { test, expect, describe, mock, afterAll } from 'bun:test'
import type { AuthStateChangedEvent, Result, User } from '@asci/shared'
import type { AuthStub } from './auth-stub.ts'
import type { AuthTokenStore, StoredTokens } from './auth-token-store.ts'
import type { AuthDeeplinkHandler } from './auth-deeplink.ts'
import type { OpensciAuthClient } from './auth-opensci-client.ts'

// bun runtime 无 Electron context：stub 掉 auth-service / auth-dev-bypass 用到的 electron API
mock.module('electron', () => ({
  BrowserWindow: class {},
  shell: { openExternal: async () => {} },
  safeStorage: { isEncryptionAvailable: () => false },
  app: { isPackaged: false, getPath: () => '/tmp/asci-test' },
}))

// 动态 import，确保 mock.module 在 AuthService 解析 electron 之前生效
const { AuthService } = await import('./auth-service.ts')

// 还原 mock，避免 electron stub 跨测试文件泄漏
afterAll(() => mock.restore())

const FAKE_USER: User = {
  uid: 'uid-test-001',
  email: 't@x.com',
  emailVerified: true,
  nickname: 'T',
  avatarUrl: null,
  institution: null,
  field: null,
  preferredLanguage: null,
  linkedProviders: ['email'],
  linkedOpenSciId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: '2026-01-01T00:00:00.000Z',
}

function makeFakeTokenStore(): AuthTokenStore & { cleared: boolean; saved: StoredTokens | null } {
  let saved: StoredTokens | null = null
  return {
    cleared: false,
    get saved() {
      return saved
    },
    async save(t) {
      saved = t
    },
    async getAll() {
      return saved
    },
    async getAccessToken() {
      return saved?.accessToken ?? null
    },
    async getRefreshToken() {
      return saved?.refreshToken ?? null
    },
    async getObtainedAt() {
      return saved?.obtainedAt ?? null
    },
    async clear() {
      saved = null
      ;(this as { cleared: boolean }).cleared = true
    },
  }
}

/** 只实现 login / mintAccessToken / deleteAccount，其余抛错（本测试不触达） */
function makeFakeStub(deleteResult: Result<void>): AuthStub & { deletedUid: string | null } {
  return {
    deletedUid: null,
    async login() {
      return { ok: true, value: { user: FAKE_USER, refreshToken: 'refresh-xyz' } }
    },
    async mintAccessToken() {
      return 'header.payload.sig'
    },
    async deleteAccount(uid: string) {
      ;(this as { deletedUid: string | null }).deletedUid = uid
      return deleteResult
    },
  } as unknown as AuthStub & { deletedUid: string | null }
}

const NOOP_DEEPLINK: AuthDeeplinkHandler = {
  start() {},
  cancel() {},
  markRendererReady() {},
} as unknown as AuthDeeplinkHandler

function makeService(stub: AuthStub, events: AuthStateChangedEvent[], tokenStore: AuthTokenStore): AuthService {
  return new AuthService({
    tokenStore,
    stub,
    deeplink: NOOP_DEEPLINK,
    mainWindow: () => null,
    userDataPath: '/tmp/asci-test',
    onAuthStateChanged: (e) => events.push(e),
  })
}

/**
 * 冷启动并发刷新去重（issue #699）：主进程 on-ready 与渲染进程 useInitAuth 在同一实例上
 * 并发各调一次 getCurrentUser，access 已过期时不得对同一 refresh token 双刷。
 */
function makeFakeOpensciClient(refreshDelayMs = 0): OpensciAuthClient & {
  refreshCalls: string[]
} {
  const refreshCalls: string[] = []
  let cached: User | null = FAKE_USER
  return {
    refreshCalls,
    async refreshTokens(refreshToken: string) {
      refreshCalls.push(refreshToken)
      if (refreshDelayMs > 0) await new Promise((r) => setTimeout(r, refreshDelayMs))
      return {
        ok: true,
        value: {
          accessToken: 'new-access',
          refreshToken: `rotated-${refreshCalls.length}`,
          idToken: null,
          expiresAt: Date.now() + 3_600_000,
        },
      }
    },
    getCachedUser() {
      return cached
    },
    clearCachedUser() {
      cached = null
    },
  } as unknown as OpensciAuthClient & { refreshCalls: string[] }
}

function makeOidcService(
  client: OpensciAuthClient,
  tokenStore: AuthTokenStore,
): AuthService {
  return new AuthService({
    tokenStore,
    opensciClient: client,
    deeplink: NOOP_DEEPLINK,
    mainWindow: () => null,
    userDataPath: '/tmp/asci-test',
  })
}

describe('OIDC 冷启动并发刷新去重 (single-flight, #699)', () => {
  test('并发两次 getCurrentUser 对同一过期 token 只刷一次', async () => {
    const client = makeFakeOpensciClient(20) // 留刷新窗口让第二个调用撞上在飞 promise
    const tokenStore = makeFakeTokenStore()
    await tokenStore.save({
      accessToken: 'expired-access',
      refreshToken: 'R0',
      obtainedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: Date.now() - 60_000, // 已过期 → 走刷新
    })
    const svc = makeOidcService(client, tokenStore)

    const [a, b] = await Promise.all([svc.getCurrentUser(), svc.getCurrentUser()])

    expect(client.refreshCalls).toEqual(['R0']) // 只发一次刷新，且用的是同一个 R0
    expect(a.ok && a.value?.uid).toBe(FAKE_USER.uid)
    expect(b.ok && b.value?.uid).toBe(FAKE_USER.uid)
    expect(tokenStore.saved?.refreshToken).toBe('rotated-1') // 旋转结果落库一次
  })

  test('串行两次刷新（in-flight 已清）各发一次', async () => {
    const client = makeFakeOpensciClient(0)
    const tokenStore = makeFakeTokenStore()
    await tokenStore.save({
      accessToken: 'expired-access',
      refreshToken: 'R0',
      obtainedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: Date.now() - 60_000,
    })
    const svc = makeOidcService(client, tokenStore)

    await svc.refresh()
    // 第二次刷新读到的是上一次旋转出的新 token（rotated-1），属不同 token → 正常再刷一次
    await svc.refresh()

    expect(client.refreshCalls).toEqual(['R0', 'rotated-1'])
  })
})

describe('getValidAccessToken', () => {
  test('未登录（无 token）→ null', async () => {
    // tokenStore 默认 saved = null，模拟未登录态
    const client = makeFakeOpensciClient()
    const tokenStore = makeFakeTokenStore()
    const svc = makeOidcService(client, tokenStore)
    expect(await svc.getValidAccessToken()).toBeNull()
  })

  test('token 未过期：直接返回，不触发 refresh', async () => {
    const client = makeFakeOpensciClient()
    const tokenStore = makeFakeTokenStore()
    // 存入未过期 token
    await tokenStore.save({
      accessToken: 'good-token',
      refreshToken: 'r',
      obtainedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: Date.now() + 600_000, // 10 分钟后过期
    })
    const svc = makeOidcService(client, tokenStore)
    const result = await svc.getValidAccessToken()
    expect(result).toBe('good-token')
    // 未过期不应发刷新请求
    expect(client.refreshCalls).toHaveLength(0)
  })

  test('token 已过期：先 refresh，再返回刷新后的 token', async () => {
    const client = makeFakeOpensciClient()
    const tokenStore = makeFakeTokenStore()
    // 存入已过期 token
    await tokenStore.save({
      accessToken: 'stale-token',
      refreshToken: 'R0',
      obtainedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: Date.now() - 1_000, // 1 秒前已过期
    })
    const svc = makeOidcService(client, tokenStore)
    const result = await svc.getValidAccessToken()
    // refresh 触发了一次（用 stale refreshToken R0）
    expect(client.refreshCalls).toEqual(['R0'])
    // 刷新后 store 存入新 access token（makeFakeOpensciClient 返回 'new-access'）
    expect(result).toBe('new-access')
  })
})

describe('deleteAccount (DO-3)', () => {
  test('未登录 → invalid-credentials', async () => {
    const svc = makeService(makeFakeStub({ ok: true, value: undefined }), [], makeFakeTokenStore())
    const r = await svc.deleteAccount()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('invalid-credentials')
  })

  test('stub 路径成功 → 清 token + 发 account-deleted', async () => {
    const events: AuthStateChangedEvent[] = []
    const tokenStore = makeFakeTokenStore()
    const stub = makeFakeStub({ ok: true, value: undefined })
    const svc = makeService(stub, events, tokenStore)

    await svc.login({ email: 't@x.com', password: 'pw' })
    expect(tokenStore.saved).not.toBeNull()

    const r = await svc.deleteAccount()
    expect(r.ok).toBe(true)
    expect(stub.deletedUid).toBe(FAKE_USER.uid)
    expect(tokenStore.cleared).toBe(true)
    expect(events.map((e) => e.type)).toEqual(['login-success', 'account-deleted'])
  })

  test('服务端删除失败 → 保留本地态、不发事件（可重试）', async () => {
    const events: AuthStateChangedEvent[] = []
    const tokenStore = makeFakeTokenStore()
    const stub = makeFakeStub({ ok: false, error: { code: 'network-error', message: 'offline' } })
    const svc = makeService(stub, events, tokenStore)

    await svc.login({ email: 't@x.com', password: 'pw' })
    const r = await svc.deleteAccount()

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('network-error')
    expect(tokenStore.cleared).toBe(false)
    expect(tokenStore.saved).not.toBeNull()
    expect(events.map((e) => e.type)).toEqual(['login-success']) // 无 account-deleted
  })
})

describe('Google session isolation', () => {
  test('Google token never reaches OPENSCI journal or developer IPC', async () => {
    const store = makeFakeTokenStore()
    await store.save({ accessToken: 'google-secret', refreshToken: 'refresh', obtainedAt: '2026-01-01' })
    const service = new AuthService({ tokenStore: store, googleClient: makeFakeOpensciClient(), deeplink: NOOP_DEEPLINK, mainWindow: () => null })
    expect(await service.getValidAccessToken()).toBeNull()
    expect(await service.getAccessTokenForDev()).toMatchObject({ ok: true, value: null })
  })
  test('missing Google profile never restores legacy stub access token', async () => {
    const store = makeFakeTokenStore()
    const client = makeFakeOpensciClient()
    client.clearCachedUser()
    await store.save({ accessToken: 'old-opensci-token', refreshToken: 'old-refresh', obtainedAt: '2026-01-01' })
    const service = new AuthService({ tokenStore: store, googleClient: client, deeplink: NOOP_DEEPLINK, mainWindow: () => null })
    expect(await service.getCurrentUser()).toEqual({ ok: true, value: null })
    expect(await service.oauthStart({ provider: 'opensci' })).toMatchObject({ ok: false })
    expect(client.refreshCalls).toHaveLength(0)
  })
})

test.each(['logout', 'cancel'] as const)('%s during asynchronous OAuth save cannot resurrect session', async action => {
  const store = makeFakeTokenStore()
  const save = store.save.bind(store)
  let release!: () => void
  let started!: () => void
  const saving = new Promise<void>(r => { started = r })
  const blocked = new Promise<void>(r => { release = r })
  store.save = async tokens => { started(); await blocked; await save(tokens) }
  const client = makeFakeOpensciClient()
  client.cacheUser = () => {}
  let complete!: (value: Result<import('./auth-opensci-client.ts').OpensciLoginResult>) => void
  const completion = new Promise<Result<import('./auth-opensci-client.ts').OpensciLoginResult>>(r => { complete = r })
  client.startLogin = async () => ({ authorizeUrl: 'https://accounts.google.com', completion, cancel: () => {} })
  const events: AuthStateChangedEvent[] = []
  const service = new AuthService({ tokenStore: store, googleClient: client, deeplink: NOOP_DEEPLINK, mainWindow: () => null, onAuthStateChanged: e => events.push(e) })
  const pending = await service.oauthStart({ provider: 'google' })
  complete({ ok: true, value: { user: FAKE_USER, accessToken: 'stale', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 } })
  await saving
  const logout = action === 'logout' ? service.logout() : service.oauthCancel({ pendingId: pending.ok ? pending.value.pendingId : '' })
  release()
  await logout
  await new Promise(r => setTimeout(r, 0))
  expect(store.saved).toBeNull()
  expect(events.filter(e => e.type === 'login-success')).toHaveLength(0)
})

test('old refresh cannot overwrite a newer OAuth account or cached profile', async () => {
  const store = makeFakeTokenStore()
  await store.save({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: 0, obtainedAt: '2026-01-01' })
  const client = makeFakeOpensciClient()
  let release!: () => void
  let started!: () => void
  const refreshing = new Promise<void>(r => { started = r })
  const block = new Promise<void>(r => { release = r })
  client.refreshTokens = async () => { started(); await block; return { ok: true, value: { accessToken: 'stale-refresh-access', refreshToken: 'stale-refresh', expiresAt: Date.now() + 3600000, idToken: null } } }
  const newUser = { ...FAKE_USER, uid: 'new-account' }
  let cached = FAKE_USER
  client.getCachedUser = () => cached
  client.cacheUser = user => { cached = user }
  client.startLogin = async () => ({ authorizeUrl: 'https://accounts.google.com', completion: Promise.resolve({ ok: true, value: { user: newUser, accessToken: 'new-account-access', refreshToken: 'new-account-refresh', expiresAt: Date.now() + 3600000 } }), cancel: () => {} })
  const events: AuthStateChangedEvent[] = []
  const service = new AuthService({ tokenStore: store, googleClient: client, deeplink: NOOP_DEEPLINK, mainWindow: () => null, onAuthStateChanged: e => events.push(e) })
  const restore = service.getCurrentUser()
  await refreshing
  await service.oauthStart({ provider: 'google' })
  await new Promise(r => setTimeout(r, 0))
  release()
  await restore
  expect(store.saved?.accessToken).toBe('new-account-access')
  expect(cached.uid).toBe('new-account')
  expect(events.filter(e => e.type === 'session-expired')).toHaveLength(0)
})

test('changed Google client binding clears stored session before restoring profile', async () => {
  const store = makeFakeTokenStore()
  await store.save({ accessToken: 'google-secret', refreshToken: 'old-refresh', googleClientId: 'old-client', obtainedAt: '2026-01-01', expiresAt: Date.now() + 3600000 })
  const client = makeFakeOpensciClient()
  client.validateSessionBinding = id => id === 'current-client' ? { ok: true, value: undefined } : { ok: false, error: { code: 'oauth-config-missing', message: 'Client changed' } }
  const service = new AuthService({ tokenStore: store, googleClient: client, deeplink: NOOP_DEEPLINK, mainWindow: () => null })
  expect(await service.getCurrentUser()).toEqual({ ok: true, value: null })
  expect(store.saved).toBeNull()
  expect(client.refreshCalls).toHaveLength(0)
})

test('old Google revoke completion preserves a newer login session', async () => {
  const store = makeFakeTokenStore()
  await store.save({ accessToken: 'old-access', refreshToken: 'old-refresh', obtainedAt: '2026-01-01', expiresAt: Date.now() + 3600000 })
  const client = makeFakeOpensciClient()
  let cached: User | null = FAKE_USER
  client.getCachedUser = () => cached
  client.clearCachedUser = () => { cached = null }
  client.cacheUser = user => { cached = user }
  let started!: () => void
  let release!: () => void
  const revoking = new Promise<void>(r => { started = r })
  const block = new Promise<void>(r => { release = r })
  client.deleteAccount = async token => { expect(token).toBe('old-refresh'); started(); await block; return { ok: true, value: undefined } }
  const newUser = { ...FAKE_USER, uid: 'new-google-account' }
  client.startLogin = async () => ({ authorizeUrl: 'https://accounts.google.com', completion: Promise.resolve({ ok: true, value: { user: newUser, accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: Date.now() + 3600000 } }), cancel: () => {} })
  const events: AuthStateChangedEvent[] = []
  const service = new AuthService({ tokenStore: store, googleClient: client, deeplink: NOOP_DEEPLINK, mainWindow: () => null, onAuthStateChanged: e => events.push(e) })
  await service.getCurrentUser()
  const revoke = service.deleteAccount()
  await revoking
  await service.logout()
  await service.oauthStart({ provider: 'google' })
  await new Promise(r => setTimeout(r, 0))
  const eventsBeforeOldRevoke = [...events]
  release()
  expect(await revoke).toMatchObject({ ok: true })
  expect(store.saved?.accessToken).toBe('new-access')
  expect(cached?.uid).toBe('new-google-account')
  expect(events).toEqual(eventsBeforeOldRevoke)
  expect(await service.getCurrentUser()).toMatchObject({ ok: true, value: { uid: 'new-google-account' } })
})

test('Google disconnect revokes refresh token even when access token expired', async () => {
  const store = makeFakeTokenStore()
  await store.save({ accessToken: 'expired-access', refreshToken: 'valid-google-refresh', obtainedAt: '2026-01-01', expiresAt: 0 })
  const client = makeFakeOpensciClient()
  let revoked: string | null = null
  client.deleteAccount = async token => { revoked = token; return { ok: true, value: undefined } }
  const service = new AuthService({ tokenStore: store, googleClient: client, deeplink: NOOP_DEEPLINK, mainWindow: () => null })
  // 直接设定已登录状态，模拟长期运行而尚未触发刷新。
  Object.assign(service, { currentUid: FAKE_USER.uid })
  expect(await service.deleteAccount()).toMatchObject({ ok: true })
  expect(revoked).toBe('valid-google-refresh')
  expect(store.saved).toBeNull()
  expect(client.refreshCalls).toHaveLength(0)
})
