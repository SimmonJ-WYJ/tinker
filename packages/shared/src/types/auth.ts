// packages/shared/src/types/auth.ts
/**
 * 账户体系类型定义（spec §五）。前后端共用，IPC 序列化保留全字段。
 */

export type AuthProvider = 'email' | 'google' | 'orcid' | 'opensci'

export type AuthStatus = 'uninitialized' | 'checking' | 'unauthenticated' | 'authenticated'

export type AuthRoute = 'login' | 'oauth-pending'

export type PreferredLanguage = 'en' | 'zh'

export interface User {
  uid: string
  email: string
  emailVerified: boolean
  nickname: string | null
  avatarUrl: string | null
  institution: string | null
  field: string | null
  preferredLanguage: PreferredLanguage | null
  linkedProviders: AuthProvider[]
  linkedOpenSciId: string | null
  createdAt: string  // ISO
  lastLoginAt: string
}

export type AuthErrorCode =
  | 'invalid-credentials'
  | 'email-not-verified'
  | 'email-already-exists'
  | 'weak-password'
  | 'invalid-token'
  | 'token-expired'
  | 'rate-limited'
  | 'network-error'
  | 'oauth-cancelled'
  | 'oauth-state-mismatch'
  | 'oauth-provider-error'
  | 'oauth-config-missing'
  | 'unknown'

export interface AuthError {
  code: AuthErrorCode
  message: string
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: AuthError }

// ─── 请求 / 响应 schema ───

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  password: string
  nickname?: string
  institution?: string
  field?: string
  preferredLanguage?: PreferredLanguage
}

export interface RegisterResponse {
  requiresEmailVerify: true
}

export interface EmailVerifyRequest {
  token: string
}

export interface EmailVerifyResendRequest {
  email: string
}

export interface PasswordResetRequest {
  email: string
}

export interface PasswordResetConfirmRequest {
  token: string
  newPassword: string
}

export interface OAuthStartRequest {
  provider: Exclude<AuthProvider, 'email'>
}

export interface OAuthStartResponse {
  pendingId: string
}

export interface OAuthCancelRequest {
  pendingId: string
}

export interface UpdateProfileRequest {
  nickname?: string | null
  institution?: string | null
  field?: string | null
  preferredLanguage?: PreferredLanguage | null
}

// ─── 会话元数据（dev bypass 标识） ───

export interface SessionMeta {
  isDevBypass: boolean
  loginAt: string
}

// ─── 老用户升级：本地研究库归属 marker ───

export interface LocalDataCounts {
  papers: number
  notes: number
  evidenceSets: number
}

export interface LocalDataSnapshot {
  hasLocalData: boolean
  counts: LocalDataCounts
  attributedTo: string | null
}

export interface OwnerMarker {
  uid: string
  attributedAt: string
  attributedFrom: 'upgrade-notice' | 'manual'
  snapshot: LocalDataCounts
}

// ─── 事件 payload（main → renderer） ───

export type AuthStateChangedEvent =
  | { type: 'login-success'; user: User }
  | { type: 'logout' }
  | { type: 'session-expired'; error?: AuthError }
  | { type: 'user-updated'; user: User }
  // 账户删除成功（DO-3）：服务端身份+遥测已清，本地研究库保留；renderer 退回登录门
  | { type: 'account-deleted' }

export type AuthDeeplinkEvent =
  | { kind: 'verify'; token: string }
  | { kind: 'reset'; token: string }
