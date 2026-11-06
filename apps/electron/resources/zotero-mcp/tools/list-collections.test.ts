import { test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { handleListCollections } from './list-collections.ts'

const originalFetch = globalThis.fetch
beforeEach(() => { globalThis.fetch = mock() as unknown as typeof fetch })
afterEach(() => { globalThis.fetch = originalFetch })

test('list-collections 返回扁平数组', async () => {
  const raw = [
    { key: 'A', version: 1, data: { name: 'Root', parentCollection: false } },
    { key: 'B', version: 1, data: { name: 'Child', parentCollection: 'A' } },
  ]
  globalThis.fetch = mock(async () => new Response(JSON.stringify(raw), {
    status: 200, headers: { 'content-type': 'application/json' },
  }))
  const result = await handleListCollections()
  expect(result).toEqual([
    { key: 'A', name: 'Root', parentKey: null },
    { key: 'B', name: 'Child', parentKey: 'A' },
  ])
})
