/**
 * Preload · auth domain 片段
 *
 * 账户体系（auth，spec §五）与 OAuth 协议（oauth，spec §六）两个 namespace。
 */
import type { PlatformTransport } from '../transport.ts'
import { subscribe } from '../helpers.ts'
import { AUTH_CHANNELS, OAUTH_CHANNELS } from '@asci/shared'
import type {
  AuthStateChangedEvent,
  AuthDeeplinkEvent,
  AuthServerConnectionCheck,
  LoginRequest,
  RegisterRequest,
  RegisterResponse,
  Result,
  SessionMeta,
  UpdateProfileRequest,
  User,
  AuthProvider,
  LocalDataSnapshot,
} from '@asci/shared'

/** 账户体系 - spec §五 */
export interface AuthApi {
  login: (req: LoginRequest) => Promise<Result<User>>
  register: (req: RegisterRequest) => Promise<Result<RegisterResponse>>
  logout: () => Promise<Result<void>>
  getCurrentUser: () => Promise<Result<User | null>>
  refresh: () => Promise<Result<void>>
  requestEmailVerify: (req: { email: string }) => Promise<Result<void>>
  confirmEmailVerify: (req: { token: string }) => Promise<Result<void>>
  requestPasswordReset: (req: { email: string }) => Promise<Result<void>>
  confirmPasswordReset: (req: { token: string; newPassword: string }) => Promise<Result<void>>
  updateProfile: (req: UpdateProfileRequest) => Promise<Result<User>>
  /** 删除账户（DO-3）：清服务端身份+遥测，本地研究库保留 */
  deleteAccount: () => Promise<Result<void>>
  /** dev-only 连通自检：只读 GET /me，验证 ASCI-Server 可达且接受当前 token，零副作用 */
  verifyConnection: () => Promise<Result<AuthServerConnectionCheck>>
  /** dev-only：取当前 access token 原文（供手动调试/复制）；生产恒拒 */
  getAccessTokenForDev: () => Promise<Result<string | null>>
  getSessionMeta: () => Promise<Result<SessionMeta | null>>
  markRendererReady: () => Promise<Result<void>>
  scanLocalData: () => Promise<Result<LocalDataSnapshot>>
  /** 订阅 auth 状态变更事件（login-success / logout / session-expired / user-updated）；返回取消订阅函数 */
  onStateChanged: (cb: (event: AuthStateChangedEvent) => void) => () => void
  /** 订阅 deeplink 路由事件（verify / reset token 到达）；返回取消订阅函数 */
  onDeeplinkRoute: (cb: (event: AuthDeeplinkEvent) => void) => () => void
}

/** OAuth 协议 - spec §六 */
export interface OAuthApi {
  start: (req: { provider: Exclude<AuthProvider, 'email'> }) => Promise<Result<{ pendingId: string }>>
  cancel: (req: { pendingId: string }) => Promise<Result<void>>
}

// 账户体系 - spec §五
export function createAuthApi(transport: PlatformTransport): AuthApi {
  return {
    login: (req: LoginRequest): Promise<Result<User>> =>
      transport.invoke(AUTH_CHANNELS.LOGIN, req) as Promise<Result<User>>,
    register: (req: RegisterRequest): Promise<Result<RegisterResponse>> =>
      transport.invoke(AUTH_CHANNELS.REGISTER, req) as Promise<Result<RegisterResponse>>,
    logout: (): Promise<Result<void>> =>
      transport.invoke(AUTH_CHANNELS.LOGOUT) as Promise<Result<void>>,
    getCurrentUser: (): Promise<Result<User | null>> =>
      transport.invoke(AUTH_CHANNELS.GET_CURRENT_USER) as Promise<Result<User | null>>,
    refresh: (): Promise<Result<void>> =>
      transport.invoke(AUTH_CHANNELS.REFRESH) as Promise<Result<void>>,
    requestEmailVerify: (req: { email: string }): Promise<Result<void>> =>
      transport.invoke(AUTH_CHANNELS.REQUEST_EMAIL_VERIFY, req) as Promise<Result<void>>,
    confirmEmailVerify: (req: { token: string }): Promise<Result<void>> =>
      transport.invoke(AUTH_CHANNELS.CONFIRM_EMAIL_VERIFY, req) as Promise<Result<void>>,
    requestPasswordReset: (req: { email: string }): Promise<Result<void>> =>
      transport.invoke(AUTH_CHANNELS.REQUEST_PASSWORD_RESET, req) as Promise<Result<void>>,
    confirmPasswordReset: (req: { token: string; newPassword: string }): Promise<Result<void>> =>
      transport.invoke(AUTH_CHANNELS.CONFIRM_PASSWORD_RESET, req) as Promise<Result<void>>,
    updateProfile: (req: UpdateProfileRequest): Promise<Result<User>> =>
      transport.invoke(AUTH_CHANNELS.UPDATE_PROFILE, req) as Promise<Result<User>>,
    deleteAccount: (): Promise<Result<void>> =>
      transport.invoke(AUTH_CHANNELS.DELETE_ACCOUNT) as Promise<Result<void>>,
    verifyConnection: (): Promise<Result<AuthServerConnectionCheck>> =>
      transport.invoke(AUTH_CHANNELS.VERIFY_CONNECTION) as Promise<Result<AuthServerConnectionCheck>>,
    getAccessTokenForDev: (): Promise<Result<string | null>> =>
      transport.invoke(AUTH_CHANNELS.GET_ACCESS_TOKEN_DEV) as Promise<Result<string | null>>,
    getSessionMeta: (): Promise<Result<SessionMeta | null>> =>
      transport.invoke(AUTH_CHANNELS.GET_SESSION_META) as Promise<Result<SessionMeta | null>>,
    markRendererReady: (): Promise<Result<void>> =>
      transport.invoke(AUTH_CHANNELS.MARK_RENDERER_READY) as Promise<Result<void>>,
    scanLocalData: (): Promise<Result<LocalDataSnapshot>> =>
      transport.invoke(AUTH_CHANNELS.SCAN_LOCAL_DATA) as Promise<Result<LocalDataSnapshot>>,
    onStateChanged: (cb: (event: AuthStateChangedEvent) => void): (() => void) =>
      subscribe<AuthStateChangedEvent>(transport, AUTH_CHANNELS.STATE_CHANGED, cb),
    onDeeplinkRoute: (cb: (event: AuthDeeplinkEvent) => void): (() => void) =>
      subscribe<AuthDeeplinkEvent>(transport, AUTH_CHANNELS.DEEPLINK_ROUTE, cb),
  }
}

// OAuth 协议 - spec §六
export function createOAuthApi(transport: PlatformTransport): OAuthApi {
  return {
    start: (req: { provider: Exclude<AuthProvider, 'email'> }): Promise<Result<{ pendingId: string }>> =>
      transport.invoke(OAUTH_CHANNELS.START, req) as Promise<Result<{ pendingId: string }>>,
    cancel: (req: { pendingId: string }): Promise<Result<void>> =>
      transport.invoke(OAUTH_CHANNELS.CANCEL, req) as Promise<Result<void>>,
  }
}
