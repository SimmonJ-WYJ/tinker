/**
 * zotero_wiki_lookup: 查询 ASCI 本地 wiki 索引判断论文是否有可读全文
 *
 * 数据源：~/.asci/zotero/wiki/index.json（由 zotero-pdf-parser/index-writer 在
 * snapshot 任意变动后自动重写；entry 里 parseStatus='completed' 且 mdPath 非空
 * 才代表真的有可读全文）。
 *
 * 与 zotero_get_attachment_path 的关键差别：
 *   - get_attachment_path：只看 Zotero 元数据有没有 PDF attachment 记录，
 *     不验证物理文件是否存在 → 经常误报"有 PDF"
 *   - wiki_lookup：只在 PDF 真的被成功解析后才有 entry，且直接给出 mdPath，
 *     下游可跳过 PDF 二次解析直接 Read markdown
 *
 * 不依赖 Zotero 桌面版运行（纯本地 JSON 查询）。
 *
 * ──── 排查不命中（DEBUG 日志） ────
 * 综述里某篇论文老是匹配不上 wiki 时打开 debug，会把每一次 lookup 的输入、
 * 走到的 layer、命中数、为什么被过滤掉、最接近的 top-3 候选都打到 stderr：
 *
 *   touch ~/.asci/zotero/.wiki-lookup-debug    # 启用
 *   rm    ~/.asci/zotero/.wiki-lookup-debug    # 关闭
 *
 * 触发后下次 review 时观察 ASCI 主进程控制台（dev 下是 `bun run dev` 的输出）。
 */

import { existsSync, readFileSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type {
  ZoteroPdfWikiIndex,
  ZoteroPdfWikiIndexEntry,
  ZoteroPdfParseStatus,
  ZoteroPdfArticleStatus,
} from '@asci/shared'
import { normalizeDoi, nowIso } from '@asci/shared'
import {
  getZoteroWikiIndexPath,
  getZoteroWikiStructuredTxtPath,
} from '../../../src/main/lib/config-paths.ts'
import { buildAttachmentPath } from '../../../src/main/lib/zotero-client/data-dir.ts'

export interface WikiLookupInput {
  /** Zotero parentItemKey 或 attachmentKey（任一即可） */
  zoteroKey?: string
  /** DOI（不带 https://doi.org/ 前缀；大小写、空白会规范化） */
  doi?: string
  /** 论文标题（规范化后严格相等） */
  title?: string
  /** 作者姓氏列表（规范化后每个都必须出现在 entry.authors 的姓氏集合中） */
  authors?: string[]
  /** 4 位年份（数字或字符串） */
  year?: number | string
}

export type WikiLookupReason =
  | 'insufficient_identity'
  | 'not_in_wiki'
  | 'ambiguous'
  | 'parse_pending'
  | 'parse_failed'
  | 'index_not_found'

export interface WikiLookupResult {
  /** true ⇔ entry 存在 + parseStatus='completed' + mdPath 非空（可直接深读全文） */
  found: boolean
  /** 是否在 wiki 索引里（不论解析状态） */
  inIndex: boolean
  /** 解析状态（仅 inIndex:true 时有值） */
  parseStatus?: ZoteroPdfParseStatus
  /** 命中的 entry 元数据（仅 inIndex:true 时有值） */
  attachmentKey?: string
  parentItemKey?: string | null
  title?: string
  authors?: string[]
  year?: string | null
  doi?: string | null
  publicationTitle?: string | null
  abstract?: string | null
  /** 解析后 markdown 路径（仅 found:true，下游可直接 Read，跳过 pdf_parse_batch） */
  mdPath?: string
  /**
   * 段落总结增强版 markdown 路径（仅 articleStatus='completed' 时有值）。
   * 下游优先 Read 这个路径——比 mdPath 多了"逐段总结 + 关键术语标注"，
   * 对 LLM 综述写作更友好。缺失时回落到 txtPath / mdPath（raw 解析）。
   */
  articlePath?: string
  /**
   * 结构化 parser 输出（`~/.asci/zotero/wiki/{key}.txt`），由设置页"生成结构化 TXT"按钮触发生成。
   * 内容格式与 `.article.md` **完全同构**（YAML frontmatter + `# OUTLINE` + `# CONTENT` +
   * `<p id="pS_P">` 段落锚点），因此下游 papers_read_outline / papers_read_article_section
   * 可直接消费。
   *
   * 运行时检测：每次 lookup 调用都会 fs.stat `{key}.txt`，命中则填本字段；不持久化到 index.json。
   * 下游读原文优先级：articlePath > txtPath > mdPath。
   */
  txtPath?: string
  /** article.md 生成状态；旧索引（无 article 字段）读出来为 null */
  articleStatus?: ZoteroPdfArticleStatus
  /** 物理 PDF 路径（imported_file/imported_url 时拼出），下游 fallback 用 */
  pdfPath?: string
  /** 失败原因（found:false 时填） */
  reason?: WikiLookupReason
}

/**
 * 主入口
 */
export function handleWikiLookup(input: WikiLookupInput): WikiLookupResult {
  const debug = debugEnabled()
  if (debug) dlogHeader(input)

  const idx = loadIndex()
  if (!idx) {
    if (debug) dlog('  ✗ index 不可用 → reason=index_not_found')
    return { found: false, inIndex: false, reason: 'index_not_found' }
  }

  return resolveOne(idx, input, debug)
}

/**
 * 在**已加载**的索引上解析单条 lookup —— 单篇 `handleWikiLookup` 与批量
 * `handleWikiLookupBatch` 共用此核心，确保批量 `results[i]` 与单篇返回**逐字段一致**
 * （便于后续把其他地方的单篇调用点平滑迁到批量接口）。
 */
function resolveOne(idx: ZoteroPdfWikiIndex, input: WikiLookupInput, debug: boolean): WikiLookupResult {
  const matches = findMatches(idx.entries, input, debug)
  if (matches.length === 0) {
    if (!hasAnyIdentity(input)) {
      if (debug) dlog('  ✗ 输入无任何身份字段 → reason=insufficient_identity')
      return { found: false, inIndex: false, reason: 'insufficient_identity' }
    }
    if (debug) dlogClosestForMiss(idx.entries, input)
    return { found: false, inIndex: false, reason: 'not_in_wiki' }
  }

  // 多条匹配时优先挑 completed 的；都不是 completed 时按 index 顺序取第一条
  const completed = matches.filter((e) => e.parseStatus === 'completed' && e.mdPath)
  if (completed.length > 1) {
    if (debug) {
      dlog(`  ⚠ ambiguous: 命中 ${completed.length} 条 completed`)
      for (const e of completed) {
        dlog(`     - ${e.parentItemKey}/${e.attachmentKey}  "${(e.title ?? '').slice(0, 60)}"  doi=${e.doi}`)
      }
    }
    return { found: false, inIndex: true, reason: 'ambiguous' }
  }
  if (matches.length > 1 && completed.length === 0) {
    if (debug) dlog(`  ◯ 命中 ${matches.length} 条但都未 completed，返回首条状态: parseStatus=${matches[0]!.parseStatus}`)
    return toResult(matches[0], false)
  }

  const entry = completed[0] ?? matches[0]
  const isReady = entry.parseStatus === 'completed' && !!entry.mdPath
  if (debug) {
    if (isReady) dlog(`  ✓ found mdPath=${entry.mdPath}`)
    else dlog(`  ◯ 命中但 parseStatus=${entry.parseStatus}, mdPath=${entry.mdPath ?? 'null'}`)
  }
  return toResult(entry, isReady)
}

/* -------------------------------- batch -------------------------------- */

/** 批量 lookup 每页默认 / 上限条数 */
const DEFAULT_BATCH_PAGE_SIZE = 50
const MAX_BATCH_PAGE_SIZE = 500

export interface WikiLookupBatchInput {
  /** 1..N 个论文身份；**单篇查询传长度为 1 的数组**即可 */
  items: WikiLookupInput[]
  /** 1-based 页码，默认 1 */
  page?: number
  /** 每页条数，默认 50，上限 500 */
  pageSize?: number
}

export interface WikiLookupBatchResult {
  /** 与请求页的 items 切片**逐一对齐**的结果（每条结构同 `WikiLookupResult`） */
  results: WikiLookupResult[]
  /** 实际返回的页码 */
  page: number
  /** 实际生效的每页条数（已 clamp 到 [1, 500]） */
  pageSize: number
  /** items 总数（分页前） */
  total: number
  /** 是否还有下一页 */
  hasMore: boolean
  /** wiki 索引是否可用；false 时本页每条 result 的 reason=index_not_found */
  indexAvailable: boolean
}

/**
 * 批量版 wiki lookup —— **索引只加载一次**，对该页 items 逐条复用 `resolveOne`。
 * 这是相对"逐篇调用 handleWikiLookup"的性能点（N 次 JSON 解析 → 1 次）。
 * 与单篇共享匹配核心 → `results[i]` 与 `handleWikiLookup(items[i])` 逐字段一致。
 */
export function handleWikiLookupBatch(input: WikiLookupBatchInput): WikiLookupBatchResult {
  const items = Array.isArray(input.items) ? input.items : []
  const total = items.length
  const pageSize = clampPageSize(input.pageSize)
  const page = Math.max(1, Math.floor(input.page ?? 1))
  const start = (page - 1) * pageSize
  const slice = items.slice(start, start + pageSize)
  const hasMore = start + pageSize < total

  const debug = debugEnabled()
  const idx = loadIndex()
  if (!idx) {
    if (debug) dlog('  ✗ index 不可用 → 本页全部 reason=index_not_found')
    return {
      results: slice.map(() => ({ found: false, inIndex: false, reason: 'index_not_found' as WikiLookupReason })),
      page,
      pageSize,
      total,
      hasMore,
      indexAvailable: false,
    }
  }

  const results = slice.map((item) => {
    if (debug) dlogHeader(item)
    return resolveOne(idx, item, debug)
  })
  return { results, page, pageSize, total, hasMore, indexAvailable: true }
}

function clampPageSize(v: number | undefined): number {
  if (v == null || !Number.isFinite(v)) return DEFAULT_BATCH_PAGE_SIZE
  return Math.min(MAX_BATCH_PAGE_SIZE, Math.max(1, Math.floor(v)))
}

/* -------------------------------- helpers -------------------------------- */

function loadIndex(): ZoteroPdfWikiIndex | null {
  const path = getZoteroWikiIndexPath()
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    return JSON.parse(raw) as ZoteroPdfWikiIndex
  } catch {
    // 索引文件损坏；视为不可用，让 gate 走 unresolved 路径
    return null
  }
}

function hasAnyIdentity(input: WikiLookupInput): boolean {
  return Boolean(input.zoteroKey || input.doi || input.title)
}

function findMatches(
  entries: ZoteroPdfWikiIndexEntry[],
  input: WikiLookupInput,
  debug = false,
): ZoteroPdfWikiIndexEntry[] {
  // 优先级 1：zoteroKey（命中 parentItemKey 或 attachmentKey 任一即可）
  if (input.zoteroKey) {
    const key = input.zoteroKey.trim()
    const hit = entries.filter((e) => e.parentItemKey === key || e.attachmentKey === key)
    if (debug) dlog(`  layer=zoteroKey input="${key}" hits=${hit.length}`)
    if (hit.length > 0) return hit
    // zoteroKey 给了但没命中 → 不再回落到 doi/title，保持严格语义
    return []
  }

  // 优先级 2：doi（规范化后严格相等）
  if (input.doi) {
    const target = normalizeDoi(input.doi)
    if (debug) dlog(`  layer=doi input="${input.doi}" normalized="${target ?? '(null)'}"`)
    if (target) {
      const hit = entries.filter((e) => e.doi && normalizeDoi(e.doi) === target)
      if (debug) dlog(`     hits=${hit.length}`)
      if (hit.length > 0) return hit
      return []
    }
    if (debug) dlog('     normalized=null → 视为无效 doi，跳过该层')
  }

  // 优先级 3：title + authors + year 严格匹配
  if (input.title) {
    const titleNorm = normalizeTitle(input.title)
    const candidates = entries.filter((e) => normalizeTitle(e.title) === titleNorm)
    const hit = candidates.filter((e) => matchAuthorsAndYear(e, input))
    if (debug) {
      dlog(`  layer=title+authors+year input.title="${input.title}"`)
      dlog(`     normalized="${titleNorm}"`)
      dlog(`     title-exact-matches=${candidates.length}, after authors+year filter=${hit.length}`)
      // 详细解释每条候选为啥被过滤掉
      if (candidates.length > 0 && hit.length === 0) {
        for (const c of candidates) {
          const reasons: string[] = []
          if (input.year != null) {
            const inYear = String(input.year).match(/\d{4}/)?.[0]
            if (!inYear) reasons.push('input.year 不含 4 位数字')
            else if (c.year !== inYear) reasons.push(`year mismatch: input=${inYear} vs entry=${c.year}`)
          }
          if (input.authors && input.authors.length > 0) {
            const entryLast = new Set(c.authors.map(extractLastName).filter(Boolean))
            const missing = input.authors.map(extractLastName).filter((a) => a && !entryLast.has(a))
            if (missing.length > 0) reasons.push(`author missing: [${missing.join(', ')}] not in entry-authors=[${[...entryLast].join(', ')}]`)
          }
          dlog(`     - rejected ${c.parentItemKey}/${c.attachmentKey}: ${reasons.join('; ') || '(no reason captured)'}`)
        }
      }
    }
    return hit
  }

  return []
}

function matchAuthorsAndYear(entry: ZoteroPdfWikiIndexEntry, input: WikiLookupInput): boolean {
  // 年份：输入提供时严格相等（4 位字符串）
  if (input.year != null) {
    const inYear = String(input.year).match(/\d{4}/)?.[0]
    if (!inYear) return false
    if (entry.year !== inYear) return false
  }

  // 作者：输入每一个姓氏都必须出现在 entry 姓氏集合中（允许 entry 多 author）
  if (input.authors && input.authors.length > 0) {
    const entryLastNames = new Set(entry.authors.map(extractLastName).filter(Boolean))
    for (const a of input.authors) {
      const last = extractLastName(a)
      if (!last) return false
      if (!entryLastNames.has(last)) return false
    }
  }

  return true
}

function toResult(entry: ZoteroPdfWikiIndexEntry, isReady: boolean): WikiLookupResult {
  const result: WikiLookupResult = {
    found: isReady,
    inIndex: true,
    parseStatus: entry.parseStatus,
    attachmentKey: entry.attachmentKey,
    parentItemKey: entry.parentItemKey,
    title: entry.title,
    authors: entry.authors,
    year: entry.year,
    doi: entry.doi,
    publicationTitle: entry.publicationTitle,
    abstract: entry.abstract,
  }

  // mdPath：仅当确实 completed 且 entry 里有非空 mdPath
  if (isReady && entry.mdPath) {
    result.mdPath = entry.mdPath
  }

  // articlePath：article.md 生成完成时透传；与 parseStatus 解耦
  // （旧索引可能没这俩字段，写成 ?? null 兼容；只有 completed + 非空才返回）
  const articleStatus = entry.articleStatus ?? null
  const articlePath = entry.articlePath ?? null
  if (articleStatus) {
    result.articleStatus = articleStatus
  }
  if (articleStatus === 'completed' && articlePath) {
    result.articlePath = articlePath
  }

  // txtPath：结构化 parser 输出，不在 index 里持久化 → 运行时 fs.stat 判定。
  // 用户在设置页点过"生成结构化 TXT"且物理文件还在时命中；
  // 与 articleStatus 解耦（即便 article 已生成也并存，让下游按优先级选）
  try {
    const txtPath = getZoteroWikiStructuredTxtPath(entry.attachmentKey)
    if (existsSync(txtPath)) {
      result.txtPath = txtPath
    }
  } catch {
    // 路径拼接 / stat 异常都不让 lookup 整体失败 —— txtPath 是增益字段
  }

  // pdfPath：imported_file / imported_url 时本地可拼出；其他 linkMode 不给（不保证可用）
  if (entry.linkMode === 'imported_file' || entry.linkMode === 'imported_url') {
    result.pdfPath = buildAttachmentPath(entry.attachmentKey, entry.filename)
  }

  if (!isReady) {
    result.reason = entry.parseStatus === 'failed' ? 'parse_failed' : 'parse_pending'
  }

  return result
}

/* -------------------------------- debug -------------------------------- */

/**
 * 调试日志开关：通过 touchfile 启用，避免 env 在 MCP 子进程不传播。
 *
 *   touch ~/.asci/zotero/.wiki-lookup-debug   # 启用
 *   rm    ~/.asci/zotero/.wiki-lookup-debug   # 关闭
 *
 * 每次 lookup 调用 stat 一次该文件，开销可忽略（每次 lookup 已经在 read JSON 索引）。
 * 日志同时走两路：
 *   - stderr（不污染 MCP stdout 协议；Electron dev 下能在主进程控制台看到）
 *   - ~/.asci/zotero/wiki-lookup-debug.log（append-only，永远有迹可循；
 *     防止 MCP 子进程 stderr 被宿主吞掉时找不到日志）
 */
function debugEnabled(): boolean {
  try {
    return existsSync(join(dirname(getZoteroWikiIndexPath()), '.wiki-lookup-debug'))
  } catch {
    return false
  }
}

function getDebugLogPath(): string {
  return join(dirname(getZoteroWikiIndexPath()), 'wiki-lookup-debug.log')
}

function dlog(...parts: unknown[]): void {
  const line = `[wiki-lookup] ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`
  console.error(line)
  try {
    appendFileSync(getDebugLogPath(), line + '\n', 'utf-8')
  } catch {
    // 文件写不进去也不让 lookup 出错
  }
}

function dlogHeader(input: WikiLookupInput): void {
  const ts = nowIso()
  dlog(`── ${ts} ──`)
  dlog(`  input: zoteroKey=${input.zoteroKey ?? '∅'}  doi=${input.doi ?? '∅'}  title=${input.title ? `"${input.title.slice(0, 60)}"` : '∅'}  authors=${input.authors ? JSON.stringify(input.authors) : '∅'}  year=${input.year ?? '∅'}`)
}

/**
 * Layer 3 全部 miss 时，输出 wiki 索引中"标题最接近"的 top-3，便于排查
 * "为什么明明有这篇但没匹配上"。距离用归一化后 token 的 Jaccard 相似度。
 */
function dlogClosestForMiss(entries: ZoteroPdfWikiIndexEntry[], input: WikiLookupInput): void {
  if (!input.title) return
  const target = new Set(normalizeTitle(input.title).split(' ').filter((t) => t.length >= 3))
  if (target.size === 0) return
  const scored: Array<{ score: number; e: ZoteroPdfWikiIndexEntry }> = []
  for (const e of entries) {
    const cand = new Set(normalizeTitle(e.title).split(' ').filter((t) => t.length >= 3))
    if (cand.size === 0) continue
    let inter = 0
    for (const t of target) if (cand.has(t)) inter++
    const union = new Set([...target, ...cand]).size
    const score = union > 0 ? inter / union : 0
    if (score > 0) scored.push({ score, e })
  }
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, 3)
  if (top.length === 0) {
    dlog('  closest: (无任何 title token 重叠)')
    return
  }
  dlog('  closest by Jaccard token overlap:')
  for (const { score, e } of top) {
    dlog(`     ${score.toFixed(2)}  ${e.parentItemKey}/${e.attachmentKey}  "${(e.title ?? '').slice(0, 70)}"  doi=${e.doi ?? 'null'}  year=${e.year ?? 'null'}`)
  }
}

/* ----------------------------- normalization ----------------------------- */

// normalizeDoi 来自 @asci/shared，与 paper-result-recorder / workspace-paper-store
// 共用同一份清洗逻辑（处理反引号、冒号、引号等 markdown 残余尾缀）

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 从作者字符串里抽姓氏（lowercase + trim）
 *
 * 输入可能形态：
 *   - "Last, First"（wiki entry 里折叠后的格式）
 *   - "Last"（只姓）
 *   - "First Last"（用户传入的全名，取最后一个空格后的 token）
 *   - "Surname"（用户直接传姓）
 */
function extractLastName(s: string): string {
  const trimmed = s.trim()
  if (!trimmed) return ''
  if (trimmed.includes(',')) {
    return trimmed.split(',')[0].trim().toLowerCase()
  }
  const tokens = trimmed.split(/\s+/)
  return tokens[tokens.length - 1].toLowerCase()
}

/* ------------------------------- tool def ------------------------------- */

export const wikiLookupToolDefinition = {
  name: 'zotero_wiki_lookup',
  description:
    '在 ASCI 本地 wiki 索引（~/.asci/zotero/wiki/index.json）里查论文是否有可读全文。'
    + '只在 PDF 被成功解析后才有 entry，比 zotero_get_attachment_path 更准确。'
    + '输入身份优先级：zoteroKey > doi > title+authors+year。'
    + '返回 found:true 当且仅当 entry 存在、parseStatus=completed、mdPath 非空；'
    + '此时下游可直接 Read mdPath 跳过 pdf_parse_batch。'
    + '若该论文 article.md 段落总结增强版也已生成（articleStatus=completed），'
    + '会额外返回 articlePath。若 .txt 结构化 parser 输出物理存在（用户在设置页点过"生成结构化 TXT"），'
    + '会额外返回 txtPath；.txt 与 .article.md 格式同构（YAML + # OUTLINE + # CONTENT + <p id="pS_P">），'
    + '可被 papers_read_outline / papers_read_article_section 直接消费。'
    + '下游读原文链路优先级：articlePath > txtPath > mdPath > abstract。'
    + 'inIndex:true 但 parseStatus 是 pending/parsing/failed 时，仍返回 abstract 等元数据用于兜底。'
    + '不依赖 Zotero 桌面版运行（纯本地 JSON 查询）。',
  inputSchema: {
    type: 'object',
    properties: {
      zoteroKey: { type: 'string', description: 'Zotero parentItemKey 或 attachmentKey' },
      doi: { type: 'string', description: 'DOI，不带 https://doi.org/ 前缀' },
      title: { type: 'string', description: '论文标题（规范化后严格相等）' },
      authors: {
        type: 'array',
        items: { type: 'string' },
        description: '作者姓氏列表（每个都必须出现在 entry 的姓氏集合中）',
      },
      year: { type: ['number', 'string'], description: '4 位年份' },
    },
    additionalProperties: false,
  },
} as const

export const wikiLookupBatchToolDefinition = {
  name: 'zotero_wiki_lookup_batch',
  description:
    '批量版 zotero_wiki_lookup：一次查多篇论文是否有可读全文，读同一份本地 wiki 索引'
    + '（~/.asci/zotero/wiki/index.json），**索引只加载一次**，比逐篇调用快得多。'
    + 'items 传 1..N 个身份对象（**单篇查询传长度为 1 的数组**即可）；每个身份的字段、'
    + '优先级与匹配语义与 zotero_wiki_lookup 完全一致（zoteroKey > doi > title+authors+year），'
    + 'results[i] 与 zotero_wiki_lookup 返回**逐字段相同**（found/inIndex/parseStatus/mdPath/'
    + 'articlePath/txtPath/abstract/reason 等），found:true ⇔ 有可读全文。'
    + '支持分页：page（从 1 起，默认 1）/ pageSize（默认 50，上限 500）切分 items，'
    + '响应含 total/hasMore 供循环拉取。纯本地查询，不依赖 Zotero 桌面版。',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            zoteroKey: { type: 'string', description: 'Zotero parentItemKey 或 attachmentKey' },
            doi: { type: 'string', description: 'DOI，不带 https://doi.org/ 前缀' },
            title: { type: 'string', description: '论文标题（规范化后严格相等）' },
            authors: { type: 'array', items: { type: 'string' }, description: '作者姓氏列表' },
            year: { type: ['number', 'string'], description: '4 位年份' },
          },
          additionalProperties: false,
        },
        description: '1..N 个论文身份；单篇查询传长度为 1 的数组',
      },
      page: { type: 'number', description: '1-based 页码，默认 1' },
      pageSize: { type: 'number', description: '每页条数，默认 50，上限 500' },
    },
    required: ['items'],
    additionalProperties: false,
  },
} as const
