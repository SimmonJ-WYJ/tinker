import { test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { handleGetAttachmentPath } from './get-attachment-path.ts'

const originalFetch = globalThis.fetch
beforeEach(() => {
  globalThis.fetch = mock() as unknown as typeof fetch
  delete process.env.ZOTERO_DATA_DIR
  delete process.env.ZOTERO_LINKED_BASE_DIR
})
afterEach(() => { globalThis.fetch = originalFetch })

/**
 * 把 children 挂到一个非附件父 item 上（模拟经典 journalArticle + PDF 附件）。
 * /items/{key}?format=json → 非附件占位
 * /items/{key}/children   → 指定 children
 */
const mockParentWithChildren = (children: unknown[]): void => {
  globalThis.fetch = mock(async (url: unknown) => {
    const s = String(url)
    if (s.includes('/children')) {
      return new Response(JSON.stringify(children), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      key: 'PARENT', version: 1, data: { itemType: 'journalArticle' },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
}

/**
 * itemKey 本身就是 attachment（顶层附件），没有 children。
 */
const mockTopLevelAttachment = (attachment: unknown): void => {
  globalThis.fetch = mock(async (url: unknown) => {
    const s = String(url)
    if (s.includes('/children')) {
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify(attachment), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

test('找到 PDF 附件 → 返回绝对路径', async () => {
  mockParentWithChildren([{
    key: 'ATT1', version: 1, data: {
      itemType: 'attachment', filename: 'paper.pdf',
      contentType: 'application/pdf', linkMode: 'imported_file',
    },
  }])
  const result = await handleGetAttachmentPath({ itemKey: 'ITEM1' })
  expect(result).toEqual({
    found: true,
    path: join(homedir(), 'Zotero', 'storage', 'ATT1', 'paper.pdf'),
    filename: 'paper.pdf',
    contentType: 'application/pdf',
  })
})

test('无附件 → found=false', async () => {
  mockParentWithChildren([])
  const result = await handleGetAttachmentPath({ itemKey: 'ITEM1' })
  expect(result).toEqual({ found: false })
})

test('非 PDF 附件（默认路径）→ found=false + reason', async () => {
  mockParentWithChildren([{
    key: 'ATT2', version: 1, data: {
      itemType: 'attachment', filename: 'snap.html',
      contentType: 'text/html', linkMode: 'imported_url',
    },
  }])
  const result = await handleGetAttachmentPath({ itemKey: 'ITEM1' })
  expect(result).toEqual({ found: false, reason: 'unsupported_type' })
})

test('linked_file PDF 走默认路径 → found=false + unsupported_type', async () => {
  mockParentWithChildren([{
    key: 'LINKED1', version: 1, data: {
      itemType: 'attachment', filename: 'ext.pdf',
      contentType: 'application/pdf', linkMode: 'linked_file',
    },
  }])
  const result = await handleGetAttachmentPath({ itemKey: 'ITEM1' })
  expect(result).toEqual({ found: false, reason: 'unsupported_type' })
})

test('linked_url PDF 走默认路径 → found=false + unsupported_type', async () => {
  mockParentWithChildren([{
    key: 'LINKED2', version: 1, data: {
      itemType: 'attachment', filename: 'web.pdf',
      contentType: 'application/pdf', linkMode: 'linked_url',
    },
  }])
  const result = await handleGetAttachmentPath({ itemKey: 'ITEM1' })
  expect(result).toEqual({ found: false, reason: 'unsupported_type' })
})

test('指定 attachmentKey 时返回目标附件，不限 contentType', async () => {
  mockParentWithChildren([
    {
      key: 'ATT_PDF', version: 1, data: {
        itemType: 'attachment', filename: 'paper.pdf',
        contentType: 'application/pdf', linkMode: 'imported_file',
      },
    },
    {
      key: 'ATT_IMG', version: 1, data: {
        itemType: 'attachment', filename: 'figure.png',
        contentType: 'image/png', linkMode: 'imported_file',
      },
    },
  ])
  const result = await handleGetAttachmentPath({ itemKey: 'ITEM1', attachmentKey: 'ATT_IMG' })
  expect(result).toEqual({
    found: true,
    path: join(homedir(), 'Zotero', 'storage', 'ATT_IMG', 'figure.png'),
    filename: 'figure.png',
    contentType: 'image/png',
  })
})

test('指定 attachmentKey 不存在 → found=false + reason not_found', async () => {
  mockParentWithChildren([{
    key: 'ATT_PDF', version: 1, data: {
      itemType: 'attachment', filename: 'paper.pdf',
      contentType: 'application/pdf', linkMode: 'imported_file',
    },
  }])
  const result = await handleGetAttachmentPath({ itemKey: 'ITEM1', attachmentKey: 'MISSING' })
  expect(result).toEqual({ found: false, reason: 'not_found' })
})

test('linked_file 绝对路径 → 直接返回该路径', async () => {
  mockParentWithChildren([{
    key: 'LF1', version: 1, data: {
      itemType: 'attachment', filename: 'ext.pdf',
      contentType: 'application/pdf', linkMode: 'linked_file',
      path: '/Volumes/Data/papers/ext.pdf',
    },
  }])
  const result = await handleGetAttachmentPath({ itemKey: 'ITEM1', attachmentKey: 'LF1' })
  expect(result).toEqual({
    found: true,
    path: '/Volumes/Data/papers/ext.pdf',
    filename: 'ext.pdf',
    contentType: 'application/pdf',
  })
})

test('linked_file attachments: 前缀 + ZOTERO_LINKED_BASE_DIR → 解析成绝对路径', async () => {
  process.env.ZOTERO_LINKED_BASE_DIR = '/Users/foo/ZoteroLinked'
  mockParentWithChildren([{
    key: 'LF2', version: 1, data: {
      itemType: 'attachment', filename: 'rel.pdf',
      contentType: 'application/pdf', linkMode: 'linked_file',
      path: 'attachments:subdir/rel.pdf',
    },
  }])
  const result = await handleGetAttachmentPath({ itemKey: 'ITEM1', attachmentKey: 'LF2' })
  expect(result).toEqual({
    found: true,
    path: '/Users/foo/ZoteroLinked/subdir/rel.pdf',
    filename: 'rel.pdf',
    contentType: 'application/pdf',
  })
})

test('linked_file attachments: 前缀但 base dir 未设 → found=false + reason', async () => {
  mockParentWithChildren([{
    key: 'LF3', version: 1, data: {
      itemType: 'attachment', filename: 'rel.pdf',
      contentType: 'application/pdf', linkMode: 'linked_file',
      path: 'attachments:rel.pdf',
    },
  }])
  const result = await handleGetAttachmentPath({ itemKey: 'ITEM1', attachmentKey: 'LF3' })
  expect(result).toEqual({ found: false, reason: 'linked_file_base_dir_unset' })
})

test('linked_file 缺少 path 字段 → found=false + reason', async () => {
  mockParentWithChildren([{
    key: 'LF4', version: 1, data: {
      itemType: 'attachment', filename: 'x.pdf',
      contentType: 'application/pdf', linkMode: 'linked_file',
    },
  }])
  const result = await handleGetAttachmentPath({ itemKey: 'ITEM1', attachmentKey: 'LF4' })
  expect(result).toEqual({ found: false, reason: 'linked_file_path_missing' })
})

test('linked_url 指定附件 → found=false + reason', async () => {
  mockParentWithChildren([{
    key: 'LU1', version: 1, data: {
      itemType: 'attachment', filename: 'page.html',
      contentType: 'text/html', linkMode: 'linked_url',
      url: 'https://example.com',
    },
  }])
  const result = await handleGetAttachmentPath({ itemKey: 'ITEM1', attachmentKey: 'LU1' })
  expect(result).toEqual({ found: false, reason: 'linked_url_no_file' })
})

test('默认行为保持不变：无 attachmentKey 时首选 imported PDF', async () => {
  mockParentWithChildren([
    { key: 'IMG', version: 1, data: { itemType: 'attachment', filename: 'f.png', contentType: 'image/png', linkMode: 'imported_file' } },
    { key: 'PDF', version: 1, data: { itemType: 'attachment', filename: 'p.pdf', contentType: 'application/pdf', linkMode: 'imported_file' } },
  ])
  const result = await handleGetAttachmentPath({ itemKey: 'ITEM1' })
  expect(result).toMatchObject({ found: true, contentType: 'application/pdf' })
})

test('ZOTERO_DATA_DIR 覆盖默认路径', async () => {
  process.env.ZOTERO_DATA_DIR = '/custom/zotero'
  mockParentWithChildren([{
    key: 'ATT3', version: 1, data: {
      itemType: 'attachment', filename: 'a.pdf',
      contentType: 'application/pdf', linkMode: 'imported_file',
    },
  }])
  const result = await handleGetAttachmentPath({ itemKey: 'I' })
  expect(result).toMatchObject({ found: true, path: '/custom/zotero/storage/ATT3/a.pdf' })
})

// ===== 顶层附件（itemKey 本身是 attachment，没有 parent item） =====

test('顶层图片附件（itemKey 自身就是 attachment）→ found=true，不查 children', async () => {
  mockTopLevelAttachment({
    key: 'TOPIMG', version: 1, data: {
      itemType: 'attachment', filename: 'photo.jpg',
      contentType: 'image/jpeg', linkMode: 'imported_file',
    },
  })
  const result = await handleGetAttachmentPath({ itemKey: 'TOPIMG' })
  expect(result).toEqual({
    found: true,
    path: join(homedir(), 'Zotero', 'storage', 'TOPIMG', 'photo.jpg'),
    filename: 'photo.jpg',
    contentType: 'image/jpeg',
  })
})

test('顶层附件 + 相同 attachmentKey → found=true', async () => {
  mockTopLevelAttachment({
    key: 'TOPIMG', version: 1, data: {
      itemType: 'attachment', filename: 'photo.jpg',
      contentType: 'image/jpeg', linkMode: 'imported_file',
    },
  })
  const result = await handleGetAttachmentPath({ itemKey: 'TOPIMG', attachmentKey: 'TOPIMG' })
  expect(result).toMatchObject({ found: true, contentType: 'image/jpeg' })
})

test('顶层附件 + attachmentKey 不匹配 → found=false + reason not_found', async () => {
  mockTopLevelAttachment({
    key: 'TOPIMG', version: 1, data: {
      itemType: 'attachment', filename: 'photo.jpg',
      contentType: 'image/jpeg', linkMode: 'imported_file',
    },
  })
  const result = await handleGetAttachmentPath({ itemKey: 'TOPIMG', attachmentKey: 'OTHER' })
  expect(result).toEqual({ found: false, reason: 'not_found' })
})

test('顶层 PDF 附件（默认调用，无 attachmentKey）→ found=true', async () => {
  mockTopLevelAttachment({
    key: 'TOPPDF', version: 1, data: {
      itemType: 'attachment', filename: 'paper.pdf',
      contentType: 'application/pdf', linkMode: 'imported_file',
    },
  })
  const result = await handleGetAttachmentPath({ itemKey: 'TOPPDF' })
  expect(result).toMatchObject({ found: true, contentType: 'application/pdf' })
})
