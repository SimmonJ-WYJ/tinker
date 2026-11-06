/**
 * pdf-text-match 单测
 *
 * 覆盖：
 *   - normalize：所有 8 类字符差异 + reverse index 正确回填
 *   - findExactMatch：归一化后包含命中 / 不命中
 *   - findDiceMatch：含 [12]、连字符、smart quote 的真实样本
 *   - findAnchorMatch：长 quote 中间词缺失也能锚定
 *   - findBestMatch：三级回退顺序正确
 */

import { describe, expect, test } from 'bun:test'

import {
  __testing__,
  findAnchorMatch,
  findBestMatch,
  findDiceMatch,
  findExactMatch,
  normalize,
  normalizedRangeToOriginal,
} from './pdf-text-match.ts'

describe('normalize: 字符差异类别', () => {
  test('行末连字符复原', () => {
    const r = normalize('trans-\nformer attention')
    expect(r.text).toBe('transformer attention')
  })

  test('行末断词 + 多空格', () => {
    const r = normalize('multi-\n   layer perceptron')
    expect(r.text).toBe('multilayer perceptron')
  })

  test('plain hyphen + 空格（无换行）不合并', () => {
    // PDF 真实 EOL 断词总是带 \n；普通空格分隔的复合词不应被吃掉 hyphen
    const r = normalize('state- of-the-art')
    expect(r.text).toBe('state- of-the-art')
  })

  test('引用标记 [12] 移除（注意周围空白塌缩）', () => {
    const r = normalize('attention [12] yields')
    expect(r.text).toBe('attention  yields'.replace(/\s+/g, ' '))
  })

  test('引用标记 [1, 2] / [1-3] / [1–3]', () => {
    expect(normalize('foo [1, 2] bar').text).toBe('foo  bar'.replace(/\s+/g, ' '))
    expect(normalize('foo [1-3] bar').text).toBe('foo  bar'.replace(/\s+/g, ' '))
    expect(normalize('foo [1–3] bar').text).toBe('foo  bar'.replace(/\s+/g, ' '))
  })

  test('dash 家族统一为 -', () => {
    expect(normalize('a–b').text).toBe('a-b')
    expect(normalize('a—b').text).toBe('a-b')
    expect(normalize('a−b').text).toBe('a-b')
  })

  test('Unicode ligature ﬁ → fi（NFKC 展开）', () => {
    const r = normalize('ﬁnding')
    expect(r.text).toBe('finding')
    // 两个输出字符都指回 ligature 的同一源下标 0
    expect(r.reverse[0]).toBe(0)
    expect(r.reverse[1]).toBe(0)
  })

  test('智能引号统一为 ASCII', () => {
    expect(normalize('“long-context”').text).toBe('"long-context"')
    expect(normalize('it’s').text).toBe("it's")
  })

  test('NBSP + 多空格 + 换行 → 单空格', () => {
    expect(normalize('a  b\n\nc\t\td').text).toBe('a b c d')
  })

  test('大小写统一为小写', () => {
    expect(normalize('Transformer').text).toBe('transformer')
  })

  test('首尾空白 trim', () => {
    expect(normalize('  hello  ').text).toBe('hello')
  })
})

describe('normalize: reverse index 完整性', () => {
  test('简单字符串 reverse 长度 = text.length + 1', () => {
    const r = normalize('hello')
    expect(r.text).toBe('hello')
    expect(r.reverse.length).toBe(r.text.length + 1)
    expect(r.reverse[0]).toBe(0)
    expect(r.reverse[4]).toBe(4)
    expect(r.reverse[5]).toBe(5) // 哨兵
  })

  test('删除了引用标记后，reverse 仍能映回原始坐标', () => {
    const input = 'foo [12] bar'
    const r = normalize(input)
    // text = 'foo  bar' (注意 [12] 被删后留下两个空格被塌缩为一个)
    expect(r.text).toBe('foo bar')
    // 'b' 在 normalized 中的位置 = 4，应映回原始 'b' 位置 = 9
    const bIdx = r.text.indexOf('b')
    expect(r.reverse[bIdx]).toBe(input.indexOf('b'))
  })
})

describe('normalizedRangeToOriginal', () => {
  test('整段区间映射', () => {
    const r = normalize('hello world')
    const range = normalizedRangeToOriginal(r, 0, r.text.length)
    expect(range).toEqual({ origStart: 0, origEnd: 11 })
  })

  test('引用标记内的区间映射跨过删除段', () => {
    const input = 'foo [12] bar baz'
    const r = normalize(input)
    // text = 'foo bar baz'，'bar' 起始在 normalized=4
    const sIdx = r.text.indexOf('bar')
    const eIdx = sIdx + 3
    const { origStart, origEnd } = normalizedRangeToOriginal(r, sIdx, eIdx)
    expect(input.slice(origStart, origEnd)).toBe('bar')
  })
})

describe('findExactMatch: Level 1', () => {
  test('归一化前不匹配，归一化后命中', () => {
    const page = 'See trans-\nformer attention [12] mechanism here'
    const quote = 'transformer attention mechanism'
    const r = findExactMatch(page, quote)
    expect(r).not.toBeNull()
    expect(r!.mode).toBe('exact')
    // 原始坐标应覆盖从 'trans' 到 'mechanism' 末尾
    const slice = page.slice(r!.origStart, r!.origEnd)
    expect(slice).toContain('trans-')
    expect(slice).toContain('mechanism')
  })

  test('完全不相关返回 null', () => {
    expect(findExactMatch('hello world', 'goodbye moon')).toBeNull()
  })

  test('空 quote 返回 null', () => {
    expect(findExactMatch('hello', '')).toBeNull()
    expect(findExactMatch('hello', '   ')).toBeNull()
  })

  test('quote 含 ligature，page 是 fi —— 双向均命中', () => {
    expect(findExactMatch('finding answers', 'ﬁnding answers')).not.toBeNull()
    expect(findExactMatch('ﬁnding answers', 'finding answers')).not.toBeNull()
  })

  test('quote 含智能引号，page 含直引号', () => {
    expect(findExactMatch('the "long-context" claim', 'the “long-context” claim')).not.toBeNull()
  })
})

describe('findDiceMatch: Level 2', () => {
  test('quote 单词替换（obtain ↔ achieve）→ 命中 fuzzy', () => {
    // LLM 摘录时偶发的近义词替换，token 数不变、绝大多数 bigram 重合
    const page = 'We demonstrate that Transformer models obtain state-of-the-art performance on translation tasks across multiple language pairs'
    const quote = 'Transformer models achieve state-of-the-art performance on translation tasks'
    const r = findDiceMatch(page, quote)
    expect(r).not.toBeNull()
    expect(r!.mode).toBe('fuzzy')
    expect(r!.score).toBeGreaterThanOrEqual(0.75)
  })

  test('quote 完全无关 → 返回 null', () => {
    const page = 'The cat sat on the mat'
    const quote = 'machine learning attention mechanism'
    expect(findDiceMatch(page, quote)).toBeNull()
  })

  test('quote 比 page 还长 → 返回 null', () => {
    expect(findDiceMatch('short', 'this quote is way longer than the page text')).toBeNull()
  })
})

describe('findAnchorMatch: Level 3', () => {
  test('quote 头尾完全保留、中间换词 → anchor 命中', () => {
    const page = 'In our experiments we observed that the proposed method significantly outperforms all existing baselines across diverse datasets.'
    // 头 8 token 完全一致 + 尾 8 token 完全一致
    const quote = 'In our experiments we observed that the proposed COMPLETELY DIFFERENT MIDDLE PART outperforms all existing baselines across diverse datasets'
    const r = findAnchorMatch(page, quote)
    expect(r).not.toBeNull()
    expect(r!.mode).toBe('fuzzy')
  })

  test('完全无 anchor 命中 → null', () => {
    expect(findAnchorMatch('hello world this is a test', 'nothing at all matches here ok')).toBeNull()
  })
})

describe('findBestMatch: 三级回退', () => {
  test('Level 1 直接命中', () => {
    const r = findBestMatch('hello world', 'hello world')
    expect(r?.mode).toBe('exact')
    expect(r?.score).toBe(1)
  })

  test('Level 1 miss → Level 2 命中', () => {
    const page = 'We demonstrate that Transformer models obtain state-of-the-art performance on translation tasks across multiple language pairs'
    const quote = 'Transformer models achieve state-of-the-art performance on translation tasks'
    const r = findBestMatch(page, quote)
    expect(r?.mode).toBe('fuzzy')
    expect(r?.score).toBeGreaterThanOrEqual(0.75)
  })

  test('全不命中 → null', () => {
    expect(findBestMatch('hello world', 'completely unrelated text foo bar baz')).toBeNull()
  })
})

describe('__testing__.tokenize', () => {
  test('丢弃 1 字符 token', () => {
    const r = __testing__.tokenize('a quick brown fox')
    // 'a' 长度 1 被丢
    expect(r.map((t) => t.text)).toEqual(['quick', 'brown', 'fox'])
  })

  test('保留 hyphen 内的 token', () => {
    const r = __testing__.tokenize('state-of-the-art')
    expect(r[0]!.text).toBe('state-of-the-art')
  })
})

describe('__testing__.charBigrams + diceCoefficient', () => {
  test('完全一致 → Dice = 1', () => {
    const a = __testing__.charBigrams('hello')
    const b = __testing__.charBigrams('hello')
    expect(__testing__.diceCoefficient(a, b)).toBe(1)
  })

  test('完全不同 → Dice = 0', () => {
    expect(__testing__.diceCoefficient(
      __testing__.charBigrams('abc'),
      __testing__.charBigrams('xyz'),
    )).toBe(0)
  })

  test('部分重叠 → 0 < Dice < 1', () => {
    const score = __testing__.diceCoefficient(
      __testing__.charBigrams('night'),
      __testing__.charBigrams('nacht'),
    )
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })
})
