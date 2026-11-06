// apps/electron/src/main/lib/auth-stub-server.ts
/**
 * Stub-only HTTP server - spec §六 6.3
 *
 * 仅 !app.isPackaged 启动；提供 OAuth 模拟同意页。
 * 端口 53682 / 53683 / 53684 依次尝试；都占用则降级（OAuth 按钮 disabled）。
 */

import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type { AuthProvider } from '@asci/shared'

const PORTS = [53682, 53683, 53684]

export interface StubServer {
  start(): Promise<{ port: number } | null>
  stop(): Promise<void>
  buildAuthorizeUrl(provider: Exclude<AuthProvider, 'email'>, state: string): string | null
}

export function createStubServer(): StubServer {
  let server: http.Server | null = null
  let activePort: number | null = null

  function html(provider: string, state: string): string {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ASCI Dev OAuth Mock</title>
<style>
  body { font: 14px/1.5 -apple-system, sans-serif; max-width: 480px; margin: 80px auto; padding: 0 20px; color: #111; }
  h1 { font-size: 18px; }
  .meta { color: #666; margin: 16px 0 24px; }
  input { width: 100%; padding: 8px 10px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
  label { display: block; margin: 12px 0 6px; font-size: 12px; color: #444; }
  .btn { display: inline-block; padding: 9px 18px; border: 0; border-radius: 6px; cursor: pointer; margin-top: 16px; font-size: 13px; }
  .approve { background: #4f46e5; color: white; }
  .deny { background: #f3f4f6; color: #111; margin-left: 8px; }
  .note { background: #fef3c7; padding: 12px; border-radius: 6px; margin: 24px 0; font-size: 12px; color: #92400e; }
</style></head><body>
<h1>ASCI Dev OAuth Mock · ${provider.toUpperCase()}</h1>
<div class="meta">这是 ASCI 开发模式的 OAuth 同意模拟页。生产环境不会出现此页。</div>
<form method="POST" action="/stub-oauth/approve?provider=${encodeURIComponent(provider)}&state=${encodeURIComponent(state)}">
  <label>模拟账户邮箱</label>
  <input name="email" required value="alice@example.com" />
  <label>模拟 Subject ID（provider 端的稳定 ID）</label>
  <input name="subjectId" required value="${provider}-${randomUUID().slice(0, 8)}" />
  <button class="btn approve" type="submit">同意授权</button>
</form>
<form method="POST" action="/stub-oauth/deny?state=${encodeURIComponent(state)}" style="display:inline">
  <button class="btn deny" type="submit">拒绝</button>
</form>
<div class="note">同意后将跳转回 ASCI 应用（asci:// 协议）。如果浏览器询问，请点击允许。</div>
</body></html>`
  }

  return {
    async start() {
      if (app.isPackaged) return null

      for (const port of PORTS) {
        try {
          await new Promise<void>((resolve, reject) => {
            const s = http.createServer(async (req, res) => {
              try {
                const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
                if (req.method === 'GET' && url.pathname === '/stub-oauth') {
                  const provider = url.searchParams.get('provider') ?? 'unknown'
                  const state = url.searchParams.get('state') ?? ''
                  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
                  res.end(html(provider, state))
                  return
                }
                if (req.method === 'POST' && url.pathname === '/stub-oauth/approve') {
                  const state = url.searchParams.get('state') ?? ''
                  const provider = url.searchParams.get('provider') ?? 'unknown'
                  // 解析 form body
                  const chunks: Buffer[] = []
                  for await (const c of req) chunks.push(c as Buffer)
                  const body = new URLSearchParams(Buffer.concat(chunks).toString())
                  const email = body.get('email') ?? ''
                  const subjectId = body.get('subjectId') ?? ''
                  // 把 email + subjectId 塞进 code（stub 用法），由 auth-stub.oauthExchange 解出
                  const code = Buffer.from(JSON.stringify({ email, subjectId, provider })).toString(
                    'base64url',
                  )
                  res.writeHead(302, { Location: `asci://oauth/callback?code=${code}&state=${state}` })
                  res.end()
                  return
                }
                if (req.method === 'POST' && url.pathname === '/stub-oauth/deny') {
                  const state = url.searchParams.get('state') ?? ''
                  res.writeHead(302, {
                    Location: `asci://oauth/callback?error=access_denied&state=${state}`,
                  })
                  res.end()
                  return
                }
                res.writeHead(404)
                res.end('not found')
              } catch (e) {
                res.writeHead(500)
                res.end(String(e))
              }
            })
            s.once('error', reject)
            s.listen(port, '127.0.0.1', () => {
              server = s
              activePort = port
              resolve()
            })
          })
          return { port }
        } catch {
          continue
        }
      }
      return null
    },
    async stop() {
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()))
        server = null
        activePort = null
      }
    },
    buildAuthorizeUrl(provider, state) {
      if (activePort === null) return null
      return `http://127.0.0.1:${activePort}/stub-oauth?provider=${encodeURIComponent(provider)}&state=${encodeURIComponent(state)}`
    },
  }
}

/** stub 模式下从 stub-server code 中还原 fixture（email + subjectId）*/
export function decodeStubCode(code: string): { email: string; subjectId: string; provider: string } | null {
  try {
    return JSON.parse(Buffer.from(code, 'base64url').toString())
  } catch {
    return null
  }
}
