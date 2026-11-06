import { test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { handleGetItem } from './get-item.ts'

const originalFetch = globalThis.fetch
beforeEach(() => { globalThis.fetch = mock() as unknown as typeof fetch })
afterEach(() => { globalThis.fetch = originalFetch })

test('get-item 返回完整字段', async () => {
  const raw = {
    key: 'ABC',
    version: 9,
    data: {
      itemType: 'journalArticle',
      title: 'T',
      creators: [{ creatorType: 'author', firstName: 'A', lastName: 'B' }],
      date: '2020',
      tags: [{ tag: 'ml' }],
      collections: ['C1'],
      abstractNote: 'abs',
      DOI: '10.1/x',
      url: 'http://x',
    },
  }
  globalThis.fetch = mock(async () => new Response(JSON.stringify(raw), {
    status: 200, headers: { 'content-type': 'application/json' },
  }))
  const result = await handleGetItem({ itemKey: 'ABC' })
  expect(result).toMatchObject({
    key: 'ABC',
    title: 'T',
    creators: ['A B'],
    date: '2020',
    tags: ['ml'],
    collections: ['C1'],
    abstract: 'abs',
    doi: '10.1/x',
    url: 'http://x',
  })
})

test('get-item 传入正确路径', async () => {
  let capturedUrl = ''
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    capturedUrl = String(url)
    return new Response(JSON.stringify({ key: 'X', version: 1, data: { itemType: 'x', title: 't' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  })
  await handleGetItem({ itemKey: 'X' })
  expect(capturedUrl).toContain('/users/0/items/X')
})
