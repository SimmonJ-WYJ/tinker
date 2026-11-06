// apps/electron/src/main/lib/auth-service.ts
/**
 * Auth 编排服务 - spec §五
 *
 * 把所有 IPC 入口转化为对 stub（或未来 HTTP client）的调用。
 * 服务端就绪后只改本文件构造注入 + 内部 stub 调用替换为 httpClient。
 */

import { randomUUID } from 'node:crypto'
import { BrowserWindow, shell } from 'electron'
import type {
  AuthDeeplinkEvent,
  AuthProvider,
  AuthServerConnectionCheck,
  AuthStateChangedEvent,
  LoginRequest,
  RegisterRequest,
  RegisterResponse,
  Result,
  SessionMeta,
  UpdateProfileRequest,
  User,
} from '@asci/shared'
import { AUTH_CHANNELS, nowIso, nowMs } from '@asci/shared'
import { isTokenExpired, type OidcTokens } from './auth-oidc.ts'
import type { AuthStub } from './auth-stub.ts'
import type { AuthDeeplinkHandler } from './auth-deeplink.ts'
import type { AuthTokenStore } from './auth-token-store.ts'
import type { StubServer } from './auth-stub-server.ts'
import { decodeStubCode } from './auth-stub-server.ts'
import { shouldBypass, disableBypassForRuntime } from './auth-dev-bypass.ts'
import type { OpensciAuthClient, OpensciLoginHandle } from './auth-opensci-client.ts'

export interface AuthServiceDeps {
  tokenStore: AuthTokenStore
  stub?: AuthStub
  /**
   * OPENSCI OIDC 真实对接 client。注入后 provider='opensci' 的登录走真实
   * loopback + /auth/handoff（替代 stubServer 的 mock），getCurrentUser 从其 User 缓存恢复。
   */
  googleClient?: OpensciAuthClient
  opensciClient?: OpensciAuthClient
  stubServer?: StubServer
  deeplink: AuthDeeplinkHandler
  mainWindow: () => BrowserWindow | null
  /**
   * 登录态变更旁路回调（主进程内消费，与 renderer 推送并行）。
   * 供埋点按账户归属用：login-success → identify、logout/session-expired → 回落匿名。
   * 注入方负责不抛异常（本类不 try/catch 包裹）。
   */
  onAuthStateChanged?: (event: AuthStateChangedEvent) => void
}

export class AuthService {
  private currentUid: string | null = null
  private loginAt: string | null = null
  /** 进行中的 OIDC 登录会话（pendingId → handle），供 oauthCancel 取消 loopback */
  private oidcPending = new Map<string, OpensciLoginHandle>()
  /**
   * 进行中的 OIDC token 刷新（single-flight）。冷启动时主进程 on-ready 与渲染进程
   * useInitAuth 会在同一实例上并发各调一次 getCurrentUser，若各自对同一过期 refresh
   * token 发一次旋转刷新，会被 IdP 判为 refresh token reuse（grace window 之外即撤链）。
   * 按 token 值缓存在飞的 promise：同一 token 同一时刻只飞一次，后到者复用其结果（issue #699）。
   */
  private inflightOpensciRefresh: {
    token: string
    promise: Promise<Result<OidcTokens>>
  } | null = null

  private sessionGeneration = 0
  private mutations: Promise<void> = Promise.resolve()

  /** 串行提交凭据/缓存，跨 await 后重新校验代次，防止旧授权覆盖新身份。 */
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation)
    this.mutations = result.then(() => {}, () => {})
    return result
  }

  constructor(private deps: AuthServiceDeps) {}

  private get identityClient(): OpensciAuthClient | undefined {
    return this.deps.googleClient ?? this.deps.opensciClient
  }

  private sendStateChanged(event: AuthStateChangedEvent): void {
    // 主进程旁路消费（埋点账户归属等）——先于 renderer 推送，且不受窗口存活影响
    this.deps.onAuthStateChanged?.(event)
    const w = this.deps.mainWindow()
    if (!w || w.isDestroyed()) return
    w.webContents.send(AUTH_CHANNELS.STATE_CHANGED, event)
  }

  /**
   * 清本地会话态（清 token + User 缓存 + 解除 dev-bypass + 复位 uid/loginAt），并广播状态事件。
   * **绝不动本地研究库**。logout 与 deleteAccount 共用这段收尾。
   */
  private async clearLocalSession(event: AuthStateChangedEvent): Promise<void> {
    ++this.sessionGeneration
    await this.mutate(async () => {
      await this.deps.tokenStore.clear()
      this.identityClient?.clearCachedUser()
      if (shouldBypass()) disableBypassForRuntime()
      this.currentUid = null
      this.loginAt = null
      this.sendStateChanged(event)
    })
  }

  private sendDeeplinkRoute(event: AuthDeeplinkEvent): void {
    const w = this.deps.mainWindow()
    if (!w || w.isDestroyed()) return
    w.webContents.send(AUTH_CHANNELS.DEEPLINK_ROUTE, event)
  }

  /** 给 deeplink-handler 提供 sendToRenderer */
  getSendDeeplinkRoute(): (e: AuthDeeplinkEvent) => void {
    return (e) => this.sendDeeplinkRoute(e)
  }

  /** 给 deeplink-handler 提供 notifyOAuthError */
  getNotifyOAuthError(): (msg: string) => void {
    return (msg) => {
      this.sendStateChanged({ type: 'session-expired' })
      console.warn('[auth-service] oauth error:', msg)
    }
  }

  // ─── public IPC methods ──────────────────────────────────

  async login(req: LoginRequest): Promise<Result<User>> {
    if (!this.deps.stub) return errUnsupported()
    const r = await this.deps.stub.login(req)
    if (!r.ok) return r
    await this.deps.tokenStore.save({
      accessToken: await this.mintAccessForStub(r.value.user.uid),
      refreshToken: r.value.refreshToken,
      obtainedAt: nowIso(),
    })
    this.currentUid = r.value.user.uid
    this.loginAt = nowIso()
    this.sendStateChanged({ type: 'login-success', user: r.value.user })
    return { ok: true, value: r.value.user }
  }

  async register(req: RegisterRequest): Promise<Result<RegisterResponse>> {
    if (!this.deps.stub) return errUnsupported()
    const r = await this.deps.stub.register(req)
    if (!r.ok) return r
    return { ok: true, value: { requiresEmailVerify: true } }
  }

  async logout(): Promise<Result<void>> {
    ++this.sessionGeneration
    for (const handle of this.oidcPending.values()) handle.cancel()
    this.oidcPending.clear()
    // 静默登出：仅清本机会话（token + User 缓存），**不**销毁账号中心 SSO 会话。
    // 登出只作用于 ASCI 客户端，OPENSCI 账号中心仍保持登录；二次登录时系统浏览器
    // 复用 Hydra 现存会话直接重走授权码流程换新 token（接入规范 §6 改为客户端本地登出）。
    // 吊销该账户全部 session 需在复位 currentUid 之前完成
    if (this.currentUid && this.deps.stub) {
      await this.deps.stub.revokeAllSessions(this.currentUid)
    }
    await this.clearLocalSession({ type: 'logout' })
    return { ok: true, value: undefined }
  }

  async getCurrentUser(): Promise<Result<User | null>> {
    // OIDC 优先：有 User 缓存 → 校验/按需刷新 token 后恢复
    if (this.identityClient) {
      const restored = await this.restoreOpensciSession(this.identityClient)
      if (restored) return { ok: true, value: restored }
    }
    if (this.deps.googleClient) return { ok: true, value: null }
    const refreshToken = await this.deps.tokenStore.getRefreshToken()
    if (!refreshToken) {
      // dev bypass 短路
      if (shouldBypass() && this.deps.stub) {
        const fixture = await this.deps.stub.ensureDevFixture()
        if (fixture) {
          const login = await this.deps.stub.login({
            email: 'dev@asci.local',
            password: 'dev1234',
          })
          if (login.ok) {
            await this.deps.tokenStore.save({
              accessToken: await this.mintAccessForStub(login.value.user.uid),
              refreshToken: login.value.refreshToken,
              obtainedAt: nowIso(),
            })
            this.currentUid = login.value.user.uid
            this.loginAt = nowIso()
            console.info('[auth] dev bypass auto-login:', fixture.email)
            return { ok: true, value: login.value.user }
          }
        }
      }
      return { ok: true, value: null }
    }
    // 有 token：解析 uid（stub 用 access token payload）
    const accessToken = await this.deps.tokenStore.getAccessToken()
    if (!accessToken) return { ok: true, value: null }
    const uid = parseStubAccessUid(accessToken)
    if (!uid) return { ok: true, value: null }
    if (!this.deps.stub) return errUnsupported()
    const user = await this.deps.stub.getUserByUid(uid)
    if (!user) {
      await this.deps.tokenStore.clear()
      return { ok: true, value: null }
    }
    this.currentUid = uid
    this.loginAt = (await this.deps.tokenStore.getObtainedAt()) ?? nowIso()
    return { ok: true, value: user }
  }

  async refresh(): Promise<Result<void>> {
    const generation = this.sessionGeneration
    const tokens = await this.deps.tokenStore.getAll()
    if (!tokens?.refreshToken) return errUnauth()
    const binding = this.deps.googleClient?.validateSessionBinding?.(tokens.googleClientId)
    if (binding && !binding.ok) {
      if (generation === this.sessionGeneration) await this.clearLocalSession({ type: 'session-expired', error: binding.error })
      return binding
    }
    // OIDC 路径：直连账号中心旋转刷新
    if (this.identityClient?.getCachedUser()) {
      // single-flight：与冷启动 getCurrentUser 共用在飞刷新，避免同一 token 双刷（issue #699）
      const r = await this.refreshOpensciSingleFlight(
        this.identityClient,
        tokens.refreshToken,
        tokens.googleClientId,
      )
      if (generation !== this.sessionGeneration) return { ok: false, error: { code: 'oauth-cancelled', message: 'Session changed' } }
      if (!r.ok) {
        // 离线（网络错误）：保留本地 token 走宽限，不清态
        if (r.error.code === 'network-error') return r
        // 刷新被拒 = 吊销 / 冻结 / 全局登出（接入规范 §6/§7）
        await this.clearLocalSession({ type: 'session-expired', error: r.error })
        return r
      }
      // 旋转结果已由 single-flight 落库
      return { ok: true, value: undefined }
    }
    if (!this.deps.stub) return errUnauth()
    const r = await this.deps.stub.rotateRefreshToken(tokens.refreshToken)
    if (!r.ok) {
      await this.deps.tokenStore.clear()
      this.sendStateChanged({ type: 'session-expired' })
      return r
    }
    await this.deps.tokenStore.save({
      accessToken: r.value.accessToken,
      refreshToken: r.value.refreshToken,
      obtainedAt: nowIso(),
    })
    return { ok: true, value: undefined }
  }

  /**
   * OIDC 登录态恢复（spec §3）：access 有效直接恢复；过期且有 refresh → 旋转刷新；
   * 网络错误走离线宽限（保持登录，联网后下次再刷）；刷新被拒（吊销/冻结/全局登出）→ 清态返回 null。
   */
  private async restoreOpensciSession(client: OpensciAuthClient): Promise<User | null> {
    const generation = this.sessionGeneration
    const tokens = await this.deps.tokenStore.getAll()
    if (generation !== this.sessionGeneration) return null
    const binding = client.validateSessionBinding?.(tokens?.googleClientId)
    if (tokens && binding && !binding.ok) {
      await this.clearLocalSession({ type: 'session-expired', error: binding.error })
      return null
    }
    const cached = client.getCachedUser()
    if (!cached || !tokens?.accessToken) return null
    const restore = (): User | null => {
      if (generation !== this.sessionGeneration) return null
      this.currentUid = cached.uid
      this.loginAt = tokens.obtainedAt
      return cached
    }
    if (tokens.expiresAt != null && !isTokenExpired(tokens.expiresAt, nowMs())) return restore()
    if (!tokens.refreshToken) {
      await this.clearLocalSession({ type: 'session-expired' })
      return null
    }
    const r = await this.refreshOpensciSingleFlight(client, tokens.refreshToken, tokens.googleClientId)
    if (generation !== this.sessionGeneration) return null
    if (r.ok || r.error.code === 'network-error') return restore()
    await this.clearLocalSession({ type: 'session-expired', error: r.error })
    return null
  }

  /**
   * OIDC token 旋转刷新（single-flight，issue #699）：同一 refresh token 同一时刻只发一次刷新，
   * 后到的并发调用 await 同一 promise、复用旋转结果，避免对同一过期 token 双刷触发 IdP reuse 判定。
   * 成功即就地落库（旋转结果只写一次）；失败收尾（清态 / 发 session-expired）仍由各调用方按语义处理。
   */
  private async refreshOpensciSingleFlight(
    client: OpensciAuthClient,
    refreshToken: string,
    googleClientId?: string,
  ): Promise<Result<OidcTokens>> {
    const generation = this.sessionGeneration
    if (this.inflightOpensciRefresh?.token === refreshToken) {
      return this.inflightOpensciRefresh.promise
    }
    const promise = (async (): Promise<Result<OidcTokens>> => {
      const r = await client.refreshTokens(refreshToken, googleClientId)
      if (generation !== this.sessionGeneration) return { ok: false, error: { code: 'oauth-cancelled', message: 'Session changed' } }
      if (!r.ok) return r
      return this.mutate(async () => {
        if (generation !== this.sessionGeneration) return { ok: false, error: { code: 'oauth-cancelled', message: 'Session changed' } }
        const binding = client.validateSessionBinding?.(googleClientId)
        if (binding && !binding.ok) return binding
        await this.saveOpensciTokens(r.value, googleClientId)
        if (generation !== this.sessionGeneration) {
          await this.deps.tokenStore.clear()
          return { ok: false, error: { code: 'oauth-cancelled', message: 'Session changed' } }
        }
        return r
      })
    })()
    const inflight = { token: refreshToken, promise }
    this.inflightOpensciRefresh = inflight
    try {
      return await promise
    } finally {
      if (this.inflightOpensciRefresh === inflight) this.inflightOpensciRefresh = null
    }
  }

  /** 旋转刷新结果整组覆盖写（id_token 仅登录时解码 profile 用，不入库） */
  private async saveOpensciTokens(tokens: OidcTokens, googleClientId?: string): Promise<void> {
    await this.deps.tokenStore.save({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      obtainedAt: nowIso(),
      expiresAt: tokens.expiresAt,
      ...(googleClientId ? { googleClientId } : {}),
    })
  }

  async requestEmailVerify(req: { email: string }): Promise<Result<void>> {
    // stub 模式 = 防探测；不暴露邮箱是否存在，始终返回 ok（spec §五）
    void req
    return { ok: true, value: undefined }
  }

  async confirmEmailVerify(req: { token: string }): Promise<Result<void>> {
    if (!this.deps.stub) return errUnsupported()
    return this.deps.stub.confirmEmailVerify(req.token)
  }

  async requestPasswordReset(req: { email: string }): Promise<Result<void>> {
    if (!this.deps.stub) return errUnsupported()
    const r = await this.deps.stub.requestPasswordReset(req.email)
    // 始终 ok（防邮箱枚举）
    void r
    return { ok: true, value: undefined }
  }

  async confirmPasswordReset(req: { token: string; newPassword: string }): Promise<Result<void>> {
    if (!this.deps.stub) return errUnsupported()
    return this.deps.stub.confirmPasswordReset(req.token, req.newPassword)
  }

  async updateProfile(req: UpdateProfileRequest): Promise<Result<User>> {
    if (this.deps.googleClient && this.currentUid) {
      const cached = this.deps.googleClient.getCachedUser()
      if (!cached) return errUnauth()
      const user = { ...cached, ...req }
      this.deps.googleClient.cacheUser(user)
      this.sendStateChanged({ type: 'user-updated', user })
      return { ok: true, value: user }
    }
    if (!this.currentUid || !this.deps.stub) return errUnauth()
    const r = await this.deps.stub.updateUser(this.currentUid, {
      nickname: req.nickname,
      institution: req.institution,
      field: req.field,
      preferredLanguage: req.preferredLanguage,
    })
    if (!r.ok) return r
    this.sendStateChanged({ type: 'user-updated', user: r.value })
    return r
  }

  /**
   * 删除账户（DO-3）：清服务端身份 + 行为遥测，本地研究库保留。
   * 服务端删除失败 → 保留本地登录态（不发事件），让用户重试（spec §4.2 D8）。
   */
  async deleteAccount(): Promise<Result<void>> {
    if (!this.currentUid) return errUnauth()
    const generation = this.sessionGeneration
    const initiatingUid = this.currentUid
    const sessionChanged = (): boolean => generation !== this.sessionGeneration || initiatingUid !== this.currentUid

    // OIDC 真实路径：有 opensci 缓存用户 → 调 ASCI-Server DELETE /me
    if (this.identityClient?.getCachedUser()) {
      const googleTokens = this.deps.googleClient ? await this.deps.tokenStore.getAll() : null
      const accessToken = this.deps.googleClient
        ? googleTokens?.refreshToken ?? googleTokens?.accessToken
        : await this.deps.tokenStore.getAccessToken()
      if (sessionChanged()) return { ok: true, value: undefined }
      if (!accessToken) return errUnauth()
      const r = await this.identityClient.deleteAccount(accessToken)
      if (!r.ok) return r
    } else if (this.deps.stub) {
      // stub / dev-bypass 路径
      const r = await this.deps.stub.deleteAccount(this.currentUid)
      if (!r.ok) return r
    } else {
      return errUnsupported()
    }

    // 成功：清本地会话（绝不动本地研究库），退出登录态。
    // 不开浏览器全局登出页——账户已删，Hydra 会话由服务端一并失效（spec §4.2 D7）。
    // 撤销的是发起时的账户；网络等待期间可能已退出并登录另一个账户。
    if (sessionChanged()) return { ok: true, value: undefined }
    await this.clearLocalSession({ type: 'account-deleted' })
    return { ok: true, value: undefined }
  }

  /**
   * dev-only 连通自检：只读 GET /me，验证当前会话能打通 ASCI-Server（与 deleteAccount 同链路、零副作用）。
   * 仅 OIDC 真实路径有意义（stub/dev-bypass 无远端可探，回 unsupported）。
   */
  async verifyServerConnection(): Promise<Result<AuthServerConnectionCheck>> {
    if (!this.currentUid) return errUnauth()
    if (!this.identityClient?.getCachedUser()) return errUnsupported()
    const accessToken = await this.deps.tokenStore.getAccessToken()
    if (!accessToken) return errUnauth()
    return this.identityClient.verifyConnection(accessToken)
  }

  /**
   * dev-only：取当前 access token 原文（供手动调试 ASCI-Server 接口 / 复制给后端定位）。
   * 仅返回已落盘的 token，不触发刷新；生产构建由 ipc 层 app.isPackaged 门控拒绝调用。
   */
  async getAccessTokenForDev(): Promise<Result<string | null>> {
    if (this.deps.googleClient) return { ok: true, value: null }
    if (!this.currentUid) return errUnauth()
    const token = await this.deps.tokenStore.getAccessToken()
    return { ok: true, value: token }
  }

  /**
   * 主进程内部取当前有效 access token（供 journal 检索源等业务注入子进程 env）。
   * - 无登录态 / 无 token → null
   * - token 已过期 → 尽力 refresh（复用 single-flight）；网络错保留旧 token（离线宽限），
   *   refresh 被拒会在 refresh() 内清态，此处随后 getAccessToken() 返回 null
   * 不经 IPC 暴露给渲染进程（token 只在主进程持有）。
   */
  async getValidAccessToken(): Promise<string | null> {
    if (this.deps.googleClient) return null
    const tokens = await this.deps.tokenStore.getAll()
    if (!tokens?.accessToken) return null
    if (tokens.expiresAt != null && isTokenExpired(tokens.expiresAt, nowMs())) {
      await this.refresh() // best-effort：成功则刷新 store；失败按 refresh() 既定语义处理
    }
    return this.deps.tokenStore.getAccessToken()
  }

  async getSessionMeta(): Promise<Result<SessionMeta | null>> {
    if (!this.currentUid || !this.loginAt) return { ok: true, value: null }
    return {
      ok: true,
      value: {
        isDevBypass: shouldBypass(),
        loginAt: this.loginAt,
      },
    }
  }

  markRendererReady(): void {
    this.deps.deeplink.markRendererReady()
  }

  // ─── OAuth ───────────────────────────────────────────────

  async oauthStart(req: {
    provider: Exclude<AuthProvider, 'email'>
  }): Promise<Result<{ pendingId: string }>> {
    // OIDC 真实对接：opensci provider + 注入了 client → 走 loopback + /auth/handoff
    // （不经 deeplink；loopback server 自驱动完成，completion resolve 后发 state-changed）
    if (this.deps.googleClient) {
      if (req.provider !== 'google') return errUnsupported()
      return this.oauthStartOpensci(this.deps.googleClient)
    }
    if (req.provider === 'opensci' && this.identityClient) {
      return this.oauthStartOpensci(this.identityClient)
    }

    const pendingId = randomUUID()
    const state = randomUUID()
    this.deps.deeplink.start(pendingId, state, req.provider)

    let authorizeUrl: string | null = null
    if (this.deps.stubServer) {
      authorizeUrl = this.deps.stubServer.buildAuthorizeUrl(req.provider, state)
    }
    if (!authorizeUrl) {
      this.deps.deeplink.cancel(pendingId)
      return { ok: false, error: { code: 'unknown', message: 'OAuth not available in this mode' } }
    }
    await shell.openExternal(authorizeUrl)
    return { ok: true, value: { pendingId } }
  }

  /** OIDC（OPENSCI）登录编排：起 loopback、开浏览器、异步等 completion 落 token + 发事件 */
  private async oauthStartOpensci(client: OpensciAuthClient): Promise<Result<{ pendingId: string }>> {
    const generation = ++this.sessionGeneration
    this.inflightOpensciRefresh = null
    const pendingId = randomUUID()
    let handle: OpensciLoginHandle
    try {
      handle = await client.startLogin()
    } catch (e) {
      return { ok: false, error: { code: typeof e === 'object' && e !== null && 'code' in e && e.code === 'oauth-config-missing' ? 'oauth-config-missing' : 'network-error', message: String(e) } }
    }
    if (generation !== this.sessionGeneration) { handle.cancel(); return { ok: false, error: { code: 'oauth-cancelled', message: 'Session changed' } } }
    this.oidcPending.set(pendingId, handle)

    void handle.completion.then(async (r) => {
      await this.mutate(async () => {
        if (generation !== this.sessionGeneration || !this.oidcPending.has(pendingId)) return
        if (!r.ok) {
          this.sendStateChanged({ type: 'session-expired', error: r.error })
          return
        }
        const { user, accessToken, refreshToken, expiresAt, googleClientId } = r.value
        const binding = client.validateSessionBinding?.(googleClientId)
        if (binding && !binding.ok) {
          this.sendStateChanged({ type: 'session-expired', error: binding.error })
          return
        }
        await this.saveOpensciTokens({ accessToken, refreshToken, idToken: null, expiresAt }, googleClientId)
        if (generation !== this.sessionGeneration || !this.oidcPending.has(pendingId)) {
          await this.deps.tokenStore.clear()
          return
        }
        client.cacheUser(user, googleClientId)
        this.currentUid = user.uid
        this.loginAt = nowIso()
        this.sendStateChanged({ type: 'login-success', user })
      })
    }).catch(() => {
      if (generation === this.sessionGeneration) this.sendStateChanged({ type: 'session-expired', error: { code: 'unknown', message: 'Unable to save Google session' } })
    }).finally(() => { this.oidcPending.delete(pendingId) })

    try { await shell.openExternal(handle.authorizeUrl) } catch {
      handle.cancel()
      return { ok: false, error: { code: 'network-error', message: 'Unable to open browser' } }
    }
    return { ok: true, value: { pendingId } }
  }

  async oauthCancel(req: { pendingId: string }): Promise<Result<void>> {
    const handle = this.oidcPending.get(req.pendingId)
    if (handle) {
      ++this.sessionGeneration
      this.oidcPending.delete(req.pendingId)
      handle.cancel()
      await this.mutations
      return { ok: true, value: undefined }
    }
    this.deps.deeplink.cancel(req.pendingId)
    return { ok: true, value: undefined }
  }

  /** 由 deeplink handler 调，不暴露 IPC */
  async oauthCompleteFromCallback(
    pendingId: string,
    code: string | null,
    state: string,
    error: string | null,
  ): Promise<void> {
    void pendingId
    void state
    if (error) {
      console.warn('[auth] oauth callback error:', error)
      return
    }
    if (!code || !this.deps.stub) return

    // 从 stub code 中解出 fixture（stub 模式）
    const fixture = decodeStubCode(code)
    if (!fixture) {
      console.warn('[auth] cannot decode stub oauth code')
      return
    }
    const r = await this.deps.stub.oauthExchange(
      fixture.provider as Exclude<AuthProvider, 'email'>,
      code,
      { email: fixture.email, subjectId: fixture.subjectId },
    )
    if (!r.ok) {
      console.warn('[auth] oauthExchange failed:', r.error)
      return
    }
    await this.deps.tokenStore.save({
      accessToken: await this.mintAccessForStub(r.value.user.uid),
      refreshToken: r.value.refreshToken,
      obtainedAt: nowIso(),
    })
    this.currentUid = r.value.user.uid
    this.loginAt = nowIso()
    this.sendStateChanged({ type: 'login-success', user: r.value.user })
  }

  // ─── helpers ──────────────────────────────────────────────

  private async mintAccessForStub(uid: string): Promise<string> {
    if (!this.deps.stub) throw new Error('no stub')
    return this.deps.stub.mintAccessToken(uid)
  }
}

// ─── helpers ────────────────────────────────────────────────

function errUnsupported(): Result<never> {
  return { ok: false, error: { code: 'unknown', message: 'auth service has no backend wired' } }
}

function errUnauth(): Result<never> {
  return { ok: false, error: { code: 'invalid-credentials', message: 'not authenticated' } }
}

function parseStubAccessUid(token: string): string | null {
  try {
    const [, payloadB64] = token.split('.')
    // 防止 token 格式错误（strict TS 需要）
    if (!payloadB64) return null
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as unknown
    if (typeof payload !== 'object' || payload === null) return null
    const sub = (payload as Record<string, unknown>).sub
    return typeof sub === 'string' ? sub : null
  } catch {
    return null
  }
}
