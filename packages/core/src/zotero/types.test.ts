import { test, expect } from 'bun:test'
import { isZoteroItem, isAttachmentItem, type ZoteroItem } from './types.ts'

test('isZoteroItem 识别合法 item', () => {
  const raw = { key: 'ABC123', version: 1, data: { itemType: 'journalArticle', title: 't' } }
  expect(isZoteroItem(raw)).toBe(true)
})

test('isZoteroItem 拒绝非法 item', () => {
  expect(isZoteroItem(null)).toBe(false)
  expect(isZoteroItem({ key: 'x' })).toBe(false)
  expect(isZoteroItem({ key: 'x', version: 1, data: null })).toBe(false)
})

test('isAttachmentItem 识别 attachment', () => {
  const attach: ZoteroItem = {
    key: 'A1',
    version: 2,
    data: { itemType: 'attachment', filename: 'a.pdf', contentType: 'application/pdf', linkMode: 'imported_file' },
  }
  expect(isAttachmentItem(attach)).toBe(true)
})

test('isAttachmentItem 拒绝 journalArticle', () => {
  const article: ZoteroItem = {
    key: 'B1', version: 1,
    data: { itemType: 'journalArticle', title: 't' },
  }
  expect(isAttachmentItem(article)).toBe(false)
})

test('isZoteroItem 拒绝 data 无 itemType', () => {
  expect(isZoteroItem({ key: 'x', version: 1, data: {} })).toBe(false)
})

test('isAttachmentItem 拒绝缺失 linkMode', () => {
  const partial: ZoteroItem = {
    key: 'P1', version: 1,
    data: { itemType: 'attachment', filename: 'p.pdf', contentType: 'application/pdf' },
  }
  expect(isAttachmentItem(partial)).toBe(false)
})

test('isAttachmentItem 拒绝非法 linkMode', () => {
  const bad: ZoteroItem = {
    key: 'P2', version: 1,
    data: { itemType: 'attachment', filename: 'p.pdf', contentType: 'application/pdf', linkMode: 'unknown_mode' as 'imported_file' },
  }
  expect(isAttachmentItem(bad)).toBe(false)
})
