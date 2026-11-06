// apps/electron/src/main/lib/auth-opensci-client.ts
/**
 * OPENSCI 账号中心直连 client（桌面 public client + PKCE，RFC 8252）
 *
 * 直连账号中心（Ory Hydra，标准 OIDC Provider）完成登录：
 *   PKCE(S256)+state → 起 127.0.0.1 固定端口表 loopback → 系统浏览器打开 {issuer}oauth2/auth →
 *   回调校验 state → code+verifier 直连 {issuer}oauth2/token 换 access/refresh/id token →
 *   解码 id_token claims v1 得 profile → 映射成 `User`。
 *
 * 另提供 refreshTokens()（旋转式刷新），由 AuthService 编排调用。
 * 端点经 OIDC discovery 自动发现（进程内缓存）。
 * 登出为客户端本地登出（仅清本机 token），不经此 client 销毁账号中心会话。
 *
 * 与 AuthService 的衔接：startLogin() 返回 handle（authorizeUrl + completion Promise + cancel），
 * AuthService 负责打开浏览器、生成 pendingId、在 completion resolve 后存 token + 发 state-changed。
 *
 * 安全边界：原始 token 仅在主进程内流转；profile 映射出的 User（非凭据）缓存在
 * ~/.asci[-dev]/auth-opensci-user.json，供 getCurrentUser 在重启后恢复登录态。
 *
 * 设计依据：docs/specs/account-hydra-direct-spec.md
 */

import { createServer, type Server } from 'node:http'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { AuthErrorCode, AuthServerConnectionCheck, Result, User } from '@asci/shared'
import { nowIso, nowMs } from '@asci/shared'
import { getConfigDir, getConfigDirName } from './config-paths.ts'
import { getFetchFn } from './proxy-fetch.ts'
import { getEffectiveProxyUrl } from './proxy-settings-service.ts'
import {
  generatePkce,
  decodeJwtClaims,
  parseDiscoveryDocument,
  buildAuthorizeUrl,
  parseCallbackUrl,
  parseTokenResponse,
  parseProfileFromTokens,
  type OidcEndpoints,
  type OidcTokens,
  type OpensciProfile,
} from './auth-oidc.ts'

/**
 * 默认 issuer：当前测试环境（接入规范 §1）。生产环境上线后另起 HTTPS 域名，
 * 届时改此常量或经 auth-config.json 覆盖；本机 Hydra 联调用 http://localhost:4444/。
 */
const DEFAULT_ISSUER = 'https://opensci-id-test.opensci.io/'
/** 桌面 public client id（暂定，待账号中心注册确认 —— ASCI-Server#2 对齐项①） */
const DEFAULT_CLIENT_ID = '4342b9db-5440-44d0-a5db-64e79cadbdee'
/**
 * ASCI-Server（Resource Server）base URL：`/me` / `DELETE /me` / `/events` 在此，
 * 与 Hydra issuer（仅 OAuth）**不同源**（ASCI-Server#2：本服务转纯 RS）。
 * 默认 = 已上线的测试环境部署（`asci-test.opensci.io`）；本机 dev 联调经 auth-config.json
 * 的 `asciServerBaseUrl` 覆盖回 `http://localhost:6060/`（生产域名上线后再调此常量）。
 */
const DEFAULT_ASCI_SERVER_BASE = 'https://asci-test.opensci.io/'
/**
 * loopback 固定端口表：Hydra 默认严格匹配注册的 redirect_uris（含端口），
 * 故依次尝试已登记端口；若账号中心确认按 RFC 8252 §7.3 忽略 loopback 端口可回退随机端口。
 */
const DEFAULT_LOOPBACK_PORTS = [53682, 53683, 53684]
/** 回调等待超时（5 分钟，RFC 8252 loopback；用户关掉浏览器不授权也表现为此超时） */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
/** User 设备级缓存文件名（明文，非凭据；profile 映射结果） */
const USER_CACHE_FILE = 'auth-opensci-user.json'
const AUTH_CONFIG_FILE = 'auth-config.json'

/** auth-config.json 本地覆盖（联调切 issuer / client / 端口；旧 asciServerUrl 键废弃忽略） */
interface AuthConfigOverride {
  issuer?: string
  clientId?: string
  loopbackPorts?: number[]
  /** ASCI-Server（RS）base URL（DELETE /me 等业务接口）；默认线上测试环境 asci-test.opensci.io */
  asciServerBaseUrl?: string
}

/** 解析后的接入配置 */
interface ResolvedAuthConfig {
  /** 恒以 / 结尾（{issuer} 直接拼 .well-known 路径） */
  issuer: string
  clientId: string
  loopbackPorts: number[]
  /** 恒以 / 结尾（直接拼 RS 路径，如 me） */
  asciServerBaseUrl: string
}

/** 登录成功结果（直连 Hydra 的 token + 映射后的 User） */
export interface OpensciLoginResult {
  googleClientId?: string
  user: User
  accessToken: string
  refreshToken: string | null
  /** access token 过期时间戳（ms） */
  expiresAt: number
}

/** 一次登录会话句柄：AuthService 打开 authorizeUrl，等 completion，必要时 cancel */
export interface OpensciLoginHandle {
  authorizeUrl: string
  /** loopback 收到回调并完成 token 交换后 resolve（成功或失败） */
  completion: Promise<Result<OpensciLoginResult>>
  /** 取消登录（关闭 loopback server，completion 以 oauth-cancelled resolve） */
  cancel(): void
}

export interface OpensciAuthClient {
  /** 起 loopback + 构造 authorizeUrl；返回 handle 供 AuthService 编排 */
  startLogin(): Promise<OpensciLoginHandle>
  /**
   * 旋转式刷新（grant_type=refresh_token）。错误语义：
   * network-error = 离线（调用方保持登录态宽限）；token-expired = 被拒（吊销/冻结/全局登出，调用方清态）。
   */
  refreshTokens(refreshToken: string, googleClientId?: string): Promise<Result<OidcTokens>>
  /**
   * 删除账户（DO-3）：调 ASCI-Server `DELETE /me` 清服务端身份映射 + 演化遥测事件。
   * 契约（ASCI-Server#2 接口表）：
   *   DELETE {asciServerBaseUrl}me，Authorization: Bearer {accessToken}，幂等 204。
   * 错误语义：401/403 → token-expired（需重新登录）；其他 4xx/5xx → oauth-provider-error；网络 → network-error。
   */
  deleteAccount(accessToken: string): Promise<Result<void>>
  /**
   * dev-only 连通自检：只读 `GET {asciServerBaseUrl}me`，与 deleteAccount 走完全相同的
   * base URL + Bearer 链路但零副作用——验证 ASCI-Server 可达且接受当前 access token。
   * 任意 HTTP 响应都回 ok（带 httpStatus）；仅网络层失败回 network-error。
   */
  verifyConnection(accessToken: string): Promise<Result<AuthServerConnectionCheck>>
  /** 缓存 User（登录成功后），供重启恢复登录态 */
  cacheUser(user: User, googleClientId?: string): void
  validateSessionBinding?(googleClientId?: string): Result<void>
  /** 读 User 缓存（无 / 损坏返回 null） */
  getCachedUser(): User | null
  /** 清 User 缓存（登出） */
  clearCachedUser(): void
}

/** OpensciProfile（claims v1）→ User 映射（纯函数，便于单测）；v1 无 email/机构/学科 → 空值收敛 */
export function opensciProfileToUser(profile: OpensciProfile, nowIsoStr: string): User {
  return {
    uid: profile.uid,
    email: '',
    emailVerified: true, // OIDC 登录视为已验证（凭证校验在账号中心完成）
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl,
    institution: null,
    field: null,
    preferredLanguage: null,
    linkedProviders: ['opensci'],
    linkedOpenSciId: profile.uid,
    createdAt: nowIsoStr,
    lastLoginAt: nowIsoStr,
  }
}

/** 读 auth-config.json 合并默认接入配置 */
function resolveAuthConfig(): ResolvedAuthConfig {
  let override: AuthConfigOverride = {}
  const path = join(getConfigDir(), AUTH_CONFIG_FILE)
  if (existsSync(path)) {
    try {
      override = JSON.parse(readFileSync(path, 'utf-8')) as AuthConfigOverride
    } catch (error) {
      console.warn('[auth-opensci] 读取 auth-config.json 失败，用默认配置:', error)
    }
  }
  const rawIssuer = override.issuer ?? DEFAULT_ISSUER
  const issuer = rawIssuer.endsWith('/') ? rawIssuer : `${rawIssuer}/`
  const ports = override.loopbackPorts?.filter((p) => Number.isInteger(p) && p > 0 && p < 65536)
  if (getConfigDirName() === '.asci-dev' && !override.issuer) {
    console.info('[auth-opensci] dev 未配置 issuer，默认测试环境:', issuer)
  }
  const rawServerBase = override.asciServerBaseUrl ?? DEFAULT_ASCI_SERVER_BASE
  const asciServerBaseUrl = rawServerBase.endsWith('/') ? rawServerBase : `${rawServerBase}/`
  return {
    issuer,
    clientId: override.clientId ?? DEFAULT_CLIENT_ID,
    loopbackPorts: ports && ports.length > 0 ? ports : DEFAULT_LOOPBACK_PORTS,
    asciServerBaseUrl,
  }
}

/** ASCI-Server（RS）base URL 取值器：供主进程业务（如 journal 检索源 env 注入）复用单一真相源。 */
export function getAsciServerBaseUrl(): string {
  return resolveAuthConfig().asciServerBaseUrl
}

function err(code: AuthErrorCode, message: string): Result<never> {
  return { ok: false, error: { code, message } }
}

/** 回调浏览器页（极简静态 HTML；面向浏览器，非 app UI，固定英文） */
function callbackHtml(ok: boolean): string {
  const title = ok ? 'Signed in' : 'Sign-in failed'
  const body = ok ? 'You can close this tab and return to ASCI.' : 'Please return to ASCI and try again.'
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#333}main{text-align:center}</style>
</head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`
}

/** 依次尝试固定端口表绑定 127.0.0.1；全占用 reject */
async function listenOnFirstFreePort(server: Server, ports: number[]): Promise<number> {
  for (const port of ports) {
    const bound = await new Promise<boolean>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false)
        else reject(error)
      }
      server.once('error', onError)
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError)
        resolve(true)
      })
    })
    if (bound) return port
  }
  throw new Error(`all loopback ports in use: ${ports.join(', ')}`)
}

export function createOpensciAuthClient(): OpensciAuthClient {
  const userCachePath = join(getConfigDir(), USER_CACHE_FILE)
  /** discovery 进程内缓存（key=issuer；issuer 可被 auth-config.json 热改，故按值缓存） */
  const endpointsCache = new Map<string, OidcEndpoints>()

  async function discoverEndpoints(issuer: string): Promise<OidcEndpoints> {
    const cached = endpointsCache.get(issuer)
    if (cached) return cached
    const fetchFn = getFetchFn(await getEffectiveProxyUrl())
    const res = await fetchFn(`${issuer}.well-known/openid-configuration`)
    if (!res.ok) throw new Error(`discovery HTTP ${res.status}`)
    const endpoints = parseDiscoveryDocument(await res.json())
    if (!endpoints) throw new Error('discovery document missing endpoints')
    endpointsCache.set(issuer, endpoints)
    return endpoints
  }

  /** token endpoint 表单请求（授权码交换 / refresh 共用）；4xx → token-expired，5xx → oauth-provider-error */
  async function postTokenEndpoint(
    tokenEndpoint: string,
    form: Record<string, string>,
  ): Promise<Result<OidcTokens>> {
    try {
      const fetchFn = getFetchFn(await getEffectiveProxyUrl())
      const res = await fetchFn(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      })
      if (!res.ok) {
        const code: AuthErrorCode = res.status >= 400 && res.status < 500 ? 'token-expired' : 'oauth-provider-error'
        // Hydra 在响应体回 OAuth 错误（error / error_description），是定位失败原因的关键
        const body = await res.text().catch(() => '')
        console.warn(`[auth-opensci] token endpoint HTTP ${res.status}:`, body)
        return err(code, `token endpoint HTTP ${res.status}: ${body}`)
      }
      const tokens = parseTokenResponse(await res.json(), nowMs())
      if (!tokens) return err('oauth-provider-error', 'token response missing access_token')
      return { ok: true, value: tokens }
    } catch (error) {
      return err('network-error', String(error))
    }
  }

  async function startLogin(): Promise<OpensciLoginHandle> {
    const config = resolveAuthConfig()
    const endpoints = await discoverEndpoints(config.issuer)
    const pkce = generatePkce()

    let settled = false
    let settle!: (r: Result<OpensciLoginResult>) => void
    const completion = new Promise<Result<OpensciLoginResult>>((resolve) => {
      settle = resolve
    })
    let timeout: ReturnType<typeof setTimeout>

    /** 统一收尾：幂等关 server、清定时器、resolve */
    const finish = (r: Result<OpensciLoginResult>): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      server.close()
      settle(r)
    }

    /** code + verifier 直连 token endpoint → 解码 claims v1 profile → User */
    const exchange = async (code: string, redirectUri: string): Promise<Result<OpensciLoginResult>> => {
      const r = await postTokenEndpoint(endpoints.tokenEndpoint, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        code_verifier: pkce.verifier,
      })
      if (!r.ok) return r
      const tokens = r.value
      const profile = parseProfileFromTokens(tokens.idToken, tokens.accessToken, nowMs())
      if (!profile) return err('oauth-provider-error', 'token missing decodable sub claim')
      return {
        ok: true,
        value: {
          user: opensciProfileToUser(profile, nowIso()),
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        },
      }
    }

    const server = createServer((req, res) => {
      const rawUrl = req.url ?? ''
      const parsed = parseCallbackUrl(rawUrl, pkce.state)
      // favicon 等无关请求直接 404，不结束登录会话
      if (parsed.kind === 'invalid' && !rawUrl.startsWith('/callback')) {
        res.writeHead(404).end()
        return
      }
      const ok = parsed.kind === 'code'
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(callbackHtml(ok))

      if (parsed.kind === 'code') {
        void exchange(parsed.code, redirectUri).then(finish)
        return
      }
      const code: AuthErrorCode =
        parsed.kind === 'denied' ? 'oauth-cancelled'
        : parsed.kind === 'state-mismatch' ? 'oauth-state-mismatch'
        : 'unknown'
      finish(err(code, `callback ${parsed.kind}`))
    })

    // 绑定 127.0.0.1 固定端口表首个空闲端口（须与注册的 redirect_uris 一致）。
    // 探测期的 EADDRINUSE 由 listenOnFirstFreePort 内部逐个消化，故持久 error
    // 处理器必须在绑定成功后再挂——否则探测时的端口占用会被误判为登录失败。
    const port = await listenOnFirstFreePort(server, config.loopbackPorts)

    server.on('error', (error) => {
      console.error('[auth-opensci] loopback server 异常:', error)
      finish(err('unknown', String(error)))
    })

    timeout = setTimeout(() => finish(err('oauth-cancelled', 'login timeout')), LOGIN_TIMEOUT_MS)

    const redirectUri = `http://127.0.0.1:${port}/callback`
    const authorizeUrl = buildAuthorizeUrl({
      authorizationEndpoint: endpoints.authorizationEndpoint,
      clientId: config.clientId,
      redirectUri,
      challenge: pkce.challenge,
      state: pkce.state,
    })

    return {
      authorizeUrl,
      completion,
      cancel: () => finish(err('oauth-cancelled', 'cancelled by user')),
    }
  }

  return {
    startLogin,
    async refreshTokens(refreshToken) {
      const config = resolveAuthConfig()
      let endpoints: OidcEndpoints
      try {
        endpoints = await discoverEndpoints(config.issuer)
      } catch (error) {
        return err('network-error', String(error))
      }
      return postTokenEndpoint(endpoints.tokenEndpoint, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
      })
    },
    async deleteAccount(accessToken) {
      const { asciServerBaseUrl } = resolveAuthConfig()
      try {
        const fetchFn = getFetchFn(await getEffectiveProxyUrl())
        // ASCI-Server DELETE /me：清身份映射 + 演化遥测事件，幂等 204
        const res = await fetchFn(`${asciServerBaseUrl}me`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          const code: AuthErrorCode =
            res.status === 401 || res.status === 403 ? 'token-expired' : 'oauth-provider-error'
          console.warn(`[auth-opensci] DELETE /me HTTP ${res.status}:`, body)
          return err(code, `DELETE /me HTTP ${res.status}: ${body}`)
        }
        return { ok: true, value: undefined }
      } catch (error) {
        return err('network-error', String(error))
      }
    },
    async verifyConnection(accessToken) {
      const { asciServerBaseUrl } = resolveAuthConfig()
      try {
        const fetchFn = getFetchFn(await getEffectiveProxyUrl())
        // 只读 GET /me：可达即收到 HTTP 响应；2xx 即 RS 接受了 token。不做任何写/删。
        const res = await fetchFn(`${asciServerBaseUrl}me`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (!res.ok) {
          // 仅失败时打印诊断：响应体（常含拒绝原因，如 invalid token/audience）+ token 关键 claims
          const body = await res.text().catch(() => '')
          const claims = decodeJwtClaims(accessToken)
          console.warn(`[auth-opensci][verify] GET /me HTTP ${res.status}:`, body, {
            isJwt: !!claims,
            aud: claims?.aud,
            client_id: claims?.client_id,
          })
        }
        return {
          ok: true,
          value: { serverBaseUrl: asciServerBaseUrl, httpStatus: res.status, authorized: res.ok },
        }
      } catch (error) {
        return err('network-error', String(error))
      }
    },
    cacheUser(user) {
      try {
        writeFileSync(userCachePath, JSON.stringify(user, null, 2), 'utf-8')
      } catch (error) {
        console.warn('[auth-opensci] 写 User 缓存失败:', error)
      }
    },
    getCachedUser() {
      if (!existsSync(userCachePath)) return null
      try {
        return JSON.parse(readFileSync(userCachePath, 'utf-8')) as User
      } catch (error) {
        console.warn('[auth-opensci] 读 User 缓存失败:', error)
        return null
      }
    },
    clearCachedUser() {
      try {
        rmSync(userCachePath, { force: true })
      } catch (error) {
        console.warn('[auth-opensci] 清 User 缓存失败:', error)
      }
    },
  }
}
