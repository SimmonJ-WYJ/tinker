import { describe, test, expect } from 'bun:test'
import { parsePaperSearchResult } from './paper-search-result.ts'

describe('parsePaperSearchResult', () => {
  test('标准 JSON 返回 count + sources', () => {
    const text = JSON.stringify({
      display_count: 12,
      sources: ['arxiv', 'openalex', 'crossref'],
    })
    expect(parsePaperSearchResult(text)).toEqual({
      count: 12,
      sources: ['arxiv', 'openalex', 'crossref'],
    })
  })

  test('JSON 含额外字段不影响解析', () => {
    const text = JSON.stringify({
      display_count: 5,
      sources: ['arxiv'],
      extra: 'ignored',
      papers: [{ title: 'foo' }],
    })
    expect(parsePaperSearchResult(text)).toEqual({
      count: 5,
      sources: ['arxiv'],
    })
  })

  test('display_count 为 0 仍返回有效结果', () => {
    const text = JSON.stringify({ display_count: 0, sources: [] })
    expect(parsePaperSearchResult(text)).toEqual({
      count: 0,
      sources: [],
    })
  })

  test('缺 display_count 字段返回 null', () => {
    const text = JSON.stringify({ sources: ['arxiv'] })
    expect(parsePaperSearchResult(text)).toBeNull()
  })

  test('display_count 不是 number 返回 null', () => {
    const text = JSON.stringify({ display_count: '12', sources: [] })
    expect(parsePaperSearchResult(text)).toBeNull()
  })

  test('缺 sources 字段返回 null', () => {
    const text = JSON.stringify({ display_count: 12 })
    expect(parsePaperSearchResult(text)).toBeNull()
  })

  test('sources 不是数组返回 null', () => {
    const text = JSON.stringify({ display_count: 12, sources: 'arxiv,openalex' })
    expect(parsePaperSearchResult(text)).toBeNull()
  })

  test('sources 数组里有非字符串元素返回 null', () => {
    const text = JSON.stringify({ display_count: 12, sources: ['arxiv', 42] })
    expect(parsePaperSearchResult(text)).toBeNull()
  })

  test('非 JSON 字符串返回 null', () => {
    expect(parsePaperSearchResult('not json at all')).toBeNull()
  })

  test('空字符串返回 null', () => {
    expect(parsePaperSearchResult('')).toBeNull()
  })

  test('JSON null 返回 null', () => {
    expect(parsePaperSearchResult('null')).toBeNull()
  })

  test('JSON 数组(非对象)返回 null', () => {
    expect(parsePaperSearchResult('[1,2,3]')).toBeNull()
  })
})
