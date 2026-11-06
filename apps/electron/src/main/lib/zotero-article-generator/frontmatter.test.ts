import { describe, expect, test } from 'bun:test'
import {
  extractFrontmatter,
  normalizeFrontmatter,
  serializeFrontmatter,
} from './frontmatter.ts'

describe('extractFrontmatter (v2)', () => {
  test('正确拆分 frontmatter 与 body', () => {
    const text = [
      '---',
      'id: "ABCD1234"',
      'title: "Hello World"',
      'authors: ["A", "B"]',
      'year: 2017',
      'tags: [a, b]',
      'source_pdf: "/tmp/p.pdf"',
      '---',
      '',
      '# OUTLINE',
      '- 1. Intro',
      '',
      '# CONTENT',
      '',
      '# 1. Intro',
      '<block_1>Body line.</block_1>',
    ].join('\n')
    const { frontmatter, body } = extractFrontmatter(text)
    expect(frontmatter).not.toBeNull()
    expect(frontmatter?.id).toBe('ABCD1234')
    expect(frontmatter?.title).toBe('Hello World')
    expect(frontmatter?.authors).toEqual(['A', 'B'])
    expect(frontmatter?.year).toBe(2017)
    expect(frontmatter?.tags).toEqual(['a', 'b'])
    expect(frontmatter?.source_pdf).toBe('/tmp/p.pdf')
    expect(body.startsWith('# OUTLINE')).toBe(true)
  })

  test('无 frontmatter 时整段返回 body', () => {
    const text = '# OUTLINE\n- 1. Intro'
    const { frontmatter, body } = extractFrontmatter(text)
    expect(frontmatter).toBeNull()
    expect(body).toBe(text)
  })

  test('frontmatter 未闭合时整段当 body', () => {
    const text = '---\nid: x\nno close'
    const { frontmatter, body } = extractFrontmatter(text)
    expect(frontmatter).toBeNull()
    expect(body).toBe(text)
  })
})

describe('normalizeFrontmatter (v2)', () => {
  test('强制覆写 id/title/authors/year/source_pdf', () => {
    const fm = normalizeFrontmatter({
      llmFrontmatter: {
        id: 'wrong',
        title: 'wrong title',
        authors: ['Wrong A'],
        year: 1900,
        tags: ['x'],
        source_pdf: '/wrong/path.pdf',
      },
      paperId: 'KEY123',
      recTitle: 'Real Title',
      recFilename: 'paper.pdf',
      authors: ['Real A', 'Real B'],
      year: 2026,
      sourcePdf: '/real/path/paper.pdf',
    })
    expect(fm.id).toBe('KEY123')
    expect(fm.title).toBe('Real Title')
    expect(fm.authors).toEqual(['Real A', 'Real B'])
    expect(fm.year).toBe(2026)
    expect(fm.source_pdf).toBe('/real/path/paper.pdf')
    // tags 保留 LLM 输出（归一为小写）
    expect(fm.tags).toEqual(['x'])
  })

  test('rec.title 为空时退化到 filename，再退化到 paperId', () => {
    const fm = normalizeFrontmatter({
      llmFrontmatter: null,
      paperId: 'K',
      recTitle: '',
      recFilename: 'fallback.pdf',
      authors: [],
      year: null,
      sourcePdf: '/p.pdf',
    })
    expect(fm.title).toBe('fallback.pdf')
  })

  test('tags 归一为小写、≤8、过滤空值', () => {
    const fm = normalizeFrontmatter({
      llmFrontmatter: {
        tags: ['Trans', '  Attention  ', '', 't1', 't2', 't3', 't4', 't5', 't6', 't7'],
      },
      paperId: 'K',
      recTitle: 'T',
      recFilename: 'p.pdf',
      authors: [],
      year: null,
      sourcePdf: '/p.pdf',
    })
    expect(fm.tags.length).toBeLessThanOrEqual(8)
    for (const t of fm.tags) {
      expect(t).toBe(t.toLowerCase())
      expect(t.length).toBeGreaterThan(0)
    }
  })

  test('LLM 没给 tags 时返回空数组', () => {
    const fm = normalizeFrontmatter({
      llmFrontmatter: {},
      paperId: 'K',
      recTitle: 'T',
      recFilename: 'p.pdf',
      authors: [],
      year: null,
      sourcePdf: '/p.pdf',
    })
    expect(fm.tags).toEqual([])
  })

  test('year 为 null 时落盘字面值 null', () => {
    const fm = normalizeFrontmatter({
      llmFrontmatter: null,
      paperId: 'K',
      recTitle: 'T',
      recFilename: 'p.pdf',
      authors: [],
      year: null,
      sourcePdf: '/p.pdf',
    })
    const out = serializeFrontmatter(fm)
    expect(out).toContain('year: null')
  })
})

describe('serializeFrontmatter (v2)', () => {
  test('生成 6 个字段且包含 ---', () => {
    const out = serializeFrontmatter({
      id: 'KEY',
      title: 'Hello',
      authors: ['Alice', 'Bob'],
      year: 2026,
      tags: ['a', 'b'],
      source_pdf: '/tmp/p.pdf',
    })
    expect(out.startsWith('---\n')).toBe(true)
    expect(out.endsWith('\n---')).toBe(true)
    expect(out).toContain('id: "KEY"')
    expect(out).toContain('title: "Hello"')
    expect(out).toContain('authors: ["Alice", "Bob"]')
    expect(out).toContain('year: 2026')
    expect(out).toContain('tags: [a, b]')
    expect(out).toContain('source_pdf: "/tmp/p.pdf"')
  })

  test('title 含冒号仍能正确转义', () => {
    const out = serializeFrontmatter({
      id: 'K',
      title: 'Attention: Is All You Need',
      authors: [],
      year: 2017,
      tags: [],
      source_pdf: '/p.pdf',
    })
    expect(out).toContain('title: "Attention: Is All You Need"')
  })

  test('source_pdf 含反斜杠（Windows 路径）需要正确转义', () => {
    const out = serializeFrontmatter({
      id: 'K',
      title: 'T',
      authors: [],
      year: null,
      tags: [],
      source_pdf: 'C:\\Users\\me\\paper.pdf',
    })
    // 反斜杠应被双写以保持 YAML 字符串内的字面量
    expect(out).toContain('source_pdf: "C:\\\\Users\\\\me\\\\paper.pdf"')
  })
})
