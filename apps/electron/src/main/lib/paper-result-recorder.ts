/**
 * 论文检索结果记录器
 *
 * 作为 agent-orchestrator 的 L2 中间件，对所有 tool_result 做**内容层识别**（不看 tool 名），
 * 三层管线任一层抽到论文即追加到会话专属 JSONL 文件：
 *
 *   1. 廉价前置过滤：≥2 个 DOI / arXiv ID / JSON 中含 doi 字段才继续
 *   2. JSON 通用 Walker：整段 parse 或扫描出嵌入的 {...} 块，递归找满足 paper shape 的对象
 *   3. Markdown 块解析：`**Title**` + `Label: value` 形式
 *   4. DOI 上下文兜底：对每个 DOI 抓上下文，至少保留一条碎片记录
 *
 * 文件位置：~/.asci/agent-sessions-papers/{sessionId}.jsonl（Agent cwd 外，不污染上下文）
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PaperRecord } from '@asci/shared'
import { normalizeDoi, sanitizeText, nowIso } from '@asci/shared'
import { getSessionPapersPath } from './config-paths'

export type { PaperRecord } from '@asci/shared'

/** 待匹配的 tool_use，等待对应 tool_result */
interface PendingToolUse {
  toolName: string
  query: string | null
  workspaceSlug: string | null
  workspaceId: string | null
}

// ===== 状态 =====

/** sessionId → (tool_use_id → PendingToolUse) */
const pendingBySession = new Map<string, Map<string, PendingToolUse>>()

/** sessionId → 当前写入链（保证同会话 append 串行） */
const writeLocks = new Map<string, Promise<void>>()

// ===== 公共 API =====

/** 跟踪一个 tool_use。不筛选 tool 名，所有调用都记 query 以便结果阶段关联审计。 */
export function trackToolUse(
  sessionId: string,
  toolUseId: string,
  toolName: string,
  input: unknown,
  workspaceSlug?: string,
  workspaceId?: string,
): void {
  const query = extractQuery(input)
  const sessionMap = pendingBySession.get(sessionId) ?? new Map<string, PendingToolUse>()
  sessionMap.set(toolUseId, { toolName, query, workspaceSlug: workspaceSlug ?? null, workspaceId: workspaceId ?? null })
  pendingBySession.set(sessionId, sessionMap)
}

/** 处理 tool_result。对**每个**工具结果都跑三层内容识别，抽到论文则入库。 */
export async function handleToolResult(
  sessionId: string,
  toolUseId: string,
  resultContent: unknown,
): Promise<void> {
  const sessionMap = pendingBySession.get(sessionId)
  const pending = sessionMap?.get(toolUseId)
  if (!pending || !sessionMap) return
  sessionMap.delete(toolUseId)

  const rawText = extractResultText(resultContent)
  if (!rawText) return
  // 超长响应改为截取扫描，避免整条丢弃
  const text = rawText.length > MAX_CONTENT_BYTES ? rawText.slice(0, MAX_CONTENT_BYTES) : rawText
  if (rawText.length > MAX_CONTENT_BYTES) {
    console.log(`[论文记录] 内容 ${rawText.length} 字节超阈值，截取前 ${MAX_CONTENT_BYTES} 字节扫描`)
  }

  // 层 1：廉价前置过滤
  if (!hasPaperSignals(text)) return

  const sourceTag = buildSourceTag(pending.toolName, text)
  const query = pending.query

  // 层 2+2.5+3+4：顺序尝试，合并去重
  const records: PaperRecord[] = []
  try {
    const jsonRecs = extractFromJson(text, sourceTag, query)
    mergeUnique(records, jsonRecs)
  } catch (err) {
    console.warn('[论文记录] JSON 层失败:', err)
  }

  try {
    const xmlRecs = extractFromAtomXml(text, sourceTag, query)
    mergeUnique(records, xmlRecs)
  } catch (err) {
    console.warn('[论文记录] XML 层失败:', err)
  }

  try {
    const mdRecs = extractFromMarkdown(text, sourceTag, query)
    mergeUnique(records, mdRecs)
  } catch (err) {
    console.warn('[论文记录] Markdown 层失败:', err)
  }

  if (records.length === 0) {
    try {
      const scanRecs = scanDoisAsFragments(text, sourceTag, query)
      mergeUnique(records, scanRecs)
    } catch (err) {
      console.warn('[论文记录] DOI 扫描层失败:', err)
    }
  }

  if (records.length === 0) return

  await enqueueAppend(sessionId, records)

  // 注：search_executed 埋点已迁出本函数。检索结果的 JSONL 落盘职责早已迁到 Python MCP
  // （process_service.py），本 recorder 的 handleToolResult 生产侧零调用；埋点改由
  // search-telemetry-hook.ts 的 PostToolUse hook 上报（issue #717）。

  // 异步回流到工作区索引（失败只 warn + 通知 renderer，不影响主流程）
  if (pending.workspaceSlug) {
    try {
      const { appendOrMerge } = await import('./workspace-paper-store')
      appendOrMerge(pending.workspaceSlug, records, sessionId)
    } catch (err) {
      console.warn(`[论文记录] 回流到工作区 ${pending.workspaceSlug} 失败:`, err)
      if (pending.workspaceId) {
        const { emitPapersChanged } = await import('./workspace-paper-events')
        emitPapersChanged(pending.workspaceId, [], 'reflow_failed')
      }
    }
  }
}

/** Turn 结束时清理 pending 状态 + writeLocks Map 引用（避免长跑积累） */
export function clearSessionPaperState(sessionId: string): void {
  pendingBySession.delete(sessionId)
  // 等链上最后一次写完成后再删 Map entry，避免 in-flight 写丢失串行保证
  writeLocks.get(sessionId)?.finally(() => writeLocks.delete(sessionId))
}

/**
 * 读取指定会话的论文记录。
 * 文件不存在时返回空数组；按记录的 ts 字段倒序（最新在前）。
 */
export function listSessionPapers(sessionId: string): { records: PaperRecord[]; filePath: string } {
  const filePath = getSessionPapersPath(sessionId)
  if (!existsSync(filePath)) return { records: [], filePath }

  const records: PaperRecord[] = []
  try {
    for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
      if (!line.trim()) continue
      try {
        const raw = JSON.parse(line) as PaperRecord
        // 兜底：旧数据可能把 authors 存为 string 而非 string[]
        raw.authors = normalizeAuthors(raw.authors)
        records.push(raw)
      } catch { /* 跳过损坏行 */ }
    }
  } catch (err) {
    console.warn('[论文记录] 读取文件失败:', err)
  }

  // 最新在前
  records.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
  return { records, filePath }
}

/**
 * 为系统提示词构造紧凑的"本会话已检索论文摘要"。
 *
 * 用途：在 buildDynamicContext 中注入 `<session_paper_index>` 块，
 * 让 Lead Agent 在多轮检索同一课题时能识别"已有结果集合"，做增量补充而非重新跑一遍。
 *
 * 设计：
 *   - 用 recordKey（DOI / arXiv / paperId / pmid / openalexId / title+year）做去重
 *   - 仅保留 maxEntries 条（按 ts 倒序），其余以"…… N more"摘要
 *   - 标题截断到 100 字符，避免吃掉过多 context token
 *   - 完全无副作用：仅读取磁盘 JSONL，不写文件、不发事件
 *
 * 返回：可直接拼进 prompt 的字符串；若本会话无论文则返回 null（调用方应跳过整段注入）。
 */
export function summarizeSessionPapersForPrompt(
  sessionId: string,
  maxEntries = 50,
): { total: number; truncated: number; lines: string[] } | null {
  const { records } = listSessionPapers(sessionId)
  if (records.length === 0) return null

  // 按 recordKey 去重，保留每个 key 第一条（records 已是 ts 倒序，故第一条是最新）
  const seen = new Map<string, PaperRecord>()
  for (const r of records) {
    const k = recordKey(r)
    if (!k) continue
    if (!seen.has(k)) seen.set(k, r)
  }
  if (seen.size === 0) return null

  const sorted = [...seen.values()].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
  const head = sorted.slice(0, maxEntries)
  const truncated = Math.max(0, sorted.length - head.length)

  const lines = head.map((p) => formatPaperIdentityLine(p))
  return { total: seen.size, truncated, lines }
}

/** 单条论文的紧凑标识行：`<id> — <title slice>(<year>)`；优先选最稳定的 id 类型 */
function formatPaperIdentityLine(p: PaperRecord): string {
  const id = pickPrimaryIdentifier(p)
  const rawTitle = (p.title || '').trim()
  const titleSlice = rawTitle.length > 100 ? rawTitle.slice(0, 100) + '…' : rawTitle
  const yearPart = p.year ? ` (${p.year})` : ''
  return `- ${id} — ${titleSlice || '(no title)'}${yearPart}`
}

/**
 * 单条论文的主标识字符串（与 `<session_paper_index>` 注入块、回答引用规约一致）。
 * 导出供 evidence 抽取器复用：扫回答正文里的标识时按同一格式匹配。
 */
export function pickPrimaryIdentifier(p: PaperRecord): string {
  if (p.doi) return `doi:${p.doi}`
  const extra = (p.extra ?? {}) as Record<string, unknown>
  if (typeof extra.arxivId === 'string' && extra.arxivId) return `arXiv:${extra.arxivId}`
  if (typeof extra.paperId === 'string' && extra.paperId) return `s2:${extra.paperId}`
  if (typeof extra.pmid === 'string' && extra.pmid) return `pmid:${extra.pmid}`
  if (typeof extra.openalexId === 'string' && extra.openalexId) return `oa:${extra.openalexId}`
  return 'title-only'
}

// ===== 常量与正则 =====

const MAX_CONTENT_BYTES = 500_000
const DOI_RE = /\b10\.\d{4,9}\/[^\s"'<>,;\)\]}]+/g
// 支持 `arXiv:2401.12345` / `arXiv 2401.12345` / `arxiv.org/abs/2401.12345` / `arxiv.org/pdf/2401.12345`
const ARXIV_RE = /\b(?:arXiv[:/]?\s*|arxiv\.org\/(?:abs|pdf)\/)\d{4}\.\d{4,}(?:v\d+)?/i
// 扩 S2 / Crossref / OpenAlex / NCBI / ADS 常见字段
const JSON_HINT_RE = /"(?:doi|DOI|openalex|openalex_id|semantic_scholar_id|pmid|issn|paperId|paper_id|corpusId|corpusid|arxivId|arxiv_id|ArXiv|externalIds|pmcid|PMCID|bibcode|container-title|is-referenced-by-count|abstract_inverted_index)"/
// Schema.org JSON-LD
const SCHOLARLY_LD_RE = /"@type"\s*:\s*"ScholarlyArticle"/i

// ===== 输入提取 =====

function extractQuery(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  // 常见的检索 query 字段名
  for (const key of ['query', 'q', 'search', 'keyword', 'args', 'prompt']) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function extractResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (b.type === 'text' && typeof b.text === 'string') {
        parts.push(b.text)
      } else if (b.type === 'image') {
        // 图片 block 跳过（base64 内容无识别价值且会撑爆 MAX_CONTENT_BYTES）
        continue
      } else {
        // 兜底：非 text 的结构化 block（自定义 MCP 返回结构等）序列化交给 4 层管线尝试识别
        try { parts.push(JSON.stringify(b)) } catch { /* 循环引用等忽略 */ }
      }
    }
    return parts.join('\n')
  }
  // 直接对象 / 数字 / boolean → 序列化兜底（部分 MCP 工具直接返回结构化结果）
  if (content !== null && content !== undefined) {
    try { return JSON.stringify(content) } catch { return '' }
  }
  return ''
}

function buildSourceTag(toolName: string, text: string): string {
  // Skill 工具额外把 skill 名放进来，便于审计
  if (toolName === 'Skill') {
    const m = text.match(/^\s*#\s*([a-z0-9_-]+)/i)
    return m ? `tool:Skill:${m[1]}` : 'tool:Skill'
  }
  return `tool:${toolName}`
}

// ===== 层 1：廉价前置过滤 =====

function hasPaperSignals(text: string): boolean {
  if (text.length < 40) return false

  // 2 个以上 DOI → 几乎肯定是论文数据
  let doiCount = 0
  DOI_RE.lastIndex = 0
  while (DOI_RE.exec(text) !== null) {
    doiCount++
    if (doiCount >= 2) return true
  }

  // arXiv ID（含 arxiv.org URL 形式）
  if (ARXIV_RE.test(text)) return true

  // JSON 里含 paper 特征字段
  if (JSON_HINT_RE.test(text)) return true

  // Schema.org JSON-LD
  if (SCHOLARLY_LD_RE.test(text)) return true

  // Atom / arXiv XML 响应
  if (hasXmlPaperSignal(text)) return true

  return false
}

/** Atom feed 或 arXiv API 原始 XML 特征检测 */
function hasXmlPaperSignal(text: string): boolean {
  if (!text.includes('<title')) return false
  if (text.includes('<entry')) return true
  // 退化场景：agent 用 grep 过滤掉 `<entry>` / `<id>`，只留 title/summary/published
  const titleCount = (text.match(/<title\b/g) ?? []).length
  return titleCount >= 2 && text.includes('<summary') && text.includes('<published')
}

// ===== 层 2：JSON Walker =====

/**
 * 尝试把 text 当 JSON 解析，或从 text 中扫出平衡的 {...}/[...] 块逐个 parse。
 * 对每个成功的 JSON 做递归 walk，凡节点满足 paper-shape 条件就抽成 PaperRecord。
 */
function extractFromJson(text: string, sourceTag: string, query: string | null): PaperRecord[] {
  const parsed: unknown[] = []

  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      parsed.push(JSON.parse(trimmed))
    } catch {
      // 整段 parse 失败，转入子块扫描
    }
  }

  if (parsed.length === 0) {
    for (const block of extractBalancedJsonBlocks(text)) {
      try {
        parsed.push(JSON.parse(block))
      } catch {
        // 逐块容错
      }
    }
  }

  const records: PaperRecord[] = []
  const ts = nowIso()
  for (const root of parsed) {
    walkForPapers(root, (paperObj) => {
      const rec = objectToRecord(paperObj, sourceTag, query, ts)
      if (rec) records.push(rec)
    })
  }
  return records
}

/** 从文本中按大括号平衡抽取可能的 JSON 对象/数组块 */
function extractBalancedJsonBlocks(text: string): string[] {
  const blocks: string[] = []
  const openChars = ['{', '[']
  const closeMap: Record<string, string> = { '{': '}', '[': ']' }
  let i = 0

  while (i < text.length && blocks.length < 50) {
    const ch = text[i]
    if (!openChars.includes(ch as string)) { i++; continue }

    const openCh = ch as '{' | '['
    const closeCh = closeMap[openCh]
    const start = i
    let depth = 0
    let inStr = false
    let escape = false
    let j = i

    for (; j < text.length; j++) {
      const c = text[j]
      if (inStr) {
        if (escape) { escape = false }
        else if (c === '\\') escape = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') { inStr = true; continue }
      if (c === openCh) depth++
      else if (c === closeCh) {
        depth--
        if (depth === 0) { j++; break }
      }
    }

    if (depth === 0 && j - start > 20) {
      blocks.push(text.slice(start, j))
      i = j
    } else {
      i = start + 1  // 未闭合，跳一字符继续
    }
  }

  return blocks
}

/**
 * 递归 walk 对象树，凡节点像一篇论文就回调。
 * Paper-shape 判定：
 *   - 有 doi / DOI / externalIds.DOI 之一
 *   - 或同时有 title 和（authors|author|creator）中的一个
 */
function walkForPapers(node: unknown, onPaper: (obj: Record<string, unknown>) => void, depth = 0): void {
  if (depth > 20 || node === null || node === undefined) return

  if (Array.isArray(node)) {
    for (const item of node) walkForPapers(item, onPaper, depth + 1)
    return
  }

  if (typeof node !== 'object') return

  const obj = node as Record<string, unknown>
  if (isPaperShape(obj)) {
    onPaper(obj)
    // 不继续深入：对象自身就是一篇，避免把它的 references 再抽一遍
    return
  }

  // 非 paper 节点 → 继续深入
  for (const v of Object.values(obj)) walkForPapers(v, onPaper, depth + 1)
}

function isPaperShape(obj: Record<string, unknown>): boolean {
  const doiRaw = pickField(obj, ['doi', 'DOI'])
  const doiNested = readNestedString(obj, ['externalIds', 'DOI']) ?? readNestedString(obj, ['ids', 'doi'])
  const hasDoi = Boolean(normalizeDoi(doiRaw) || normalizeDoi(doiNested))

  const hasTitle = typeof pickField(obj, ['title', 'name']) === 'string'
  const hasAuthors = Array.isArray(pickField(obj, ['authors', 'author', 'creator', 'authorships']))

  if (hasDoi && hasTitle) return true
  if (hasTitle && hasAuthors) return true
  return false
}

function objectToRecord(
  obj: Record<string, unknown>,
  sourceTag: string,
  query: string | null,
  ts: string,
): PaperRecord | null {
  const titleRaw = pickField(obj, ['title', 'name'])
  const title = sanitizeText(coerceStringOrArray(titleRaw)) || '(无标题)'

  const authors = extractAuthorsFromObject(obj)
  const year = extractYearFromObject(obj)
  const venue = coerceStringOrArray(
    pickField(obj, ['venue', 'journal', 'container-title', 'container_title', 'publication_venue', 'journal_name']),
  )

  const doi = normalizeDoi(
    pickField(obj, ['doi', 'DOI']) ??
    readNestedString(obj, ['externalIds', 'DOI']) ??
    readNestedString(obj, ['ids', 'doi']),
  )

  const url = coerceStringOrArray(
    pickField(obj, ['url', 'URL', 'pdf_link', 'pdf_url', 'pdfUrl']) ??
    readNestedString(obj, ['open_access_pdf', 'url']) ??
    readNestedString(obj, ['primary_location', 'source', 'homepage_url']),
  )

  const abstract = extractAbstract(obj)

  const extra: Record<string, unknown> = {}
  captureExtraIds(obj, extra)
  const citedBy = pickField(obj, ['citationCount', 'cited_by_count', 'citedByCount', 'is-referenced-by-count'])
  if (typeof citedBy === 'number') extra.citedBy = citedBy
  const takeaway = pickField(obj, ['takeaway'])
  if (typeof takeaway === 'string') extra.takeaway = takeaway

  return {
    ts,
    query,
    source: sourceTag,
    title, // 已 sanitizeText（含 trim）
    authors,
    year,
    venue: venue ? venue.trim() : null,
    doi,
    url,
    abstract,
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  }
}

// ===== JSON 字段提取辅助 =====

function pickField(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

function readNestedString(obj: Record<string, unknown>, path: string[]): string | undefined {
  let cur: unknown = obj
  for (const key of path) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return typeof cur === 'string' && cur ? cur : undefined
}

function coerceStringOrArray(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') return String(v[0]).trim() || null
  return null
}

/** 将 authors 字段从 string | string[] | unknown 规范为 string[] */
function normalizeAuthors(authors: unknown): string[] {
  if (Array.isArray(authors)) return authors.filter((a): a is string => typeof a === 'string')
  if (typeof authors === 'string' && authors.trim()) {
    return authors.split(/[,，;；、]/).map((s) => s.trim()).filter(Boolean)
  }
  return []
}

function extractAuthorsFromObject(obj: Record<string, unknown>): string[] {
  const raw = pickField(obj, ['authors', 'author', 'creator', 'authorships'])
  if (!Array.isArray(raw)) return []

  const out: string[] = []
  for (const a of raw) {
    if (typeof a === 'string') { out.push(a.trim()); continue }
    if (a && typeof a === 'object') {
      const ao = a as Record<string, unknown>
      // OpenAlex authorship: { author: { display_name } }
      const nested = (ao.author ?? ao.raw_author_name) as unknown
      if (typeof nested === 'object' && nested) {
        const nestedObj = nested as Record<string, unknown>
        const nname = nestedObj.display_name ?? nestedObj.name
        if (typeof nname === 'string' && nname) { out.push(nname.trim()); continue }
      }
      const direct =
        ao.name ??
        ao.display_name ??
        ao.full_name ??
        (ao.given && ao.family ? `${ao.given} ${ao.family}` : null)
      if (typeof direct === 'string' && direct) out.push(direct.trim())
    }
  }
  return out.filter(Boolean).slice(0, 50)
}

function extractYearFromObject(obj: Record<string, unknown>): number | null {
  const direct = pickField(obj, ['year', 'publicationYear', 'publication_year', 'publishedYear', 'publish_year'])
  if (typeof direct === 'number') return direct
  if (typeof direct === 'string') {
    const n = Number(direct)
    if (Number.isFinite(n) && n > 1000 && n < 3000) return n
  }

  // Crossref 风格: issued.date-parts [[2024,5,1]]
  for (const key of ['issued', 'published', 'published-print', 'published-online']) {
    const nested = obj[key] as unknown
    if (nested && typeof nested === 'object') {
      const dp = (nested as Record<string, unknown>)['date-parts']
      if (Array.isArray(dp) && Array.isArray(dp[0]) && typeof dp[0][0] === 'number') {
        return dp[0][0] as number
      }
    }
  }

  // ISO 日期字符串
  const pubDate = pickField(obj, ['publishedAt', 'published_at', 'publishedDate', 'date', 'publicationDate'])
  if (typeof pubDate === 'string') {
    const m = pubDate.match(/(\d{4})/)
    if (m?.[1]) return Number(m[1])
  }

  return null
}

// 摘要清洗 + 截断：先 sanitizeText（剥 JATS / HTML 标签、解实体、去不可见符）再截 2000，
// 避免截到半个标签；纯标签摘要清成 '' → null。各 source 抽取路径共用，保截断口径一致。
function cleanAbstract(text: string | null | undefined): string | null {
  return sanitizeText(text).slice(0, 2000) || null
}

function extractAbstract(obj: Record<string, unknown>): string | null {
  const direct = pickField(obj, ['abstract', 'summary', 'description'])
  if (typeof direct === 'string' && direct) return cleanAbstract(direct)

  // OpenAlex 的 abstract_inverted_index（字典 → 位置数组）
  const inv = obj.abstract_inverted_index
  if (inv && typeof inv === 'object') {
    const invObj = inv as Record<string, unknown>
    const words: Array<{ pos: number; word: string }> = []
    for (const [word, positions] of Object.entries(invObj)) {
      if (Array.isArray(positions)) {
        for (const p of positions) {
          if (typeof p === 'number') words.push({ pos: p, word })
        }
      }
    }
    if (words.length > 0) {
      words.sort((a, b) => a.pos - b.pos)
      return cleanAbstract(words.map((w) => w.word).join(' '))
    }
  }

  return null
}

function captureExtraIds(obj: Record<string, unknown>, extra: Record<string, unknown>): void {
  const paperId = pickField(obj, ['paperId', 'paper_id'])
  if (typeof paperId === 'string') extra.paperId = paperId

  const arxivId = pickField(obj, ['arxiv_id', 'arxivId', 'arxiv']) ?? readNestedString(obj, ['externalIds', 'ArXiv'])
  if (typeof arxivId === 'string') extra.arxivId = arxivId

  const openalex = pickField(obj, ['openalex', 'openalex_id']) ?? readNestedString(obj, ['ids', 'openalex'])
  if (typeof openalex === 'string') extra.openalexId = openalex

  const pmid = pickField(obj, ['pmid', 'PMID']) ?? readNestedString(obj, ['externalIds', 'PubMed'])
  if (typeof pmid === 'string' || typeof pmid === 'number') extra.pmid = String(pmid)
}

// ===== 层 2.5：Atom / arXiv XML 解析 =====

const ATOM_ENTRY_RE = /<entry\b[^>]*>([\s\S]*?)<\/entry>/g
const XML_TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title>/g
const XML_SUMMARY_RE = /<summary\b[^>]*>([\s\S]*?)<\/summary>/g
const XML_PUBLISHED_RE = /<published\b[^>]*>([\s\S]*?)<\/published>/g
const XML_ID_RE = /<id\b[^>]*>([\s\S]*?)<\/id>/i
const XML_AUTHOR_NAME_RE = /<author\b[^>]*>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g
const ARXIV_URL_RE = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/i

/**
 * 解析 Atom / arXiv 风格 XML：
 *   - 优先匹配 `<entry>...</entry>` 块（完整 Atom feed）
 *   - 退化场景：无 `<entry>` 时，按顺序配对 `<title>` / `<summary>` / `<published>`
 */
function extractFromAtomXml(text: string, sourceTag: string, query: string | null): PaperRecord[] {
  if (!text.includes('<title')) return []
  const ts = nowIso()

  const entries = Array.from(text.matchAll(ATOM_ENTRY_RE))
  if (entries.length > 0) {
    const records: PaperRecord[] = []
    for (const match of entries) {
      const rec = parseAtomEntry(match[1] ?? '', sourceTag, query, ts)
      if (rec) records.push(rec)
    }
    return records
  }

  // 退化：依序配对
  const titles = matchAllGroup(text, XML_TITLE_RE).map(sanitizeText)
  const summaries = matchAllGroup(text, XML_SUMMARY_RE).map(decodeXml)
  const publisheds = matchAllGroup(text, XML_PUBLISHED_RE).map(decodeXml)

  // 首个 <title> 通常是 feed 标题（"arXiv Query: ..."），尝试跳过
  let offset = 0
  const first = titles[0]?.toLowerCase() ?? ''
  if (
    titles.length > 1 &&
    (first.includes('query') || first.includes('search results') || first.includes('arxiv.org'))
  ) {
    offset = 1
  }

  const count = Math.min(titles.length - offset, summaries.length, publisheds.length)
  const records: PaperRecord[] = []
  for (let i = 0; i < count; i++) {
    const title = titles[i + offset]
    if (!title) continue
    const summary = summaries[i] ?? ''
    records.push({
      ts,
      query,
      source: sourceTag,
      title, // 已 sanitizeText（含 trim）
      authors: [],
      year: extractYearFromIso(publisheds[i] ?? null),
      venue: 'arXiv',
      doi: null,
      url: null,
      abstract: summary ? cleanAbstract(summary) : null,
      extra: undefined,
    })
  }
  return records
}

function parseAtomEntry(
  body: string,
  sourceTag: string,
  query: string | null,
  ts: string,
): PaperRecord | null {
  const titleMatch = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch?.[1] ? sanitizeText(titleMatch[1]) || null : null
  if (!title) return null

  const summaryMatch = body.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)
  const publishedMatch = body.match(/<published\b[^>]*>([\s\S]*?)<\/published>/i)
  const idMatch = body.match(XML_ID_RE)
  const idValue = idMatch?.[1] ? decodeXml(idMatch[1]).trim() : null

  const authors = matchAllGroup(body, XML_AUTHOR_NAME_RE).map(decodeXml).filter(Boolean)
  const arxivMatch = idValue?.match(ARXIV_URL_RE)
  const arxivId = arxivMatch?.[1] ?? null
  const url = idValue && /^https?:\/\//.test(idValue) ? idValue : null

  const extra: Record<string, unknown> = {}
  if (arxivId) extra.arxivId = arxivId

  return {
    ts,
    query,
    source: sourceTag,
    title,
    authors: authors.slice(0, 50),
    year: extractYearFromIso(publishedMatch?.[1] ?? null),
    venue: arxivId ? 'arXiv' : null,
    doi: null,
    url,
    abstract: summaryMatch?.[1] ? cleanAbstract(summaryMatch[1]) : null,
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  }
}

function matchAllGroup(text: string, re: RegExp): string[] {
  const out: string[] = []
  for (const m of text.matchAll(re)) {
    if (m[1]) out.push(m[1])
  }
  return out
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractYearFromIso(s: string | null | undefined): number | null {
  if (!s) return null
  const m = s.match(/(\d{4})/)
  if (!m?.[1]) return null
  const n = Number(m[1])
  return n > 1000 && n < 3000 ? n : null
}

// ===== 层 3：Markdown 块解析（保留原有 scholar/arxiv/crossref/consensus/elicit 的 Label: value 格式） =====

const PLAIN_TITLE_LABEL_RE = /^\s*(?:Title|Paper|Article|标题)\s*[:：]\s*\S/im
const PAPER_SECONDARY_LABEL_RE = /(?:^|\n)\s*(?:DOI|Authors?|Journal|Venue|Year|PDF|Abstract|作者|期刊|年份|摘要)\s*[:：]\s*\S/im

/**
 * 识别两种块结构：
 *   1. Markdown 粗体：`**Title**\nLabel: value\n...`
 *   2. 纯文本标签块：`Title: ...\nDOI: ...\nAuthors: ...\n...`（Bash/curl 常见）
 */
function extractFromMarkdown(text: string, sourceTag: string, query: string | null): PaperRecord[] {
  const hasBold = text.includes('**')
  const hasPlainLabel = PLAIN_TITLE_LABEL_RE.test(text)
  if (!hasBold && !hasPlainLabel) return []

  const body = text.replace(/^\*\*[^*]+Search Results[^*]*\*\*\s*\n+/m, '')
  let blocks: string[]
  if (body.includes('\n\n---\n\n')) {
    blocks = body.split('\n\n---\n\n')
  } else if (hasBold) {
    blocks = body.split(/\n\n(?=\*\*)/)
  } else {
    // 按空行 + 下一块以 `Title:` 开头切分
    blocks = body.split(/\n\s*\n(?=\s*(?:Title|Paper|Article|标题)\s*[:：])/i)
  }

  const records: PaperRecord[] = []
  const ts = nowIso()

  for (const rawBlock of blocks) {
    const block = rawBlock.trim()
    if (!block) continue

    let title: string | null = null
    const boldMatch = block.match(/^\*\*(.+?)\*\*/)
    if (boldMatch?.[1]) {
      title = sanitizeText(boldMatch[1]) || null
    } else {
      const labelMatch = block.match(/^\s*(?:Title|Paper|Article|标题)\s*[:：]\s*(.+)$/im)
      if (labelMatch?.[1]) title = sanitizeText(labelMatch[1]) || null
    }
    if (!title || title.length < 3) continue

    // 纯标签块需要至少 1 个次要字段（DOI / Authors / Journal / Year / ...），避免误抓 bug 报告等同构文本
    if (!boldMatch && !PAPER_SECONDARY_LABEL_RE.test(block)) continue

    records.push({
      ts,
      query,
      source: sourceTag,
      title,
      authors: extractAuthorsFromMarkdown(block),
      year: extractYearFromMarkdown(block),
      venue: extractByLabels(block, ['Venue', 'Journal', 'Book', '期刊']),
      doi: normalizeDoi(extractByLabels(block, ['DOI'])),
      url: extractByLabels(block, ['URL', 'PDF', 'Link']),
      abstract: sanitizeText(extractByLabels(block, ['Abstract', 'Takeaway', 'Summary', '摘要'])) || null,
      extra: collectMarkdownExtra(block),
    })
  }
  return records
}

function extractAuthorsFromMarkdown(block: string): string[] {
  const m = block.match(/^\s*(?:Authors?|作者)\s*[:：]\s*(.+)$/im)
  if (!m?.[1]) return []
  return m[1]
    .split(/[,，;；、]/)
    .map((s) => s.replace(/\s*et al\.?.*$/i, '').trim())
    .filter(Boolean)
}

function extractYearFromMarkdown(block: string): number | null {
  const y =
    block.match(/(?:^|[\s,;])(?:Year|年份)\s*[:：]\s*(\d{4})/im) ??
    block.match(/(?:^|[\s,;])Published\s*[:：]\s*(\d{4})/im) ??
    block.match(/\((\d{4})\)/)
  return y?.[1] ? Number(y[1]) : null
}

function extractByLabels(block: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`^\\s*${label}\\s*[:：]\\s*(.+)$`, 'mi')
    const m = block.match(re)
    if (m?.[1]) {
      const value = m[1].trim().replace(/^\*\*(.+)\*\*$/, '$1')
      if (value && value !== 'N/A') return value
    }
  }
  return null
}

function collectMarkdownExtra(block: string): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {}
  const paperId = extractByLabels(block, ['Paper ID'])
  if (paperId) extra.paperId = paperId
  const arxivId = extractByLabels(block, ['arXiv'])
  if (arxivId) extra.arxivId = arxivId
  const citedBy = block.match(/(?:Cited by|Citations):\s*(\d+)/i)
  if (citedBy?.[1]) extra.citedBy = Number(citedBy[1])
  return Object.keys(extra).length > 0 ? extra : undefined
}

// ===== 层 4：DOI 上下文兜底 =====

function scanDoisAsFragments(text: string, sourceTag: string, query: string | null): PaperRecord[] {
  DOI_RE.lastIndex = 0
  const hits: Array<{ doi: string; start: number }> = []
  let m: RegExpExecArray | null
  while ((m = DOI_RE.exec(text)) !== null) {
    hits.push({ doi: m[0], start: m.index })
  }
  if (hits.length === 0) return []

  const ts = nowIso()
  const seen = new Set<string>()
  const records: PaperRecord[] = []

  for (const hit of hits) {
    const normalized = normalizeDoi(hit.doi)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const ctxStart = Math.max(0, hit.start - 150)
    const ctxEnd = Math.min(text.length, hit.start + 150)
    const ctx = text.slice(ctxStart, ctxEnd).trim()

    records.push({
      ts,
      query,
      source: sourceTag,
      title: '(DOI 片段)',
      authors: [],
      year: null,
      venue: null,
      doi: normalized,
      url: null,
      abstract: null,
      extra: { raw: ctx },
    })
  }
  return records
}

// ===== 合并 & DOI 规范化 =====

function mergeUnique(into: PaperRecord[], add: PaperRecord[]): void {
  const existingKeys = new Set<string>()
  for (const r of into) {
    const k = recordKey(r)
    if (k) existingKeys.add(k)
  }
  for (const r of add) {
    const k = recordKey(r)
    if (k && existingKeys.has(k)) continue
    if (k) existingKeys.add(k)
    into.push(r)
  }
}

function recordKey(r: PaperRecord): string | null {
  if (r.doi) return `doi:${r.doi.toLowerCase()}`
  const extra = (r.extra ?? {}) as Record<string, unknown>
  if (typeof extra.paperId === 'string') return `pid:${extra.paperId}`
  if (typeof extra.arxivId === 'string') return `arx:${extra.arxivId}`
  if (typeof extra.pmid === 'string') return `pmid:${extra.pmid}`
  if (typeof extra.openalexId === 'string') return `oa:${extra.openalexId}`
  // 无唯一 id 时，用 title+year 作为弱去重。title 走 sanitizeText：旧脏标题与新净标题哈希一致
  if (r.title && r.title !== '(无标题)' && r.title !== '(DOI 片段)') {
    return `t:${sanitizeText(r.title).toLowerCase()}|y:${r.year ?? ''}`
  }
  return null
}

// normalizeDoi 已抽到 @asci/shared，避免与 wiki-lookup / workspace-paper-store 不一致

// ===== 文件写入 =====

function enqueueAppend(sessionId: string, records: PaperRecord[]): Promise<void> {
  const prev = writeLocks.get(sessionId) ?? Promise.resolve()
  const next = prev
    .then(() => writeWithDedup(sessionId, records))
    .catch((err) => {
      console.error(`[论文记录] session=${sessionId} 写入失败:`, err)
    })
  writeLocks.set(sessionId, next)
  return next
}

const PLACEHOLDER_TITLES = new Set(['(DOI 片段)', '(无标题)'])

function isRicherThan(incoming: PaperRecord, existing: PaperRecord): boolean {
  // 已入库的是占位记录，新来的有真标题 → 升级
  if (PLACEHOLDER_TITLES.has(existing.title) && !PLACEHOLDER_TITLES.has(incoming.title)) return true
  // 同为真标题时，字段更齐的升级
  if (!PLACEHOLDER_TITLES.has(existing.title) && !PLACEHOLDER_TITLES.has(incoming.title)) {
    const score = (r: PaperRecord) =>
      (r.authors?.length ? 1 : 0) +
      (r.year ? 1 : 0) +
      (r.venue ? 1 : 0) +
      (r.url ? 1 : 0) +
      (r.abstract ? 1 : 0)
    return score(incoming) > score(existing) + 1
  }
  return false
}

function writeWithDedup(sessionId: string, records: PaperRecord[]): void {
  const filePath = getSessionPapersPath(sessionId)
  mkdirSync(dirname(filePath), { recursive: true })

  // 读入现有记录（保留原文行方便决定是否覆写）
  const existingByKey = new Map<string, PaperRecord>()
  const existingLines: string[] = []
  if (existsSync(filePath)) {
    try {
      for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
        if (!line.trim()) continue
        try {
          const r = JSON.parse(line) as PaperRecord
          r.authors = normalizeAuthors(r.authors)
          const k = recordKey(r)
          if (k) existingByKey.set(k, r)
          existingLines.push(line)
        } catch { /* 跳过损坏行 */ }
      }
    } catch (err) {
      console.warn('[论文记录] 读取现有文件失败，跳过去重:', err)
    }
  }

  const upgrades = new Map<string, PaperRecord>()  // key → 新记录（覆写旧占位）
  const appends: PaperRecord[] = []
  let dedupCount = 0

  for (const r of records) {
    const k = recordKey(r)
    if (k && existingByKey.has(k)) {
      const existing = existingByKey.get(k)!
      if (isRicherThan(r, existing)) {
        upgrades.set(k, r)
        existingByKey.set(k, r)
      } else {
        dedupCount++
      }
      continue
    }
    if (k) existingByKey.set(k, r)
    appends.push(r)
  }

  // 有升级 → 重写整文件（把占位行替换为真记录），否则纯追加
  if (upgrades.size > 0) {
    const rewritten: string[] = []
    for (const line of existingLines) {
      try {
        const r = JSON.parse(line) as PaperRecord
        const k = recordKey(r)
        if (k && upgrades.has(k)) {
          rewritten.push(JSON.stringify(upgrades.get(k)!))
          upgrades.delete(k)
        } else {
          rewritten.push(line)
        }
      } catch {
        rewritten.push(line)
      }
    }
    for (const r of appends) rewritten.push(JSON.stringify(r))
    // 升级过程中未命中旧行的（正常不该发生），当新增补上
    for (const r of upgrades.values()) rewritten.push(JSON.stringify(r))

    writeFileSync(filePath, rewritten.join('\n') + '\n', 'utf-8')
    console.log(
      `[论文记录] session=${sessionId} 升级 ${upgrades.size + (rewritten.length - existingLines.length - appends.length)} 条占位 / 新增 ${appends.length} 条 → ${filePath}`,
    )
    return
  }

  if (appends.length === 0) {
    if (dedupCount > 0) {
      console.log(`[论文记录] session=${sessionId} ${records.length} 条全部被去重跳过`)
    }
    return
  }

  appendFileSync(filePath, appends.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8')
  console.log(
    `[论文记录] session=${sessionId} 写入 ${appends.length} 条（去重 ${dedupCount}） → ${filePath}`,
  )
}

// ===== 测试专用导出（勿在业务代码中使用） =====

export const __testing__ = {
  hasPaperSignals,
  hasXmlPaperSignal,
  extractFromAtomXml,
  extractFromJson,
  extractFromMarkdown,
  scanDoisAsFragments,
}
