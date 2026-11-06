import { describe, expect, test } from 'bun:test'
import { splitMarkdownIntoChunks } from './splitter.ts'

describe('splitMarkdownIntoChunks', () => {
  test('短文档单片返回', () => {
    const md = '# Title\n\nFirst para.\n\n## Section\n\nSecond para.'
    const chunks = splitMarkdownIntoChunks(md, 8000)
    expect(chunks.length).toBe(1)
    expect(chunks[0]?.isFirst).toBe(true)
    expect(chunks[0]?.total).toBe(1)
    expect(chunks[0]?.markdown).toBe(md)
  })

  test('按 ## 标题切片（文档超过最小切片阈值）', () => {
    // 超过 splitter 最小阈值（1500 字符）才会真切；每个 section 体量足够
    const sectionBody = 'A'.repeat(800)
    const md = `# Title\n\nIntro.\n\n## A\n\n${sectionBody}\n\n## B\n\n${sectionBody}\n\n## C\n\n${sectionBody}`
    const chunks = splitMarkdownIntoChunks(md, 500)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]?.isFirst).toBe(true)
    expect(chunks[chunks.length - 1]?.total).toBe(chunks.length)
  })

  test('单超长 section 按段落继续切', () => {
    // 单 section 内部很多段，整体超阈值
    const longBody = Array.from({ length: 50 }, (_, i) => 'X'.repeat(80) + ` para${i + 1}`).join('\n\n')
    const md = `# Title\n\n${longBody}`
    const chunks = splitMarkdownIntoChunks(md, 500)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.markdown.length).toBeGreaterThan(0)
    }
  })

  test('index/total 全程一致', () => {
    const sectionBody = 'B'.repeat(800)
    const md = `# T\n\n## A\n\n${sectionBody}\n\n## B\n\n${sectionBody}\n\n## C\n\n${sectionBody}`
    const chunks = splitMarkdownIntoChunks(md, 500)
    const total = chunks.length
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i + 1)
      expect(c.total).toBe(total)
      expect(c.isFirst).toBe(i === 0)
    })
  })
})
