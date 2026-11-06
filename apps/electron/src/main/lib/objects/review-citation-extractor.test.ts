/**
 * review-citation-extractor 单测
 */
import { describe, expect, test } from 'bun:test'

import {
  extractReviewCitations,
  parseReferencesTable,
} from './review-citation-extractor.ts'

const SAMPLE = `<article class="asci-review" data-version="1">
  <header><h1>T</h1></header>
  <section id="s1">
    <h2>§1 Introduction</h2>
    <p>The Transformer architecture introduced by Vaswani<cite data-ref="1"><q>attention is all you need verbatim</q></cite> reshaped LLM.</p>
    <p>Later, ReAct<cite data-ref="2"><q>react verbatim quote</q></cite> showed agent-based reasoning.</p>
  </section>
  <section id="s2">
    <h2>§2 Core Themes</h2>
    <p>Attention<cite data-ref="1"><q>second cite same paper</q></cite> and acting<cite data-ref="2"><q>2nd cite of paper 2</q></cite>.</p>
  </section>
  <section id="s7" class="references">
    <h2>§7 References</h2>
    <ol class="refs">
      <li id="ref-1" data-ref="1" data-doi="10.48550/arXiv.1706.03762">
        Vaswani, A. <i>Attention Is All You Need</i>. 2017.
      </li>
      <li id="ref-2" data-ref="2" data-paper-id="paper-react">
        Yao, S. <i>ReAct: Synergizing Reasoning and Acting in Language Models</i>. 2023.
      </li>
    </ol>
  </section>
</article>`

describe('parseReferencesTable', () => {
  test('解析多条 <li data-ref>，按 data-paper-id / data-doi 优先级取 PaperRef', () => {
    const refs = parseReferencesTable(SAMPLE)
    expect(refs.size).toBe(2)
    expect(refs.get(1)?.paper).toEqual({ doi: '10.48550/arXiv.1706.03762' })
    expect(refs.get(2)?.paper).toEqual({ id: 'paper-react' })
  })

  test('paper-id 优先级高于 doi', () => {
    const html = `<li data-ref="1" data-paper-id="P1" data-doi="10.x/y">A</li>`
    const r = parseReferencesTable(html)
    expect(r.get(1)?.paper).toEqual({ id: 'P1' })
  })

  test('只有 zotero-key 时也能取到', () => {
    const html = `<li data-ref="1" data-zotero-key="ABC123">A</li>`
    const r = parseReferencesTable(html)
    expect(r.get(1)?.paper).toEqual({ zoteroKey: 'ABC123' })
  })

  test('既无 paper-id 也无 doi 也无 zotero-key → paper: null（仍出现在 map 里）', () => {
    const html = `<li data-ref="1">A. <i>T</i>. 2020</li>`
    const r = parseReferencesTable(html)
    expect(r.size).toBe(1)
    expect(r.get(1)?.paper).toBeNull()
  })

  test('容忍单 / 双引号', () => {
    const html = `<li data-ref='1' data-paper-id='P1'>A</li>`
    expect(parseReferencesTable(html).get(1)?.paper).toEqual({ id: 'P1' })
  })

  test('从 <li> 文本抽 metadata（title/authors/year/venue）', () => {
    const refs = parseReferencesTable(SAMPLE)
    expect(refs.get(1)?.metadata).toEqual({
      title: 'Attention Is All You Need',
      authors: ['Vaswani', 'A'],
      year: 2017,
      doi: '10.48550/arXiv.1706.03762',
    })
    expect(refs.get(2)?.metadata).toEqual({
      title: 'ReAct: Synergizing Reasoning and Acting in Language Models',
      authors: ['Yao', 'S'],
      year: 2023,
    })
  })

  test('venue 在 title 与 year 之间也能抽出来', () => {
    const html = `<li data-ref="1" data-doi="10.1/x">Broxton, M. <i>Wave optics theory</i>. Optics Express, 2013.</li>`
    const r = parseReferencesTable(html)
    expect(r.get(1)?.metadata).toEqual({
      title: 'Wave optics theory',
      authors: ['Broxton', 'M'],
      year: 2013,
      venue: 'Optics Express',
      doi: '10.1/x',
    })
  })
})

describe('extractReviewCitations', () => {
  test('完整提取：跨 section 的多个 cite + dedup paper 解析', () => {
    const r = extractReviewCitations(SAMPLE)
    expect(r.items.length).toBe(4) // 2 cites in s1 + 2 cites in s2

    // 第一条：s1 第 1 段 第 1 个 cite，引用 paper 1
    const first = r.items[0]!
    expect(first.paper).toEqual({ doi: '10.48550/arXiv.1706.03762' })
    expect(first.source.type).toBe('md')
    expect(first.source.snapshotText).toBe('attention is all you need verbatim')
    expect(first.target.type).toBe('html')
    expect(first.target.snapshotText).toBe(
      'The Transformer architecture introduced by Vaswani reshaped LLM.',
    )
    expect(first.target.locationData).toMatchObject({
      kind: 'html',
      sectionId: 's1',
      paragraphIndex: 0,
      citeIndex: 0,
    })
    expect((first.target.locationData as { selector?: string }).selector).toContain('#s1')

    // 第二条：s1 第 2 段 第 1 个 cite，引用 paper 2
    expect(r.items[1]).toMatchObject({
      paper: { id: 'paper-react' },
      source: { snapshotText: 'react verbatim quote' },
      target: { locationData: { sectionId: 's1', paragraphIndex: 1, citeIndex: 0 } },
    })

    // 第三条：s2 第 1 段 第 1 个 cite（注意 paragraphIdx 在 section 内重置为 0）
    expect(r.items[2]).toMatchObject({
      paper: { doi: '10.48550/arXiv.1706.03762' },
      target: { locationData: { sectionId: 's2', paragraphIndex: 0, citeIndex: 0 } },
    })

    // 第四条：s2 第 1 段 第 2 个 cite
    expect(r.items[3]).toMatchObject({
      paper: { id: 'paper-react' },
      target: { locationData: { sectionId: 's2', paragraphIndex: 0, citeIndex: 1 } },
    })

    expect(r.refsMissingPaper).toEqual([])
    expect(r.citesUnresolved).toEqual([])
  })

  test('target.snapshotText 剥掉 <cite>...</cite> 块（不污染段落文本）', () => {
    const r = extractReviewCitations(SAMPLE)
    for (const item of r.items) {
      expect(item.target.snapshotText).not.toContain('<cite')
      expect(item.target.snapshotText).not.toContain('<q')
      expect(item.target.snapshotText).not.toContain('verbatim')  // quote 内容不应出现在段落文本
    }
  })

  test('§7 References 块自身的 <li>/<cite>（如果有）不被当作正文引用', () => {
    // SAMPLE 的 §7 没有 <cite>，加一个有 cite 的 §7 试试
    const html = `<article class="asci-review">
      <section id="s1"><p>x<cite data-ref="1"><q>q1</q></cite>.</p></section>
      <section id="s7" class="references">
        <ol class="refs">
          <li id="ref-1" data-ref="1" data-paper-id="P1">
            <p>some intro<cite data-ref="1"><q>should not extract</q></cite></p>
            A. <i>T</i>. 2020
          </li>
        </ol>
      </section>
    </article>`
    const r = extractReviewCitations(html)
    expect(r.items.length).toBe(1)
    expect(r.items[0]!.source.snapshotText).toBe('q1')
  })

  test('cite data-ref 在 §7 找不到对应 paper → citesUnresolved 记录，items 不含这条', () => {
    const html = `<article class="asci-review">
      <section id="s1"><p>x<cite data-ref="99"><q>orphan</q></cite>.</p></section>
      <section id="s7" class="references"><ol class="refs"></ol></section>
    </article>`
    const r = extractReviewCitations(html)
    expect(r.items.length).toBe(0)
    expect(r.citesUnresolved).toEqual([99])
  })

  test('§7 条目缺 paper 标识 → refsMissingPaper 记录', () => {
    const html = `<article class="asci-review">
      <section id="s1"><p>x<cite data-ref="1"><q>q</q></cite>.</p></section>
      <section id="s7" class="references">
        <ol class="refs">
          <li id="ref-1" data-ref="1">A. <i>T</i>. 2020</li>
        </ol>
      </section>
    </article>`
    const r = extractReviewCitations(html)
    expect(r.refsMissingPaper).toEqual([1])
    expect(r.items.length).toBe(0)
    expect(r.citesUnresolved).toEqual([1])
  })

  test('wrapped HTML 文档（含 <!doctype><html><head><body>）也能命中 <article>', () => {
    const wrapped = `<!doctype html><html><head><title>x</title></head><body>${SAMPLE}</body></html>`
    const r = extractReviewCitations(wrapped)
    expect(r.items.length).toBe(4)
  })

  test('找不到 <article class="asci-review"> → 返回空（不抛错）', () => {
    expect(extractReviewCitations('<p>just a paragraph</p>')).toEqual({
      items: [],
      references: [],
      refsMissingPaper: [],
      citesUnresolved: [],
    })
  })

  test('section 无 id → selector 缺省，但 paragraphIndex / citeIndex 仍有', () => {
    const html = `<article class="asci-review">
      <section><p>x<cite data-ref="1"><q>q</q></cite>.</p></section>
      <section id="s7" class="references">
        <ol class="refs"><li id="ref-1" data-ref="1" data-paper-id="P1">x</li></ol>
      </section>
    </article>`
    const r = extractReviewCitations(html)
    expect(r.items.length).toBe(1)
    expect(r.items[0]!.target.locationData).toMatchObject({
      kind: 'html',
      paragraphIndex: 0,
      citeIndex: 0,
    })
    expect((r.items[0]!.target.locationData as { selector?: string }).selector).toBeUndefined()
  })

  test('HTML 实体在 quote 和段落文本中被解码', () => {
    const html = `<article class="asci-review">
      <section id="s1"><p>A &amp; B<cite data-ref="1"><q>X &lt; Y &amp; Z</q></cite>.</p></section>
      <section id="s7" class="references">
        <ol class="refs"><li id="ref-1" data-ref="1" data-paper-id="P1">x</li></ol>
      </section>
    </article>`
    const r = extractReviewCitations(html)
    expect(r.items[0]!.source.snapshotText).toBe('X < Y & Z')
    expect(r.items[0]!.target.snapshotText).toBe('A & B.')
  })
})
