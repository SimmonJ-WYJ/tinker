/**
 * review-cwd-scanner 集成测试
 *
 * v0.19.0+：扫描器只接受 .html 文件（HTML fragment），并从首个 <h1>…</h1>
 * 抽取标题；老链路 .md 文件应被忽略（已落库的老 review 由 bodyPath 直读，
 * 不依赖本扫描器）。
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scanSessionReviewsDir } from './review-cwd-scanner.ts'

let tmpCwd: string

beforeEach(() => {
  tmpCwd = mkdtempSync(join(tmpdir(), 'asci-cwd-scan-'))
})
afterEach(() => {
  rmSync(tmpCwd, { recursive: true, force: true })
})

function writeHtml(name: string, body: string, mtimeMs?: number): string {
  const reviewsDir = join(tmpCwd, 'reviews')
  mkdirSync(reviewsDir, { recursive: true })
  const p = join(reviewsDir, name)
  writeFileSync(p, body, 'utf-8')
  if (mtimeMs !== undefined) {
    const t = mtimeMs / 1000
    utimesSync(p, t, t)
  }
  return p
}

/** 极简 fragment 包装，让用例只关心 H1 内容 */
function frag(h1: string, rest = ''): string {
  return `<article class="asci-review" data-version="1">
  <header><h1>${h1}</h1></header>
  <section id="s1"><h2>§1</h2><p>${rest || '正文…'}</p></section>
</article>`
}

describe('scanSessionReviewsDir', () => {
  test('cwd 下没有 reviews/ 子目录 → 返回空数组', () => {
    expect(scanSessionReviewsDir(tmpCwd, Date.now())).toEqual([])
  })

  test('找到 mtime 在 runStartedAt 之后的 html 文件', () => {
    const since = Date.now()
    writeHtml('2026-05-21_15-30-rag.html', frag('RAG 综述'), since + 5000)
    const found = scanSessionReviewsDir(tmpCwd, since)
    expect(found.length).toBe(1)
    expect(found[0]!.fileName).toBe('2026-05-21_15-30-rag.html')
    expect(found[0]!.title).toBe('RAG 综述')
    expect(found[0]!.content).toContain('正文')
  })

  test('过滤掉 runStartedAt 之前 > 2s 的旧文件', () => {
    const since = Date.now()
    writeHtml('old.html', frag('Old'), since - 10_000) // 10s 前，丢弃
    writeHtml('new.html', frag('新综述'), since + 1_000) // 1s 后，保留
    const found = scanSessionReviewsDir(tmpCwd, since)
    expect(found.map((f) => f.fileName)).toEqual(['new.html'])
  })

  test('mtime 落在 grace 窗口内（runStartedAt - 1s）仍保留', () => {
    const since = Date.now()
    writeHtml('borderline.html', frag('边界'), since - 1000)
    const found = scanSessionReviewsDir(tmpCwd, since)
    expect(found.length).toBe(1)
  })

  test('忽略非 .html 文件（含历史 .md）', () => {
    const since = Date.now()
    writeHtml('reviewer.txt', 'not html', since + 1000)
    writeHtml('legacy.md', '# legacy markdown', since + 1000)
    writeHtml('also.htm', '<h1>not html5 ext</h1>', since + 1000)
    expect(scanSessionReviewsDir(tmpCwd, since)).toEqual([])
  })

  test('多份 html 按 mtime 升序返回', () => {
    const since = Date.now()
    writeHtml('b.html', frag('B'), since + 5000)
    writeHtml('a.html', frag('A'), since + 1000)
    writeHtml('c.html', frag('C'), since + 3000)
    const found = scanSessionReviewsDir(tmpCwd, since)
    expect(found.map((f) => f.title)).toEqual(['A', 'C', 'B'])
  })

  test('title 提取：H1 内含 inline tag → 剥标签后保留文本', () => {
    const since = Date.now()
    writeHtml(
      '2026-05-21_15-30-rag.html',
      `<article><header><h1>RAG <em>综述</em> &amp; 评测</h1></header></article>`,
      since + 1000,
    )
    const found = scanSessionReviewsDir(tmpCwd, since)
    expect(found[0]!.title).toBe('RAG 综述 & 评测')
  })

  test('title 提取：H1 带属性、大小写不敏感', () => {
    const since = Date.now()
    writeHtml(
      'attr.html',
      `<H1 class="x" id="t">Title via H1</H1>`,
      since + 1000,
    )
    const found = scanSessionReviewsDir(tmpCwd, since)
    expect(found[0]!.title).toBe('Title via H1')
  })

  test('title 兜底：无 H1 时使用文件名 slug', () => {
    const since = Date.now()
    writeHtml(
      '2026-05-21_15-30-rag-vs-long-context.html',
      '<p>正文无 H1</p>',
      since + 1000,
    )
    const found = scanSessionReviewsDir(tmpCwd, since)
    expect(found[0]!.title).toBe('rag vs long context')
  })

  test('title 兜底：完全自由文件名时直接用去扩展名后的名字', () => {
    const since = Date.now()
    writeHtml('myreview.html', '<p>正文</p>', since + 1000)
    const found = scanSessionReviewsDir(tmpCwd, since)
    expect(found[0]!.title).toBe('myreview')
  })

  test('空文件被丢弃', () => {
    const since = Date.now()
    writeHtml('empty.html', '   \n  ', since + 1000)
    expect(scanSessionReviewsDir(tmpCwd, since)).toEqual([])
  })

  test('H1 内容为空时回退到文件名 slug', () => {
    const since = Date.now()
    writeHtml(
      '2026-05-21_15-30-empty-h1.html',
      `<h1></h1><p>正文</p>`,
      since + 1000,
    )
    const found = scanSessionReviewsDir(tmpCwd, since)
    expect(found[0]!.title).toBe('empty h1')
  })
})
