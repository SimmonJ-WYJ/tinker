/**
 * asci-zotero:request_batch_import — Agent 透明触发"批量加入 Zotero"对话框的 MCP 工具
 *
 * 设计动机：
 *   - 项目里 Zotero MCP 只暴露读工具（search / get / list），没有写/批量导入工具；
 *     模型自己尝试"对话内导入"时容易调不存在的工具或编造 Connector API 调用，不稳定。
 *   - 真实稳定的批量写路径只存在于渲染进程的 SessionPapersPanel + ZoteroBatchLinkDialog（issue #61）。
 *   - 该工具作为"对话 → 既有 UI 链路"的唯一入口：解析用户/Agent 给出的 paper_ids，
 *     映射到当前 session 的 PaperRecord，向 renderer 推送 IPC 让面板自动勾选 + 弹出 dialog，
 *     用户在 dialog 里完成 collection 选择 + 最终确认。
 *
 * 工具不直接写入 Zotero，亦不绕过用户确认；所有真实写入仍走既有
 * workspacePapers.linkZotero → performLinkZotero → Zotero Connector 链路。
 *
 * 通过 createSdkMcpServer + tool() 暴露给 claude-agent-sdk 的 in-process MCP 通道。
 */

import { z } from 'zod'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { PaperRecord, ZoteroOpenBatchImportPayload } from '@asci/shared'
import { listSessionPapers as listSessionPapersImpl } from '../lib/paper-result-recorder.ts'

export type SendOpenBatchImportFn = (payload: ZoteroOpenBatchImportPayload) => void
export type ListSessionPapersFn = (sessionId: string) => { records: PaperRecord[]; filePath: string }

interface HandlerDeps {
  sessionId: string
  sendOpenBatchImport: SendOpenBatchImportFn
  /** 测试可注入 stub；生产用 paper-result-recorder.listSessionPapers */
  listSessionPapers?: ListSessionPapersFn
}

const inputShape = {
  paper_ids: z.array(z.string().min(1)).min(1).describe(
    [
      'Identifiers of papers to import into Zotero in batch.',
      'Each item may be: a DOI (e.g. "10.1038/nature14539") or doi.org URL;',
      'an arXiv ID (e.g. "2103.00020", optionally prefixed "arXiv:");',
      'an arxiv.org abs/pdf URL; a PubMed ID (digits or "pmid:N");',
      'an OpenAlex Work ID ("W…"); or an already-canonical key',
      '("doi:…" / "arx:…" / "pid:…" / "pmid:…" / "oa:…" / "t:…").',
      "All ids are resolved against the current Agent session's retrieved papers (the panel backed by",
      'agent-sessions-papers/{sessionId}.jsonl). Run paper-search + process_search_results first if empty.',
    ].join(' ')
  ),
}

interface ToolInput {
  paper_ids: string[]
}

/**
 * 把单个原始 id 归一化为 canonical recordKey（形如 `doi:...` / `arx:...`），无法识别时返回 null。
 * 与 paper-result-recorder.ts / workspace-paper-store.ts / session-papers-utils.ts 中的 recordKey 协议保持一致。
 */
export function normalizePaperId(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null

  // 已是 canonical key（任意大小写前缀都接受，前缀强制小写）
  const canon = s.match(/^(doi|arx|pid|pmid|oa|t):(.+)$/i)
  if (canon) {
    const prefix = canon[1]!.toLowerCase()
    const tail = canon[2]!
    // doi 与 t 走小写匹配（与 recordKey 实现一致）
    return prefix === 'doi' || prefix === 't' ? `${prefix}:${tail.toLowerCase()}` : `${prefix}:${tail}`
  }

  // doi.org URL（http/https/无协议、dx 子域都接受）
  const doiUrl = s.match(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\/(.+)$/i)
  if (doiUrl) return `doi:${doiUrl[1]!.toLowerCase()}`

  // 裸 DOI（10.NN+/...）—— 不卡死位数，避免长尾 registrant code 漏判
  if (/^10\.\d{2,}\/\S+$/.test(s)) return `doi:${s.toLowerCase()}`

  // arxiv.org/abs|pdf/<id>(.pdf)?(vN)?
  const arxivUrl = s.match(/^(?:https?:\/\/)?arxiv\.org\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/i)
  if (arxivUrl) return `arx:${arxivUrl[1]!.replace(/v\d+$/, '')}`

  const arxivPrefixed = s.match(/^arxiv:(.+)$/i)
  if (arxivPrefixed) return `arx:${arxivPrefixed[1]!.replace(/v\d+$/, '')}`

  // 现代 arxiv id：YYMM.NNNNN(vN)?
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(s)) return `arx:${s.replace(/v\d+$/, '')}`

  // 旧 arxiv id：domain-class/YYNNNNN
  if (/^[a-z-]+\.[A-Z]{2}\/\d{7}$/i.test(s)) return `arx:${s}`

  // PubMed PMID（"pmid:N" 已被 canon 捕获；这里支持纯数字、heuristic 7-9 位）
  if (/^\d{7,9}$/.test(s)) return `pmid:${s}`

  // OpenAlex Work id
  if (/^W\d+$/.test(s)) return `oa:${s}`

  return null
}

/**
 * 与 paper-result-recorder.ts / workspace-paper-store.ts 内部 recordKey 等价实现。
 * 当前项目刻意保留多份避免跨层循环依赖；如未来抽到共享层应同步替换。
 */
function recordKey(r: PaperRecord): string | null {
  if (r.doi) return `doi:${r.doi.toLowerCase()}`
  const extra = (r.extra ?? {}) as Record<string, unknown>
  if (typeof extra.paperId === 'string') return `pid:${extra.paperId}`
  if (typeof extra.arxivId === 'string') return `arx:${extra.arxivId}`
  if (typeof extra.pmid === 'string') return `pmid:${extra.pmid}`
  if (typeof extra.openalexId === 'string') return `oa:${extra.openalexId}`
  if (r.title && r.title !== '(无标题)' && r.title !== '(DOI 片段)') {
    return `t:${r.title.toLowerCase()}|y:${r.year ?? ''}`
  }
  return null
}

function errText(msg: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: msg }] }
}

function truncateList(items: string[], limit = 5): string {
  if (items.length <= limit) return items.join(', ')
  return `${items.slice(0, limit).join(', ')} and ${items.length - limit} more`
}

/** 测试入口：返回 handler 函数本身（独立于 SDK MCP 注册壳） */
export function createZoteroImportToolHandler(deps: HandlerDeps) {
  const list = deps.listSessionPapers ?? listSessionPapersImpl
  return async (input: ToolInput, _extra: unknown): Promise<CallToolResult> => {
    const requested = Array.isArray(input.paper_ids) ? input.paper_ids : []
    if (requested.length === 0) return errText('paper_ids cannot be empty.')

    const normalized = requested.map((raw) => ({ raw, key: normalizePaperId(raw) }))
    const unrecognized = normalized.filter((n) => !n.key).map((n) => n.raw)

    let records: PaperRecord[]
    try {
      records = list(deps.sessionId).records
    } catch (err) {
      return errText(`Failed to read session papers: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (records.length === 0) {
      return errText(
        'No papers have been retrieved in this session yet. Run paper-search '
          + '(search_arxiv / search_semantic / …) and then mcp__paper-search__process_search_results first, '
          + 'then call this tool again with the resulting paper ids.'
      )
    }

    const recordsByKey = new Map<string, PaperRecord>()
    for (const r of records) {
      const k = recordKey(r)
      if (k) recordsByKey.set(k, r)
    }

    const matched: string[] = []
    const notInSession: string[] = []
    const seen = new Set<string>()
    for (const { raw, key } of normalized) {
      if (!key) continue
      if (seen.has(key)) continue
      seen.add(key)
      if (recordsByKey.has(key)) matched.push(key)
      else notInSession.push(raw)
    }

    if (matched.length === 0) {
      const parts = [
        `Could not match any of the ${requested.length} requested paper_ids against this session's retrieved papers.`,
        unrecognized.length ? `Unrecognized id format: ${truncateList(unrecognized)}.` : '',
        notInSession.length ? `Not found in this session: ${truncateList(notInSession)}.` : '',
        'Hint: make sure the IDs come from this session\'s paper-search results, and that process_search_results has been called.',
      ].filter(Boolean)
      return { isError: true, content: [{ type: 'text', text: parts.join('\n') }] }
    }

    try {
      deps.sendOpenBatchImport({ sessionId: deps.sessionId, recordKeys: matched })
    } catch (err) {
      return errText(`Failed to open batch-import dialog: ${err instanceof Error ? err.message : String(err)}`)
    }

    const lines = [
      `Opened the Zotero batch-import dialog with ${matched.length} paper${matched.length === 1 ? '' : 's'} preselected.`,
      notInSession.length ? `Skipped (not in this session): ${truncateList(notInSession)}.` : '',
      unrecognized.length ? `Skipped (unrecognized id format): ${truncateList(unrecognized)}.` : '',
      'The user will pick a destination collection and confirm in the dialog. Papers already linked to Zotero will be skipped by the dialog automatically.',
    ].filter(Boolean)

    return { isError: false, content: [{ type: 'text', text: lines.join('\n') }] }
  }
}

/** 生产入口：构造 SDK MCP server，供 agent-orchestrator 注入到 mcpServers */
export function createAsciZoteroMcpServer(deps: HandlerDeps) {
  const handler = createZoteroImportToolHandler(deps)
  return createSdkMcpServer({
    name: 'asci-zotero',
    version: '0.1.0',
    tools: [
      tool(
        'request_batch_import',
        [
          'Open the Zotero batch-import dialog in ASCI with the given papers preselected.',
          'Use this whenever the user asks to import retrieved papers (all / some / specific) into their Zotero library.',
          'Do NOT attempt other import paths: no Zotero connector POST, no DOI→RIS scripting, no calls to other zotero MCP write tools.',
          'Returns a summary of how many papers were preselected and which inputs were skipped; the user then picks a collection and confirms in the dialog.',
        ].join(' '),
        inputShape,
        handler,
      ),
    ],
  })
}
