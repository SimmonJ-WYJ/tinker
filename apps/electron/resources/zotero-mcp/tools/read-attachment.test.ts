import { test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleReadAttachment } from './read-attachment.ts'

const originalFetch = globalThis.fetch
let tmpHome: string

/**
 * 在伪造的 Zotero storage 里放文件 + 配 Zotero API 响应
 * 当 itemKey === attachmentKey 视作顶层附件
 */
const setupAttachment = (opts: {
  itemKey: string
  attachmentKey: string
  contentType: string
  filename: string
  body: Buffer | string
  isTopLevel?: boolean
}): string => {
  const { itemKey, attachmentKey, contentType, filename, isTopLevel } = opts
  const dir = join(tmpHome, 'Zotero', 'storage', attachmentKey)
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, filename)
  writeFileSync(filePath, opts.body)

  globalThis.fetch = mock(async (url: unknown) => {
    const s = String(url)
    if (s.match(new RegExp(`/items/${itemKey}/children`))) {
      if (isTopLevel) {
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify([{
        key: attachmentKey, version: 1, data: {
          itemType: 'attachment', contentType, linkMode: 'imported_file', filename,
        },
      }]), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (s.match(new RegExp(`/items/${itemKey}(\\?|$)`))) {
      if (isTopLevel) {
        return new Response(JSON.stringify({
          key: itemKey, version: 1, data: {
            itemType: 'attachment', contentType, linkMode: 'imported_file', filename,
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        key: itemKey, version: 1, data: { itemType: 'journalArticle' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('nope', { status: 404 })
  }) as unknown as typeof fetch

  return filePath
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-read-att-'))
  process.env.ZOTERO_DATA_DIR = join(tmpHome, 'Zotero')
})

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true })
  delete process.env.ZOTERO_DATA_DIR
  globalThis.fetch = originalFetch
})

test('读取纯文本 txt 附件 → 返回文件内容', async () => {
  setupAttachment({
    itemKey: 'ITEM1', attachmentKey: 'ATT1',
    contentType: 'text/plain', filename: 'note.txt',
    body: '这是一段中文笔记\n第二行',
  })
  const result = await handleReadAttachment({ itemKey: 'ITEM1', attachmentKey: 'ATT1' })
  expect(result.text).toBe('这是一段中文笔记\n第二行')
  expect(result.truncated).toBe(false)
  expect(result.contentType).toBe('text/plain')
  expect(result.filename).toBe('note.txt')
  expect(result.charCount).toBeGreaterThan(0)
})

test('顶层文本附件（itemKey === attachmentKey）→ 直接读', async () => {
  setupAttachment({
    itemKey: 'TOPTXT', attachmentKey: 'TOPTXT',
    contentType: 'text/markdown', filename: 'readme.md',
    body: '# 标题\n内容',
    isTopLevel: true,
  })
  const result = await handleReadAttachment({ itemKey: 'TOPTXT', attachmentKey: 'TOPTXT' })
  expect(result.text).toBe('# 标题\n内容')
})

test('maxChars 截断时设 truncated=true + 附加提示', async () => {
  setupAttachment({
    itemKey: 'ITEM1', attachmentKey: 'ATT1',
    contentType: 'text/plain', filename: 'long.txt',
    body: 'A'.repeat(5000),
  })
  const result = await handleReadAttachment({
    itemKey: 'ITEM1', attachmentKey: 'ATT1', maxChars: 100,
  })
  expect(result.truncated).toBe(true)
  expect(result.text.length).toBe(100)
  expect(result.charCount).toBe(5000)
})

test('image/* → ATTACHMENT_TYPE_UNSUPPORTED，提示先 get_attachment_path 再 ocr_image', async () => {
  setupAttachment({
    itemKey: 'ITEM1', attachmentKey: 'IMG1',
    contentType: 'image/png', filename: 'figure.png',
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  })
  try {
    await handleReadAttachment({ itemKey: 'ITEM1', attachmentKey: 'IMG1' })
    throw new Error('不应走到这里')
  } catch (err) {
    expect(err).toHaveProperty('code', 'ATTACHMENT_TYPE_UNSUPPORTED')
    expect((err as { message: string }).message).toMatch(/ocr_image/)
  }
})

test('audio/* → ATTACHMENT_TYPE_UNSUPPORTED，提示改日支持音频识别', async () => {
  setupAttachment({
    itemKey: 'ITEM1', attachmentKey: 'AUD1',
    contentType: 'audio/mpeg', filename: 'clip.mp3',
    body: Buffer.from('mp3'),
  })
  try {
    await handleReadAttachment({ itemKey: 'ITEM1', attachmentKey: 'AUD1' })
    throw new Error('不应走到这里')
  } catch (err) {
    expect(err).toHaveProperty('code', 'ATTACHMENT_TYPE_UNSUPPORTED')
  }
})

test('附件不存在（key 不匹配） → ATTACHMENT_NOT_FOUND', async () => {
  setupAttachment({
    itemKey: 'ITEM1', attachmentKey: 'REAL',
    contentType: 'text/plain', filename: 'a.txt',
    body: 'x',
  })
  try {
    await handleReadAttachment({ itemKey: 'ITEM1', attachmentKey: 'MISSING' })
    throw new Error('不应走到这里')
  } catch (err) {
    expect(err).toHaveProperty('code', 'ATTACHMENT_NOT_FOUND')
  }
})

test('附件文件不在磁盘 → ATTACHMENT_FILE_MISSING', async () => {
  // 仅放 metadata，不写文件
  globalThis.fetch = mock(async (url: unknown) => {
    const s = String(url)
    if (s.match(/\/items\/ITEM1\/children/)) {
      return new Response(JSON.stringify([{
        key: 'ATT1', version: 1, data: {
          itemType: 'attachment', contentType: 'text/plain', linkMode: 'imported_file', filename: 'ghost.txt',
        },
      }]), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (s.match(/\/items\/ITEM1(\?|$)/)) {
      return new Response(JSON.stringify({
        key: 'ITEM1', version: 1, data: { itemType: 'journalArticle' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('nope', { status: 404 })
  }) as unknown as typeof fetch

  try {
    await handleReadAttachment({ itemKey: 'ITEM1', attachmentKey: 'ATT1' })
    throw new Error('不应走到这里')
  } catch (err) {
    expect(err).toHaveProperty('code', 'ATTACHMENT_FILE_MISSING')
  }
})

test('默认 maxChars 是 50000（合理上限，避免 stdio 过载）', async () => {
  setupAttachment({
    itemKey: 'ITEM1', attachmentKey: 'ATT1',
    contentType: 'text/plain', filename: 'big.txt',
    body: 'A'.repeat(60000),
  })
  const result = await handleReadAttachment({ itemKey: 'ITEM1', attachmentKey: 'ATT1' })
  expect(result.truncated).toBe(true)
  expect(result.text.length).toBe(50000)
})

test('默认行为：不传 attachmentKey 时取 children 第一个文档类附件', async () => {
  // 模拟一个 parent item 有多个 children，其中两个是 attachment
  globalThis.fetch = mock(async (url: unknown) => {
    const s = String(url)
    if (s.match(/\/items\/PARENT\/children/)) {
      const dir = join(tmpHome, 'Zotero', 'storage', 'PDF1')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'paper.txt'), 'hello')
      return new Response(JSON.stringify([
        {
          key: 'PDF1', version: 1, data: {
            itemType: 'attachment', contentType: 'text/plain', linkMode: 'imported_file', filename: 'paper.txt',
          },
        },
      ]), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (s.match(/\/items\/PARENT(\?|$)/)) {
      return new Response(JSON.stringify({
        key: 'PARENT', version: 1, data: { itemType: 'journalArticle' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('nope', { status: 404 })
  }) as unknown as typeof fetch

  const result = await handleReadAttachment({ itemKey: 'PARENT' })
  expect(result.text).toBe('hello')
})
