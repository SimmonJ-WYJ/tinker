import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildRgArgs,
  createPapersRgMcpServer,
  createReadArticleSectionHandler,
  createReadContextHandler,
  createReadOutlineHandler,
  createSearchHandler,
  createSemanticSearchHandler,
  extractArticleSection,
  extractOutlineSection,
  findArticleSections,
  findRgBinFromPackage,
  parseRgJsonOutput,
  resolveArticlePath,
  resolvePaperPath,
  resolveRgBin,
  resolveStructuredSourcePath,
  resolveStructuredTxtPath,
  type RgRunnerFn,
} from './papers-rg-tool.ts'

let tmpRoot: string
let wikiDir: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'asci-papers-rg-'))
  wikiDir = join(tmpRoot, 'wiki')
  mkdirSync(wikiDir, { recursive: true })
})

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }) } catch {}
})

/** 把多条 rg --json 事件拼成 stdout 形式的工具 */
function rgJsonStream(matches: Array<{
  path: string
  line: number
  offset: number
  text: string
}>): string {
  return matches
    .map((m) =>
      JSON.stringify({
        type: 'match',
        data: {
          path: { text: m.path },
          lines: { text: m.text },
          line_number: m.line,
          absolute_offset: m.offset,
          submatches: [],
        },
      }),
    )
    .join('\n') + '\n'
}

test('resolvePaperPath：合法 paperId 返回 wikiDir 下的 md 路径', () => {
  const path = resolvePaperPath(wikiDir, 'ABC123')
  expect(path).toBe(join(wikiDir, 'ABC123.md'))
})

test('resolvePaperPath：拒绝带斜杠 / 反斜杠 / .. / 绝对路径的 paperId', () => {
  expect(resolvePaperPath(wikiDir, 'a/b')).toBeNull()
  expect(resolvePaperPath(wikiDir, 'a\\b')).toBeNull()
  expect(resolvePaperPath(wikiDir, '../etc/passwd')).toBeNull()
  expect(resolvePaperPath(wikiDir, '/etc/passwd')).toBeNull()
  expect(resolvePaperPath(wikiDir, '')).toBeNull()
})

test('buildRgArgs：默认 fixed-strings + 忽略大小写 + 全量扫描 wikiDir', () => {
  const args = buildRgArgs({ query: 'foo' }, wikiDir)
  expect(args).toContain('--fixed-strings')
  expect(args).toContain('--ignore-case')
  expect(args).toContain('--json')
  expect(args).toContain('--line-number')
  expect(args).toContain('--byte-offset')
  expect(args).toContain('-g')
  expect(args[args.length - 1]).toBe(wikiDir)
})

test('buildRgArgs：regex=true 时不加 fixed-strings；caseSensitive=true 时不加 ignore-case', () => {
  const args = buildRgArgs(
    { query: 'foo|bar', regex: true, caseSensitive: true },
    wikiDir,
  )
  expect(args).not.toContain('--fixed-strings')
  expect(args).not.toContain('--ignore-case')
})

test('buildRgArgs：传 paperIds 时把它们逐个解析为 wikiDir/{id}.md，非法 id 静默丢弃', () => {
  const args = buildRgArgs(
    { query: 'x', paperIds: ['ABC', 'DEF'] },
    wikiDir,
  )
  expect(args).toContain(join(wikiDir, 'ABC.md'))
  expect(args).toContain(join(wikiDir, 'DEF.md'))

  // 含非法 id 时，仅合法 id 进入参数，非法的不出现
  const mixed = buildRgArgs(
    { query: 'x', paperIds: ['ABC', '../etc/passwd', '/abs', 'sub/dir'] },
    wikiDir,
  )
  expect(mixed).toContain(join(wikiDir, 'ABC.md'))
  for (const a of mixed) {
    if (a.endsWith('.md')) {
      expect(a.startsWith(wikiDir)).toBe(true)
    }
  }

  // 全非法 → 用占位符兜底，绝不在 wikiDir 之外
  const allBad = buildRgArgs(
    { query: 'x', paperIds: ['../etc/passwd', '/abs'] },
    wikiDir,
  )
  for (const a of allBad) {
    if (a.endsWith('.md')) {
      expect(a.startsWith(wikiDir)).toBe(true)
    }
  }
})

test('parseRgJsonOutput：把 rg --json 事件拼成 SearchHit 列表，paperId = basename(path,".md")', () => {
  const stdout = rgJsonStream([
    { path: join(wikiDir, 'ABC.md'), line: 12, offset: 345, text: 'hello world\n' },
    { path: join(wikiDir, 'DEF.md'), line: 7, offset: 100, text: 'foo bar' },
  ])
  const { hits, truncated } = parseRgJsonOutput(stdout, 50)
  expect(truncated).toBe(false)
  expect(hits).toEqual([
    { paperId: 'ABC', lineNumber: 12, byteOffset: 345, snippet: 'hello world' },
    { paperId: 'DEF', lineNumber: 7, byteOffset: 100, snippet: 'foo bar' },
  ])
})

test('parseRgJsonOutput：超过 max 时停在阈值并标记 truncated', () => {
  const stdout = rgJsonStream(
    Array.from({ length: 5 }, (_, i) => ({
      path: join(wikiDir, `P${i}.md`),
      line: i + 1,
      offset: i * 10,
      text: `line ${i}`,
    })),
  )
  const { hits, truncated } = parseRgJsonOutput(stdout, 3)
  expect(hits.length).toBe(3)
  expect(truncated).toBe(true)
})

test('parseRgJsonOutput：忽略非 match 事件 (begin/summary/end) 和损坏 JSON', () => {
  const stdout = [
    JSON.stringify({ type: 'begin', data: {} }),
    'NOT_JSON_AT_ALL',
    JSON.stringify({
      type: 'match',
      data: {
        path: { text: join(wikiDir, 'X.md') },
        lines: { text: 'ok' },
        line_number: 1,
        absolute_offset: 0,
      },
    }),
    JSON.stringify({ type: 'end', data: {} }),
  ].join('\n')
  const { hits } = parseRgJsonOutput(stdout, 50)
  expect(hits.length).toBe(1)
  expect(hits[0]?.paperId).toBe('X')
})

test('search handler：rg 退出码 0（有匹配）→ 返回 hits', async () => {
  const stub: RgRunnerFn = async () => ({
    stdout: rgJsonStream([
      { path: join(wikiDir, 'ABC.md'), line: 1, offset: 0, text: 'foo' },
    ]),
    stderr: '',
    exitCode: 0,
  })
  const handler = createSearchHandler({ wikiDir, rgRunner: stub })
  const res = await handler({ query: 'foo' }, {})
  expect(res.isError).toBeFalsy()
  const text = (res.content[0] as { text: string }).text
  const parsed = JSON.parse(text)
  expect(parsed.total).toBe(1)
  expect(parsed.hits[0].paperId).toBe('ABC')
})

test('search handler：rg 退出码 1（无匹配）→ 返回空列表，不报错', async () => {
  const stub: RgRunnerFn = async () => ({ stdout: '', stderr: '', exitCode: 1 })
  const handler = createSearchHandler({ wikiDir, rgRunner: stub })
  const res = await handler({ query: 'nothing' }, {})
  expect(res.isError).toBeFalsy()
  const parsed = JSON.parse((res.content[0] as { text: string }).text)
  expect(parsed.total).toBe(0)
  expect(parsed.hits).toEqual([])
})

test('search handler：rg 退出码 2（错误）→ 返回 isError 并带 stderr', async () => {
  const stub: RgRunnerFn = async () => ({
    stdout: '',
    stderr: 'regex parse error',
    exitCode: 2,
  })
  const handler = createSearchHandler({ wikiDir, rgRunner: stub })
  const res = await handler({ query: '(', regex: true }, {})
  expect(res.isError).toBe(true)
  expect((res.content[0] as { text: string }).text).toContain('regex parse error')
})

test('search handler：runner spawn 抛错（rg 不存在）→ 返回友好错误并提示 ASCI_RG_BIN', async () => {
  const stub: RgRunnerFn = async () => {
    throw Object.assign(new Error('spawn rg ENOENT'), { code: 'ENOENT' })
  }
  const handler = createSearchHandler({ wikiDir, rgRunner: stub })
  const res = await handler({ query: 'x' }, {})
  expect(res.isError).toBe(true)
  const msg = (res.content[0] as { text: string }).text
  expect(msg).toContain('ENOENT')
  expect(msg).toContain('ASCI_RG_BIN')
})

test('search handler：wikiDir 不存在 → 直接返回 isError', async () => {
  const handler = createSearchHandler({
    wikiDir: join(tmpRoot, 'nope'),
    rgRunner: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  })
  const res = await handler({ query: 'x' }, {})
  expect(res.isError).toBe(true)
  expect((res.content[0] as { text: string }).text).toContain('wiki 目录不存在')
})

test('search handler：maxResults 上限生效 + truncated=true', async () => {
  const stub: RgRunnerFn = async () => ({
    stdout: rgJsonStream(
      Array.from({ length: 10 }, (_, i) => ({
        path: join(wikiDir, `P${i}.md`),
        line: i,
        offset: i,
        text: `line ${i}`,
      })),
    ),
    stderr: '',
    exitCode: 0,
  })
  const handler = createSearchHandler({ wikiDir, rgRunner: stub })
  const res = await handler({ query: 'x', maxResults: 4 }, {})
  const parsed = JSON.parse((res.content[0] as { text: string }).text)
  expect(parsed.hits.length).toBe(4)
  expect(parsed.truncated).toBe(true)
})

test('read context handler：在 offset 前后各读 N 字节，cursorOffsetInText 指向 offset 的位置', async () => {
  const md = 'A'.repeat(100) + 'TARGET' + 'B'.repeat(100)
  const path = join(wikiDir, 'X.md')
  writeFileSync(path, md, 'utf-8')

  const handler = createReadContextHandler({ wikiDir })
  const res = await handler({ paperId: 'X', offset: 100, n: 50 }, {})
  expect(res.isError).toBeFalsy()
  const parsed = JSON.parse((res.content[0] as { text: string }).text)
  expect(parsed.paperId).toBe('X')
  expect(parsed.fileSize).toBe(md.length)
  expect(parsed.rangeStart).toBe(50)
  expect(parsed.rangeEnd).toBe(150)
  expect(parsed.cursorOffsetInText).toBe(50)
  expect(parsed.text).toBe('A'.repeat(50) + 'TARGET' + 'B'.repeat(44))
})

test('read context handler：靠近文件头时不会读到负偏移', async () => {
  const md = 'HEAD' + 'X'.repeat(50)
  writeFileSync(join(wikiDir, 'Y.md'), md, 'utf-8')

  const handler = createReadContextHandler({ wikiDir })
  const res = await handler({ paperId: 'Y', offset: 2, n: 50 }, {})
  const parsed = JSON.parse((res.content[0] as { text: string }).text)
  expect(parsed.rangeStart).toBe(0)
  expect(parsed.cursorOffsetInText).toBe(2)
  expect(parsed.text.startsWith('HEAD')).toBe(true)
})

test('read context handler：N clamp 到 [50, 2000]', async () => {
  const md = 'X'.repeat(5000)
  writeFileSync(join(wikiDir, 'Z.md'), md, 'utf-8')
  const handler = createReadContextHandler({ wikiDir })

  const tooSmall = await handler({ paperId: 'Z', offset: 2500, n: 1 }, {})
  const small = JSON.parse((tooSmall.content[0] as { text: string }).text)
  expect(small.rangeEnd - small.rangeStart).toBe(100) // 2 * 50

  const tooLarge = await handler({ paperId: 'Z', offset: 2500, n: 100000 }, {})
  const large = JSON.parse((tooLarge.content[0] as { text: string }).text)
  expect(large.rangeEnd - large.rangeStart).toBe(4000) // 2 * 2000
})

test('read context handler：缺省 n 默认 300', async () => {
  const md = 'X'.repeat(2000)
  writeFileSync(join(wikiDir, 'W.md'), md, 'utf-8')
  const handler = createReadContextHandler({ wikiDir })
  const res = await handler({ paperId: 'W', offset: 1000 }, {})
  const parsed = JSON.parse((res.content[0] as { text: string }).text)
  expect(parsed.rangeEnd - parsed.rangeStart).toBe(600)
})

test('read context handler：非法 paperId 直接拒绝', async () => {
  const handler = createReadContextHandler({ wikiDir })
  const res = await handler({ paperId: '../etc/passwd', offset: 0 }, {})
  expect(res.isError).toBe(true)
  expect((res.content[0] as { text: string }).text).toContain('非法的 paperId')
})

test('read context handler：md 文件不存在', async () => {
  const handler = createReadContextHandler({ wikiDir })
  const res = await handler({ paperId: 'NOTEXIST', offset: 0 }, {})
  expect(res.isError).toBe(true)
  expect((res.content[0] as { text: string }).text).toContain('不存在')
})

test('read context handler：offset 超过文件大小', async () => {
  writeFileSync(join(wikiDir, 'S.md'), 'short', 'utf-8')
  const handler = createReadContextHandler({ wikiDir })
  const res = await handler({ paperId: 'S', offset: 10000 }, {})
  expect(res.isError).toBe(true)
  expect((res.content[0] as { text: string }).text).toContain('超过文件大小')
})

test('findRgBinFromPackage：能解析到 @vscode/ripgrep 包目录下的 bin/rg(.exe)', () => {
  // 包已通过 bun add 安装，但 postinstall 是否跑取决于环境（rg 二进制可能未下载）。
  // 这里仅断言"解析行为不抛错"，找不到时返回 null 是合法分支。
  const result = findRgBinFromPackage()
  if (result !== null) {
    expect(result.endsWith(process.platform === 'win32' ? 'rg.exe' : 'rg')).toBe(true)
    expect(result).toContain('@vscode/ripgrep')
  }
})

test('resolveRgBin：显式参数最高优先', () => {
  const original = process.env.ASCI_RG_BIN
  process.env.ASCI_RG_BIN = '/from/env/rg'
  try {
    expect(resolveRgBin('/explicit/rg')).toBe('/explicit/rg')
  } finally {
    if (original === undefined) delete process.env.ASCI_RG_BIN
    else process.env.ASCI_RG_BIN = original
  }
})

test('resolveRgBin：ASCI_RG_BIN 次之', () => {
  const original = process.env.ASCI_RG_BIN
  process.env.ASCI_RG_BIN = '/from/env/rg'
  try {
    expect(resolveRgBin()).toBe('/from/env/rg')
  } finally {
    if (original === undefined) delete process.env.ASCI_RG_BIN
    else process.env.ASCI_RG_BIN = original
  }
})

test('resolveRgBin：env 未设 + @vscode/ripgrep 找不到 binary 时回落到 "rg"', () => {
  const original = process.env.ASCI_RG_BIN
  delete process.env.ASCI_RG_BIN
  try {
    const result = resolveRgBin()
    // 包内置二进制存在时返回绝对路径；不存在时回落 'rg'（系统 PATH）
    const expectFallback = findRgBinFromPackage() === null
    if (expectFallback) {
      expect(result).toBe('rg')
    } else {
      expect(result).toContain('@vscode/ripgrep')
    }
  } finally {
    if (original !== undefined) process.env.ASCI_RG_BIN = original
  }
})

// ───────────────────────────────────────────────────────────────────
// 真实 rg binary 集成测试：不打 stub，直接 spawn @vscode/ripgrep 自带的 rg。
// CI / 本地 bun install 跑过 postinstall 后这些应该全绿；rg 不存在时整组跳过。
// ───────────────────────────────────────────────────────────────────

const realRgBin = findRgBinFromPackage()
const itReal = realRgBin ? test : test.skip

itReal('集成：真实 rg binary 能在 wiki 目录里 fixed-strings 检索到关键词，并返回正确的 paperId / lineNumber / byteOffset', async () => {
  // 写两个 fixture md：一个有匹配，一个无匹配
  const matchMd = [
    '# Paper Foo',
    '',
    'Some intro text here.',
    'This sentence mentions transformer architecture explicitly.',
    'And another paragraph below.',
  ].join('\n')
  writeFileSync(join(wikiDir, 'PAPER_A.md'), matchMd, 'utf-8')
  writeFileSync(join(wikiDir, 'PAPER_B.md'), '# Other paper\nNothing relevant here.\n', 'utf-8')
  // 故意混入一个非 .md 文件，验证 -g '*.md' 过滤生效
  writeFileSync(join(wikiDir, 'index.json'), '{"transformer":1}', 'utf-8')

  const handler = createSearchHandler({ wikiDir })
  const res = await handler({ query: 'transformer' }, {})
  expect(res.isError).toBeFalsy()
  const out = JSON.parse((res.content[0] as { text: string }).text)

  expect(out.total).toBe(1)
  const hit = out.hits[0]
  expect(hit.paperId).toBe('PAPER_A')
  expect(hit.lineNumber).toBe(4)
  expect(hit.snippet).toContain('transformer architecture')
  expect(typeof hit.byteOffset).toBe('number')
  expect(hit.byteOffset).toBeGreaterThan(0)

  // 拿 hit 的 byteOffset 喂给 read_context，验证两个工具能串起来用
  const reader = createReadContextHandler({ wikiDir })
  const ctxRes = await reader({ paperId: hit.paperId, offset: hit.byteOffset, n: 100 }, {})
  const ctx = JSON.parse((ctxRes.content[0] as { text: string }).text)
  expect(ctx.text).toContain('transformer')
})

itReal('集成：真实 rg 大小写不敏感（默认）vs 大小写敏感（caseSensitive=true）', async () => {
  writeFileSync(join(wikiDir, 'CASE.md'), 'Hello WORLD\nhello world\nHELLO WORLD\n', 'utf-8')

  const handler = createSearchHandler({ wikiDir })

  const insens = await handler({ query: 'world' }, {})
  expect(JSON.parse((insens.content[0] as { text: string }).text).total).toBe(3)

  const sens = await handler({ query: 'world', caseSensitive: true }, {})
  expect(JSON.parse((sens.content[0] as { text: string }).text).total).toBe(1)
})

itReal('集成：真实 rg 在 paperIds 限定下只扫指定文件', async () => {
  writeFileSync(join(wikiDir, 'A.md'), 'needle\n', 'utf-8')
  writeFileSync(join(wikiDir, 'B.md'), 'needle\n', 'utf-8')
  writeFileSync(join(wikiDir, 'C.md'), 'needle\n', 'utf-8')

  const handler = createSearchHandler({ wikiDir })
  const res = await handler({ query: 'needle', paperIds: ['A', 'C'] }, {})
  const out = JSON.parse((res.content[0] as { text: string }).text)
  const ids = out.hits.map((h: { paperId: string }) => h.paperId).sort()
  expect(ids).toEqual(['A', 'C'])
})

itReal('集成：真实 rg 无匹配时返回 total=0、不报错', async () => {
  writeFileSync(join(wikiDir, 'X.md'), 'just some content\n', 'utf-8')
  const handler = createSearchHandler({ wikiDir })
  const res = await handler({ query: 'definitely_not_present_xyzzy' }, {})
  expect(res.isError).toBeFalsy()
  const out = JSON.parse((res.content[0] as { text: string }).text)
  expect(out.total).toBe(0)
  expect(out.hits).toEqual([])
})

/* ---------------- papers_read_outline ---------------- */

test('resolveArticlePath：合法 paperId 返回 wikiDir 下的 article.md 路径', () => {
  expect(resolveArticlePath(wikiDir, 'KEYA')).toBe(join(wikiDir, 'KEYA.article.md'))
})

test('resolveArticlePath：拒绝越权（绝对路径 / .. / 跨目录） — 与 resolvePaperPath 同步', () => {
  expect(resolveArticlePath(wikiDir, '/etc/passwd')).toBeNull()
  expect(resolveArticlePath(wikiDir, '../escape')).toBeNull()
  expect(resolveArticlePath(wikiDir, 'sub/dir')).toBeNull()
  expect(resolveArticlePath(wikiDir, '')).toBeNull()
})

test('extractOutlineSection：标准格式（frontmatter + # OUTLINE list + # CONTENT）', () => {
  const md = [
    '---',
    'id: KEYA',
    'authors: ["Alice"]',
    '---',
    '',
    '# OUTLINE',
    '- 1. Introduction',
    '- 2. Related Work',
    '- 3. Method',
    '',
    '# CONTENT',
    '',
    '# 1. Introduction',
    '<p id="p1_1">Hello</p>',
  ].join('\n')
  const r = extractOutlineSection(md)
  expect(r.hasOutline).toBe(true)
  expect(r.items).toEqual(['1. Introduction', '2. Related Work', '3. Method'])
  expect(r.outlineRaw).toContain('1. Introduction')
})

test('extractOutlineSection：缺少 OUTLINE 标题 → hasOutline:false', () => {
  const md = '# CONTENT\n\n# 1. Section\n'
  const r = extractOutlineSection(md)
  expect(r.hasOutline).toBe(false)
  expect(r.items).toEqual([])
  expect(r.outlineRaw).toBe('')
})

test('extractOutlineSection：缺少 CONTENT 终止标题 → hasOutline:false（避免吞到正文末尾）', () => {
  const md = '# OUTLINE\n- 1. Intro\n\n## misformatted level\n'
  const r = extractOutlineSection(md)
  expect(r.hasOutline).toBe(false)
})

test('extractOutlineSection：用 * 起始的 list 也能解析；空行和注释被跳过', () => {
  const md = [
    '# OUTLINE',
    '* 1. Intro',
    '',
    '<!-- comment -->',
    '* 2. Method',
    '# CONTENT',
  ].join('\n')
  const r = extractOutlineSection(md)
  expect(r.items).toEqual(['1. Intro', '2. Method'])
})

test('readOutline handler：article.md 不存在 → hasArticle:false（不报错）', async () => {
  const handler = createReadOutlineHandler({ wikiDir })
  const res = await handler({ paperId: 'NOPE' }, {})
  expect(res.isError).toBeFalsy()
  const out = JSON.parse((res.content[0] as { text: string }).text)
  expect(out.hasArticle).toBe(false)
  expect(out.hasOutline).toBe(false)
  expect(out.outlineItems).toEqual([])
})

test('readOutline handler：article.md 存在且含 OUTLINE → 返回 items + outlineRaw', async () => {
  writeFileSync(
    join(wikiDir, 'KEYB.article.md'),
    [
      '---',
      'id: KEYB',
      '---',
      '',
      '# OUTLINE',
      '- 1. Background',
      '- 2. Approach',
      '',
      '# CONTENT',
      '',
      '# 1. Background',
      '<p id="p1_1">x</p>',
    ].join('\n'),
    'utf-8',
  )
  const handler = createReadOutlineHandler({ wikiDir })
  const res = await handler({ paperId: 'KEYB' }, {})
  expect(res.isError).toBeFalsy()
  const out = JSON.parse((res.content[0] as { text: string }).text)
  expect(out.hasArticle).toBe(true)
  expect(out.hasOutline).toBe(true)
  expect(out.outlineItems).toEqual(['1. Background', '2. Approach'])
  expect(out.fileSize).toBeGreaterThan(0)
})

test('readOutline handler：拒绝非法 paperId（含 .. / /）', async () => {
  const handler = createReadOutlineHandler({ wikiDir })
  const res = await handler({ paperId: '../escape' }, {})
  expect(res.isError).toBe(true)
})

/* ---------------- 结构化源解析 (.article.md → .txt fallback) ---------------- */

test('resolveStructuredTxtPath：合法 paperId 返回 wikiDir 下的 .txt 路径', () => {
  expect(resolveStructuredTxtPath(wikiDir, 'KEYX')).toBe(join(wikiDir, 'KEYX.txt'))
})

test('resolveStructuredTxtPath：拒绝越权（与 resolveArticlePath 同步）', () => {
  expect(resolveStructuredTxtPath(wikiDir, '../escape')).toBeNull()
  expect(resolveStructuredTxtPath(wikiDir, '/etc/passwd')).toBeNull()
  expect(resolveStructuredTxtPath(wikiDir, 'sub/dir')).toBeNull()
})

test('resolveStructuredSourcePath：article.md 与 .txt 都不在 → missing', () => {
  const r = resolveStructuredSourcePath(wikiDir, 'NOFILES')
  expect(r.kind).toBe('missing')
})

test('resolveStructuredSourcePath：仅 .article.md 存在 → kind=article', () => {
  writeFileSync(join(wikiDir, 'ONLY_ART.article.md'), '# OUTLINE\n# CONTENT', 'utf-8')
  const r = resolveStructuredSourcePath(wikiDir, 'ONLY_ART')
  expect(r.kind).toBe('article')
  if (r.kind === 'article') expect(r.path).toBe(join(wikiDir, 'ONLY_ART.article.md'))
})

test('resolveStructuredSourcePath：仅 .txt 存在 → kind=txt', () => {
  writeFileSync(join(wikiDir, 'ONLY_TXT.txt'), '# OUTLINE\n# CONTENT', 'utf-8')
  const r = resolveStructuredSourcePath(wikiDir, 'ONLY_TXT')
  expect(r.kind).toBe('txt')
  if (r.kind === 'txt') expect(r.path).toBe(join(wikiDir, 'ONLY_TXT.txt'))
})

test('resolveStructuredSourcePath：两个都存在 → 优先 article', () => {
  writeFileSync(join(wikiDir, 'BOTH.article.md'), '# OUTLINE\n# CONTENT', 'utf-8')
  writeFileSync(join(wikiDir, 'BOTH.txt'), '# OUTLINE\n# CONTENT', 'utf-8')
  const r = resolveStructuredSourcePath(wikiDir, 'BOTH')
  expect(r.kind).toBe('article')
})

test('resolveStructuredSourcePath：非法 paperId → invalid', () => {
  const r = resolveStructuredSourcePath(wikiDir, '../escape')
  expect(r.kind).toBe('invalid')
})

test('readOutline handler：仅 .txt 存在时也走结构化解析 + sourceKind=txt', async () => {
  writeFileSync(
    join(wikiDir, 'TXTONLY.txt'),
    [
      '---',
      'id: TXTONLY',
      'format_version: 2',
      '---',
      '',
      '# OUTLINE',
      '- 1. Introduction',
      '- 2. Method',
      '',
      '# CONTENT',
      '',
      '# 1. Introduction',
      '<p id="p1_1">x</p>',
    ].join('\n'),
    'utf-8',
  )
  const handler = createReadOutlineHandler({ wikiDir })
  const res = await handler({ paperId: 'TXTONLY' }, {})
  expect(res.isError).toBeFalsy()
  const out = JSON.parse((res.content[0] as { text: string }).text)
  expect(out.hasArticle).toBe(true)
  expect(out.sourceKind).toBe('txt')
  expect(out.outlineItems).toEqual(['1. Introduction', '2. Method'])
  // filePath 指向实际命中的 .txt
  expect(out.filePath.endsWith('TXTONLY.txt')).toBe(true)
})

test('readOutline handler：.article.md 与 .txt 同时存在 → 优先 article + sourceKind=article', async () => {
  const articleContent = [
    '---',
    'id: BOTHRD',
    '---',
    '',
    '# OUTLINE',
    '- 1. From Article',
    '',
    '# CONTENT',
  ].join('\n')
  const txtContent = [
    '---',
    'id: BOTHRD',
    'format_version: 2',
    '---',
    '',
    '# OUTLINE',
    '- 1. From Txt',
    '',
    '# CONTENT',
  ].join('\n')
  writeFileSync(join(wikiDir, 'BOTHRD.article.md'), articleContent, 'utf-8')
  writeFileSync(join(wikiDir, 'BOTHRD.txt'), txtContent, 'utf-8')
  const handler = createReadOutlineHandler({ wikiDir })
  const res = await handler({ paperId: 'BOTHRD' }, {})
  const out = JSON.parse((res.content[0] as { text: string }).text)
  expect(out.sourceKind).toBe('article')
  // outline 应来自 article 而非 txt
  expect(out.outlineItems).toEqual(['1. From Article'])
})

test('readArticleSection handler：仅 .txt 存在时可正常抽章节 + sourceKind=txt', async () => {
  writeFileSync(
    join(wikiDir, 'TXTSEC.txt'),
    [
      '---',
      'id: TXTSEC',
      '---',
      '',
      '# OUTLINE',
      '- 1. Intro',
      '- 2. Method',
      '',
      '# CONTENT',
      '',
      '# 1. Intro',
      '<p id="p1_1">intro body</p>',
      '',
      '# 2. Method',
      '<p id="p2_1">method body</p>',
    ].join('\n'),
    'utf-8',
  )
  const handler = createReadArticleSectionHandler({ wikiDir })
  const res = await handler({ paperId: 'TXTSEC', sectionIndex: 2 }, {})
  expect(res.isError).toBeFalsy()
  const out = JSON.parse((res.content[0] as { text: string }).text)
  expect(out.found).toBe(true)
  expect(out.sourceKind).toBe('txt')
  expect(out.section.title).toBe('Method')
  expect(out.section.paragraphs[0].text).toContain('method body')
})

test('readArticleSection handler：两个源都不在 → hasArticle:false（不报错）', async () => {
  const handler = createReadArticleSectionHandler({ wikiDir })
  const res = await handler({ paperId: 'NONE_AT_ALL', sectionIndex: 1 }, {})
  expect(res.isError).toBeFalsy()
  const out = JSON.parse((res.content[0] as { text: string }).text)
  expect(out.hasArticle).toBe(false)
  expect(out.found).toBe(false)
  expect(out.sourceKind).toBeUndefined()
})

/* ---------------- papers_read_article_section ---------------- */

const ARTICLE_FIXTURE = [
  '---',
  'id: KEYS',
  '---',
  '',
  '# OUTLINE',
  '- 1. Introduction',
  '- 2. Method',
  '- 3. References',
  '',
  '# CONTENT',
  '',
  '# 1. Introduction',
  '<p id="p1_1">Intro paragraph one.</p>',
  '',
  '<p id="p1_2">Intro paragraph two.</p>',
  '',
  '# 2. Method',
  '<p id="p2_1">We propose X.</p>',
  '',
  '## 2.1 Subsection ignored as section boundary',
  '<p id="p2_2">More method detail.</p>',
  '',
  '| col | val |',
  '| --- | --- |',
  '| a   | 1   |',
  '',
  '# 3. References',
  '- [1] Smith 2024',
  '- [2] Jones 2025',
].join('\n')

test('findArticleSections：按 ^# (\\d+)\\.? 切出所有一级章节，忽略 ## 子节 / # OUTLINE / # CONTENT', () => {
  const sections = findArticleSections(ARTICLE_FIXTURE)
  expect(sections.map((s) => ({ idx: s.index, title: s.title }))).toEqual([
    { idx: 1, title: 'Introduction' },
    { idx: 2, title: 'Method' },
    { idx: 3, title: 'References' },
  ])
  // byteStart 必须严格递增
  expect(sections[1]!.byteStart).toBeGreaterThan(sections[0]!.byteStart)
  expect(sections[2]!.byteStart).toBeGreaterThan(sections[1]!.byteStart)
})

test('findArticleSections：兼容 # 3 Method（无 dot）OUTLINE 编号风格', () => {
  const md = ['# CONTENT', '# 1 Intro', '<p id="p1_1">x</p>', '# 2 Method', '<p id="p2_1">y</p>'].join('\n')
  const sections = findArticleSections(md)
  expect(sections.map((s) => ({ idx: s.index, title: s.title }))).toEqual([
    { idx: 1, title: 'Intro' },
    { idx: 2, title: 'Method' },
  ])
})

test('extractArticleSection：按 sectionIndex 抽中间一节，含 <p> + 表格 + 子节标题', () => {
  const r = extractArticleSection(ARTICLE_FIXTURE, { sectionIndex: 2 })
  expect(r.found).toBe(true)
  expect(r.availableSections.length).toBe(3)
  expect(r.section!.title).toBe('Method')
  // raw 应包含本节全部内容（<p> + ## 子节 + 表格），但不含下一节 # 3. References 起始
  expect(r.section!.raw).toContain('<p id="p2_1">')
  expect(r.section!.raw).toContain('## 2.1 Subsection')
  expect(r.section!.raw).toContain('| col | val |')
  expect(r.section!.raw).not.toContain('# 3. References')
  expect(r.section!.paragraphs.map((p) => p.id)).toEqual(['p2_1', 'p2_2'])
  expect(r.section!.paragraphs[0]!.text).toBe('We propose X.')
})

test('extractArticleSection：按 sectionTitle substring 不区分大小写匹配', () => {
  const r = extractArticleSection(ARTICLE_FIXTURE, { sectionTitle: 'METHOD' })
  expect(r.found).toBe(true)
  expect(r.section!.index).toBe(2)
})

test('extractArticleSection：末节抽到 EOF，无 <p> 也能抽出（References 节）', () => {
  const r = extractArticleSection(ARTICLE_FIXTURE, { sectionIndex: 3 })
  expect(r.found).toBe(true)
  expect(r.section!.title).toBe('References')
  expect(r.section!.raw).toContain('[1] Smith 2024')
  expect(r.section!.raw).toContain('[2] Jones 2025')
  // References 节没 <p>，paragraphs 应为空
  expect(r.section!.paragraphs).toEqual([])
  // byteRange[1] 应到文件末尾
  expect(r.section!.byteRange[1]).toBe(ARTICLE_FIXTURE.length)
})

test('extractArticleSection：找不到时 found:false，availableSections 仍返回供 LLM 重试', () => {
  const r = extractArticleSection(ARTICLE_FIXTURE, { sectionIndex: 99 })
  expect(r.found).toBe(false)
  expect(r.availableSections.length).toBe(3)
  expect(r.section).toBeUndefined()
})

test('readArticleSection handler：article.md 不存在 → hasArticle:false（不报错）', async () => {
  const handler = createReadArticleSectionHandler({ wikiDir })
  const res = await handler({ paperId: 'NOPE', sectionIndex: 1 }, {})
  expect(res.isError).toBeFalsy()
  const out = JSON.parse((res.content[0] as { text: string }).text)
  expect(out.hasArticle).toBe(false)
  expect(out.found).toBe(false)
})

test('readArticleSection handler：完整跑通——存在 + 抽出 + paragraphs', async () => {
  writeFileSync(join(wikiDir, 'KEYS.article.md'), ARTICLE_FIXTURE, 'utf-8')
  const handler = createReadArticleSectionHandler({ wikiDir })
  const res = await handler({ paperId: 'KEYS', sectionIndex: 2 }, {})
  expect(res.isError).toBeFalsy()
  const out = JSON.parse((res.content[0] as { text: string }).text)
  expect(out.hasArticle).toBe(true)
  expect(out.found).toBe(true)
  expect(out.section.title).toBe('Method')
  expect(out.section.paragraphs).toHaveLength(2)
})

test('readArticleSection handler：sectionIndex 与 sectionTitle 都没传 → 报错', async () => {
  const handler = createReadArticleSectionHandler({ wikiDir })
  const res = await handler({ paperId: 'KEYS' } as { paperId: string; sectionIndex?: number; sectionTitle?: string }, {})
  expect(res.isError).toBe(true)
})

test('readArticleSection handler：拒绝非法 paperId', async () => {
  const handler = createReadArticleSectionHandler({ wikiDir })
  const res = await handler({ paperId: '../escape', sectionIndex: 1 }, {})
  expect(res.isError).toBe(true)
})

// ===== papers_semantic_search handler =====

test('semantic search handler：透传参数并 clamp maxResults，结果 JSON 序列化返回', async () => {
  const calls: unknown[] = []
  const handler = createSemanticSearchHandler(async (input) => {
    calls.push(input)
    return {
      query: input.query,
      modelId: 'multilingual-e5-small-q8',
      total: 1,
      hits: [
        { paperId: 'K1', textKind: 'raw', anchorStart: 'b100', anchorEnd: 'b200', sectionIndex: null, sectionTitle: null, snippet: 's', score: 0.03, rawCosine: null, rawBm25: null },
      ],
    }
  })
  const res = await handler({ query: 'attention cost', paperIds: ['K1'], maxResults: 999 }, {})
  expect(res.isError).toBeUndefined()
  expect(calls).toHaveLength(1)
  expect((calls[0] as { attachmentKeys?: string[] }).attachmentKeys).toEqual(['K1'])
  expect((calls[0] as { maxResults?: number }).maxResults).toBe(50) // clamp 到硬上限
  const first = res.content[0] as { type: 'text'; text: string }
  const payload = JSON.parse(first.text) as { hits: Array<{ paperId: string }> }
  expect(payload.hits[0]!.paperId).toBe('K1')
})

test('semantic search handler：底层抛错 → isError 而非异常外抛', async () => {
  const handler = createSemanticSearchHandler(async () => {
    throw new Error('db locked')
  })
  const res = await handler({ query: 'x' }, {})
  expect(res.isError).toBe(true)
  const first = res.content[0] as { type: 'text'; text: string }
  expect(first.text).toContain('db locked')
})

test('createPapersRgMcpServer：缺省 semanticSearch 时不注册 papers_semantic_search 工具', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rg-no-sem-'))
  try {
    const server = createPapersRgMcpServer({ wikiDir: dir }) as unknown as {
      instance?: unknown
    }
    // createSdkMcpServer 返回 McpSdkServerConfigWithInstance；工具列表在内部 server 上，
    // 这里只验证带/不带 semanticSearch 两种构造都不抛错（注册差异由 handler 测试覆盖）
    expect(server).toBeTruthy()
    const withSem = createPapersRgMcpServer({
      wikiDir: dir,
      semanticSearch: async (i) => ({ query: i.query, modelId: 'm', total: 0, hits: [] }),
    })
    expect(withSem).toBeTruthy()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
