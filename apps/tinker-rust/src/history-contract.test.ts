import { expect, test } from 'bun:test'
import { decodeHistoryPage } from './history-contract.ts'

const entry = { lineNumber: 3, kind: 'assistant', text: '中文\n<script>不会执行</script>', uuid: 'message-1', raw: { type: 'assistant', future: { retained: true } } }
const page = { protocolVersion: 1 as const, entries: [entry], nextBeforeLine: 3, incompleteTail: 5 }

test('历史契约保留原始对象、未知 SDK 类型及安全文本', () => {
  expect(decodeHistoryPage(page)).toEqual(page)
  const raw = { extension: ['未知字段'], imagePath: '/不读取/图片.png' }
  expect(decodeHistoryPage({ ...page, entries: [{ ...entry, kind: 'future-sdk-type', uuid: null, raw }] }).entries[0]?.raw).toBe(raw)
  expect(decodeHistoryPage({ protocolVersion: 1, entries: [], nextBeforeLine: null, incompleteTail: 1 })).toEqual({ protocolVersion: 1, entries: [], nextBeforeLine: null, incompleteTail: 1 })
})

test('历史契约拒绝缺失、错误字段和超过 256 条的页面', () => {
  const malformed: unknown[] = [null, [], {}, { ...page, protocolVersion: 2 }, { ...page, entries: {} }, { ...page, entries: Array.from({ length: 257 }, (_, index) => ({ ...entry, lineNumber: index + 1 })), nextBeforeLine: 1, incompleteTail: null }]
  for (const change of [{ lineNumber: 0 }, { lineNumber: 1.5 }, { lineNumber: Number.MAX_SAFE_INTEGER + 1 }, { kind: '' }, { kind: null }, { text: null }, { uuid: 42 }, { raw: null }, { raw: [] }, { raw: 'json' }]) malformed.push({ ...page, entries: [{ ...entry, ...change }] })
  for (const value of malformed) expect(() => decodeHistoryPage(value)).toThrow('protocolMismatch')
})

test('历史契约拒绝非递增行号和不安全游标或尾行', () => {
  for (const value of [
    { ...page, entries: [entry, entry] },
    { ...page, entries: [entry, { ...entry, lineNumber: 2 }] },
    { ...page, nextBeforeLine: 2 }, { ...page, nextBeforeLine: 0 },
    { ...page, nextBeforeLine: Number.MAX_SAFE_INTEGER + 1 },
    { ...page, entries: [], nextBeforeLine: 3 },
    { ...page, incompleteTail: 3 }, { ...page, incompleteTail: 0 },
    { ...page, incompleteTail: Number.MAX_SAFE_INTEGER + 1 },
    { ...page, nextBeforeLine: undefined }, { ...page, incompleteTail: undefined },
  ]) expect(() => decodeHistoryPage(value)).toThrow('protocolMismatch')
})
