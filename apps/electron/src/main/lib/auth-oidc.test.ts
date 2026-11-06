/**
 * auth-oidc 纯逻辑单测（PKCE / discovery / 回调解析 / token 响应解析 / claims v1 / 过期判定）
 */

import { describe, test, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  generatePkce,
  parseDiscoveryDocument,
  buildAuthorizeUrl,
  parseCallbackUrl,
  parseTokenResponse,
  decodeJwtClaims,
  parseProfileFromClaims,
  parseProfileFromTokens,
  isTokenExpired,
  DEFAULT_SCOPE,
} from './auth-oidc'

/** 构造一个仅含 payload 的假 JWT（header.payload.sig，sig 任意——桌面端不验签） */
function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.sig`
}

describe('generatePkce', () => {
  test('challenge = S256(verifier)，base64url 无填充；state 非空且每次不同', () => {
    const p = generatePkce()
    expect(p.challenge).toBe(createHash('sha256').update(p.verifier).digest('base64url'))
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(p.state.length).toBeGreaterThanOrEqual(8) // Hydra 强制 state ≥8 字符
    expect(generatePkce().state).not.toBe(p.state)
  })
})

describe('parseDiscoveryDocument', () => {
  test('解析授权 / token 端点', () => {
    expect(
      parseDiscoveryDocument({
        authorization_endpoint: 'https://id.x/oauth2/auth',
        token_endpoint: 'https://id.x/oauth2/token',
      }),
    ).toEqual({
      authorizationEndpoint: 'https://id.x/oauth2/auth',
      tokenEndpoint: 'https://id.x/oauth2/token',
    })
  })

  test('缺必要端点 / 非对象 → null', () => {
    expect(parseDiscoveryDocument({ token_endpoint: 'https://id.x/oauth2/token' })).toBeNull()
    expect(parseDiscoveryDocument(null)).toBeNull()
    expect(parseDiscoveryDocument('nope')).toBeNull()
  })
})

describe('buildAuthorizeUrl', () => {
  test('授权 URL 含 PKCE S256 + state + 默认 scope', () => {
    const url = new URL(
      buildAuthorizeUrl({
        authorizationEndpoint: 'https://id.x/oauth2/auth',
        clientId: 'asci-desktop',
        redirectUri: 'http://127.0.0.1:53682/callback',
        challenge: 'chal',
        state: 'st-12345678',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://id.x/oauth2/auth')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('asci-desktop')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:53682/callback')
    expect(url.searchParams.get('scope')).toBe(DEFAULT_SCOPE)
    expect(url.searchParams.get('state')).toBe('st-12345678')
    expect(url.searchParams.get('code_challenge')).toBe('chal')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })
})

describe('parseCallbackUrl', () => {
  test('合法回调（code + state 匹配）返回授权码', () => {
    expect(parseCallbackUrl('/callback?code=abc&state=st-1', 'st-1')).toEqual({ kind: 'code', code: 'abc' })
  })

  test('state 不匹配 / 缺失 → state-mismatch', () => {
    expect(parseCallbackUrl('/callback?code=abc&state=evil', 'st-1')).toEqual({ kind: 'state-mismatch' })
    expect(parseCallbackUrl('/callback?code=abc', 'st-1')).toEqual({ kind: 'state-mismatch' })
  })

  test('用户拒绝授权 → denied', () => {
    expect(parseCallbackUrl('/callback?error=access_denied&state=st-1', 'st-1')).toEqual({ kind: 'denied' })
  })

  test('非 /callback 路径与缺 code → invalid', () => {
    expect(parseCallbackUrl('/favicon.ico', 'st-1')).toEqual({ kind: 'invalid' })
    expect(parseCallbackUrl('/callback?state=st-1', 'st-1')).toEqual({ kind: 'invalid' })
  })
})

describe('parseTokenResponse', () => {
  const NOW = 1_780_000_000_000

  test('access/refresh/id 三 token + expires_in 折算绝对过期时间戳', () => {
    const tokens = parseTokenResponse(
      { access_token: 'at', refresh_token: 'rt', id_token: 'it', expires_in: 600 },
      NOW,
    )
    expect(tokens).toEqual({ accessToken: 'at', refreshToken: 'rt', idToken: 'it', expiresAt: NOW + 600_000 })
  })

  test('缺 refresh_token / id_token 容忍为 null；缺 expires_in 默认 15min（规范 §5 TTL）', () => {
    const tokens = parseTokenResponse({ access_token: 'at' }, NOW)
    expect(tokens?.refreshToken).toBeNull()
    expect(tokens?.idToken).toBeNull()
    expect(tokens?.expiresAt).toBe(NOW + 15 * 60_000)
  })

  test('缺 access_token / 非对象 → null', () => {
    expect(parseTokenResponse({ refresh_token: 'rt' }, NOW)).toBeNull()
    expect(parseTokenResponse('nope', NOW)).toBeNull()
    expect(parseTokenResponse(null, NOW)).toBeNull()
  })
})

describe('decodeJwtClaims', () => {
  test('解码 payload claims（不验签）', () => {
    const jwt = fakeJwt({ sub: 'uid-1', name: 'Nick' })
    expect(decodeJwtClaims(jwt)).toEqual({ sub: 'uid-1', name: 'Nick' })
  })

  test('非三段 / payload 非法 base64 → null', () => {
    expect(decodeJwtClaims('not-a-jwt')).toBeNull()
    expect(decodeJwtClaims('a.!!!.c')).toBeNull()
  })
})

describe('parseProfileFromClaims（claims v1）', () => {
  const NOW = 1_780_000_000_000

  test('完整字段映射（头像取标准 picture；auth_method 透传）', () => {
    const profile = parseProfileFromClaims(
      { sub: 'uid-1', auth_method: 'orcid', claims_ver: 1, name: 'Nick', picture: 'https://x/a.png' },
      NOW,
    )
    expect(profile).toEqual({
      uid: 'uid-1',
      authMethod: 'orcid',
      nickname: 'Nick',
      avatarUrl: 'https://x/a.png',
      syncedAt: NOW,
    })
  })

  test('首登 token 缺 name/picture（presence 规则）：昵称兜底 sub、头像 null', () => {
    const minimal = parseProfileFromClaims({ sub: 'uid-1', auth_method: 'email_otp', claims_ver: 1 }, NOW)
    expect(minimal?.nickname).toBe('uid-1')
    expect(minimal?.avatarUrl).toBeNull()
  })

  test('缺 sub → null；auth_method 防御性容忍缺失', () => {
    expect(parseProfileFromClaims({ name: 'x' }, NOW)).toBeNull()
    expect(parseProfileFromClaims({ sub: 'uid-1' }, NOW)?.authMethod).toBeNull()
  })
})

describe('parseProfileFromTokens', () => {
  const NOW = 1_780_000_000_000

  test('优先用 id_token；缺失时回退 access_token（两者皆含 sub）', () => {
    const idJwt = fakeJwt({ sub: 'uid-id', name: 'From ID' })
    const accessJwt = fakeJwt({ sub: 'uid-access', name: 'From Access' })
    expect(parseProfileFromTokens(idJwt, accessJwt, NOW)?.uid).toBe('uid-id')
    expect(parseProfileFromTokens(null, accessJwt, NOW)?.uid).toBe('uid-access')
  })

  test('两者都解不出 sub → null', () => {
    expect(parseProfileFromTokens(fakeJwt({ name: 'x' }), 'bad.token', NOW)).toBeNull()
  })
})

describe('isTokenExpired', () => {
  test('60s 提前量：到期前 61s 未过期、前 59s 视为过期', () => {
    const expiresAt = 1_780_000_000_000
    expect(isTokenExpired(expiresAt, expiresAt - 61_000)).toBe(false)
    expect(isTokenExpired(expiresAt, expiresAt - 59_000)).toBe(true)
  })
})
