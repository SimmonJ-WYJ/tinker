/**
 * 登录纯逻辑工具（零 Electron 依赖，可直接 bun test）
 *
 * 桌面端作为 public client（PKCE，无 secret）直连账号中心（Ory Hydra）：
 * PKCE 生成 / discovery 文档解析 / loopback 回调解析（含 state 校验）/
 * 标准 token endpoint 响应解析 / id_token claims v1 解码 / access 过期判定 /
 * RP-initiated 登出 URL 构造。网络与存储副作用在 auth-opensci-client.ts。
 *
 * 设计依据：docs/specs/account-hydra-direct-spec.md
 */

import { createHash, randomBytes } from 'node:crypto'

// ─── PKCE ───────────────────────────────────────────────────

/** 一次授权会话的 PKCE 三元组（S256） */
export interface PkceParams {
  verifier: string
  challenge: string
  state: string
}

/** 生成 PKCE verifier（43 字符 base64url）+ S256 challenge + state nonce */
export function generatePkce(): PkceParams {
  const verifier = randomBytes(32).toString('base64url')
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: randomBytes(16).toString('base64url'),
  }
}

// ─── discovery ──────────────────────────────────────────────

/** OIDC discovery 文档中桌面端需要的端点 */
export interface OidcEndpoints {
  authorizationEndpoint: string
  tokenEndpoint: string
}

/** 解析 {issuer}.well-known/openid-configuration 响应 */
export function parseDiscoveryDocument(json: unknown): OidcEndpoints | null {
  if (typeof json !== 'object' || json === null) return null
  const obj = json as Record<string, unknown>
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  const authorizationEndpoint = str(obj.authorization_endpoint)
  const tokenEndpoint = str(obj.token_endpoint)
  if (!authorizationEndpoint || !tokenEndpoint) return null
  return {
    authorizationEndpoint,
    tokenEndpoint,
  }
}

// ─── 授权 URL ───────────────────────────────────────────────

export interface AuthorizeUrlParams {
  authorizationEndpoint: string
  clientId: string
  redirectUri: string
  challenge: string
  state: string
  scope?: string
}

/** 接入规范 §2：第一期 scope（offline_access 换旋转式 refresh token） */
export const DEFAULT_SCOPE = 'openid profile offline_access'

/** 构造授权码请求 URL（Authorization Code + PKCE S256） */
export function buildAuthorizeUrl(p: AuthorizeUrlParams): string {
  const url = new URL(p.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', p.clientId)
  url.searchParams.set('redirect_uri', p.redirectUri)
  url.searchParams.set('scope', p.scope ?? DEFAULT_SCOPE)
  url.searchParams.set('state', p.state)
  url.searchParams.set('code_challenge', p.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

// ─── loopback 回调 ──────────────────────────────────────────

/** loopback 回调解析结果 */
export type CallbackResult =
  | { kind: 'code'; code: string }
  | { kind: 'denied' }
  | { kind: 'state-mismatch' }
  | { kind: 'invalid' }

/**
 * 解析 loopback 回调请求 URL（/callback?code=...&state=...）
 *
 * Hydra 直连：回调带授权码 + state，state 必须与本次会话一致（防 CSRF / 会话串扰）。
 * 用户在授权页拒绝 → `?error=access_denied`；其余 error code 一律 invalid。
 *
 * @param rawUrl http.IncomingMessage.url（path + query）
 * @param expectedState 本次授权会话的 state nonce
 */
export function parseCallbackUrl(rawUrl: string, expectedState: string): CallbackResult {
  let url: URL
  try {
    url = new URL(rawUrl, 'http://127.0.0.1')
  } catch {
    return { kind: 'invalid' }
  }
  if (url.pathname !== '/callback') return { kind: 'invalid' }
  if (url.searchParams.get('error') === 'access_denied') return { kind: 'denied' }

  const code = url.searchParams.get('code')
  if (!code) return { kind: 'invalid' }
  if (url.searchParams.get('state') !== expectedState) return { kind: 'state-mismatch' }
  return { kind: 'code', code }
}

// ─── token endpoint 响应 ────────────────────────────────────

/** 标准 token endpoint 成功响应（授权码交换与 refresh 旋转同构） */
export interface OidcTokens {
  accessToken: string
  refreshToken: string | null
  idToken: string | null
  /** access token 过期时间戳（ms），由 expires_in 折算 */
  expiresAt: number
}

/** 接入规范 §5：access token 有效期 15 分钟（expires_in 缺失时的兜底） */
const DEFAULT_EXPIRES_IN_S = 15 * 60

/**
 * 解析 {issuer}oauth2/token 的 JSON 响应（snake_case：access_token / refresh_token / id_token / expires_in）
 *
 * @param json 已 JSON.parse 的响应体
 * @param now 当前时间戳（ms），注入便于测试
 */
export function parseTokenResponse(json: unknown, now: number): OidcTokens | null {
  if (typeof json !== 'object' || json === null) return null
  const obj = json as Record<string, unknown>
  const accessToken = obj.access_token
  if (typeof accessToken !== 'string' || !accessToken) return null

  const expiresIn = typeof obj.expires_in === 'number' ? obj.expires_in : DEFAULT_EXPIRES_IN_S
  const refreshToken = typeof obj.refresh_token === 'string' && obj.refresh_token ? obj.refresh_token : null
  const idToken = typeof obj.id_token === 'string' && obj.id_token ? obj.id_token : null

  return {
    accessToken,
    refreshToken,
    idToken,
    expiresAt: now + expiresIn * 1000,
  }
}

// ─── claims v1 → profile ────────────────────────────────────

/**
 * OPENSCI 用户 profile（claims v1 解码后的中间产物）
 *
 * 仅在主进程内流转：解码 id_token（回退 access_token）得到它，再映射成 `User`（packages/shared）。
 * 字段对齐账号中心 claims v1：sub / auth_method / claims_ver 恒在，name / picture 按 presence。
 */
export interface OpensciProfile {
  /** 全局 user_id（OIDC sub，唯一可出边界标识） */
  uid: string
  /** 登录凭证类型（google | orcid | email_otp | wallet_eoa；防御性容忍缺失） */
  authMethod: string | null
  /** 昵称（name 缺失时兜底 sub —— 全局首登的首个 token 通常不含 name） */
  nickname: string
  /** 头像 URL（claims v1 标准 picture，可选） */
  avatarUrl: string | null
  /** 本地解码时间戳（ms） */
  syncedAt: number
}

/**
 * 解码 JWT 的 payload claims（base64url，**不验签**）
 *
 * 桌面端只用于从 id_token 提取展示用 profile —— token 经 TLS 直连 issuer 的 token endpoint
 * 获得（非浏览器面传递），安全决策由 Resource Server 对 access token JWKS 验签兜底。
 */
export function decodeJwtClaims(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  const payloadPart = parts[1]
  if (!payloadPart) return null
  try {
    const payload = Buffer.from(payloadPart, 'base64url').toString('utf-8')
    const parsed = JSON.parse(payload) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * 从 id_token（缺失时回退 access_token）解码 claims 得 profile。
 * 正常 scope 含 openid → 必有 id_token；回退仅作防御——两者皆含 sub，至少保证 uid 可得。
 */
export function parseProfileFromTokens(
  idToken: string | null,
  accessToken: string,
  now: number,
): OpensciProfile | null {
  for (const jwt of [idToken, accessToken]) {
    if (!jwt) continue
    const claims = decodeJwtClaims(jwt)
    const profile = claims && parseProfileFromClaims(claims, now)
    if (profile) return profile
  }
  return null
}

/** claims v1 → OpensciProfile（name/picture 按 presence；勿读 ext.* —— Hydra 镜像实现产物） */
export function parseProfileFromClaims(claims: Record<string, unknown>, now: number): OpensciProfile | null {
  const sub = claims.sub
  if (typeof sub !== 'string' || !sub) return null

  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  return {
    uid: sub,
    authMethod: str(claims.auth_method),
    nickname: str(claims.name) ?? sub,
    avatarUrl: str(claims.picture),
    syncedAt: now,
  }
}

/** access token 过期判定（60s 提前量；refresh-on-demand 用） */
export function isTokenExpired(expiresAt: number, now: number): boolean {
  return now >= expiresAt - 60_000
}
