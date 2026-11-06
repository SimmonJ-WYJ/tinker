import { test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { handleSearchItems } from './search-items.ts'

const originalFetch = globalThis.fetch
beforeEach(() => { globalThis.fetch = mock() as unknown as typeof fetch })
afterEach(() => { globalThis.fetch = originalFetch })

const mockItem = {
  key: 'ABC123',
  version: 5,
  data: {
    itemType: 'journalArticle',
    title: 'Attention Is All You Need',
    creators: [{ creatorType: 'author', firstName: 'Ashish', lastName: 'Vaswani' }],
    date: '2017',
    tags: [{ tag: 'transformer' }],
    collections: ['COLL1'],
  },
}

test('search 返回精简摘要', async () => {
  globalThis.fetch = mock(async () => new Response(JSON.stringify([mockItem]), {
    status: 200, headers: { 'content-type': 'application/json' },
  }))
  const result = await handleSearchItems({ query: 'attention' })
  expect(result).toEqual([{
    key: 'ABC123',
    title: 'Attention Is All You Need',
    creators: ['Ashish Vaswani'],
    date: '2017',
    tags: ['transformer'],
    collections: ['COLL1'],
  }])
})

test('URL 带 q / limit / qmode', async () => {
  let capturedUrl = ''
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    capturedUrl = String(url)
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  await handleSearchItems({ query: 'foo bar', limit: 5 })
  expect(capturedUrl).toContain('q=foo%20bar')
  expect(capturedUrl).toContain('limit=5')
  expect(capturedUrl).toContain('qmode=everything')
})

test('默认 limit=20', async () => {
  let capturedUrl = ''
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    capturedUrl = String(url)
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  await handleSearchItems({ query: 'x' })
  expect(capturedUrl).toContain('limit=20')
})
