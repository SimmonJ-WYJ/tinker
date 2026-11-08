import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { get } from 'node:http'
import { createConnection } from 'node:net'
import { setLanguage } from './i18n-main.ts'
import { createGoogleAuthClient } from './auth-google-client.ts'
const directory = () => mkdtempSync(join(tmpdir(), 'asci-google-'))
test('missing config gives actionable error', async () => {
  const client = createGoogleAuthClient({ configDir: directory() })
  await expect(client.startLogin()).rejects.toMatchObject({ code: 'oauth-config-missing' })
})
test('loopback uses PKCE and state; mismatch rejects without exchanging', async () => {
  const client = createGoogleAuthClient({ configDir: directory(), config: { clientId: 'desktop.apps.googleusercontent.com' } })
  const h = await client.startLogin()
  const url = new URL(h.authorizeUrl)
  expect(url.origin).toBe('https://accounts.google.com')
  expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  expect(url.searchParams.get('code_challenge')?.length).toBeGreaterThan(30)
  const callback = url.searchParams.get('redirect_uri')!
  expect(new URL(callback).hostname).toBe('127.0.0.1')
  await new Promise<void>((resolve, reject) => { get(`${callback}?code=x&state=wrong`, response => { response.resume(); response.on('end', resolve) }).on('error', reject) })
  expect(await h.completion).toMatchObject({ ok: false, error: { code: 'oauth-state-mismatch' } })
})
test('cancel closes pending login', async () => {
  const h = await createGoogleAuthClient({ configDir: directory(), config: { clientId: 'desktop.apps.googleusercontent.com' } }).startLogin()
  h.cancel()
  expect(await h.completion).toMatchObject({ ok: false, error: { code: 'oauth-cancelled' } })
})
test('refresh preserves token and sends credentials only to Google', async () => {
  const destinations: string[] = []
  const client = createGoogleAuthClient({ configDir: directory(), config: { clientId: 'desktop.apps.googleusercontent.com' }, fetch: async (url) => {
    destinations.push(String(url))
    return Response.json({ access_token: 'new', expires_in: 3600 })
  } })
  expect(await client.refreshTokens('refresh', 'desktop.apps.googleusercontent.com')).toMatchObject({ ok: true, value: { accessToken: 'new', refreshToken: 'refresh' } })
  expect(destinations).toEqual(['https://oauth2.googleapis.com/token'])
})
test('timeout cancels loopback', async () => {
  const h = await createGoogleAuthClient({ configDir: directory(), config: { clientId: 'desktop.apps.googleusercontent.com' }, timeoutMs: 10 }).startLogin()
  expect(await h.completion).toMatchObject({ ok: false, error: { code: 'oauth-cancelled' } })
})
test('verified Google identity login ignores duplicate callbacks', async () => {
  const destinations: string[] = []
  const client = createGoogleAuthClient({ configDir: directory(), config: { clientId: 'desktop.apps.googleusercontent.com' }, fetch: async (url) => {
    destinations.push(url)
    if (url.endsWith('/token')) { await new Promise(r => setTimeout(r, 15)); return Response.json({ access_token: 'google', refresh_token: 'refresh', expires_in: 3600 }) }
    return Response.json({ sub: '123', email: 'test@example.org', email_verified: true, name: 'Test' })
  } })
  const h = await client.startLogin()
  const url = new URL(h.authorizeUrl)
  const callback = `${url.searchParams.get('redirect_uri')}?code=valid&state=${url.searchParams.get('state')}`
  const send = () => new Promise<number>((resolve, reject) => { get(callback, response => { response.resume(); response.on('end', () => resolve(response.statusCode!)) }).on('error', reject) })
  expect(await send()).toBe(200)
  expect(await send()).toBe(409)
  expect(await h.completion).toMatchObject({ ok: true, value: { user: { uid: 'google:123', linkedProviders: ['google'], linkedOpenSciId: null } } })
  expect(destinations).toEqual(['https://oauth2.googleapis.com/token', 'https://openidconnect.googleapis.com/v1/userinfo'])
})
test('disconnect revokes authorization rather than deleting identity', async () => {
  const destinations: string[] = []
  const client = createGoogleAuthClient({ configDir: directory(), fetch: async (url, init) => { destinations.push(url); expect(init?.method).toBe('POST'); return new Response('', { status: 200 }) } })
  expect(await client.deleteAccount('token')).toMatchObject({ ok: true })
  expect(destinations).toEqual(['https://oauth2.googleapis.com/revoke'])
})
test('login freezes Desktop client config while browser is authorizing', async () => {
  const cfg = { clientId: 'first.apps.googleusercontent.com' }
  let exchangedClient = ''
  const client = createGoogleAuthClient({ configDir: directory(), config: cfg, fetch: async (url, init) => {
    if (url.endsWith('/token')) { exchangedClient = new URLSearchParams(String(init?.body)).get('client_id')!; return Response.json({ access_token: 'token', expires_in: 3600 }) }
    return Response.json({ sub: '123', email: 't@example.org', email_verified: true })
  } })
  const h = await client.startLogin()
  cfg.clientId = 'second.apps.googleusercontent.com'
  const url = new URL(h.authorizeUrl)
  await new Promise<void>((resolve, reject) => { get(`${url.searchParams.get('redirect_uri')}?code=x&state=${url.searchParams.get('state')}`, r => { r.resume(); r.on('end', resolve) }).on('error', reject) })
  expect((await h.completion).ok).toBe(true)
  expect(exchangedClient).toBe('first.apps.googleusercontent.com')
})
test('refresh rejects a different client binding without submitting token', async () => {
  let calls = 0
  const client = createGoogleAuthClient({ configDir: directory(), config: { clientId: 'second.apps.googleusercontent.com' }, fetch: async () => { calls++; return Response.json({ access_token: 'token' }) } })
  expect(await client.refreshTokens('old-token', 'first.apps.googleusercontent.com')).toMatchObject({ ok: false, error: { code: 'oauth-config-missing' } })
  expect(calls).toBe(0)
})
test('missing configuration during refresh is never an offline network error', async () => {
  const client = createGoogleAuthClient({ configDir: directory() })
  expect(await client.refreshTokens('old-token', 'first.apps.googleusercontent.com')).toMatchObject({ ok: false, error: { code: 'oauth-config-missing' } })
})
test('malformed HTTP target returns 400 and leaves pending login usable', async () => {
  const h = await createGoogleAuthClient({ configDir: directory(), config: { clientId: 'desktop.apps.googleusercontent.com' } }).startLogin()
  const callback = new URL(new URL(h.authorizeUrl).searchParams.get('redirect_uri')!)
  const status = await new Promise<number>((resolve, reject) => {
    const socket = createConnection({ host: callback.hostname, port: Number(callback.port) }, () => socket.write('GET http://[invalid HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'))
    socket.once('data', data => { resolve(Number(data.toString().split(' ')[1])); socket.destroy() })
    socket.on('error', reject)
  })
  expect(status).toBe(400)
  h.cancel()
  expect(await h.completion).toMatchObject({ ok: false, error: { code: 'oauth-cancelled' } })
})


test('loopback responses use the current language and Tinker branding', async () => {
  for (const language of ['en', 'zh'] as const) {
    setLanguage(language)
    try {
      for (const outcome of ['security', 'cancelled', 'received'] as const) {
        const h = await createGoogleAuthClient({
          configDir: directory(), config: { clientId: 'desktop.apps.googleusercontent.com' },
          fetch: async () => new Response('', { status: 400 }),
        }).startLogin()
        const url = new URL(h.authorizeUrl)
        const callback = new URL(url.searchParams.get('redirect_uri')!)
        callback.searchParams.set('state', outcome === 'security' ? 'wrong' : url.searchParams.get('state')!)
        callback.searchParams.set(outcome === 'cancelled' ? 'error' : 'code', 'test')
        const response = await new Promise<{ body: string; contentType: string }>((resolve, reject) => {
          get(callback, res => {
            let body = ''
            res.setEncoding('utf8')
            res.on('data', chunk => { body += chunk })
            res.on('end', () => resolve({ body, contentType: String(res.headers['content-type']) }))
          }).on('error', reject)
        })
        expect(response.body).toContain('Tinker')
        expect(response.body).not.toMatch(/ASCI|OPENSCI/i)
        expect(response.contentType).toBe('text/plain; charset=utf-8')
        expect(/[\u4e00-\u9fff]/.test(response.body)).toBe(language === 'zh')
        await h.completion
      }
    } finally { setLanguage('en') }
  }
})
