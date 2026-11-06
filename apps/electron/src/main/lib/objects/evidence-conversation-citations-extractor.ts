/**
 * 会话引用论文抽取器 —— 从 Agent session 的 SDK 消息流里扫"这条回答用到的论文"
 *
 * 三条互补的来源：
 *   A. 回答正文扫描（extractAnswerPaperCitations）：普通问答里论文知识来自
 *      `<session_paper_index>` 上下文注入，Agent 据 prompt 规约在正文里用精确标识
 *      （doi:/arXiv:/s2:/pmid:/oa:）引用。扫正文标识 → 匹配本会话 paper 记录 →
 *      带元数据的候选（反查不到 DB 时可兜底建 paper）。
 *   B. 工具调用扫描（extractConversationPaperRefs）：Agent 调
 *      workspace_papers_get / pdf_parse_batch 时从 tool_result 还原；以及 **确定性的
 *      Read-PDF 扫描** —— Agent 用内置 Read 读 Zotero PDF（`…/storage/{attachmentKey}/x.pdf`）
 *      或 parsed-papers/{key}.txt 时，路径里的 key 即论文身份，无需 Agent 引用。
 *      "读过即证据"是最确定的信号，service 侧经 zotero-pdf-snapshot 反查论文。
 *
 * 定位窗口：从被点击的 assistant 消息（messageUuid）往前回溯到上一条**人类** user
 * 消息（非 tool_result 回填），收集中间所有 tool_use + 配对的 tool_result。
 *
 * 输出 PaperRefCandidate[]，交给 evidence-conversation-service 反查/兜底建 paperId
 * 后落 source.kind='paper' 的 EvidenceRef。
 *
 * 纯函数 + 只读：不碰 DB，paper 反查与持久化都在 service 层。
 */

import type {
  PaperRecord,
  SDKAssistantMessage,
  SDKMessage,
  SDKToolResultBlock,
  SDKToolUseBlock,
  SDKUserMessage,
  WorkspacePaperEntry,
} from '@asci/shared'

import { getAgentSessionSDKMessages } from '../agent-session-manager.ts'
import { listSessionPapers, pickPrimaryIdentifier } from '../paper-result-recorder.ts'
import type { PaperRef } from './evidence-attachment-service.ts'

/** 已知工具全名（MCP 前缀 = `mcp__<server>__<tool>`） */
const TOOL_WORKSPACE_PAPERS_GET = 'mcp__workspace_papers__workspace_papers_get'
const TOOL_PDF_PARSE_BATCH = 'mcp__pdf_parser__pdf_parse_batch'

/** 回答正文扫描的伪 toolName 标签 */
const SOURCE_ANSWER_TEXT = 'answer-text'

/** 内置 Read 工具名 */
const TOOL_READ = 'Read'

/**
 * papers-rg 结构化精读工具（in-process MCP，服务名 `papers-rg`）。paperId = wiki md 文件
 * basename = Zotero attachmentKey，故候选走 `pdfAttachmentKey`（service 经 zotero-pdf-snapshot
 * 按附件 key 确定性反查论文），与 Read 命中 Zotero PDF 同路径。读到的片段作为 snapshotText
 * 直接成为证据行的 quote；passageKey 让同篇多片段各成一条。
 */
const TOOL_PAPERS_SEARCH = 'mcp__papers-rg__papers_search_keywords'
const TOOL_PAPERS_READ_CONTEXT = 'mcp__papers-rg__papers_read_context'
const TOOL_PAPERS_READ_OUTLINE = 'mcp__papers-rg__papers_read_outline'
const TOOL_PAPERS_READ_SECTION = 'mcp__papers-rg__papers_read_article_section'
const TOOL_PAPERS_SEMANTIC_SEARCH = 'mcp__papers-rg__papers_semantic_search'

/**
 * zotero_read_attachment：精读 Zotero 论文正文的主力工具。论文身份在**入参 itemKey**
 * （父条目 key），返回体不含 key。按后缀匹配，避免写死 server key 前缀（zotero/asci-zotero）。
 */
function isZoteroReadAttachment(toolName: string): boolean {
  return toolName === 'zotero_read_attachment' || toolName.endsWith('__zotero_read_attachment')
}

/** Zotero storage PDF 路径：`…/storage/{attachmentKey}/{file}.pdf`（8 位大写字母数字 key） */
const ZOTERO_PDF_PATH_RE = /[/\\]storage[/\\]([A-Z0-9]{8})[/\\][^/\\]+\.pdf$/i
/** 工作区 pdf_parse_batch 产物：`…/parsed-papers/{key}.txt` */
const PARSED_PAPER_TXT_RE = /[/\\]parsed-papers[/\\]([^/\\]+)\.txt$/

/** abstract 作为 snapshotText 时的截断上限（避免整段摘要塞进 anchor） */
const SNAPSHOT_MAX_CHARS = 1000

/** 论文兜底建库所需的元数据（反查 DB 不命中时用） */
export interface PaperCandidateMeta {
  title: string
  year?: number
  authors?: string[]
  abstract?: string
  doi?: string
}

/**
 * 一条候选论文证据。
 * - `paper` 为可反查标识（doi/zoteroKey/id）；正文里只拿到非 DOI 标识（arXiv/s2/...）
 *   且记录无 DOI 时可能缺省，此时只能靠 `meta` 兜底建 paper。
 * - `snapshotText` 可能为空（如 pdf_parse_batch 拿不到摘要），由 service 用 paper.title 兜底。
 * - `meta` 来自本会话 paper 记录，供 service 反查不到 DB 时 createPaper。
 */
export interface PaperRefCandidate {
  paper?: PaperRef
  /** Read 命中 Zotero PDF 时的附件 key（service 侧经 snapshot 反查论文 / 充实 meta） */
  pdfAttachmentKey?: string
  snapshotText: string
  toolName: string
  toolUseId?: string
  meta?: PaperCandidateMeta
  /**
   * 片段判别键（papers-rg 专用）：同一篇论文被多次精读（不同章节 / byteOffset / 命中行）时，
   * 每段应各成一条证据，而非按论文折叠。两层去重（toolCandidateDedupKey / candidateDedupKey）
   * 在 base key 后拼 `#${passageKey}` 区分片段；缺省（如 outline / 兜底建库）则按论文折叠。
   */
  passageKey?: string
}

/**
 * 主入口：抽取某条 assistant 回答用到的论文（读盘 + 委托纯函数）。
 *
 * messageUuid 找不到对应 assistant 消息 → 返回空数组（上游不报错）。
 */
export function extractConversationPaperRefs(
  sessionId: string,
  messageUuid: string,
): PaperRefCandidate[] {
  const messages = getAgentSessionSDKMessages(sessionId)
  return extractPaperRefsFromMessages(messages, messageUuid)
}

/**
 * 纯函数核心：给定整段消息流 + 目标 messageUuid，还原论文候选。
 * 抽出来便于单测（不依赖磁盘）。
 */
export function extractPaperRefsFromMessages(
  messages: SDKMessage[],
  messageUuid: string,
): PaperRefCandidate[] {
  if (messages.length === 0) return []

  const endIdx = messages.findIndex(
    (m) => m.type === 'assistant' && (m as SDKAssistantMessage).uuid === messageUuid,
  )
  if (endIdx < 0) return []

  // 回溯起点：从 endIdx 往前，停在上一条人类 user 消息（不含它）
  let startIdx = 0
  for (let i = endIdx - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type === 'user' && isHumanUserMessage(m as SDKUserMessage)) {
      startIdx = i + 1
      break
    }
  }

  // 收集窗口内的 tool_use（id → block）与 tool_result（tool_use_id → block）
  const toolUses = new Map<string, SDKToolUseBlock>()
  const toolResults = new Map<string, SDKToolResultBlock>()
  for (let i = startIdx; i <= endIdx; i++) {
    const m = messages[i]!
    if (m.type === 'assistant') {
      for (const block of (m as SDKAssistantMessage).message.content) {
        if (block.type === 'tool_use') {
          const tb = block as SDKToolUseBlock
          toolUses.set(tb.id, tb)
        }
      }
    } else if (m.type === 'user') {
      const content = (m as SDKUserMessage).message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block.type === 'tool_result') {
          const rb = block as SDKToolResultBlock
          toolResults.set(rb.tool_use_id, rb)
        }
      }
    }
  }

  // 分发解析 → 去重
  const candidates: PaperRefCandidate[] = []
  const seen = new Set<string>()
  for (const [id, use] of toolUses) {
    const result = toolResults.get(id)
    let parsed: PaperRefCandidate[] = []
    if (use.name === TOOL_WORKSPACE_PAPERS_GET) {
      parsed = parseWorkspacePapersGet(use, result)
    } else if (use.name === TOOL_PDF_PARSE_BATCH) {
      parsed = parsePdfParseBatch(use, result)
    } else if (use.name === TOOL_READ) {
      parsed = parseReadPaperPdf(use)
    } else if (isZoteroReadAttachment(use.name)) {
      parsed = parseZoteroReadAttachment(use)
    } else if (use.name === TOOL_PAPERS_SEARCH) {
      parsed = parsePapersSearchKeywords(use, result)
    } else if (use.name === TOOL_PAPERS_READ_CONTEXT) {
      parsed = parsePapersReadContext(use, result)
    } else if (use.name === TOOL_PAPERS_READ_SECTION) {
      parsed = parsePapersReadArticleSection(use, result)
    } else if (use.name === TOOL_PAPERS_READ_OUTLINE) {
      parsed = parsePapersReadOutline(use)
    } else if (use.name === TOOL_PAPERS_SEMANTIC_SEARCH) {
      parsed = parsePapersSemanticSearch(use, result)
    }
    for (const c of parsed) {
      const key = toolCandidateDedupKey(c)
      // 无可去重 key 的候选（理论上不会，Read/工具候选都至少有 attachmentKey/paper）直接保留
      if (!key) {
        candidates.push(c)
      } else if (!seen.has(key)) {
        seen.add(key)
        candidates.push(c)
      }
    }
  }
  return candidates
}

/**
 * 工具候选去重 key：paper 标识优先，其次 attachmentKey；带 passageKey（papers-rg 片段）
 * 时在 base 后拼 `#${passageKey}`，使同篇不同片段各保留、完全相同片段折叠。
 */
function toolCandidateDedupKey(c: PaperRefCandidate): string | null {
  const base = c.paper ? paperRefKey(c.paper) : c.pdfAttachmentKey ? `att:${c.pdfAttachmentKey}` : null
  if (base == null) return null
  return c.passageKey ? `${base}#${c.passageKey}` : base
}

/**
 * 解析 Read 工具的 file_path：命中论文 PDF → 候选。
 *   - Zotero `…/storage/{attachmentKey}/{file}.pdf` → { pdfAttachmentKey, meta(文件名兜底解析) }
 *   - 工作区 `…/parsed-papers/{key}.txt`           → { paper:{zoteroKey:key} }
 * 非论文路径 → 空。
 */
function parseReadPaperPdf(use: SDKToolUseBlock): PaperRefCandidate[] {
  const filePath = (use.input as { file_path?: unknown }).file_path
  if (typeof filePath !== 'string' || !filePath) return []

  const zoteroMatch = ZOTERO_PDF_PATH_RE.exec(filePath)
  if (zoteroMatch) {
    const attachmentKey = zoteroMatch[1]!
    const meta = parseZoteroFilenameMeta(filePath)
    return [
      {
        pdfAttachmentKey: attachmentKey,
        snapshotText: meta?.title ?? '',
        toolName: TOOL_READ,
        toolUseId: use.id,
        ...(meta ? { meta } : {}),
      },
    ]
  }

  const parsedMatch = PARSED_PAPER_TXT_RE.exec(filePath)
  if (parsedMatch) {
    const key = parsedMatch[1]!
    return [{ paper: { zoteroKey: key }, snapshotText: '', toolName: TOOL_READ, toolUseId: use.id }]
  }

  return []
}

/**
 * 解析 zotero_read_attachment 的入参：`{ itemKey, attachmentKey? }`。
 * itemKey 通常是论文父条目 key → 候选 `{ zoteroKey: itemKey }`；service 侧反查不到时
 * 再经 snapshot 按 parentItemKey/attachmentKey 充实 meta 兜底建库。
 */
function parseZoteroReadAttachment(use: SDKToolUseBlock): PaperRefCandidate[] {
  const input = use.input as { itemKey?: unknown }
  const itemKey = typeof input.itemKey === 'string' ? input.itemKey.trim() : ''
  if (!itemKey) return []
  return [
    { paper: { zoteroKey: itemKey }, snapshotText: '', toolName: 'zotero_read_attachment', toolUseId: use.id },
  ]
}

/**
 * 从 Zotero 默认文件名解析 meta：`{creators} - {year} - {title}.pdf`。
 * 解析失败时 title 兜底用去扩展名的整文件名。返回 null 仅当连文件名都取不到。
 */
function parseZoteroFilenameMeta(filePath: string): PaperCandidateMeta | undefined {
  const base = filePath.split(/[/\\]/).pop() ?? ''
  const stem = base.replace(/\.pdf$/i, '').trim()
  if (!stem) return undefined

  const parts = stem.split(' - ')
  if (parts.length >= 3) {
    const authorsRaw = parts[0]!.trim()
    const yearRaw = parts[1]!.trim()
    const title = parts.slice(2).join(' - ').trim()
    const meta: PaperCandidateMeta = { title: title || stem }
    if (/^\d{4}$/.test(yearRaw)) meta.year = Number.parseInt(yearRaw, 10)
    if (authorsRaw) meta.authors = [authorsRaw]
    return meta
  }
  return { title: stem }
}

// ============================================================================
// A. 回答正文扫描
// ============================================================================

/** 主入口（读盘）：扫某条 assistant 回答正文里的论文引用标识。 */
export function extractAnswerPaperCitations(
  sessionId: string,
  messageUuid: string,
): PaperRefCandidate[] {
  const messages = getAgentSessionSDKMessages(sessionId)
  const { records } = listSessionPapers(sessionId)
  return extractAnswerCitationsFromMessages(messages, records, messageUuid)
}

/**
 * 纯函数核心：给定消息流 + 本会话 paper 记录 + 目标 messageUuid，扫回答正文里的标识。
 *
 * 标识匹配本会话记录（按 pickPrimaryIdentifier 重算的标识 / 归一 DOI）：
 *   - 命中记录 → 候选带 doi（若记录有）+ 兜底元数据
 *   - 裸 DOI 未命中记录 → 仅给 { doi } 候选（无 meta，service 反查不到则 warn 跳过）
 */
export function extractAnswerCitationsFromMessages(
  messages: SDKMessage[],
  records: PaperRecord[],
  messageUuid: string,
): PaperRefCandidate[] {
  const msg = messages.find(
    (m) => m.type === 'assistant' && (m as SDKAssistantMessage).uuid === messageUuid,
  )
  if (!msg) return []
  const text = assistantText(msg as SDKAssistantMessage)
  if (!text.trim()) return []

  // 建索引：lowercased 主标识 → record；归一 DOI → record
  const byIdentifier = new Map<string, PaperRecord>()
  const byDoi = new Map<string, PaperRecord>()
  for (const r of records) {
    const idLower = pickPrimaryIdentifier(r).toLowerCase()
    if (!byIdentifier.has(idLower)) byIdentifier.set(idLower, r)
    if (r.doi) {
      const nd = normalizeDoi(r.doi)
      if (nd && !byDoi.has(nd)) byDoi.set(nd, r)
    }
  }

  const candidates: PaperRefCandidate[] = []
  const seen = new Set<string>()

  const pushCandidate = (paper: PaperRef | undefined, meta: PaperCandidateMeta | undefined) => {
    // 去重 key：doi 优先，其次 title
    const dedupKey =
      paper && 'doi' in paper
        ? `doi:${paper.doi.toLowerCase()}`
        : meta?.doi
          ? `doi:${meta.doi.toLowerCase()}`
          : meta?.title
            ? `t:${meta.title.toLowerCase()}`
            : paper
              ? paperRefKey(paper)
              : null
    if (!dedupKey || seen.has(dedupKey)) return
    seen.add(dedupKey)
    const snapshotText = truncate((meta?.abstract ?? meta?.title ?? '').trim(), SNAPSHOT_MAX_CHARS)
    candidates.push({
      ...(paper ? { paper } : {}),
      snapshotText,
      toolName: SOURCE_ANSWER_TEXT,
      ...(meta ? { meta } : {}),
    })
  }

  // 1) 带前缀的标识：doi:/arxiv:/s2:/pmid:/oa:
  for (const m of text.matchAll(PREFIXED_ID_RE)) {
    const prefix = m[1]!.toLowerCase()
    const value = stripTrailingPunct(m[2]!)
    const idLower = `${prefix}:${value}`.toLowerCase()
    const rec = byIdentifier.get(idLower)
    if (rec) {
      pushCandidate(recordToPaperRef(rec), recordToMeta(rec))
    } else if (prefix === 'doi') {
      // 标识不在本会话记录里，但仍是合法 DOI → 给 doi 候选交 service 反查
      const nd = normalizeDoi(value)
      if (nd) pushCandidate({ doi: nd }, undefined)
    }
  }

  // 2) 裸 DOI（无 doi: 前缀），匹配本会话记录优先
  for (const m of text.matchAll(BARE_DOI_RE)) {
    const nd = normalizeDoi(m[0]!)
    if (!nd) continue
    const rec = byDoi.get(nd)
    if (rec) pushCandidate(recordToPaperRef(rec), recordToMeta(rec))
    else pushCandidate({ doi: nd }, undefined)
  }

  return candidates
}

/** 把会话记录转成可反查 PaperRef（有 DOI 才能反查；否则 undefined，靠 meta 兜底建库） */
function recordToPaperRef(r: PaperRecord): PaperRef | undefined {
  const nd = normalizeDoi(r.doi)
  return nd ? { doi: nd } : undefined
}

function recordToMeta(r: PaperRecord): PaperCandidateMeta {
  const meta: PaperCandidateMeta = { title: (r.title || '').trim() || '(untitled)' }
  if (typeof r.year === 'number') meta.year = r.year
  if (Array.isArray(r.authors) && r.authors.length > 0) meta.authors = r.authors
  if (r.abstract) meta.abstract = r.abstract
  const nd = normalizeDoi(r.doi)
  if (nd) meta.doi = nd
  return meta
}

/** 拼接 assistant 消息里所有 text 块 */
function assistantText(m: SDKAssistantMessage): string {
  const parts: string[] = []
  for (const block of m.message.content) {
    if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
      parts.push((block as { text: string }).text)
    }
  }
  return parts.join('\n')
}

/** DOI 归一：去前缀 / URL、小写、trim；无效返回 null（与 paper-repository 同语义的轻量版） */
function normalizeDoi(doi: string | null | undefined): string | null {
  if (doi == null) return null
  let s = String(doi).trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
  s = s.replace(/^doi:\s*/, '')
  s = stripTrailingPunct(s)
  return s.length > 0 ? s : null
}

/** 去掉标识尾部句读（DOI/ID 被句子标点黏住时） */
function stripTrailingPunct(s: string): string {
  return s.replace(/[.,;:)\]}>"']+$/, '')
}

/** 前缀标识：`doi:10.x/...` / `arXiv:2401.x` / `s2:...` / `pmid:...` / `oa:...` */
const PREFIXED_ID_RE = /\b(doi|arxiv|s2|pmid|oa):\s?([^\s)\]}<>,;"']+)/gi
/** 裸 DOI（无前缀） */
const BARE_DOI_RE = /\b10\.\d{4,9}\/[^\s"'<>,;)\]}]+/g

/** 人类 user 消息：含 text 块、且不含 tool_result 块、且非 SDK 合成 */
function isHumanUserMessage(m: SDKUserMessage): boolean {
  if (m.isSynthetic) return false
  const content = m.message?.content
  if (!Array.isArray(content)) return true // 无 content 视为人类边界（保守）
  const hasToolResult = content.some((b) => b.type === 'tool_result')
  if (hasToolResult) return false
  return content.some((b) => b.type === 'text')
}

/** 解析 workspace_papers_get → 单条候选（notFound / 无可反查标识 → 空） */
function parseWorkspacePapersGet(
  use: SDKToolUseBlock,
  result: SDKToolResultBlock | undefined,
): PaperRefCandidate[] {
  if (!result || result.is_error) return []
  const data = parseToolResultJson(result.content)
  if (!data || typeof data !== 'object') return []
  if ((data as { notFound?: unknown }).notFound) return []

  const entry = data as Partial<WorkspacePaperEntry>
  const paper = pickPaperRef(entry.doi, entry.linkedZoteroKey)
  if (!paper) return []

  const snapshot = truncate((entry.abstract ?? entry.title ?? '').trim(), SNAPSHOT_MAX_CHARS)
  return [{ paper, snapshotText: snapshot, toolName: use.name, toolUseId: use.id }]
}

/** 解析 pdf_parse_batch → 每个成功解析的 item 一条候选（itemKey = Zotero key） */
function parsePdfParseBatch(
  use: SDKToolUseBlock,
  result: SDKToolResultBlock | undefined,
): PaperRefCandidate[] {
  // 优先信任 result.results 的 status；result 缺失/损坏时退回 args.items
  const out: PaperRefCandidate[] = []
  const parsed = result && !result.is_error ? parseToolResultJson(result.content) : null
  const results =
    parsed && typeof parsed === 'object' && Array.isArray((parsed as { results?: unknown }).results)
      ? ((parsed as { results: Array<Record<string, unknown>> }).results)
      : null

  if (results) {
    for (const r of results) {
      const itemKey = typeof r.itemKey === 'string' ? r.itemKey : null
      const status = r.status
      if (!itemKey) continue
      if (status === 'error') continue
      out.push({
        paper: { zoteroKey: itemKey },
        snapshotText: '',
        toolName: use.name,
        toolUseId: use.id,
      })
    }
    return out
  }

  // 退回 args.items
  const items = (use.input as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  for (const it of items) {
    const itemKey =
      it && typeof it === 'object' && typeof (it as { itemKey?: unknown }).itemKey === 'string'
        ? (it as { itemKey: string }).itemKey
        : null
    if (!itemKey) continue
    out.push({
      paper: { zoteroKey: itemKey },
      snapshotText: '',
      toolName: use.name,
      toolUseId: use.id,
    })
  }
  return out
}

// ============================================================================
// papers-rg 结构化精读：每个片段一条候选（同篇多段各成证据），论文走 pdfAttachmentKey
// ============================================================================

/** papers_search_keywords → 每个 hit 一条候选（snippet 作 quote，byteOffset 作片段判别键） */
function parsePapersSearchKeywords(
  use: SDKToolUseBlock,
  result: SDKToolResultBlock | undefined,
): PaperRefCandidate[] {
  if (!result || result.is_error) return []
  const data = parseToolResultJson(result.content)
  if (!data || typeof data !== 'object') return []
  const hits = (data as { hits?: unknown }).hits
  if (!Array.isArray(hits)) return []

  const out: PaperRefCandidate[] = []
  for (const h of hits) {
    if (!h || typeof h !== 'object') continue
    const paperId = typeof (h as { paperId?: unknown }).paperId === 'string' ? (h as { paperId: string }).paperId : null
    if (!paperId) continue
    const byteOffset = (h as { byteOffset?: unknown }).byteOffset
    const snippet = typeof (h as { snippet?: unknown }).snippet === 'string' ? (h as { snippet: string }).snippet : ''
    out.push({
      pdfAttachmentKey: paperId,
      snapshotText: truncate(snippet.trim(), SNAPSHOT_MAX_CHARS),
      toolName: use.name,
      toolUseId: use.id,
      passageKey: `kw:${typeof byteOffset === 'number' ? byteOffset : snippet.slice(0, 24)}`,
    })
  }
  return out
}

/**
 * papers_semantic_search → 每条命中一条段落级候选（snippet = chunk 原文作 quote）。
 * passageKey 用命中锚点（b 字节偏移 / p 段落 id / 篇章层 ta:textKind），
 * 同篇多段各成一条证据；工具自身已做每篇 top 命中去重（maxPerPaper）。
 */
function parsePapersSemanticSearch(
  use: SDKToolUseBlock,
  result: SDKToolResultBlock | undefined,
): PaperRefCandidate[] {
  if (!result || result.is_error) return []
  const data = parseToolResultJson(result.content)
  if (!data || typeof data !== 'object') return []
  const hits = (data as { hits?: unknown }).hits
  if (!Array.isArray(hits)) return []

  const out: PaperRefCandidate[] = []
  for (const h of hits) {
    if (!h || typeof h !== 'object') continue
    const paperId =
      typeof (h as { paperId?: unknown }).paperId === 'string' ? (h as { paperId: string }).paperId : null
    if (!paperId) continue
    const snippet = typeof (h as { snippet?: unknown }).snippet === 'string' ? (h as { snippet: string }).snippet : ''
    const anchorStart =
      typeof (h as { anchorStart?: unknown }).anchorStart === 'string'
        ? (h as { anchorStart: string }).anchorStart
        : null
    const textKind =
      typeof (h as { textKind?: unknown }).textKind === 'string' ? (h as { textKind: string }).textKind : 'raw'
    out.push({
      pdfAttachmentKey: paperId,
      snapshotText: truncate(snippet.trim(), SNAPSHOT_MAX_CHARS),
      toolName: use.name,
      toolUseId: use.id,
      passageKey: `sem:${anchorStart ?? `ta:${textKind}`}`,
    })
  }
  return out
}

/** papers_read_context → 一条候选（offset 前后文本作 quote） */
function parsePapersReadContext(
  use: SDKToolUseBlock,
  result: SDKToolResultBlock | undefined,
): PaperRefCandidate[] {
  if (!result || result.is_error) return []
  const data = parseToolResultJson(result.content)
  if (!data || typeof data !== 'object') return []
  const d = data as { paperId?: unknown; text?: unknown; offset?: unknown }
  const inputId = (use.input as { paperId?: unknown }).paperId
  const paperId = typeof d.paperId === 'string' ? d.paperId : typeof inputId === 'string' ? inputId : null
  if (!paperId) return []
  const text = typeof d.text === 'string' ? d.text : ''
  const offset = typeof d.offset === 'number' ? d.offset : (use.input as { offset?: unknown }).offset
  return [
    {
      pdfAttachmentKey: paperId,
      snapshotText: truncate(text.trim(), SNAPSHOT_MAX_CHARS),
      toolName: use.name,
      toolUseId: use.id,
      passageKey: `ctx:${typeof offset === 'number' ? offset : 0}`,
    },
  ]
}

/** papers_read_article_section → found 时一条段落候选（section.raw 作 quote）；未命中退化为论文成员候选 */
function parsePapersReadArticleSection(
  use: SDKToolUseBlock,
  result: SDKToolResultBlock | undefined,
): PaperRefCandidate[] {
  if (!result || result.is_error) return []
  const data = parseToolResultJson(result.content)
  if (!data || typeof data !== 'object') return []
  const d = data as { paperId?: unknown; found?: unknown; section?: { index?: unknown; raw?: unknown } }
  const inputId = (use.input as { paperId?: unknown }).paperId
  const paperId = typeof d.paperId === 'string' ? d.paperId : typeof inputId === 'string' ? inputId : null
  if (!paperId) return []

  const raw = d.section && typeof d.section.raw === 'string' ? d.section.raw.trim() : ''
  if (d.found && raw) {
    const idx = d.section && typeof d.section.index === 'number' ? d.section.index : 0
    return [
      {
        pdfAttachmentKey: paperId,
        snapshotText: truncate(raw, SNAPSHOT_MAX_CHARS),
        toolName: use.name,
        toolUseId: use.id,
        passageKey: `sec:${idx}`,
      },
    ]
  }
  // 未命中章节：仍把论文计入（成员级，无 passageKey → 按论文折叠），snapshot 留空走 title 兜底
  return [{ pdfAttachmentKey: paperId, snapshotText: '', toolName: use.name, toolUseId: use.id }]
}

/** papers_read_outline → 论文成员候选（查阅过即计入；无 passageKey 按论文折叠，snapshot 留空走 title 兜底） */
function parsePapersReadOutline(use: SDKToolUseBlock): PaperRefCandidate[] {
  const paperId = (use.input as { paperId?: unknown }).paperId
  if (typeof paperId !== 'string' || !paperId) return []
  return [{ pdfAttachmentKey: paperId, snapshotText: '', toolName: use.name, toolUseId: use.id }]
}

/** doi 优先，其次 zoteroKey；都没有 → null（无法反查到 DB paper） */
function pickPaperRef(
  doi: string | null | undefined,
  zoteroKey: string | null | undefined,
): PaperRef | null {
  if (doi && doi.trim()) return { doi: doi.trim() }
  if (zoteroKey && zoteroKey.trim()) return { zoteroKey: zoteroKey.trim() }
  return null
}

/** PaperRef 去重 key（同一 doi / zoteroKey / id 视为同一篇） */
function paperRefKey(ref: PaperRef): string | null {
  if ('id' in ref) return `id:${ref.id}`
  if ('doi' in ref) return `doi:${ref.doi.toLowerCase()}`
  if ('zoteroKey' in ref) return `zk:${ref.zoteroKey}`
  return null
}

/**
 * 从 tool_result.content 解析出 JSON 对象。
 *
 * content 形态兼容：
 *   - MCP 包装数组 `[{ type:'text', text:'<json>' }]`
 *   - 纯字符串 `'<json>'`
 *   - 已经是对象（理论上少见，直接返回）
 * 解析失败返回 null。
 */
function parseToolResultJson(content: unknown): unknown {
  const text = extractToolResultText(content)
  if (text == null) {
    return content && typeof content === 'object' ? content : null
  }
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 从 content 里捞出文本 payload；捞不到返回 null */
function extractToolResultText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        parts.push((block as { text: string }).text)
      }
    }
    return parts.length > 0 ? parts.join('') : null
  }
  return null
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s
}
