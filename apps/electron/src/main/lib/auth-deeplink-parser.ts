// apps/electron/src/main/lib/auth-deeplink-parser.ts
/**
 * asci:// URL 解析 - spec §六 6.5
 */

export type ParsedAsciUrl =
  | { kind: 'oauth-callback'; code: string | null; state: string; error: string | null }
  | { kind: 'verify'; token: string }
  | { kind: 'reset'; token: string }

export function parseAsciUrl(raw: string): ParsedAsciUrl | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'asci:') return null

  const host = url.host || url.pathname.replace(/^\/\//, '').split('/')[0]
  if (!host) return null
  const params = url.searchParams

  if (host === 'oauth') {
    // path 必须是 /callback
    if (!url.pathname.endsWith('/callback')) return null
    const state = params.get('state')
    if (!state) return null
    return {
      kind: 'oauth-callback',
      code: params.get('code'),
      state,
      error: params.get('error'),
    }
  }
  if (host === 'verify') {
    const token = params.get('token')
    if (!token) return null
    return { kind: 'verify', token }
  }
  if (host === 'reset') {
    const token = params.get('token')
    if (!token) return null
    return { kind: 'reset', token }
  }
  return null
}
