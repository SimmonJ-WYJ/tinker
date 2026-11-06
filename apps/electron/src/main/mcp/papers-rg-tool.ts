/**
 * papers_rg — 基于 ripgrep 的论文 Markdown 检索 + 上下文回读 MCP 工具
 *
 * 提供两个工具（in-process SDK MCP，与 asci-python-tool.ts 同壳）：
 *   1. papers_search_keywords：在 wiki 目录下的所有 .md 中检索关键词（默认 fixed-strings + 忽略大小写），
 *      返回 {paperId, lineNumber, byteOffset, snippet} 列表，不带文件全文。
 *   2. papers_read_context：基于 fs.openSync + fs.readSync 在指定 byte offset 前后各读 N 字节，
 *      用 UTF-8 解码返回文本片段。N 默认 300，clamp 到 [50, 2000]。
 *
 * 设计原则：
 *   - 所有"运行时副作用"（spawn rg / 读文件）都通过依赖注入的 runner / fs API 走，
 *     测试可以注入 stub 完全脱离系统 rg。
 *   - paperId 约定 = wiki 目录下 md 文件的 basename（去掉 .md 后缀），
 *     与 zotero-pdf-parser 写出的 {attachmentKey}.md 命名一致。
 */

import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ZoteroEmbeddingTextKind, ZoteroSemanticSearchResult } from '@asci/shared'

/** rg 子进程 runner 抽象：生产用 spawn；测试可注入 stub */
export type RgRunnerFn = (args: string[]) => Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
}>

/** read_paper_context 用到的 fs 抽象（便于测试注入） */
export interface FsLike {
  existsSync: (path: string) => boolean
  statSync: (path: string) => { size: number }
  openSync: (path: string, flags: string) => number
  closeSync: (fd: number) => void
  readSync: (fd: number, buf: Buffer, off: number, len: number, pos: number) => number
}

const realFs: FsLike = { existsSync, statSync, openSync, closeSync, readSync }

/** rg 输出最大累积字节，超出截断防止 OOM */
const MAX_RG_OUTPUT_BYTES = 4 * 1024 * 1024
/** 单条 snippet 最大字节，防止某一行特别长 */
const MAX_SNIPPET_BYTES = 240
/** query 长度上限，防止滥用 */
const MAX_QUERY_LEN = 256
/** maxResults 硬上限 */
const MAX_RESULTS_HARD_CAP = 500
/** 单次 read_paper_context 的 N 上下界 */
const N_MIN = 50
const N_MAX = 2000
const N_DEFAULT = 300
/**
 * read_outline 头部读取上限：article.md 的 frontmatter + # OUTLINE 列表 + # CONTENT 头
 * 在常规论文里 < 5KB；64KB 头读足够覆盖几十章带超长标题的极端 case，避免读全文 OOM。
 */
const OUTLINE_HEAD_READ_BYTES = 64 * 1024
/**
 * read_article_section 全量读 article.md 的硬上限。
 * 论文通常 100-500KB，长综述 1-3MB；10MB 上限防止恶意大文件 OOM。
 */
const ARTICLE_FULL_READ_LIMIT_BYTES = 10 * 1024 * 1024

/**
 * 解析 @vscode/ripgrep 内置的 rg 二进制路径。
 *
 * 该包用 `__dirname` 在运行时计算 rgPath。因此本文件必须以 `--external:@vscode/ripgrep`
 * 方式打包，否则 esbuild 会把 require 捏死，rgPath 会指向 main.cjs 旁边的不存在路径。
 *
 * 解析顺序：
 *   1. createRequire(__filename).resolve('@vscode/ripgrep') 拿到 lib/index.js
 *   2. 取其上级 lib/ 的父目录 + bin/rg(.exe) 即为二进制路径
 *   3. existsSync 校验后返回；找不到（postinstall 没跑）返回 null
 *
 * @returns rg 绝对路径；包不存在 / postinstall 未运行时返回 null
 */
export function findRgBinFromPackage(): string | null {
  try {
    // __filename 在 esbuild 输出的 CJS 里有效；ESM 测试模式下 createRequire(import.meta.url) 也行
    // 这里用 __filename，编译产物 main.cjs 时直接可用；test 模式 bun 会把 __filename 注入运行时
    const cjsRequire = createRequire(typeof __filename === 'string' ? __filename : import.meta.url)
    const indexJs = cjsRequire.resolve('@vscode/ripgrep')
    const pkgDir = dirname(dirname(indexJs)) // .../ripgrep/lib/index.js → .../ripgrep
    const binName = process.platform === 'win32' ? 'rg.exe' : 'rg'
    const binPath = join(pkgDir, 'bin', binName)
    return existsSync(binPath) ? binPath : null
  } catch {
    return null
  }
}

/**
 * 解析最终使用的 rg 二进制路径。
 *
 * 优先级：显式参数 > ASCI_RG_BIN 环境变量 > @vscode/ripgrep 包内置 binary > 系统 PATH 上的 'rg'
 */
export function resolveRgBin(explicit?: string): string {
  if (explicit) return explicit
  const fromEnv = process.env.ASCI_RG_BIN
  if (fromEnv) return fromEnv
  const fromPkg = findRgBinFromPackage()
  if (fromPkg) return fromPkg
  return 'rg'
}

/** 默认 rg runner：spawn `rg` 并把 stdout/stderr 累到 buffer 返回 */
export function createDefaultRgRunner(rgBin: string): RgRunnerFn {
  return (args) =>
    new Promise((resolveRun, rejectRun) => {
      let stdout = ''
      let stderr = ''
      let stdoutOver = false
      const proc = spawn(rgBin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      proc.stdout.on('data', (chunk: Buffer) => {
        if (stdoutOver) return
        stdout += chunk.toString('utf-8')
        if (stdout.length >= MAX_RG_OUTPUT_BYTES) {
          stdoutOver = true
          stdout = stdout.slice(0, MAX_RG_OUTPUT_BYTES)
        }
      })
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8')
      })
      proc.on('error', (err) => rejectRun(err))
      proc.on('close', (code) => resolveRun({ stdout, stderr, exitCode: code }))
    })
}

/** 语义检索入口抽象（生产 = zotero-embedding-index 的 semanticSearchPapers；测试注入 stub） */
export type SemanticSearchFn = (input: {
  query: string
  attachmentKeys?: string[]
  maxResults?: number
  textKinds?: ZoteroEmbeddingTextKind[]
  sectionIndex?: number
  sectionTitle?: string
}) => Promise<ZoteroSemanticSearchResult>

interface HandlerDeps {
  /** 论文 wiki 目录绝对路径，例如 ~/.asci/zotero/wiki/ */
  wikiDir: string
  /** rg 二进制路径，默认从 ASCI_RG_BIN 或 PATH 中的 rg */
  rgBin?: string
  /** rg 调用器（可注入 stub） */
  rgRunner?: RgRunnerFn
  /** fs 抽象（可注入 stub） */
  fs?: FsLike
  /**
   * 语义检索入口；缺省时不注册 papers_semantic_search 工具。
   * 检索模式（zotero-embedding.json mode）由 agent-orchestrator 每会话判定：
   * 仅 vector / both 档传入本字段（注册向量工具）。
   */
  semanticSearch?: SemanticSearchFn
  /**
   * 是否注册 ripgrep 关键词检索工具 papers_search_keywords。
   * 缺省（undefined）= 注册（向后兼容）；'vector' 档传 false 以隔离纯向量评估。
   * papers_read_* 深读工具不受此开关影响（各档都注册）。
   */
  keywordSearch?: boolean
}

interface SearchToolInput {
  query: string
  regex?: boolean
  caseSensitive?: boolean
  paperIds?: string[]
  maxResults?: number
}

interface SearchHit {
  paperId: string
  lineNumber: number
  byteOffset: number
  snippet: string
}

interface SearchToolOutput {
  query: string
  total: number
  truncated: boolean
  hits: SearchHit[]
}

interface ReadContextInput {
  paperId: string
  offset: number
  n?: number
}

interface ReadContextOutput {
  paperId: string
  filePath: string
  fileSize: number
  offset: number
  rangeStart: number
  rangeEnd: number
  cursorOffsetInText: number
  text: string
}

interface ReadOutlineInput {
  paperId: string
}

interface ReadOutlineOutput {
  paperId: string
  /** 解析后的源文件绝对路径（.article.md 优先 / 缺失时为 .txt）；都不在时填占位的 .article.md 路径供日志排查 */
  filePath: string
  /** 文件大小；hasArticle:false 时为 0 */
  fileSize: number
  /** 是否找到任一结构化源文件（.article.md 或 .txt）。字段名保留 hasArticle 维持向后兼容 */
  hasArticle: boolean
  /**
   * 实际命中的结构化源类型：
   *   - 'article' = `.article.md`（article-generator LLM 增益版）
   *   - 'txt'     = `.txt`（结构化 parser 输出，与 .article.md 同构）
   *   - 未命中时字段缺省
   */
  sourceKind?: 'article' | 'txt'
  /** OUTLINE / CONTENT 标题对是否在头部找到 */
  hasOutline: boolean
  /** # OUTLINE 与 # CONTENT 之间的原始 markdown（不含两侧标题行；hasOutline:false 时为空串） */
  outlineRaw: string
  /** 解析后的 list 条目（去掉前导 "- " / "* "）；hasOutline:false 时为空数组 */
  outlineItems: string[]
}

interface ReadArticleSectionInput {
  paperId: string
  /** 章节编号（1-based）；与 sectionTitle 二选一，sectionIndex 优先 */
  sectionIndex?: number
  /** 章节标题（substring 大小写不敏感匹配）；与 sectionIndex 二选一 */
  sectionTitle?: string
}

interface ArticleParagraph {
  /** 段落 ID 形如 "p3_1"；与 article generator 写出的 <p id="..."> 一致 */
  id: string
  /** 段落原文（已 trim） */
  text: string
}

interface ReadArticleSectionOutput {
  paperId: string
  filePath: string
  fileSize: number
  /** 是否找到任一结构化源文件（.article.md 或 .txt）。字段名保留 hasArticle 维持向后兼容 */
  hasArticle: boolean
  /** 实际命中的结构化源类型（同 ReadOutlineOutput.sourceKind） */
  sourceKind?: 'article' | 'txt'
  /** 是否找到匹配章节 */
  found: boolean
  /** 该 article 的所有一级章节 (idx + title)，便于 LLM 判定为何 found:false */
  availableSections: { index: number; title: string }[]
  /** 仅 found:true 时有值：章节序号、标题、原始 markdown、字节范围、解析后的 <p> 段落 */
  section?: {
    index: number
    title: string
    /** 章节内完整 markdown（含 # heading + 段落 + 表格/列表/代码等所有非段落内容）；trim 末尾空白 */
    raw: string
    /** [start, end) 在 article.md 文件内的 byte offset 范围 */
    byteRange: [number, number]
    /** 解析出的 <p id="..."> 段落（不含表格 / 列表 / 代码块等非段落内容） */
    paragraphs: ArticleParagraph[]
  }
}

/** rg --json 单条事件的最小子集 */
interface RgJsonMatch {
  type: 'match'
  data: {
    path: { text?: string }
    lines: { text?: string }
    line_number: number
    absolute_offset: number
  }
}

const searchInputShape = {
  query: z
    .string()
    .min(1)
    .max(MAX_QUERY_LEN)
    .describe('要检索的关键词；默认按字面量匹配（fixed-strings），可通过 regex=true 切到正则模式'),
  regex: z
    .boolean()
    .optional()
    .describe('为 true 时把 query 当作 ripgrep 正则；默认 false（fixed-strings 字面量）'),
  caseSensitive: z
    .boolean()
    .optional()
    .describe('为 true 时大小写敏感；默认 false（--ignore-case）'),
  paperIds: z
    .array(z.string().min(1))
    .optional()
    .describe('限定检索的 paperId 列表（即 wiki 下 md 文件 basename）；缺省时全量扫描 wikiDir'),
  maxResults: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`最多返回的命中数；默认 50，最大 ${MAX_RESULTS_HARD_CAP}`),
}

/** papers_semantic_search 单次最多返回条数硬上限 */
const SEMANTIC_MAX_RESULTS_CAP = 50
/** papers_semantic_search query 长度上限 */
const SEMANTIC_MAX_QUERY_LEN = 512

const semanticSearchInputShape = {
  query: z
    .string()
    .min(1)
    .max(SEMANTIC_MAX_QUERY_LEN)
    .describe(
      '自然语言查询（中英均可）。按语义相似度 + 关键词混合召回全库文献的相关段落，' +
        '与 papers_search_keywords 的字面量检索互补：先语义召回锁定段落，再决定是否深读。' +
        '注意：跨语言召回明显弱于同语言，而学术文献多为英文——当查询语言与文献语言不同时，' +
        '请优先用文献语言（通常英文）改写查询，或中英各发一次（结果会合并去重）。',
    ),
  paperIds: z
    .array(z.string().min(1))
    .optional()
    .describe('限定检索的 paperId（= attachmentKey）列表；缺省时检索整个文献库'),
  maxResults: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`最多返回的命中数；默认 10，最大 ${SEMANTIC_MAX_RESULTS_CAP}`),
  textKinds: z
    .array(z.enum(['raw', 'article', 'title_abstract']))
    .optional()
    .describe(
      '限定语料层：raw（原文段落）/ article（LLM 逐段摘要）/ title_abstract（篇章级标题+摘要）；缺省检索全部层',
    ),
  sectionTitle: z
    .string()
    .min(1)
    .optional()
    .describe(
      '限定章节标题（如 "method" / "results"），substring 大小写不敏感匹配每条 chunk 自带的章节标题；' +
        '可跨篇（"找各文献 Methods 里讨论 X 的段落"）。仅对结构化来源（structured .txt / article）的段落 chunk 有效——' +
        'lite 解析的纯文本段与 title_abstract 层无章节归属，加此过滤会被排除。',
    ),
  sectionIndex: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      '限定顶层章节号（来自 papers_read_outline 的 "N. Title" 前缀 N），精确匹配。' +
        '章节号是篇内编号，跨篇含义不同，通常配合单篇 paperIds 使用；与 sectionTitle 可同时给（取交集）。',
    ),
}

interface SemanticSearchInput {
  query: string
  paperIds?: string[]
  maxResults?: number
  textKinds?: ZoteroEmbeddingTextKind[]
  sectionTitle?: string
  sectionIndex?: number
}

const readContextInputShape = {
  paperId: z.string().min(1).describe('论文 ID，即 wiki 下 md 文件名 basename（不带 .md 后缀）'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .describe('文件内 byte offset，通常来源于 papers_search_keywords 返回的 byteOffset'),
  n: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`offset 前后各读取的字节数；默认 ${N_DEFAULT}，clamp 到 [${N_MIN}, ${N_MAX}]`),
}

const readOutlineInputShape = {
  paperId: z
    .string()
    .min(1)
    .describe('论文 ID（attachmentKey），即 wiki 下文件名 basename（不带 .md / .article.md 后缀）'),
}

const readArticleSectionInputShape = {
  paperId: z
    .string()
    .min(1)
    .describe('论文 ID（attachmentKey），与 papers_read_outline 一致'),
  sectionIndex: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('章节编号（来自 outlineItems 里 "N. Title" 前缀的 N）；优先于 sectionTitle'),
  sectionTitle: z
    .string()
    .min(1)
    .optional()
    .describe('章节标题，substring 大小写不敏感匹配；sectionIndex 缺失时使用'),
}

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo
  if (value > hi) return hi
  return value
}

function truncateSnippet(text: string): string {
  const cleaned = text.replace(/\r?\n$/, '')
  if (cleaned.length <= MAX_SNIPPET_BYTES) return cleaned
  return cleaned.slice(0, MAX_SNIPPET_BYTES) + '…'
}

/** 命中日志用：单行截断（多语言安全，按 code point） */
function logClip(text: string, n = 100): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const arr = [...flat]
  return arr.length > n ? `${arr.slice(0, n).join('')}…` : flat
}

/** 把 paperId 安全地解析为 wikiDir 下的 md 路径，拒绝越权（绝对路径 / .. / 跨目录） */
export function resolvePaperPath(wikiDir: string, paperId: string): string | null {
  if (!paperId || paperId.includes('\0')) return null
  if (isAbsolute(paperId)) return null
  if (paperId.includes('/') || paperId.includes('\\')) return null
  if (paperId.includes('..')) return null
  const resolved = resolve(wikiDir, `${paperId}.md`)
  const baseResolved = resolve(wikiDir)
  if (!resolved.startsWith(baseResolved + '/') && resolved !== baseResolved) return null
  return resolved
}

/**
 * 把 paperId 安全地解析为 wikiDir 下的 article.md 路径
 *
 * 与 resolvePaperPath 同样的越权防护；后缀改成 `.article.md`，
 * 由 zotero-article-generator 写出（与 raw `{key}.md` 同目录、同 key）。
 */
export function resolveArticlePath(wikiDir: string, paperId: string): string | null {
  if (!paperId || paperId.includes('\0')) return null
  if (isAbsolute(paperId)) return null
  if (paperId.includes('/') || paperId.includes('\\')) return null
  if (paperId.includes('..')) return null
  const resolved = resolve(wikiDir, `${paperId}.article.md`)
  const baseResolved = resolve(wikiDir)
  if (!resolved.startsWith(baseResolved + '/') && resolved !== baseResolved) return null
  return resolved
}

/**
 * 把 paperId 安全地解析为 wikiDir 下的 .txt 路径
 *
 * `{key}.txt` 由 settings 页"生成结构化 TXT"按钮触发，
 * 内容格式与 `.article.md` 同构（YAML frontmatter + # OUTLINE + # CONTENT + `<p id="pS_P">` 段落锚点）。
 * 越权防护与 resolvePaperPath / resolveArticlePath 完全一致，仅后缀不同。
 */
export function resolveStructuredTxtPath(wikiDir: string, paperId: string): string | null {
  if (!paperId || paperId.includes('\0')) return null
  if (isAbsolute(paperId)) return null
  if (paperId.includes('/') || paperId.includes('\\')) return null
  if (paperId.includes('..')) return null
  const resolved = resolve(wikiDir, `${paperId}.txt`)
  const baseResolved = resolve(wikiDir)
  if (!resolved.startsWith(baseResolved + '/') && resolved !== baseResolved) return null
  return resolved
}

/**
 * "结构化源"路径解析：按优先级 `.article.md` → `.txt` 找出第一个物理存在的文件。
 *
 * 两者格式同构（同一套 # OUTLINE / # CONTENT / `<p id="pS_P">`），因此可以共用
 * `extractOutlineSection` / `findArticleSections` / `extractArticleSection` 解析逻辑 ——
 * 调用方无需感知具体后缀。
 *
 * 返回值：
 *  - `{ kind: 'article' | 'txt', path }` —— 至少一个源文件存在
 *  - `{ kind: 'missing', articlePath }` —— paperId 合法但两个源都不在；
 *      articlePath 仅用于在 response 里回填"占位 filePath"，保持向后兼容字段语义
 *  - `{ kind: 'invalid' }` —— paperId 不合法（路径越权 / 包含分隔符等）
 */
export type StructuredSourceResolution =
  | { kind: 'article' | 'txt'; path: string }
  | { kind: 'missing'; articlePath: string }
  | { kind: 'invalid' }

export function resolveStructuredSourcePath(
  wikiDir: string,
  paperId: string,
  fsApi: { existsSync: (p: string) => boolean } = realFs,
): StructuredSourceResolution {
  const articlePath = resolveArticlePath(wikiDir, paperId)
  if (!articlePath) return { kind: 'invalid' }
  if (fsApi.existsSync(articlePath)) return { kind: 'article', path: articlePath }
  const txtPath = resolveStructuredTxtPath(wikiDir, paperId)
  if (txtPath && fsApi.existsSync(txtPath)) return { kind: 'txt', path: txtPath }
  return { kind: 'missing', articlePath }
}

/**
 * 从 article.md 头部文本里抽 `# OUTLINE` 与 `# CONTENT` 之间的内容
 *
 * 容忍：
 * - 标题前可有 frontmatter / 空行
 * - `#` 与单词之间允许 1+ 空白（如 `#  OUTLINE`）
 * - OUTLINE 这一行末尾允许尾随空格 / 注释
 *
 * 解析 list 条目：去掉前导 `- ` / `* `；空行 / 非列表行（如 `<!-- ... -->`）跳过。
 *
 * 找不到任一标题（没生成 / 头部被截断）→ hasOutline:false。
 */
export function extractOutlineSection(text: string): {
  hasOutline: boolean
  outlineRaw: string
  items: string[]
} {
  const re = /(?:^|\n)#\s+OUTLINE\b[^\n]*\n([\s\S]*?)\n#\s+CONTENT\b/
  const m = text.match(re)
  // m[1] 在正则有 capture group 且 m 非空时一定有值；TS 严格模式无法静态推断
  const captured = m?.[1]
  if (!m || captured === undefined) return { hasOutline: false, outlineRaw: '', items: [] }
  const outlineRaw = captured.trim()
  const items: string[] = []
  for (const line of outlineRaw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const itemMatch = trimmed.match(/^[-*]\s+(.+)$/)
    const itemText = itemMatch?.[1]
    if (itemText !== undefined) items.push(itemText.trim())
  }
  return { hasOutline: true, outlineRaw, items }
}

/**
 * 扫 article.md 全文，返回所有一级章节的 marker（idx + title + byteStart）
 *
 * 一级章节判定（与 article generator prompt 规则 4 / 70 对齐）：
 * - `^# (\d+)\.?\s+(.+)$` —— 容忍 `# 3. Method` 与 `# 3 Method` 两种 OUTLINE 编号风格
 * - `## 3.1 Sub` 不匹配（两个 #）
 * - `# OUTLINE` / `# CONTENT` 不匹配（无数字）
 * - `- 3. Method` 不匹配（无 #，是 OUTLINE list item）
 *
 * 子章节嵌套在父节内，不参与切片。
 */
export interface ArticleSectionMarker {
  index: number
  title: string
  byteStart: number
}

export function findArticleSections(articleMd: string): ArticleSectionMarker[] {
  const re = /^# (\d+)\.?\s+(.+)$/gm
  const out: ArticleSectionMarker[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(articleMd)) !== null) {
    const idxStr = m[1]
    const title = m[2]
    if (idxStr === undefined || title === undefined) continue
    out.push({
      index: parseInt(idxStr, 10),
      title: title.trim(),
      byteStart: m.index,
    })
  }
  return out
}

/**
 * 在 article.md 文本中按 sectionIndex 或 sectionTitle 抽出某一节的完整内容
 *
 * 边界规则：
 * - 起始：匹配的 `# N. Title` 行的开头
 * - 结束：下一个 `# M. ...` 一级章节的开头；若是末节，到 EOF
 * - 切出来的 raw 含 heading 行 + 全部段落（`<p>`）+ 非段落（表格、代码块、列表、公式等）
 *
 * 选择规则：
 * - sectionIndex 提供：精确按数字匹配
 * - 否则 sectionTitle 提供：substring 大小写不敏感匹配；多个匹配取第一个
 * - 都未提供：found:false
 *
 * 段落解析：用 `<p id="pX_Y">...</p>` 抓所有段落；非段落内容（表格、代码、公式等）
 * 仍保留在 raw 里供 LLM 自行处理，但不进 paragraphs 数组。
 */
export function extractArticleSection(
  articleMd: string,
  selector: { sectionIndex?: number; sectionTitle?: string },
): {
  found: boolean
  availableSections: { index: number; title: string }[]
  section?: {
    index: number
    title: string
    raw: string
    byteRange: [number, number]
    paragraphs: ArticleParagraph[]
  }
} {
  const markers = findArticleSections(articleMd)
  const availableSections = markers.map((m) => ({ index: m.index, title: m.title }))

  let targetIdx = -1
  if (selector.sectionIndex !== undefined) {
    targetIdx = markers.findIndex((m) => m.index === selector.sectionIndex)
  } else if (selector.sectionTitle !== undefined) {
    const needle = selector.sectionTitle.toLowerCase().trim()
    if (needle.length > 0) {
      targetIdx = markers.findIndex((m) => m.title.toLowerCase().includes(needle))
    }
  }
  if (targetIdx < 0) return { found: false, availableSections }

  const target = markers[targetIdx]
  if (!target) return { found: false, availableSections }
  const next = markers[targetIdx + 1]
  const byteEnd = next ? next.byteStart : articleMd.length
  const raw = articleMd.slice(target.byteStart, byteEnd).trimEnd()

  const paragraphs: ArticleParagraph[] = []
  const pRe = /<p id="([^"]+)">([\s\S]*?)<\/p>/g
  let pm: RegExpExecArray | null
  while ((pm = pRe.exec(raw)) !== null) {
    const id = pm[1]
    const text = pm[2]
    if (id === undefined || text === undefined) continue
    paragraphs.push({ id, text: text.trim() })
  }

  return {
    found: true,
    availableSections,
    section: {
      index: target.index,
      title: target.title,
      raw,
      byteRange: [target.byteStart, byteEnd],
      paragraphs,
    },
  }
}

/** 构建 rg 命令行参数 */
export function buildRgArgs(input: SearchToolInput, wikiDir: string): string[] {
  const args = [
    '--json',
    '--line-number',
    '--byte-offset',
    '--no-heading',
    '--no-messages',
    '--max-columns',
    '512',
  ]
  if (!input.regex) args.push('--fixed-strings')
  if (!input.caseSensitive) args.push('--ignore-case')

  // 没有 paperIds 限定时，加 -g '*.md' 只扫 md（过滤 wikiDir 里的 index.json 等）。
  // 注意：-g 必须在 `--` 之前，否则 rg 会把它当成 path argument。
  const hasPaperIds = input.paperIds && input.paperIds.length > 0
  if (!hasPaperIds) {
    args.push('-g', '*.md')
  }

  args.push('--', input.query)

  if (hasPaperIds) {
    // 仅保留通过 resolvePaperPath 校验、确实落在 wikiDir 下的 id；
    // 非法 id（绝对路径 / .. / 跨目录）静默丢弃，避免 rg 扫到 wiki 之外
    const resolvedPaths = input.paperIds!
      .map((id) => resolvePaperPath(wikiDir, id))
      .filter((p): p is string => p !== null)
    if (resolvedPaths.length === 0) {
      // 全部非法时给一个不存在的安全占位，rg 会自己 skip 并以 exit=1 收尾
      args.push(join(wikiDir, '__asci_no_match__.md'))
    } else {
      args.push(...resolvedPaths)
    }
  } else {
    args.push(wikiDir)
  }
  return args
}

/** 解析 rg --json 输出为 SearchHit 列表 */
export function parseRgJsonOutput(stdout: string, max: number): {
  hits: SearchHit[]
  truncated: boolean
} {
  const hits: SearchHit[] = []
  let truncated = false
  for (const rawLine of stdout.split('\n')) {
    if (!rawLine.trim()) continue
    let parsed: { type?: string; data?: unknown } | null = null
    try {
      parsed = JSON.parse(rawLine) as { type?: string; data?: unknown }
    } catch {
      continue
    }
    if (!parsed || parsed.type !== 'match') continue
    const d = (parsed as RgJsonMatch).data
    if (!d || typeof d.line_number !== 'number') continue
    const pathText = d.path?.text ?? ''
    if (!pathText) continue
    const paperId = basename(pathText, '.md')
    const lineText = d.lines?.text ?? ''
    hits.push({
      paperId,
      lineNumber: d.line_number,
      byteOffset: typeof d.absolute_offset === 'number' ? d.absolute_offset : 0,
      snippet: truncateSnippet(lineText),
    })
    if (hits.length >= max) {
      truncated = true
      break
    }
  }
  return { hits, truncated }
}

/** 测试入口：返回 search handler 函数本身 */
export function createSearchHandler(deps: HandlerDeps) {
  const fs = deps.fs ?? realFs
  const rgBin = resolveRgBin(deps.rgBin)
  const runner = deps.rgRunner ?? createDefaultRgRunner(rgBin)
  return async (input: SearchToolInput, _extra: unknown): Promise<CallToolResult> => {
    if (!fs.existsSync(deps.wikiDir)) {
      return {
        isError: true,
        content: [{ type: 'text', text: `wiki 目录不存在: ${deps.wikiDir}` }],
      }
    }
    const max = clamp(input.maxResults ?? 50, 1, MAX_RESULTS_HARD_CAP)
    const args = buildRgArgs(input, deps.wikiDir)

    let result: Awaited<ReturnType<RgRunnerFn>>
    try {
      result = await runner(args)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `调用 ripgrep 失败：${msg}（可设置 ASCI_RG_BIN 指定 rg 二进制路径）`,
          },
        ],
      }
    }

    // rg exit code 语义：0=找到匹配，1=没有匹配，2+=错误
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `ripgrep 退出码 ${result.exitCode}: ${result.stderr.slice(0, 500) || '(无 stderr)'}`,
          },
        ],
      }
    }

    const { hits, truncated } = parseRgJsonOutput(result.stdout, max)
    // 检索命中打日志（问题排查：看 Agent 关键词检索到了什么）
    console.log(`[papers-rg] 🔎 keyword "${input.query}" → ${hits.length} hits${truncated ? ' (truncated)' : ''}`)
    for (const h of hits) {
      console.log(`   · ${h.paperId} L${h.lineNumber} @${h.byteOffset} | ${logClip(h.snippet)}`)
    }
    const out: SearchToolOutput = {
      query: input.query,
      total: hits.length,
      truncated,
      hits,
    }
    return { content: [{ type: 'text', text: JSON.stringify(out) }] }
  }
}

/** 测试入口：返回 read context handler 函数本身 */
export function createReadContextHandler(deps: HandlerDeps) {
  const fs = deps.fs ?? realFs
  return async (input: ReadContextInput, _extra: unknown): Promise<CallToolResult> => {
    const path = resolvePaperPath(deps.wikiDir, input.paperId)
    if (!path) {
      return {
        isError: true,
        content: [{ type: 'text', text: `非法的 paperId: ${input.paperId}` }],
      }
    }
    if (!fs.existsSync(path)) {
      return {
        isError: true,
        content: [{ type: 'text', text: `论文 md 文件不存在: ${path}` }],
      }
    }
    const stat = fs.statSync(path)
    if (input.offset > stat.size) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `offset=${input.offset} 超过文件大小 ${stat.size}`,
          },
        ],
      }
    }
    const n = clamp(input.n ?? N_DEFAULT, N_MIN, N_MAX)
    const start = Math.max(0, input.offset - n)
    const end = Math.min(stat.size, input.offset + n)
    const length = end - start

    const fd = fs.openSync(path, 'r')
    let text = ''
    try {
      const buf = Buffer.alloc(length)
      const bytesRead = length === 0 ? 0 : fs.readSync(fd, buf, 0, length, start)
      text = buf.subarray(0, bytesRead).toString('utf-8')
    } finally {
      fs.closeSync(fd)
    }
    const out: ReadContextOutput = {
      paperId: input.paperId,
      filePath: path,
      fileSize: stat.size,
      offset: input.offset,
      rangeStart: start,
      rangeEnd: end,
      cursorOffsetInText: input.offset - start,
      text,
    }
    return { content: [{ type: 'text', text: JSON.stringify(out) }] }
  }
}

/** 测试入口：返回 read outline handler 函数本身 */
export function createReadOutlineHandler(deps: HandlerDeps) {
  const fs = deps.fs ?? realFs
  return async (input: ReadOutlineInput, _extra: unknown): Promise<CallToolResult> => {
    const resolution = resolveStructuredSourcePath(deps.wikiDir, input.paperId, fs)
    if (resolution.kind === 'invalid') {
      return {
        isError: true,
        content: [{ type: 'text', text: `非法的 paperId: ${input.paperId}` }],
      }
    }
    if (resolution.kind === 'missing') {
      // 两种结构化源都不在，未视为错误：返回 hasArticle:false 让 skill 自行决策（fallback raw md）
      const out: ReadOutlineOutput = {
        paperId: input.paperId,
        filePath: resolution.articlePath,
        fileSize: 0,
        hasArticle: false,
        hasOutline: false,
        outlineRaw: '',
        outlineItems: [],
      }
      return { content: [{ type: 'text', text: JSON.stringify(out) }] }
    }
    const path = resolution.path
    const stat = fs.statSync(path)
    const readLen = Math.min(stat.size, OUTLINE_HEAD_READ_BYTES)
    const fd = fs.openSync(path, 'r')
    let head = ''
    try {
      const buf = Buffer.alloc(readLen)
      const bytesRead = readLen === 0 ? 0 : fs.readSync(fd, buf, 0, readLen, 0)
      head = buf.subarray(0, bytesRead).toString('utf-8')
    } finally {
      fs.closeSync(fd)
    }
    const { hasOutline, outlineRaw, items } = extractOutlineSection(head)
    const out: ReadOutlineOutput = {
      paperId: input.paperId,
      filePath: path,
      fileSize: stat.size,
      hasArticle: true,
      sourceKind: resolution.kind,
      hasOutline,
      outlineRaw,
      outlineItems: items,
    }
    return { content: [{ type: 'text', text: JSON.stringify(out) }] }
  }
}

/** 测试入口：返回 read article section handler 函数本身 */
export function createReadArticleSectionHandler(deps: HandlerDeps) {
  const fs = deps.fs ?? realFs
  return async (input: ReadArticleSectionInput, _extra: unknown): Promise<CallToolResult> => {
    if (input.sectionIndex === undefined && input.sectionTitle === undefined) {
      return {
        isError: true,
        content: [{ type: 'text', text: '必须提供 sectionIndex 或 sectionTitle 之一' }],
      }
    }
    const resolution = resolveStructuredSourcePath(deps.wikiDir, input.paperId, fs)
    if (resolution.kind === 'invalid') {
      return {
        isError: true,
        content: [{ type: 'text', text: `非法的 paperId: ${input.paperId}` }],
      }
    }
    if (resolution.kind === 'missing') {
      const out: ReadArticleSectionOutput = {
        paperId: input.paperId,
        filePath: resolution.articlePath,
        fileSize: 0,
        hasArticle: false,
        found: false,
        availableSections: [],
      }
      return { content: [{ type: 'text', text: JSON.stringify(out) }] }
    }
    const path = resolution.path
    const stat = fs.statSync(path)
    if (stat.size > ARTICLE_FULL_READ_LIMIT_BYTES) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `结构化源文件过大 (${stat.size} bytes)，超过 ${ARTICLE_FULL_READ_LIMIT_BYTES} 字节硬上限；请用 papers_search_keywords + papers_read_context 在 raw .md 上分段读取`,
          },
        ],
      }
    }
    const fd = fs.openSync(path, 'r')
    let articleMd = ''
    try {
      const buf = Buffer.alloc(stat.size)
      const bytesRead = stat.size === 0 ? 0 : fs.readSync(fd, buf, 0, stat.size, 0)
      articleMd = buf.subarray(0, bytesRead).toString('utf-8')
    } finally {
      fs.closeSync(fd)
    }
    const result = extractArticleSection(articleMd, {
      sectionIndex: input.sectionIndex,
      sectionTitle: input.sectionTitle,
    })
    const out: ReadArticleSectionOutput = {
      paperId: input.paperId,
      filePath: path,
      fileSize: stat.size,
      hasArticle: true,
      sourceKind: resolution.kind,
      found: result.found,
      availableSections: result.availableSections,
      ...(result.section ? { section: result.section } : {}),
    }
    return { content: [{ type: 'text', text: JSON.stringify(out) }] }
  }
}

/** 测试入口：返回 semantic search handler 函数本身 */
export function createSemanticSearchHandler(semanticSearch: SemanticSearchFn) {
  return async (input: SemanticSearchInput, _extra: unknown): Promise<CallToolResult> => {
    try {
      const result = await semanticSearch({
        query: input.query,
        attachmentKeys: input.paperIds,
        maxResults: Math.min(input.maxResults ?? 10, SEMANTIC_MAX_RESULTS_CAP),
        textKinds: input.textKinds,
        sectionTitle: input.sectionTitle,
        sectionIndex: input.sectionIndex,
      })
      // 检索命中打日志（问题排查：看 Agent 语义检索到了什么）
      console.log(
        `[papers-rg] 🔎 semantic "${input.query}" → ${result.total} hits${result.degraded ? ` (degraded:${result.degraded})` : ''}`,
      )
      for (const h of result.hits) {
        const sec = h.sectionTitle ? ` §${h.sectionTitle}` : ''
        console.log(
          `   · ${h.paperId} ${h.textKind} ${h.anchorStart ?? '-'}${sec} ${h.score.toFixed(4)} | ${logClip(h.snippet)}`,
        )
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        isError: true,
        content: [{ type: 'text', text: `语义检索失败: ${message}` }],
      }
    }
  }
}

/** 生产入口：构造 SDK MCP server，供 agent-orchestrator 注入到 mcpServers */
export function createPapersRgMcpServer(deps: HandlerDeps) {
  const searchHandler = createSearchHandler(deps)
  const readHandler = createReadContextHandler(deps)
  const outlineHandler = createReadOutlineHandler(deps)
  const articleSectionHandler = createReadArticleSectionHandler(deps)
  const semanticTools = deps.semanticSearch
    ? [
        tool(
          'papers_semantic_search',
          '在本地文献库中按语义相似度 + 关键词（BM25）混合检索相关段落，返回 ' +
            '{paperId, textKind, anchorStart, anchorEnd, sectionIndex, sectionTitle, snippet, score, rawCosine, rawBm25} 列表。' +
            'rawCosine（向量余弦，~0.78–0.89 偏挤，弱信号）/ rawBm25（FTS5 BM25，越负越相关、≈0 为弱匹配）是相对参考分；' +
            'score 仅本次结果内排序用、跨查询不可比。' +
            '可选 sectionTitle/sectionIndex 把检索限定到某章节（如只在 Methods 里找）；sectionTitle 可跨篇匹配。' +
            '适合"哪些文献讨论了 X""找支持/反驳某论点的段落"类问题：先用本工具召回候选段落，' +
            '再视需要用 papers_read_context（b 前缀锚点 = byte offset）或 ' +
            'papers_read_article_section（p 前缀锚点 = 段落 id）深读上下文。' +
            'snippet 即命中段落原文，可直接作为证据引用。' +
            'degraded 字段提示降级：model_not_ready（嵌入模型未就绪，仅关键词路）/ index_empty（索引为空）。',
          semanticSearchInputShape,
          createSemanticSearchHandler(deps.semanticSearch),
        ),
      ]
    : []
  // keywordSearch === false（仅向量档）时不注册 ripgrep 关键词检索；缺省/ true 则注册
  const keywordTools =
    deps.keywordSearch === false
      ? []
      : [
          tool(
            'papers_search_keywords',
            '在论文 wiki 目录（{wikiDir}/{paperId}.md，raw 解析版）下用 ripgrep 检索关键词，返回 {paperId, lineNumber, byteOffset, snippet} 列表。配合 papers_read_context 拉取定位上下文。',
            searchInputShape,
            searchHandler,
          ),
        ]
  return createSdkMcpServer({
    name: 'papers-rg',
    version: '0.5.0',
    tools: [
      ...semanticTools,
      ...keywordTools,
      tool(
        'papers_read_context',
        '读取指定 paperId 在 byte offset 前后各 N 字节（默认 300，范围 50–2000）的 UTF-8 文本片段。配合 papers_search_keywords 返回的 byteOffset 使用；文件路径同样指向 raw .md。',
        readContextInputShape,
        readHandler,
      ),
      tool(
        'papers_read_outline',
        '快速读取指定 paperId 的结构化源头部 OUTLINE 区段（# OUTLINE 与 # CONTENT 之间的 list items），不读全文。源文件解析优先级：{wikiDir}/{paperId}.article.md（article-generator LLM 增益版） → {wikiDir}/{paperId}.txt（结构化 parser 输出，与 .article.md 同构）。两者格式完全一致（YAML frontmatter + # OUTLINE + # CONTENT + <p id="pS_P">），用同一套解析。响应里 sourceKind 字段告知实际命中哪个源。两个源都不在时返回 hasArticle:false，skill 应回落 Read raw .md。用于决定下一步对哪个章节做精读（再用 papers_read_article_section 拿章节内容）。',
        readOutlineInputShape,
        outlineHandler,
      ),
      tool(
        'papers_read_article_section',
        '按章节编号或标题从结构化源（.article.md 优先 / .txt 回落，与 papers_read_outline 同源解析）抽出某一节的完整内容，返回 { section: { raw, paragraphs[], byteRange } }。配合 papers_read_outline 使用：read_outline 选定章节后用 read_article_section 拿到该章节文本，无需通读全文。章节边界用一级 heading（^# N. Title）切，自动适配 OUTLINE 编号风格（# 3. Method 与 # 3 Method 都识别）。响应里 sourceKind 字段告知实际命中哪个源；两个源都不在时返回 hasArticle:false。',
        readArticleSectionInputShape,
        articleSectionHandler,
      ),
    ],
  })
}
