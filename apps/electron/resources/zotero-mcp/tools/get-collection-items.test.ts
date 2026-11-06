import { test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { handleGetCollectionItems } from './get-collection-items.ts'

const originalFetch = globalThis.fetch
beforeEach(() => { globalThis.fetch = mock() as unknown as typeof fetch })
afterEach(() => { globalThis.fetch = originalFetch })

test('collection-items 返回摘要', async () => {
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
  const result = await handleGetCollectionItems({ collectionKey: 'C1' })
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ key: 'X', title: 'T', creators: ['A B'] })
})

test('collection-items 使用正确 URL', async () => {
  let captured = ''
  globalThis.fetch = mock(async (url: string | URL | Request) => {
    captured = String(url)
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  })
  await handleGetCollectionItems({ collectionKey: 'C1', limit: 7 })
  expect(captured).toContain('/users/0/collections/C1/items')
  expect(captured).toContain('limit=7')
})
