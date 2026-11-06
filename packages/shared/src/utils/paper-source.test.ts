import { test, expect } from 'bun:test'
import { normalizePaperSource, COMMON_PAPER_SOURCES } from './paper-source'

test('normalizePaperSource: arxiv tool 标签', () => {
  expect(normalizePaperSource('tool:mcp__paper-search__arxiv_search')).toBe('arxiv')
  expect(normalizePaperSource('tool:mcp__paper-search__arxiv_fetch')).toBe('arxiv')
  expect(normalizePaperSource('tool:WebFetch:https://arxiv.org/abs/2103.00001')).toBe('arxiv')
})

test('normalizePaperSource: pubmed / pmc / ncbi', () => {
  expect(normalizePaperSource('tool:mcp__paper-search__pubmed_efetch')).toBe('pubmed')
  expect(normalizePaperSource('tool:mcp__paper-search__pubmed_esearch')).toBe('pubmed')
  expect(normalizePaperSource('tool:mcp__paper-search__pmc_fulltext')).toBe('pubmed')
  expect(normalizePaperSource('tool:WebFetch:ncbi.nlm.nih.gov/...')).toBe('pubmed')
})

test('normalizePaperSource: openalex', () => {
  expect(normalizePaperSource('tool:mcp__paper-search__openalex_works')).toBe('openalex')
  expect(normalizePaperSource('tool:mcp__paper-search__openalex_search')).toBe('openalex')
})

test('normalizePaperSource: semantic scholar', () => {
  expect(normalizePaperSource('tool:mcp__paper-search__semanticscholar_search')).toBe('semanticscholar')
  expect(normalizePaperSource('tool:mcp__paper-search__s2_lookup')).toBe('semanticscholar')
})

test('normalizePaperSource: 泛 web 抓取', () => {
  expect(normalizePaperSource('tool:WebFetch')).toBe('web')
  expect(normalizePaperSource('tool:WebSearch')).toBe('web')
})

test('normalizePaperSource: journal（OPENSCI 期刊源）', () => {
  expect(normalizePaperSource('journal')).toBe('journal')
  expect(normalizePaperSource('tool:mcp__paper-search__search_journal')).toBe('journal')
  expect(normalizePaperSource('Tool:MCP__PAPER-SEARCH__SEARCH_JOURNAL')).toBe('journal')
})

test('normalizePaperSource: 未识别工具 → other', () => {
  expect(normalizePaperSource('tool:Skill:paper-lookup')).toBe('other')
  expect(normalizePaperSource('tool:Bash')).toBe('other')
  expect(normalizePaperSource('tool:custom-mcp__unknown')).toBe('other')
})

test('normalizePaperSource: 空 / null / undefined → other', () => {
  expect(normalizePaperSource('')).toBe('other')
  expect(normalizePaperSource(null)).toBe('other')
  expect(normalizePaperSource(undefined)).toBe('other')
})

test('normalizePaperSource: 大小写不敏感', () => {
  expect(normalizePaperSource('TOOL:MCP__PAPER-SEARCH__ARXIV_SEARCH')).toBe('arxiv')
  expect(normalizePaperSource('Tool:Mcp__Paper-Search__PubMed_efetch')).toBe('pubmed')
})

test('normalizePaperSource: s2 字符边界，不误伤 tools2xx', () => {
  expect(normalizePaperSource('tools2xx_foo')).toBe('other')
})

test('COMMON_PAPER_SOURCES 顺序固定', () => {
  expect(COMMON_PAPER_SOURCES).toEqual(['arxiv', 'pubmed', 'openalex'])
})
