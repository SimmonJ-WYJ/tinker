import { test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { handlePing } from './ping.ts'

const originalFetch = globalThis.fetch
beforeEach(() => { globalThis.fetch = mock() as unknown as typeof fetch })
afterEach(() => { globalThis.fetch = originalFetch })

test('Zotero 在跑 + 远程启用 → running=true, remoteEnabled=true', async () => {
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    const s = String(url)
    if (s.includes('/connector/ping')) return new Response('OK', { status: 200 })
    if (s.includes('/api/users/0/items?limit=1')) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response('nope', { status: 404 })
  })
  const result = await handlePing()
  expect(result).toEqual({ running: true, remoteEnabled: true })
})

test('Zotero 未启动 → running=false, remoteEnabled=false', async () => {
  globalThis.fetch = mock(async () => { throw new TypeError('ECONNREFUSED') })
  const result = await handlePing()
  expect(result).toEqual({ running: false, remoteEnabled: false })
})

test('Zotero 在跑但远程未启用 → running=true, remoteEnabled=false', async () => {
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    const s = String(url)
    if (s.includes('/connector/ping')) return new Response('OK', { status: 200 })
    return new Response('forbidden', { status: 403 })
  })
  const result = await handlePing()
  expect(result).toEqual({ running: true, remoteEnabled: false })
})

test('ping 与 api 之间 Zotero 退出 → running=false, remoteEnabled=false', async () => {
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    const s = String(url)
    if (s.includes('/connector/ping')) return new Response('OK', { status: 200 })
    throw new TypeError('ECONNREFUSED') // Zotero 退出
  })
  const result = await handlePing()
  expect(result).toEqual({ running: false, remoteEnabled: false })
})
