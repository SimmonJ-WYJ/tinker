import { test, expect, beforeEach, afterEach, mock } from 'bun:test'
import {
  listCollections,
  searchItems,
  getCollectionItems,
  getItem,
  getAttachmentPath,
} from './zotero-library.ts'

const originalFetch = globalThis.fetch
beforeEach(() => { globalThis.fetch = mock() as unknown as typeof fetch; delete process.env.ZOTERO_DATA_DIR })
afterEach(() => { globalThis.fetch = originalFetch })

test('listCollections 返回扁平数组', async () => {
  const raw = [
    { key: 'A', version: 1, data: { name: 'Root', parentCollection: false } },
    { key: 'B', version: 1, data: { name: 'Child', parentCollection: 'A' } },
  ]
  globalThis.fetch = mock(async () => new Response(JSON.stringify(raw), {
    status: 200, headers: { 'content-type': 'application/json' },
  }))
  const result = await listCollections()
  expect(result).toEqual([
    { key: 'A', name: 'Root', parentKey: null },
    { key: 'B', name: 'Child', parentKey: 'A' },
  ])
})

test('searchItems 带 q / qmode / limit / start / format', async () => {
  let captured = ''
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    captured = String(url)
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  await searchItems({ query: 'attention', limit: 50, offset: 20 })
  expect(captured).toContain('q=attention')
  expect(captured).toContain('qmode=everything')
  expect(captured).toContain('limit=50')
  expect(captured).toContain('start=20')
  expect(captured).toContain('format=json')
})

test('searchItems 默认 limit=100, offset=0', async () => {
  let captured = ''
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    captured = String(url)
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  await searchItems({ query: 'x' })
  expect(captured).toContain('limit=100')
  expect(captured).toContain('start=0')
})

test('searchItems 返回 ItemSummary[]', async () => {
  const raw = [{
    key: 'X', version: 1, data: {
      itemType: 'journalArticle', title: 'T',
      creators: [{ creatorType: 'author', firstName: 'A', lastName: 'B' }],
      collections: ['C1'],
    },
  }]
  globalThis.fetch = mock(async () => new Response(JSON.stringify(raw), {
    status: 200, headers: { 'content-type': 'application/json' },
  }))
  const result = await searchItems({ query: 'x' })
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ key: 'X', title: 'T', creators: ['A B'] })
})

test('getCollectionItems collectionKey=null → 走 /users/0/items/top', async () => {
  let captured = ''
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    captured = String(url)
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  await getCollectionItems({ collectionKey: null, limit: 10 })
  expect(captured).toContain('/users/0/items/top')
  expect(captured).toContain('limit=10')
})

test('getCollectionItems collectionKey=<key> → 走 /users/0/collections/<key>/items/top', async () => {
  let captured = ''
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    captured = String(url)
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  await getCollectionItems({ collectionKey: 'ABC', limit: 10 })
  expect(captured).toContain('/users/0/collections/ABC/items/top')
})

test('getCollectionItems 过滤掉 attachment 与 note', async () => {
  const raw = [
    { key: 'P', version: 1, data: { itemType: 'journalArticle', title: 'Paper' } },
    { key: 'A', version: 1, data: { itemType: 'attachment', title: 'PDF', contentType: 'application/pdf', linkMode: 'imported_file', filename: 'p.pdf' } },
    { key: 'N', version: 1, data: { itemType: 'note', note: '<p>hi</p>' } },
    { key: 'B', version: 1, data: { itemType: 'book', title: 'Book' } },
  ]
  globalThis.fetch = mock(async () => new Response(JSON.stringify(raw), {
    status: 200, headers: { 'content-type': 'application/json' },
  }))
  const result = await getCollectionItems({ collectionKey: null })
  expect(result.map((i) => i.key)).toEqual(['P', 'B'])
})

test('searchItems 过滤掉 attachment 与 note', async () => {
  const raw = [
    { key: 'P', version: 1, data: { itemType: 'journalArticle', title: 'Paper' } },
    { key: 'A', version: 1, data: { itemType: 'attachment', title: 'PDF', contentType: 'application/pdf', linkMode: 'imported_file', filename: 'p.pdf' } },
  ]
  globalThis.fetch = mock(async () => new Response(JSON.stringify(raw), {
    status: 200, headers: { 'content-type': 'application/json' },
  }))
  const result = await searchItems({ query: 'x' })
  expect(result.map((i) => i.key)).toEqual(['P'])
})

test('getItem 命中 → status=ok + detail（issue #462）', async () => {
  const raw = {
    key: 'X', version: 1,
    data: { itemType: 'journalArticle', title: 'T', abstractNote: 'abs', DOI: '10.x' },
  }
  globalThis.fetch = mock(async () => new Response(JSON.stringify(raw), {
    status: 200, headers: { 'content-type': 'application/json' },
  }))
  const result = await getItem({ itemKey: 'X' })
  expect(result.status).toBe('ok')
  if (result.status === 'ok') {
    expect(result.detail).toMatchObject({ key: 'X', title: 'T', abstract: 'abs', doi: '10.x' })
  }
})

test('getItem 遇 Zotero 404 → status=deleted（条目已删除，issue #462）', async () => {
  // 404 → fetchZotero 抛 ZoteroError('not_found')；getItem 转 deleted。
  // 本测试无 objects DB → lookupCachedPaperMeta 兜底返回 null（不抛）。
  globalThis.fetch = mock(async () => new Response('not found', {
    status: 404, headers: { 'content-type': 'application/json' },
  }))
  const result = await getItem({ itemKey: 'GONE' })
  expect(result.status).toBe('deleted')
  if (result.status === 'deleted') {
    expect(result.cachedMeta).toBeNull()
  }
})

test('getItem 遇其它故障（403 连接被禁）→ status=error（保留请重试语义，issue #462）', async () => {
  globalThis.fetch = mock(async () => new Response('forbidden', {
    status: 403, headers: { 'content-type': 'application/json' },
  }))
  const result = await getItem({ itemKey: 'X' })
  expect(result.status).toBe('error')
  if (result.status === 'error') {
    expect(result.errorType).toBe('remote_connection_disabled')
  }
})

test('getAttachmentPath PDF found', async () => {
  const children = [{
    key: 'ATT1', version: 1, data: {
      itemType: 'attachment', filename: 'p.pdf',
      contentType: 'application/pdf', linkMode: 'imported_file',
    },
  }]
  globalThis.fetch = mock(async () => new Response(JSON.stringify(children), {
    status: 200, headers: { 'content-type': 'application/json' },
  }))
  const result = await getAttachmentPath({ itemKey: 'I' })
  expect(result).toMatchObject({ found: true, filename: 'p.pdf', contentType: 'application/pdf' })
})

test('getAttachmentPath 无附件 → found=false', async () => {
  globalThis.fetch = mock(async () => new Response('[]', {
    status: 200, headers: { 'content-type': 'application/json' },
  }))
  const result = await getAttachmentPath({ itemKey: 'I' })
  expect(result).toEqual({ found: false })
})
