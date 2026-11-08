/** Google Desktop OAuth：固定 Google 端点、PKCE、随机 loopback，凭据只留主进程。 */
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AuthErrorCode, Result, User } from '@asci/shared'
import { nowIso, nowMs } from '@asci/shared'
import oauthEn from '../../renderer/locales/en/auth/oauth.json'
import oauthZh from '../../renderer/locales/zh/auth/oauth.json'
import { getLanguage } from './i18n-main.ts'
import { getConfigDir } from './config-paths.ts'
import { readGoogleClientConfig } from './auth-google-config.ts'
import { generatePkce, parseTokenResponse } from './auth-oidc.ts'
import type { OpensciAuthClient, OpensciLoginResult } from './auth-opensci-client.ts'
import { getFetchFn } from './proxy-fetch.ts'
import { getEffectiveProxyUrl } from './proxy-settings-service.ts'
interface GoogleConfig { clientId: string; clientSecret?: string }
interface Options { configDir?: string; config?: GoogleConfig; fetch?: (url: string, init?: RequestInit) => Promise<Response>; timeoutMs?: number }
const OAUTH_MESSAGES = { en: oauthEn, zh: oauthZh }
const fail = (code: AuthErrorCode, message: string): Result<never> => ({ ok: false, error: { code, message } })
export function createGoogleAuthClient(options: Options = {}): OpensciAuthClient {
  const dir = options.configDir ?? getConfigDir()
  const cache = join(dir, 'auth-google-user.json')
  function config(): GoogleConfig {
    let value: GoogleConfig | undefined = options.config
    if (!value) {
      value = readGoogleClientConfig(dir, process.resourcesPath)
    }
    if (!value || typeof value.clientId !== 'string' || !value.clientId.endsWith('.apps.googleusercontent.com')) {
      throw Object.assign(new Error('Configure auth-google.json; see docs/google-login-setup.md'), { code: 'oauth-config-missing' })
    }
    return { ...value }
  }
  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    const proxy = await getEffectiveProxyUrl()
    // 无应用内手动代理时使用 Electron 网络栈，跟随系统/PAC；Node fetch 不会自动继承。
    const fn = options.fetch ?? (proxy ? getFetchFn(proxy) : (await import('electron')).net.fetch)
    return fn(url, { ...init, signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(20_000)]), redirect: 'error' })
  }
  async function tokens(cfg: GoogleConfig, form: Record<string, string>, signal?: AbortSignal) {
    try {
      const response = await request('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal,
        body: new URLSearchParams({ ...form, client_id: cfg.clientId, ...(cfg.clientSecret ? { client_secret: cfg.clientSecret } : {}) }).toString(),
      })
      if (!response.ok) return fail(response.status === 400 || response.status === 401 ? 'token-expired' : 'oauth-provider-error', `Google token HTTP ${response.status}`)
      const parsed = parseTokenResponse(await response.json(), nowMs())
      return parsed ? { ok: true as const, value: parsed } : fail('oauth-provider-error', 'Invalid Google token response')
    } catch { return fail('network-error', 'Google token request failed') }
  }
  return {
    async startLogin() {
      const cfg = config()
      const pkce = generatePkce()
      const controller = new AbortController()
      let settled = false
      let exchanging = false
      let resolve!: (value: Result<OpensciLoginResult>) => void
      const completion = new Promise<Result<OpensciLoginResult>>(r => { resolve = r })
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (result: Result<OpensciLoginResult>) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        controller.abort()
        server.close()
        resolve(result)
      }
      let redirectUri = ''
      const server = createServer((req, res) => {
        let url: URL
        try { url = new URL(req.url ?? '/', 'http://127.0.0.1') } catch { res.writeHead(400).end(); return }
        if (url.pathname !== '/callback' || req.method !== 'GET') { res.writeHead(404).end(); return }
        if (settled || exchanging) { res.writeHead(409).end(); return }
        if (url.searchParams.get('state') !== pkce.state) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(OAUTH_MESSAGES[getLanguage()].callback.security)
          finish(fail('oauth-state-mismatch', 'Google callback state mismatch')); return
        }
        if (url.searchParams.has('error') || !url.searchParams.get('code')) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(OAUTH_MESSAGES[getLanguage()].callback.cancelled)
          finish(fail('oauth-cancelled', 'Google authorization denied')); return
        }
        exchanging = true
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(OAUTH_MESSAGES[getLanguage()].callback.received)
        void (async () => {
          const result = await tokens(cfg, { grant_type: 'authorization_code', code: url.searchParams.get('code')!, redirect_uri: redirectUri, code_verifier: pkce.verifier }, controller.signal)
          if (!result.ok) { finish(result); return }
          try {
            const response = await request('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${result.value.accessToken}` }, signal: controller.signal })
            if (!response.ok) { finish(fail('oauth-provider-error', 'Google identity verification failed')); return }
            const profile = await response.json() as Record<string, unknown>
            if (typeof profile.sub !== 'string' || typeof profile.email !== 'string' || profile.email_verified !== true) {
              finish(fail('oauth-provider-error', 'Google identity is not verified')); return
            }
            const timestamp = nowIso()
            const user: User = { uid: `google:${profile.sub}`, email: profile.email, emailVerified: true, nickname: typeof profile.name === 'string' ? profile.name : null, avatarUrl: typeof profile.picture === 'string' ? profile.picture : null, institution: null, field: null, preferredLanguage: null, linkedProviders: ['google'], linkedOpenSciId: null, createdAt: timestamp, lastLoginAt: timestamp }
            finish({ ok: true, value: { ...result.value, user, googleClientId: cfg.clientId } })
          } catch { finish(fail('network-error', 'Google identity request failed')) }
        })()
      })
      await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen) })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Loopback unavailable')
      redirectUri = `http://127.0.0.1:${address.port}/callback`
      server.on('error', () => finish(fail('network-error', 'Loopback failed')))
      timer = setTimeout(() => finish(fail('oauth-cancelled', 'Google sign-in timeout')), options.timeoutMs ?? 300_000)
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', code_challenge: pkce.challenge, code_challenge_method: 'S256', state: pkce.state, access_type: 'offline', prompt: 'consent' }).toString()
      return { authorizeUrl: url.toString(), completion, cancel: () => finish(fail('oauth-cancelled', 'Cancelled')) }
    },
    validateSessionBinding(googleClientId) {
      try {
        return googleClientId && config().clientId === googleClientId
          ? { ok: true, value: undefined }
          : fail('oauth-config-missing', 'Google Desktop client changed; sign in again')
      } catch { return fail('oauth-config-missing', 'Configure auth-google.json before restoring Google session') }
    },
    async refreshTokens(refreshToken, googleClientId) {
      let cfg: GoogleConfig
      try { cfg = config() } catch { return fail('oauth-config-missing', 'Configure auth-google.json before refreshing') }
      if (!googleClientId || cfg.clientId !== googleClientId) return fail('oauth-config-missing', 'Google Desktop client changed; sign in again')
      const result = await tokens(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken })
      if (result.ok && !result.value.refreshToken) result.value.refreshToken = refreshToken
      return result
    },
    async deleteAccount(token) {
      try {
        const response = await request('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString() })
        return response.ok ? { ok: true, value: undefined } : fail('oauth-provider-error', `Google revoke HTTP ${response.status}`)
      } catch { return fail('network-error', 'Google revoke request failed') }
    },
    async verifyConnection() { return fail('oauth-provider-error', 'Google credentials cannot access OPENSCI services') },
    cacheUser(user, googleClientId) {
      if (!googleClientId) {
        try { googleClientId = (JSON.parse(readFileSync(cache, 'utf8')) as { googleClientId?: string }).googleClientId } catch { /* 首登必须传入绑定 */ }
      }
      if (!googleClientId) throw new Error('Google session missing client binding')
      mkdirSync(dir, { recursive: true }); writeFileSync(cache, JSON.stringify({ user, googleClientId }), { mode: 0o600 })
    },
    getCachedUser() {
      try {
        const cached = JSON.parse(readFileSync(cache, 'utf8')) as { user: User; googleClientId: string }
        const { user } = cached
        return config().clientId === cached.googleClientId && user.uid?.startsWith('google:') && user.linkedProviders?.includes('google') ? user : null
      } catch { return null }
    },
    clearCachedUser() { rmSync(cache, { force: true }) },
  }
}
