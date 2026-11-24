import { expect, test } from 'bun:test'
import { createProjectDocuments } from './project-documents'

test('the bridge transmits the exact page and rejects a reply with identical line numbers from another page', async () => {
  const document = { documentId: 'pdf', filename: 'guide.pdf', lineCount: 2, byteLength: 10, pageLineCounts: [1, 1] }
  const calls: unknown[] = []
  let page = 2
  const api = createProjectDocuments(async <T>(name: string, args?: Record<string, unknown>) => {
    calls.push([name, args])
    return { value: { document, page, startLine: 1, endLine: 1, text: 'line' } } as T
  })
  const selection = { documentId: 'pdf', page: 2, startLine: 1, endLine: 1 }
  expect((await api.read('w', selection)).page).toBe(2)
  expect(calls).toEqual([['readProjectDocument', { workspaceId: 'w', selection }]])
  page = 1
  await expect(api.read('w', selection)).rejects.toThrow('invalidReply')
})
