/**
 * vector-db 单测
 *
 * driver 说明（与 object-store.test.ts 同一结论）：Bun 测试运行时不支持
 * better-sqlite3 native binding，这里用 bun:sqlite 适配 RawVectorDb 最小接口。
 * vec0 真路径（sqlite-vec 扩展）由 Electron 冒烟覆盖；本测试覆盖
 * schema / chunks 读写 / FTS5 检索 / RRF 融合 / 过滤与每篇去重 / 删除联动。
 */

import { describe, expect, test } from 'bun:test'

import { buildFtsMatchQuery, rrfFuse } from './vector-db.ts'
import { openTestVectorDb } from './test-helpers.ts'

const CHUNK = (content: string, anchor: string | null = null) => ({
  anchorStart: anchor,
  anchorEnd: anchor,
  content,
})

describe('rrfFuse', () => {
  test('双路命中分数高于单路；按融合分降序', () => {
    const fused = rrfFuse([
      [1, 2, 3],
      [3, 4],
    ])
    const ids = fused.map(([id]) => id)
    expect(ids[0]).toBe(3) // 双路命中（rank3 + rank1）最高
    expect(ids).toContain(1)
    expect(ids).toContain(4)
    // 分数严格降序
    const scores = fused.map(([, s]) => s)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })

  test('空输入 → 空输出', () => {
    expect(rrfFuse([[], []])).toEqual([])
  })

  test('加权：向量腿加权后，向量 rank1 压过仅 FTS rank1 的噪声（P1 回退修复）', () => {
    // 向量把"正确" chunk(1)排第1；FTS 找不到它、把噪声 chunk(2)排第1。
    // 等权下两者打平(都 1/61)，加权(向量 2×)后正确 chunk 胜出。
    const equal = rrfFuse([[1], [2]])
    expect(equal[0]![1]).toBeCloseTo(equal[1]![1]) // 等权打平
    const weighted = rrfFuse([[1], [2]], [2, 1])
    expect(weighted[0]![0]).toBe(1) // 向量命中排第一
    expect(weighted[0]![1]).toBeGreaterThan(weighted[1]![1])
  })

  test('加权：weight=0 的路完全不参与', () => {
    const fused = rrfFuse([[1, 2], [3, 4]], [1, 0])
    expect(fused.map(([id]) => id).sort()).toEqual([1, 2]) // 第二路被跳过
  })
})

describe('buildFtsMatchQuery', () => {
  test('多词 → 整串短语 + 各词项 OR，连续命中靠 BM25 排前', () => {
    expect(buildFtsMatchQuery('alpha beta')).toBe('"alpha beta" OR "alpha" OR "beta"')
  })

  test('重复词项去重', () => {
    expect(buildFtsMatchQuery('Testing Sequential Testing')).toBe(
      '"Testing Sequential Testing" OR "Testing" OR "Sequential"',
    )
  })

  test('单词 → 仅该词项短语（无冗余整串）', () => {
    expect(buildFtsMatchQuery('attention')).toBe('"attention"')
  })

  test('< 3 字符词项剔除；整串短语仍保留过短词', () => {
    expect(buildFtsMatchQuery('to use cache')).toBe('"to use cache" OR "use" OR "cache"')
  })

  test('全部词项过短 → null（FTS 路跳过）', () => {
    expect(buildFtsMatchQuery('a bb')).toBeNull()
    expect(buildFtsMatchQuery('   ')).toBeNull()
  })

  test('双引号注入被转义', () => {
    expect(buildFtsMatchQuery('foo"bar baz')).toBe('"foo""bar baz" OR "foo""bar" OR "baz"')
  })
})

describe('ZoteroVectorDb（bun:sqlite，FTS-only）', () => {
  test('meta 记录模型 id 与维度', () => {
    const vdb = openTestVectorDb()
    expect(vdb.getMeta('model_id')).toBe('test-model')
    expect(vdb.getMeta('embed_dim')).toBe('4')
  })

  test('replaceChunks 写入 + content_hash 增量判定 + countChunks', () => {
    const vdb = openTestVectorDb()
    vdb.replaceChunks('KEY1', 'raw', 'hash-v1', [CHUNK('alpha beta gamma'), CHUNK('delta epsilon')])
    expect(vdb.countChunks()).toBe(2)
    expect(vdb.getContentHash('KEY1', 'raw')).toBe('hash-v1')
    expect(vdb.getContentHash('KEY1', 'article')).toBeUndefined()

    // 重复 replace 整体替换，不累积
    vdb.replaceChunks('KEY1', 'raw', 'hash-v2', [CHUNK('replaced content only')])
    expect(vdb.countChunks()).toBe(1)
    expect(vdb.getContentHash('KEY1', 'raw')).toBe('hash-v2')
  })

  test('FTS 检索：精确术语命中 + snippet 回带 + 锚点保留', () => {
    const vdb = openTestVectorDb()
    vdb.replaceChunks('KEY1', 'raw', 'h1', [
      CHUNK('Grouped-Query Attention reduces KV cache cost', 'b0'),
      CHUNK('unrelated paragraph about climate', 'b100'),
    ])
    const hits = vdb.search({ queryText: 'Grouped-Query Attention', maxResults: 5 })
    expect(hits.length).toBe(1)
    expect(hits[0].paperId).toBe('KEY1')
    expect(hits[0].anchorStart).toBe('b0')
    expect(hits[0].snippet).toContain('KV cache')
  })

  test('多词查询：整串非连续也靠词项 OR 命中（修复 trigram 单短语漏召回）', () => {
    const vdb = openTestVectorDb()
    vdb.replaceChunks('KEY1', 'raw', 'h1', [
      CHUNK('We applied post-test segmentation to correct for ramp-ups in the funnel'),
      CHUNK('Unbalanced sampling across arms biased the estimator'),
      CHUNK('totally unrelated content about marine biology'),
    ])
    // 整串 "ramp-ups post-test segmentation unbalanced sampling" 不作为连续子串出现，
    // 旧实现（整串单短语）命中 0；新实现按词项 OR 应命中前两条、跳过无关第三条
    const hits = vdb.search({
      queryText: 'ramp-ups post-test segmentation unbalanced sampling',
      maxResults: 10,
    })
    expect(hits.length).toBe(2)
    expect(hits.some((h) => h.snippet.includes('post-test segmentation'))).toBe(true)
    expect(hits.some((h) => h.snippet.includes('Unbalanced sampling'))).toBe(true)
  })

  test('多词查询：部分词项命中即召回，重复词项不影响', () => {
    const vdb = openTestVectorDb()
    vdb.replaceChunks('KEY1', 'raw', 'h1', [
      CHUNK('Sequential Hypothesis Testing controls error under optional stopping'),
      CHUNK('A note on frequentist confidence intervals'),
    ])
    const hits = vdb.search({
      queryText: 'Bayesian Hypothesis Testing Sequential Hypothesis Testing',
      maxResults: 10,
    })
    expect(hits.length).toBe(1)
    expect(hits[0].snippet).toContain('Sequential Hypothesis Testing')
  })

  test('trigram 支持中文子串命中', () => {
    const vdb = openTestVectorDb()
    vdb.replaceChunks('KEY1', 'raw', 'h1', [CHUNK('注意力机制在长上下文建模中的成本优化')])
    const hits = vdb.search({ queryText: '注意力机制', maxResults: 5 })
    expect(hits.length).toBe(1)
  })

  test('attachmentKeys / textKinds 过滤', () => {
    const vdb = openTestVectorDb()
    vdb.replaceChunks('KEY1', 'raw', 'h1', [CHUNK('shared keyword attention')])
    vdb.replaceChunks('KEY2', 'raw', 'h2', [CHUNK('shared keyword attention too')])
    vdb.replaceChunks('KEY2', 'title_abstract', 'h3', [CHUNK('shared keyword attention abstract')])

    const onlyKey1 = vdb.search({ queryText: 'keyword attention', maxResults: 10, attachmentKeys: ['KEY1'] })
    expect(onlyKey1.every((h) => h.paperId === 'KEY1')).toBe(true)
    expect(onlyKey1.length).toBe(1)

    const onlyAbstract = vdb.search({
      queryText: 'keyword attention',
      maxResults: 10,
      textKinds: ['title_abstract'],
    })
    expect(onlyAbstract.length).toBe(1)
    expect(onlyAbstract[0].textKind).toBe('title_abstract')
  })

  test('每篇去重：maxPerPaper 限制单篇命中数', () => {
    const vdb = openTestVectorDb()
    vdb.replaceChunks(
      'KEY1',
      'raw',
      'h1',
      Array.from({ length: 8 }, (_, i) => CHUNK(`repeated topic sentence variant ${i}`)),
    )
    const hits = vdb.search({ queryText: 'repeated topic sentence', maxResults: 10, maxPerPaper: 2 })
    expect(hits.length).toBe(2)
  })

  test('deleteByAttachmentKey 三表联动清理（FTS 不再命中）', () => {
    const vdb = openTestVectorDb()
    vdb.replaceChunks('KEY1', 'raw', 'h1', [CHUNK('deletable unique content')])
    vdb.replaceChunks('KEY2', 'raw', 'h2', [CHUNK('keep this one around')])
    vdb.deleteByAttachmentKey('KEY1')
    expect(vdb.countChunks()).toBe(1)
    expect(vdb.listAttachmentKeys()).toEqual(['KEY2'])
    expect(vdb.search({ queryText: 'deletable unique', maxResults: 5 }).length).toBe(0)
    expect(vdb.search({ queryText: 'keep this one', maxResults: 5 }).length).toBe(1)
  })

  test('过短 query（<3 字符）FTS 路跳过，返回空而不报错', () => {
    const vdb = openTestVectorDb()
    vdb.replaceChunks('KEY1', 'raw', 'h1', [CHUNK('ab content')])
    expect(vdb.search({ queryText: 'ab', maxResults: 5 })).toEqual([])
  })

  test('FTS 特殊字符 query 不抛错（引号转义）', () => {
    const vdb = openTestVectorDb()
    vdb.replaceChunks('KEY1', 'raw', 'h1', [CHUNK('text with "quoted" phrase inside')])
    expect(() =>
      vdb.search({ queryText: 'with "quoted" phrase', maxResults: 5 }),
    ).not.toThrow()
  })

  const SEC = (
    content: string,
    anchor: string,
    sectionIndex: number,
    sectionTitle: string,
  ) => ({ anchorStart: anchor, anchorEnd: anchor, sectionIndex, sectionTitle, content })

  test('章节过滤：sectionTitle 跨篇 substring（大小写不敏感）+ 回显 section 字段', () => {
    const vdb = openTestVectorDb()
    vdb.replaceChunks('PAPER1', 'raw', 'h1', [
      SEC('grouped query attention method detail', 'p2_1', 2, 'Methods'),
      SEC('grouped query attention result detail', 'p3_1', 3, 'Results'),
    ])
    vdb.replaceChunks('PAPER2', 'raw', 'h2', [
      SEC('grouped query attention approach detail', 'p4_1', 4, 'Method'),
    ])
    // "method" 命中 PAPER1.Methods + PAPER2.Method，排除 Results
    const hits = vdb.search({ queryText: 'grouped query attention', maxResults: 10, sectionTitle: 'method' })
    expect(hits.map((h) => h.paperId).sort()).toEqual(['PAPER1', 'PAPER2'])
    expect(hits.every((h) => /method/i.test(h.sectionTitle ?? ''))).toBe(true)
    const p1 = hits.find((h) => h.paperId === 'PAPER1')!
    expect(p1.sectionIndex).toBe(2)
    expect(p1.sectionTitle).toBe('Methods')
  })

  test('章节过滤：sectionIndex 精确匹配（篇内编号）', () => {
    const vdb = openTestVectorDb()
    vdb.replaceChunks('PAPER1', 'raw', 'h1', [
      SEC('grouped query attention method detail', 'p2_1', 2, 'Methods'),
      SEC('grouped query attention result detail', 'p3_1', 3, 'Results'),
    ])
    const hits = vdb.search({ queryText: 'grouped query attention', maxResults: 10, sectionIndex: 3 })
    expect(hits.map((h) => h.paperId)).toEqual(['PAPER1'])
    expect(hits[0].sectionTitle).toBe('Results')
  })

  test('章节过滤排除无章节归属的 chunk（lite raw / title_abstract）', () => {
    const vdb = openTestVectorDb()
    vdb.replaceChunks('P', 'raw', 'h1', [CHUNK('grouped query attention lite text', 'b100')])
    vdb.replaceChunks('P', 'title_abstract', 'h2', [CHUNK('grouped query attention abstract')])
    // 无章节过滤：两条都在
    expect(vdb.search({ queryText: 'grouped query attention', maxResults: 10 }).length).toBe(2)
    // 任一章节过滤生效 → 无 section 的 chunk 全被排除
    expect(
      vdb.search({ queryText: 'grouped query attention', maxResults: 10, sectionTitle: 'method' }).length,
    ).toBe(0)
    expect(
      vdb.search({ queryText: 'grouped query attention', maxResults: 10, sectionIndex: 2 }).length,
    ).toBe(0)
  })

  test('无章节过滤时 hits 仍回显 section 字段（含 null）', () => {
    const vdb = openTestVectorDb()
    vdb.replaceChunks('P', 'raw', 'h1', [
      SEC('unique alpha topic', 'p1_1', 1, 'Intro'),
      CHUNK('unique beta topic', 'b9'),
    ])
    const hits = vdb.search({ queryText: 'unique', maxResults: 10 })
    const a = hits.find((h) => h.snippet.includes('alpha'))!
    const b = hits.find((h) => h.snippet.includes('beta'))!
    expect(a.sectionIndex).toBe(1)
    expect(a.sectionTitle).toBe('Intro')
    expect(b.sectionIndex).toBeNull()
    expect(b.sectionTitle).toBeNull()
  })

  test('P3：命中回传原始 BM25 分（FTS 路命中）；无向量路时 rawCosine 为 null', () => {
    const vdb = openTestVectorDb() // bun:sqlite，vec 不可用 → 纯 FTS
    vdb.replaceChunks('KEY1', 'raw', 'h1', [CHUNK('grouped query attention efficiency')])
    const [hit] = vdb.search({ queryText: 'grouped query attention', maxResults: 5 })
    expect(hit).toBeDefined()
    expect(typeof hit!.rawBm25).toBe('number')
    expect(hit!.rawBm25!).toBeLessThan(0) // FTS5 bm25 越负越相关
    expect(hit!.rawCosine).toBeNull() // 向量路不可用 → 无余弦
  })
})
