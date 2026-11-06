/**
 * doi-metadata-lookup 单测：crossref JSON → PaperRecord 映射 + 异常路径
 * （spec: docs/specs/doi-paper-jump-spec.md §7）
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  lookupDoiMetadata,
  __toPaperRecordForTest,
  __reconstructInvertedIndexForTest,
  __clearCacheForTest,
} from './doi-metadata-lookup.ts'

/** crossref work 缺 abstract（触发 fallback 链） */
const WORK_NO_ABSTRACT = {
  title: ['Nature paper without crossref abstract'],
  author: [{ given: 'A', family: 'Author' }],
  issued: { 'date-parts': [[2014]] },
  DOI: '10.1038/nmeth.2964',
  'is-referenced-by-count': 761,
}

let originalFetch: typeof globalThis.fetch
beforeEach(() => {
  originalFetch = globalThis.fetch
  __clearCacheForTest() // 进程内缓存跨测试泄漏 → 每例前清，否则复用同一 DOI 会拿缓存绕过 mock
})
afterEach(() => { globalThis.fetch = originalFetch })

const FULL_WORK = {
  title: ['Extending LLM Context Window with <i>Adaptive</i> Grouped Positional Encoding'],
  author: [
    { given: 'Xinhao', family: 'Xu' },
    { name: 'OpenSci Lab' },
    { family: 'OnlyFamily' },
  ],
  issued: { 'date-parts': [[2025, 7]] },
  'container-title': ['ACL 2025'],
  DOI: '10.18653/v1/2025.acl-long.28',
  URL: 'https://doi.org/10.18653/v1/2025.acl-long.28',
  abstract: '<jats:p>Processing long input remains a challenge.</jats:p>',
  'is-referenced-by-count': 1,
}

describe('toPaperRecord 映射', () => {
  test('完整字段映射：title 剥标签 / 作者三形态 / year / venue / citedBy', () => {
    const r = __toPaperRecordForTest(FULL_WORK, '10.18653/v1/2025.acl-long.28')
    expect(r.title).toBe('Extending LLM Context Window with Adaptive Grouped Positional Encoding')
    expect(r.authors).toEqual(['Xinhao Xu', 'OpenSci Lab', 'OnlyFamily'])
    expect(r.year).toBe(2025)
    expect(r.venue).toBe('ACL 2025')
    expect(r.doi).toBe('10.18653/v1/2025.acl-long.28')
    expect(r.abstract).toBe('Processing long input remains a challenge.')
    expect(r.extra).toEqual({ citedBy: 1 })
    expect(r.source).toBe('doi-lookup')
    expect(r.query).toBeNull()
  })

  test('缺字段容错：空 work 不抛错，url 兜底 doi.org', () => {
    const r = __toPaperRecordForTest({}, '10.1234/abc')
    expect(r.title).toBe('(无标题)')
    expect(r.authors).toEqual([])
    expect(r.year).toBeNull()
    expect(r.venue).toBeNull()
    expect(r.doi).toBe('10.1234/abc')
    expect(r.url).toBe('https://doi.org/10.1234/abc')
    expect(r.abstract).toBeNull()
    expect(r.extra).toBeUndefined()
  })
})

describe('lookupDoiMetadata 网络路径', () => {
  test('200 → found，DOI 进 URL 编码', async () => {
    let calledUrl = ''
    globalThis.fetch = mock(async (url: string) => {
      calledUrl = url
      return new Response(JSON.stringify({ message: FULL_WORK }), { status: 200 })
    }) as unknown as typeof globalThis.fetch

    const res = await lookupDoiMetadata('10.18653/v1/2025.acl-long.28')
    expect(res.status).toBe('found')
    if (res.status === 'found') {
      expect(res.record.source).toBe('doi-lookup')
    }
    expect(calledUrl).toBe('https://api.crossref.org/works/10.18653%2Fv1%2F2025.acl-long.28')
  })

  test('404 → not-found', async () => {
    globalThis.fetch = mock(async () => new Response('', { status: 404 })) as unknown as typeof globalThis.fetch
    expect((await lookupDoiMetadata('10.1234/nope')).status).toBe('not-found')
  })

  test('5xx → error', async () => {
    globalThis.fetch = mock(async () => new Response('', { status: 503 })) as unknown as typeof globalThis.fetch
    const res = await lookupDoiMetadata('10.1234/abc')
    expect(res.status).toBe('error')
  })

  test('网络异常 → error（不抛给调用方）', async () => {
    globalThis.fetch = mock(async () => { throw new Error('boom') }) as unknown as typeof globalThis.fetch
    const res = await lookupDoiMetadata('10.1234/abc')
    expect(res.status).toBe('error')
    if (res.status === 'error') expect(res.message).toBe('boom')
  })

  test('message 字段缺失 → error', async () => {
    globalThis.fetch = mock(async () => new Response('{}', { status: 200 })) as unknown as typeof globalThis.fetch
    expect((await lookupDoiMetadata('10.1234/abc')).status).toBe('error')
  })
})

describe('reconstructInvertedIndex', () => {
  test('按位置重排倒排索引', () => {
    const inv = { Wave: [0], optics: [1], theory: [2] }
    expect(__reconstructInvertedIndexForTest(inv)).toBe('Wave optics theory')
  })

  test('乱序位置也能还原', () => {
    const inv = { world: [1], hello: [0] }
    expect(__reconstructInvertedIndexForTest(inv)).toBe('hello world')
  })
})

describe('摘要并行 fallback（crossref 缺摘要时 OpenAlex ‖ Semantic Scholar）', () => {
  /**
   * 按 URL 路由 mock：crossref 无摘要；openAlex / semanticScholar 取
   *   'ok' | 'empty' | 'error'(429) | 'throw'(超时/网络) 模拟各源状态
   */
  type SourceState = 'ok' | 'empty' | 'error' | 'throw'
  function mockSources(opts: { openAlex: SourceState; semanticScholar: SourceState }): void {
    const respond = (state: SourceState, okBody: unknown, emptyBody: unknown): Response => {
      if (state === 'error') return new Response('', { status: 429 })
      return new Response(JSON.stringify(state === 'ok' ? okBody : emptyBody), { status: 200 })
    }
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes('api.crossref.org')) {
        return new Response(JSON.stringify({ message: WORK_NO_ABSTRACT }), { status: 200 })
      }
      if (url.includes('api.openalex.org')) {
        if (opts.openAlex === 'throw') throw new Error('openalex timeout')
        return respond(
          opts.openAlex,
          { abstract_inverted_index: { OpenAlex: [0], abstract: [1] } },
          { abstract_inverted_index: null },
        )
      }
      if (url.includes('api.semanticscholar.org')) {
        if (opts.semanticScholar === 'throw') throw new Error('s2 timeout')
        return respond(opts.semanticScholar, { abstract: 'S2 abstract text' }, { abstract: null })
      }
      return new Response('', { status: 404 })
    }) as unknown as typeof globalThis.fetch
  }

  test('OpenAlex 命中 → 优先用 OpenAlex（即便 S2 也有）', async () => {
    mockSources({ openAlex: 'ok', semanticScholar: 'ok' })
    const res = await lookupDoiMetadata('10.1038/nmeth.2964')
    expect(res.status).toBe('found')
    if (res.status === 'found') {
      expect(res.record.abstract).toBe('OpenAlex abstract')
      expect(res.record.extra?.abstractStatus).toBeUndefined()
    }
  })

  test('OpenAlex 无 → 用 Semantic Scholar', async () => {
    mockSources({ openAlex: 'empty', semanticScholar: 'ok' })
    const res = await lookupDoiMetadata('10.1038/nmeth.2964')
    if (res.status === 'found') expect(res.record.abstract).toBe('S2 abstract text')
  })

  test('OpenAlex 超时但 S2 命中 → 仍拿到（并行不互相拖累）', async () => {
    mockSources({ openAlex: 'throw', semanticScholar: 'ok' })
    const res = await lookupDoiMetadata('10.1038/nmeth.2964')
    if (res.status === 'found') expect(res.record.abstract).toBe('S2 abstract text')
  })

  test('两源都干净返回无摘要 → abstract null 且不标 failed（真没有）', async () => {
    mockSources({ openAlex: 'empty', semanticScholar: 'empty' })
    const res = await lookupDoiMetadata('10.1038/nmeth.2964')
    expect(res.status).toBe('found')
    if (res.status === 'found') {
      expect(res.record.abstract).toBeNull()
      expect(res.record.extra?.abstractStatus).toBeUndefined()
    }
  })

  test('某源超时/限流且都没拿到 → 标 abstractStatus=failed（可重试）', async () => {
    mockSources({ openAlex: 'throw', semanticScholar: 'error' })
    const res = await lookupDoiMetadata('10.1038/nmeth.2964')
    expect(res.status).toBe('found')
    if (res.status === 'found') {
      expect(res.record.abstract).toBeNull()
      expect(res.record.extra?.abstractStatus).toBe('failed')
    }
  })

  test('一源 empty 一源 error 且都没拿到 → 仍标 failed（error 即可能可重试）', async () => {
    mockSources({ openAlex: 'empty', semanticScholar: 'error' })
    const res = await lookupDoiMetadata('10.1038/nmeth.2964')
    if (res.status === 'found') expect(res.record.extra?.abstractStatus).toBe('failed')
  })
})

describe('进程内缓存（同一 DOI 不重复查网络）', () => {
  test('成功结果缓存：第二次调用不再 fetch', async () => {
    let crossrefCalls = 0
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes('api.crossref.org')) {
        crossrefCalls++
        return new Response(JSON.stringify({ message: FULL_WORK }), { status: 200 })
      }
      return new Response('', { status: 404 })
    }) as unknown as typeof globalThis.fetch

    const a = await lookupDoiMetadata('10.18653/v1/2025.acl-long.28')
    const b = await lookupDoiMetadata('10.18653/v1/2025.acl-long.28')
    expect(a.status).toBe('found')
    expect(b.status).toBe('found')
    expect(crossrefCalls).toBe(1) // 第二次命中缓存
  })

  test('瞬时失败(abstractStatus=failed)不缓存：第二次仍重查', async () => {
    let crossrefCalls = 0
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes('api.crossref.org')) {
        crossrefCalls++
        return new Response(JSON.stringify({ message: WORK_NO_ABSTRACT }), { status: 200 })
      }
      // 两源都 error → abstractStatus=failed
      return new Response('', { status: 429 })
    }) as unknown as typeof globalThis.fetch

    const a = await lookupDoiMetadata('10.1038/nmeth.2964')
    const b = await lookupDoiMetadata('10.1038/nmeth.2964')
    expect(a.status === 'found' && a.record.extra?.abstractStatus).toBe('failed')
    expect(b.status).toBe('found')
    expect(crossrefCalls).toBe(2) // failed 未缓存，重试再查
  })

  test('not-found 不缓存：第二次仍重查', async () => {
    let calls = 0
    globalThis.fetch = mock(async () => {
      calls++
      return new Response('', { status: 404 })
    }) as unknown as typeof globalThis.fetch

    await lookupDoiMetadata('10.1234/nope')
    await lookupDoiMetadata('10.1234/nope')
    expect(calls).toBe(2)
  })
})
