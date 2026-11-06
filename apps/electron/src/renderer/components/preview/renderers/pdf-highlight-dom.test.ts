/**
 * pdf-highlight-dom.ts 单元测试
 *
 * 覆盖：
 *   - collectSpanSubRanges：局部区间数学（部分行 / 跨 span / 完整覆盖）、sepLen 0 vs 1、
 *     空 item / 零长 / 落在合成分隔符里的命中跳过
 *   - wrapSpanSubRanges：只包匹配子串（不染整行）、保留 <br>、重叠区间合并、多区间从右往左
 *   - clearInjectedHighlights + wrap 的幂等性（wrap→clear→wrap 回到 pristine）
 *
 * DOM 依赖由 test-setup.ts 的 happy-dom 提供。
 */
import { beforeEach, describe, expect, test } from 'bun:test'

import {
  PDF_HL_INNER_CLASS,
  type SpanSubRange,
  clearInjectedHighlights,
  collectSpanSubRanges,
  wrapSpanSubRanges,
} from './pdf-highlight-dom.ts'

describe('collectSpanSubRanges: 局部区间映射', () => {
  test('部分行命中：只落匹配子串的局部区间（sepLen=1, 单 item）', () => {
    const items = ['similarly to Gao et al. [29], we found that WET files retained too much boilerplate']
    const out = new Map<number, SpanSubRange[]>()
    const idx = items[0]!.indexOf('WET files')
    const len = 'WET files retained'.length
    collectSpanSubRanges(items, idx, idx + len, 1, { cls: ['note-quote-highlight'], noteId: 'n1' }, out)
    expect(out.get(0)).toEqual([{ start: idx, end: idx + len, cls: ['note-quote-highlight'], noteId: 'n1' }])
  })

  test('跨相邻两 span：左右各落一段局部区间（sepLen=1）', () => {
    const items = ['foo bar', 'baz qux'] // pageText = "foo bar baz qux"（中间 1 个分隔符）
    // 命中 "bar baz" → pageText 区间 [4, 11)
    const out = new Map<number, SpanSubRange[]>()
    collectSpanSubRanges(items, 4, 11, 1, { cls: ['note-quote-highlight'], noteId: 'n1' }, out)
    // item0="foo bar"(0..7)，局部 [4,7)="bar"；item1="baz qux"(8..15)，局部 [0,3)="baz"
    expect(out.get(0)).toEqual([{ start: 4, end: 7, cls: ['note-quote-highlight'], noteId: 'n1' }])
    expect(out.get(1)).toEqual([{ start: 0, end: 3, cls: ['note-quote-highlight'], noteId: 'n1' }])
  })

  test('完整覆盖某 span：局部区间 = 整段', () => {
    const items = ['alpha', 'beta']
    const out = new Map<number, SpanSubRange[]>()
    // pageText = "alpha beta"，命中 "alpha"
    collectSpanSubRanges(items, 0, 5, 1, { cls: ['note-quote-highlight'] }, out)
    expect(out.get(0)).toEqual([{ start: 0, end: 5, cls: ['note-quote-highlight'], noteId: undefined }])
    expect(out.has(1)).toBe(false)
  })

  test('sepLen=0（search 路径）：无分隔拼接的坐标映射', () => {
    const items = ['foo', 'bar'] // join('') = "foobar"
    const out = new Map<number, SpanSubRange[]>()
    // 命中 "oba" → [2,5)
    collectSpanSubRanges(items, 2, 5, 0, { cls: ['pdf-search-match'] }, out)
    expect(out.get(0)).toEqual([{ start: 2, end: 3, cls: ['pdf-search-match'], noteId: undefined }]) // "o"
    expect(out.get(1)).toEqual([{ start: 0, end: 2, cls: ['pdf-search-match'], noteId: undefined }]) // "ba"
  })

  test('命中落在 item 间合成分隔符里：跳过（无局部区间）', () => {
    const items = ['ab', 'cd'] // pageText="ab cd"，下标 2 是分隔符
    const out = new Map<number, SpanSubRange[]>()
    collectSpanSubRanges(items, 2, 3, 1, { cls: ['note-quote-highlight'] }, out)
    expect(out.size).toBe(0)
  })

  test('空 item 不产生子区间', () => {
    const items = ['', 'xy']
    const out = new Map<number, SpanSubRange[]>()
    // pageText = " xy"（空 item + 分隔 + xy）；命中 "xy" → [1,3)
    collectSpanSubRanges(items, 1, 3, 1, { cls: ['note-quote-highlight'] }, out)
    expect(out.has(0)).toBe(false)
    expect(out.get(1)).toEqual([{ start: 0, end: 2, cls: ['note-quote-highlight'], noteId: undefined }])
  })
})

describe('wrapSpanSubRanges: 精确包裹子串', () => {
  function makeSpan(text: string, withBr = false): HTMLElement {
    const span = document.createElement('span')
    span.appendChild(document.createTextNode(text))
    if (withBr) span.appendChild(document.createElement('br'))
    return span
  }

  test('只包匹配子串，不染整行', () => {
    const span = makeSpan('hello world foo')
    wrapSpanSubRanges(span, [{ start: 6, end: 11, cls: ['note-quote-highlight'], noteId: 'n1' }]) // "world"
    const inner = span.querySelector(`span.${PDF_HL_INNER_CLASS}`)
    expect(inner).not.toBeNull()
    expect(inner!.textContent).toBe('world')
    expect(inner!.classList.contains('note-quote-highlight')).toBe(true)
    expect((inner as HTMLElement).dataset.noteId).toBe('n1')
    // 父 span 自身不挂高亮 class（精确语义）
    expect(span.classList.contains('note-quote-highlight')).toBe(false)
    // 文本整体仍为原文
    expect(span.textContent).toBe('hello world foo')
  })

  test('保留 hasEOL 追加的 <br>', () => {
    const span = makeSpan('line text', true)
    wrapSpanSubRanges(span, [{ start: 0, end: 4, cls: ['note-quote-highlight'] }]) // "line"
    expect(span.querySelector('br')).not.toBeNull()
    expect(span.querySelector(`span.${PDF_HL_INNER_CLASS}`)!.textContent).toBe('line')
  })

  test('重叠子区间合并：并集 class + 后写覆盖 noteId，单个内层 span', () => {
    const span = makeSpan('abcdefgh')
    wrapSpanSubRanges(span, [
      { start: 1, end: 5, cls: ['note-quote-highlight'], noteId: 'n1' }, // bcde
      { start: 3, end: 7, cls: ['pdf-search-match'], noteId: 'n2' },     // defg → 与上段重叠
    ])
    const inners = span.querySelectorAll(`span.${PDF_HL_INNER_CLASS}`)
    expect(inners.length).toBe(1)
    const inner = inners[0] as HTMLElement
    expect(inner.textContent).toBe('bcdefg') // [1,7)
    expect(inner.classList.contains('note-quote-highlight')).toBe(true)
    expect(inner.classList.contains('pdf-search-match')).toBe(true)
    expect(inner.dataset.noteId).toBe('n2') // 后写覆盖
  })

  test('多个不相交子区间：各自独立内层 span', () => {
    const span = makeSpan('aaa bbb ccc')
    wrapSpanSubRanges(span, [
      { start: 0, end: 3, cls: ['note-quote-highlight'] },
      { start: 8, end: 11, cls: ['note-quote-highlight'] },
    ])
    const inners = span.querySelectorAll(`span.${PDF_HL_INNER_CLASS}`)
    expect(inners.length).toBe(2)
    expect(Array.from(inners).map((el) => el.textContent).sort()).toEqual(['aaa', 'ccc'])
    expect(span.textContent).toBe('aaa bbb ccc')
  })
})

describe('clearInjectedHighlights: 幂等还原', () => {
  let layer: HTMLElement
  beforeEach(() => {
    layer = document.createElement('div')
    layer.classList.add('textLayer')
  })

  test('wrap → clear 还原为 pristine 文本（含 <br>）', () => {
    const span = document.createElement('span')
    span.appendChild(document.createTextNode('alpha beta gamma'))
    span.appendChild(document.createElement('br'))
    layer.appendChild(span)
    wrapSpanSubRanges(span, [{ start: 6, end: 10, cls: ['note-quote-highlight'], noteId: 'n1' }]) // "beta"
    expect(layer.querySelectorAll(`span.${PDF_HL_INNER_CLASS}`).length).toBe(1)

    clearInjectedHighlights(layer)
    expect(layer.querySelectorAll(`span.${PDF_HL_INNER_CLASS}`).length).toBe(0)
    expect(span.querySelector('br')).not.toBeNull()
    // normalize 后应只剩单个文本节点 + <br>
    expect(span.childNodes.length).toBe(2)
    expect(span.childNodes[0]!.nodeType).toBe(Node.TEXT_NODE)
    expect(span.textContent).toBe('alpha beta gamma')
  })

  test('wrap→clear→wrap 幂等：重复后 DOM 一致', () => {
    const span = document.createElement('span')
    span.appendChild(document.createTextNode('one two three'))
    layer.appendChild(span)
    const sub: SpanSubRange[] = [{ start: 4, end: 7, cls: ['note-quote-highlight'], noteId: 'n1' }] // "two"

    wrapSpanSubRanges(span, sub)
    const firstHtml = span.innerHTML
    clearInjectedHighlights(layer)
    wrapSpanSubRanges(span, sub)
    expect(span.innerHTML).toBe(firstHtml)
    expect(span.querySelectorAll(`span.${PDF_HL_INNER_CLASS}`).length).toBe(1)
  })

  test('无注入 span 时 clear 是 no-op', () => {
    const span = document.createElement('span')
    span.appendChild(document.createTextNode('plain'))
    layer.appendChild(span)
    clearInjectedHighlights(layer)
    expect(span.textContent).toBe('plain')
    expect(span.childNodes.length).toBe(1)
  })
})
