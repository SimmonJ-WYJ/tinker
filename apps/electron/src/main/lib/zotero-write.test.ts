import { test, expect, beforeEach, afterEach, mock } from 'bun:test'

let originalFetch: typeof globalThis.fetch
beforeEach(() => { originalFetch = globalThis.fetch })
afterEach(() => { globalThis.fetch = originalFetch })

test('createItem 成功：saveItems + resolver attached + Web API DOI 反查返回 key', async () => {
  let saveItemsBody: Record<string, unknown> | null = null
  let resolverBody: Record<string, unknown> | null = null
  let webApiUrl = ''
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    if (url.includes('/connector/saveItems')) {
      saveItemsBody = JSON.parse(init?.body as string)
      return new Response('', { status: 201 })
    }
    if (url.includes('/connector/saveAttachmentFromResolver')) {
      resolverBody = JSON.parse(init?.body as string)
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/api/users/0/items')) {
      webApiUrl = url
      return new Response(
        JSON.stringify([{ key: 'ABC123', version: 7, data: { DOI: '10.1234/abc', title: 'Sample' } }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new Error(`意外的 fetch URL: ${url}`)
  }) as unknown as typeof globalThis.fetch

  const { createItem } = await import(`./zotero-write.ts?cb=${Date.now()}`)
  const result = await createItem({
    title: 'Sample',
    creators: [{ creatorType: 'author', firstName: 'Alice', lastName: 'Smith' }],
    DOI: '10.1234/abc',
    date: '2024',
    publicationTitle: 'Nature',
  })

  expect(result.key).toBe('ABC123')
  expect(result.version).toBe(7)
  expect(result.pdfStatus).toBe('attached')

  // saveItems payload 校验
  expect(saveItemsBody).not.toBeNull()
  const body = saveItemsBody as Record<string, unknown>
  expect(typeof body.sessionID).toBe('string')
  expect(typeof body.uri).toBe('string')
  const items = body.items as Array<Record<string, unknown>>
  expect(items[0].itemType).toBe('journalArticle')
  expect(items[0].title).toBe('Sample')
  expect(items[0].DOI).toBe('10.1234/abc')
  // connector item id 必须存在，resolver 才能挂附件
  expect(typeof items[0].id).toBe('string')
  expect((items[0].id as string).length).toBeGreaterThan(0)

  // resolver payload 复用同一 sessionID + 同一 itemID
  expect(resolverBody).not.toBeNull()
  const rb = resolverBody as Record<string, unknown>
  expect(rb.sessionID).toBe(body.sessionID)
  expect(rb.itemID).toBe(items[0].id)

  // Web API 反查 URL 包含 DOI
  expect(webApiUrl).toContain(encodeURIComponent('10.1234/abc'))
})

test('createItem resolver 500 软失败 → pdfStatus=no_pdf，item 仍然成功', async () => {
  globalThis.fetch = mock(async (url: string) => {
    if (url.includes('/connector/saveItems')) return new Response('', { status: 201 })
    if (url.includes('/connector/saveAttachmentFromResolver')) {
      return new Response('Failed to save an attachment', { status: 500 })
    }
    if (url.includes('/api/users/0/items')) {
      return new Response(
        JSON.stringify([{ key: 'NOPDF', version: 2, data: { DOI: '10.1/x' } }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new Error(`意外的 fetch: ${url}`)
  }) as unknown as typeof globalThis.fetch

  const { createItem } = await import(`./zotero-write.ts?cb=${Date.now()}`)
  const result = await createItem({
    title: 'X', creators: [], DOI: '10.1/x', date: null, publicationTitle: null,
  })
  expect(result.key).toBe('NOPDF')
  expect(result.pdfStatus).toBe('no_pdf')
})

test('createItem 无 DOI → pdfStatus=skipped，不调 resolver', async () => {
  let resolverCalled = false
  globalThis.fetch = mock(async (url: string) => {
    if (url.includes('/connector/saveItems')) return new Response('', { status: 201 })
    if (url.includes('/connector/saveAttachmentFromResolver')) {
      resolverCalled = true
      return new Response('', { status: 200 })
    }
    if (url.includes('/api/users/0/items')) {
      return new Response(
        JSON.stringify([{ key: 'NODOI1', version: 1, data: { title: 'X' } }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new Error(`意外的 fetch: ${url}`)
  }) as unknown as typeof globalThis.fetch

  const { createItem } = await import(`./zotero-write.ts?cb=${Date.now()}`)
  const result = await createItem({
    title: 'X', creators: [], DOI: null, date: null, publicationTitle: null,
  })
  expect(result.pdfStatus).toBe('skipped')
  expect(resolverCalled).toBe(false)
})

test('createItem saveItems 非 2xx → 抛 ZoteroError', async () => {
  globalThis.fetch = mock(async (url: string) => {
    if (url.includes('/connector/saveItems')) {
      return new Response('Save failed', { status: 500 })
    }
    throw new Error(`意外的 fetch: ${url}`)
  }) as unknown as typeof globalThis.fetch

  const { createItem } = await import(`./zotero-write.ts?cb=${Date.now()}`)
  await expect(
    createItem({ title: 'X', creators: [], DOI: null, date: null, publicationTitle: null }),
  ).rejects.toMatchObject({ name: 'ZoteroError' })
})

test('createItem saveItems 成功但反查找不到 → 抛 ZoteroError unexpected', async () => {
  globalThis.fetch = mock(async (url: string) => {
    if (url.includes('/connector/saveItems')) return new Response('', { status: 201 })
    if (url.includes('/connector/saveAttachmentFromResolver')) {
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/api/users/0/items')) {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    throw new Error(`意外的 fetch: ${url}`)
  }) as unknown as typeof globalThis.fetch

  const { createItem } = await import(`./zotero-write.ts?cb=${Date.now()}`)
  await expect(
    createItem({ title: 'X', creators: [], DOI: '10.9999/missing', date: null, publicationTitle: null }),
  ).rejects.toMatchObject({ name: 'ZoteroError', type: 'unexpected' })
})

test('createItem arxiv DOI + resolver 失败 → 走 arxiv 兜底拉 PDF → attached', async () => {
  let saveAttachmentCalled = false
  let saveAttachmentMetadata: Record<string, unknown> | null = null
  let saveAttachmentContentType = ''
  let arxivPdfFetched = false
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    if (url.includes('/connector/saveItems')) return new Response('', { status: 201 })
    if (url.includes('/connector/saveAttachmentFromResolver')) {
      return new Response('Failed to save an attachment', { status: 500 })
    }
    if (url.includes('arxiv.org/pdf/')) {
      arxivPdfFetched = true
      // 返回 4 字节假 PDF（%PDF）
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      })
    }
    if (url.includes('/connector/saveAttachment') && !url.includes('Resolver')) {
      saveAttachmentCalled = true
      saveAttachmentContentType = (init?.headers as Record<string, string> | undefined)?.['Content-Type'] ?? ''
      const meta = (init?.headers as Record<string, string> | undefined)?.['X-Metadata']
      if (meta) saveAttachmentMetadata = JSON.parse(meta)
      return new Response('', { status: 201 })
    }
    if (url.includes('/api/users/0/items')) {
      return new Response(
        JSON.stringify([{ key: 'ARXV1', version: 1, data: { DOI: '10.48550/arxiv.2512.10411' } }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new Error(`意外的 fetch: ${url}`)
  }) as unknown as typeof globalThis.fetch

  const { createItem } = await import(`./zotero-write.ts?cb=${Date.now()}`)
  const result = await createItem({
    title: 'New arxiv paper',
    creators: [],
    DOI: '10.48550/arxiv.2512.10411',
    date: '2025',
    publicationTitle: 'arXiv',
  })
  expect(arxivPdfFetched).toBe(true)
  expect(saveAttachmentCalled).toBe(true)
  expect(saveAttachmentContentType).toBe('application/pdf')
  expect(saveAttachmentMetadata).not.toBeNull()
  const meta = saveAttachmentMetadata as Record<string, unknown>
  expect(typeof meta.sessionID).toBe('string')
  expect(typeof meta.parentItemID).toBe('string')
  expect(meta.url).toBe('https://arxiv.org/pdf/2512.10411')
  expect(result.pdfStatus).toBe('attached')
})

test('createItem arxiv DOI（大写 arXiv）也走兜底', async () => {
  let arxivPdfFetched = false
  globalThis.fetch = mock(async (url: string) => {
    if (url.includes('/connector/saveItems')) return new Response('', { status: 201 })
    if (url.includes('/connector/saveAttachmentFromResolver')) return new Response('500', { status: 500 })
    if (url.includes('arxiv.org/pdf/2401.05435')) {
      arxivPdfFetched = true
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 })
    }
    if (url.includes('/connector/saveAttachment') && !url.includes('Resolver')) {
      return new Response('', { status: 201 })
    }
    if (url.includes('/api/users/0/items')) {
      return new Response(
        JSON.stringify([{ key: 'ARXV2', version: 1, data: { DOI: '10.48550/arXiv.2401.05435' } }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new Error(`意外的 fetch: ${url}`)
  }) as unknown as typeof globalThis.fetch

  const { createItem } = await import(`./zotero-write.ts?cb=${Date.now()}`)
  const result = await createItem({
    title: 'X', creators: [], DOI: '10.48550/arXiv.2401.05435', date: null, publicationTitle: null,
  })
  expect(arxivPdfFetched).toBe(true)
  expect(result.pdfStatus).toBe('attached')
})

test('createItem 非 arxiv DOI + resolver 失败 → 不走兜底，pdfStatus=no_pdf', async () => {
  let arxivAttempted = false
  let saveAttachmentAttempted = false
  globalThis.fetch = mock(async (url: string) => {
    if (url.includes('/connector/saveItems')) return new Response('', { status: 201 })
    if (url.includes('/connector/saveAttachmentFromResolver')) return new Response('500', { status: 500 })
    if (url.includes('arxiv.org/pdf/')) {
      arxivAttempted = true
      return new Response('', { status: 404 })
    }
    if (url.includes('/connector/saveAttachment') && !url.includes('Resolver')) {
      saveAttachmentAttempted = true
      return new Response('', { status: 201 })
    }
    if (url.includes('/api/users/0/items')) {
      return new Response(
        JSON.stringify([{ key: 'NONARXIV', version: 1, data: { DOI: '10.1038/s41586-024-99999-x' } }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new Error(`意外的 fetch: ${url}`)
  }) as unknown as typeof globalThis.fetch

  const { createItem } = await import(`./zotero-write.ts?cb=${Date.now()}`)
  const result = await createItem({
    title: 'X', creators: [], DOI: '10.1038/s41586-024-99999-x', date: null, publicationTitle: null,
  })
  expect(arxivAttempted).toBe(false)
  expect(saveAttachmentAttempted).toBe(false)
  expect(result.pdfStatus).toBe('no_pdf')
})

test('createItem arxiv 兜底里 PDF fetch 失败 → 仍 no_pdf，不抛错', async () => {
  globalThis.fetch = mock(async (url: string) => {
    if (url.includes('/connector/saveItems')) return new Response('', { status: 201 })
    if (url.includes('/connector/saveAttachmentFromResolver')) return new Response('500', { status: 500 })
    if (url.includes('arxiv.org/pdf/')) return new Response('', { status: 404 })
    if (url.includes('/api/users/0/items')) {
      return new Response(
        JSON.stringify([{ key: 'ARXVFAIL', version: 1, data: { DOI: '10.48550/arxiv.9999.99999' } }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new Error(`意外的 fetch: ${url}`)
  }) as unknown as typeof globalThis.fetch

  const { createItem } = await import(`./zotero-write.ts?cb=${Date.now()}`)
  const result = await createItem({
    title: 'X', creators: [], DOI: '10.48550/arxiv.9999.99999', date: null, publicationTitle: null,
  })
  expect(result.pdfStatus).toBe('no_pdf')
})

test('createItem 带 targetTreeViewID → connector /updateSession 移入 collection', async () => {
  let updateUrl = ''
  let updateBody: Record<string, unknown> | null = null
  let savedSessionID = ''
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    if (url.includes('/connector/saveItems')) {
      savedSessionID = JSON.parse(init!.body as string).sessionID
      return new Response('', { status: 201 })
    }
    if (url.includes('/connector/saveAttachmentFromResolver')) {
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/connector/updateSession')) {
      updateUrl = url
      updateBody = JSON.parse(init!.body as string)
      return new Response('', { status: 200 })
    }
    if (url.includes('/api/users/0/items')) {
      return new Response(
        JSON.stringify([{ key: 'ITEM01', version: 12, data: { DOI: '10.1/c' } }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new Error(`意外的 fetch: ${url}`)
  }) as unknown as typeof globalThis.fetch

  const { createItem } = await import(`./zotero-write.ts?cb=${Date.now()}`)
  const result = await createItem(
    { title: 'X', creators: [], DOI: '10.1/c', date: null, publicationTitle: null },
    { targetTreeViewID: 'C3' },
  )

  expect(updateUrl).toContain('/connector/updateSession')
  expect(updateBody).toEqual({ sessionID: savedSessionID, target: 'C3' })
  expect(result.collectionStatus).toBe('ok')
})

test("createItem targetTreeViewID='L1' → updateSession 移到「我的文献库」根", async () => {
  let updateBody: Record<string, unknown> | null = null
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    if (url.includes('/connector/saveItems')) return new Response('', { status: 201 })
    if (url.includes('/connector/saveAttachmentFromResolver')) {
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/connector/updateSession')) {
      updateBody = JSON.parse(init!.body as string)
      return new Response('', { status: 200 })
    }
    if (url.includes('/api/users/0/items')) {
      return new Response(
        JSON.stringify([{ key: 'DETACH1', version: 9, data: { DOI: '10.1/det' } }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new Error(`意外的 fetch: ${url}`)
  }) as unknown as typeof globalThis.fetch

  const { createItem } = await import(`./zotero-write.ts?cb=${Date.now()}`)
  const result = await createItem(
    { title: 'X', creators: [], DOI: '10.1/det', date: null, publicationTitle: null },
    { targetTreeViewID: 'L1' },
  )

  expect((updateBody as { target?: string } | null)?.target).toBe('L1')
  expect(result.collectionStatus).toBe('ok')
})

test('createItem 不传 targetTreeViewID → 不调 updateSession（沿用 UI 选中）', async () => {
  let updateCalled = false
  globalThis.fetch = mock(async (url: string) => {
    if (url.includes('/connector/saveItems')) return new Response('', { status: 201 })
    if (url.includes('/connector/saveAttachmentFromResolver')) {
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/connector/updateSession')) {
      updateCalled = true
      return new Response('', { status: 200 })
    }
    if (url.includes('/api/users/0/items')) {
      return new Response(
        JSON.stringify([{ key: 'NOPATCH', version: 3, data: { DOI: '10.1/d' } }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new Error(`意外的 fetch: ${url}`)
  }) as unknown as typeof globalThis.fetch

  const { createItem } = await import(`./zotero-write.ts?cb=${Date.now()}`)
  const result = await createItem(
    { title: 'X', creators: [], DOI: '10.1/d', date: null, publicationTitle: null },
  )
  expect(updateCalled).toBe(false)
  expect(result.collectionStatus).toBe('skipped')
})

test('createItem updateSession 失败 → item 仍返回 success（软失败），collectionStatus=failed', async () => {
  globalThis.fetch = mock(async (url: string) => {
    if (url.includes('/connector/saveItems')) return new Response('', { status: 201 })
    if (url.includes('/connector/saveAttachmentFromResolver')) {
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/connector/updateSession')) {
      return new Response('boom', { status: 500 })
    }
    if (url.includes('/api/users/0/items')) {
      return new Response(
        JSON.stringify([{ key: 'PATCHFAIL', version: 1, data: { DOI: '10.1/e' } }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new Error(`意外的 fetch: ${url}`)
  }) as unknown as typeof globalThis.fetch

  const { createItem } = await import(`./zotero-write.ts?cb=${Date.now()}`)
  const result = await createItem(
    { title: 'X', creators: [], DOI: '10.1/e', date: null, publicationTitle: null },
    { targetTreeViewID: 'C9' },
  )
  expect(result.key).toBe('PATCHFAIL')
  expect(result.collectionStatus).toBe('failed')
})

test('createItem 带 tags 时 items[0].tags 格式为 {tag: string}[]', async () => {
  let savedItems: Array<Record<string, unknown>> = []
  globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
    if (url.includes('/connector/saveItems')) {
      const body = JSON.parse(init?.body as string) as { items: Array<Record<string, unknown>> }
      savedItems = body.items
      return new Response('', { status: 201 })
    }
    if (url.includes('/connector/saveAttachmentFromResolver')) {
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('/api/users/0/items')) {
      return new Response(
        JSON.stringify([{ key: 'K1', version: 1, data: { DOI: '10.1/x' } }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new Error(`意外的 fetch: ${url}`)
  }) as unknown as typeof globalThis.fetch

  const { createItem } = await import(`./zotero-write.ts?cb=${Date.now()}`)
  await createItem(
    { title: 'X', creators: [], DOI: '10.1/x', date: null, publicationTitle: null },
    { tags: ['a', 'b', 'c'] },
  )
  expect(savedItems[0].tags).toEqual([{ tag: 'a' }, { tag: 'b' }, { tag: 'c' }])
})
