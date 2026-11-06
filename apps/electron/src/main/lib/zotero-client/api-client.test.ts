import { test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { fetchZotero, pingZotero, ZoteroError } from './api-client.ts'

const originalFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = mock() as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('fetchZotero 正常返回 JSON', async () => {
  globalThis.fetch = mock(async () => new Response(JSON.stringify([{ key: 'X' }]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
  const data = await fetchZotero('/users/0/items?limit=1')
  expect(data).toEqual([{ key: 'X' }])
})

test('连接失败抛 zotero_not_running', async () => {
  globalThis.fetch = mock(async () => { throw new TypeError('fetch failed: ECONNREFUSED') })
  await expect(fetchZotero('/users/0/items')).rejects.toBeInstanceOf(ZoteroError)
  await expect(fetchZotero('/users/0/items')).rejects.toMatchObject({ type: 'zotero_not_running' })
})

test('403 抛 remote_connection_disabled', async () => {
  globalThis.fetch = mock(async () => new Response('forbidden', { status: 403 }))
  await expect(fetchZotero('/users/0/items')).rejects.toMatchObject({ type: 'remote_connection_disabled' })
})

test('非 Zotero 响应抛 port_conflict', async () => {
  globalThis.fetch = mock(async () => new Response('<html>nginx</html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  }))
  await expect(fetchZotero('/users/0/items')).rejects.toMatchObject({ type: 'port_conflict' })
})

test('pingZotero Zotero 未启动时返回 false 不抛错', async () => {
  globalThis.fetch = mock(async () => { throw new TypeError('ECONNREFUSED') })
  const result = await pingZotero()
  expect(result).toBe(false)
})

test('pingZotero 超时返回 false', async () => {
  globalThis.fetch = mock(async () => { throw new DOMException('The signal has been aborted', 'AbortError') })
  const result = await pingZotero()
  expect(result).toBe(false)
})

test('pingZotero 成功响应返回 true', async () => {
  globalThis.fetch = mock(async () => new Response('OK', { status: 200 }))
  const result = await pingZotero()
  expect(result).toBe(true)
})
