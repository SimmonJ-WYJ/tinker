/**
 * anchor-codec 单测：构造 / 序列化 / 反序列化 / 兜底 / 哈希
 */
import { describe, expect, test } from 'bun:test'

import type { Anchor } from '@asci/shared'
import {
  anchorContentHash,
  anchorsContentEqual,
  buildHtmlAnchor,
  buildMdAnchor,
  buildPdfAnchor,
  deserializeAnchor,
  serializeAnchor,
} from './anchor-codec.ts'

describe('builders', () => {
  test('buildHtmlAnchor 全字段：type/locationData/version 齐全', () => {
    const a = buildHtmlAnchor({
      snapshotText: 'hello',
      selector: '#s2 > p:nth-of-type(3)',
      sectionId: 's2',
      paragraphIndex: 2,
      citeIndex: 0,
    })
    expect(a.type).toBe('html')
    expect(a.snapshotText).toBe('hello')
    expect(a.locationData).toEqual({
      kind: 'html',
      selector: '#s2 > p:nth-of-type(3)',
      sectionId: 's2',
      paragraphIndex: 2,
      citeIndex: 0,
    })
    expect(a.version).toBe(1)
  })

  test('buildMdAnchor 不填 location 字段：locationData 整体省略', () => {
    const a = buildMdAnchor({ snapshotText: 'q' })
    expect(a.type).toBe('md')
    expect(a.locationData).toBeUndefined()
  })

  test('buildMdAnchor 部分 location 字段：保留 kind + 已填字段', () => {
    const a = buildMdAnchor({ snapshotText: 'q', paragraphIndex: 5 })
    expect(a.locationData).toEqual({ kind: 'md', paragraphIndex: 5 })
  })

  test('buildPdfAnchor 全字段', () => {
    const a = buildPdfAnchor({
      snapshotText: 'p',
      page: 3,
      bbox: { x: 0, y: 0, width: 100, height: 50 },
    })
    expect(a.locationData).toEqual({
      kind: 'pdf',
      page: 3,
      bbox: { x: 0, y: 0, width: 100, height: 50 },
    })
  })
})

describe('serializeAnchor + deserializeAnchor', () => {
  test('round-trip：html anchor 全字段', () => {
    const a = buildHtmlAnchor({
      snapshotText: 'wave-optics model became the standard',
      selector: '#s2 > p:nth-of-type(3) > cite:nth-of-type(1)',
      sectionId: 's2',
      paragraphIndex: 2,
      citeIndex: 0,
    })
    const json = serializeAnchor(a)
    const back = deserializeAnchor(json)!
    expect(back).toEqual(a)
  })

  test('round-trip：md anchor 部分字段', () => {
    const a = buildMdAnchor({
      snapshotText: 'Recurrent models typically factor computation along...',
      byteOffset: { start: 1234, end: 1450 },
    })
    const json = serializeAnchor(a)
    const back = deserializeAnchor(json)!
    expect(back).toEqual(a)
  })

  test('round-trip：pdf anchor', () => {
    const a = buildPdfAnchor({
      snapshotText: 'fig 3',
      page: 5,
      bbox: { x: 10, y: 20, width: 100, height: 40 },
    })
    const json = serializeAnchor(a)
    expect(deserializeAnchor(json)).toEqual(a)
  })

  test('JSON 用 snake_case key 落盘', () => {
    const a = buildHtmlAnchor({
      snapshotText: 'x',
      sectionId: 's1',
      paragraphIndex: 0,
      citeIndex: 0,
    })
    const json = serializeAnchor(a)
    expect(json).toContain('"snapshot_text"')
    expect(json).toContain('"location_data"')
    expect(json).toContain('"section_id"')
    expect(json).toContain('"paragraph_index"')
    expect(json).toContain('"cite_index"')
    expect(json).not.toContain('"snapshotText"')
    expect(json).not.toContain('"sectionId"')
  })

  test('序列化字段顺序稳定（同输入 byte-exact 一致）', () => {
    const a = buildHtmlAnchor({ snapshotText: 'x', selector: 'p', sectionId: 's', paragraphIndex: 1, citeIndex: 0 })
    const j1 = serializeAnchor(a)
    const j2 = serializeAnchor(a)
    expect(j1).toBe(j2)
    // 顺序：type → snapshot_text → location_data → version
    expect(j1.indexOf('"type"')).toBeLessThan(j1.indexOf('"snapshot_text"'))
    expect(j1.indexOf('"snapshot_text"')).toBeLessThan(j1.indexOf('"location_data"'))
    expect(j1.indexOf('"location_data"')).toBeLessThan(j1.indexOf('"version"'))
  })

  test('locationData 为空时不出现在 JSON', () => {
    const a = buildMdAnchor({ snapshotText: 'q' })
    expect(serializeAnchor(a)).not.toContain('location_data')
  })
})

describe('deserializeAnchor 兜底', () => {
  test('null / 空串 → null', () => {
    expect(deserializeAnchor(null)).toBeNull()
    expect(deserializeAnchor(undefined)).toBeNull()
    expect(deserializeAnchor('')).toBeNull()
    expect(deserializeAnchor('   ')).toBeNull()
  })

  test('老字符串（非 JSON）→ 兜底 html anchor，snapshotText = 原字符串', () => {
    const a = deserializeAnchor('legacy-string-anchor')
    expect(a).toEqual({ type: 'html', snapshotText: 'legacy-string-anchor', version: 1 })
  })

  test('坏 JSON → 兜底 html anchor', () => {
    const a = deserializeAnchor('{not valid json')
    expect(a).toEqual({ type: 'html', snapshotText: '{not valid json', version: 1 })
  })

  test('JSON 但缺 type → 兜底', () => {
    const a = deserializeAnchor('{"foo":"bar"}')
    expect(a?.snapshotText).toBe('{"foo":"bar"}')
  })

  test('type 与 kind 不一致 → 保留 snapshotText，丢弃 location', () => {
    const json = JSON.stringify({
      type: 'md',
      snapshot_text: 'x',
      location_data: { kind: 'html', selector: 'p' }, // 与 type 不匹配
      version: 1,
    })
    const a = deserializeAnchor(json)!
    expect(a.type).toBe('md')
    expect(a.snapshotText).toBe('x')
    expect(a.locationData).toBeUndefined()
  })

  test('未知字段被静默丢弃（forward-compatible）', () => {
    const json = JSON.stringify({
      type: 'html',
      snapshot_text: 'x',
      location_data: { kind: 'html', selector: 'p', futureField: 'ignored' },
      futureTopField: 'ignored',
      version: 1,
    })
    const a = deserializeAnchor(json)!
    expect(a.snapshotText).toBe('x')
    expect((a.locationData as { selector: string }).selector).toBe('p')
  })
})

describe('anchorContentHash + anchorsContentEqual', () => {
  test('相同 snapshotText + type → 相同 hash', () => {
    const a = buildHtmlAnchor({ snapshotText: 'foo' })
    const b = buildHtmlAnchor({ snapshotText: 'foo', selector: '#different' })
    expect(anchorContentHash(a)).toBe(anchorContentHash(b))
    expect(anchorsContentEqual(a, b)).toBe(true)
  })

  test('不同 snapshotText → 不同 hash', () => {
    const a = buildHtmlAnchor({ snapshotText: 'foo' })
    const b = buildHtmlAnchor({ snapshotText: 'bar' })
    expect(anchorContentHash(a)).not.toBe(anchorContentHash(b))
    expect(anchorsContentEqual(a, b)).toBe(false)
  })

  test('locationData 差异不影响 hash（身份只看 snapshotText）', () => {
    const a: Anchor = {
      type: 'html',
      snapshotText: 'same',
      locationData: { kind: 'html', selector: 'A' },
    }
    const b: Anchor = {
      type: 'html',
      snapshotText: 'same',
      locationData: { kind: 'html', selector: 'B' },
    }
    expect(anchorContentHash(a)).toBe(anchorContentHash(b))
  })

  test('type 不同视为不同内容', () => {
    const a = buildHtmlAnchor({ snapshotText: 'x' })
    const b = buildMdAnchor({ snapshotText: 'x' })
    expect(anchorsContentEqual(a, b)).toBe(false)
  })
})
