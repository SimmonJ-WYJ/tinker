/**
 * 构造 <evidence-set-context> 片段给 agent-orchestrator 注入到用户消息前。
 *
 * 与 zotero-context-block 的关键差异：证据集**没有 Agent 可调的工具**，
 * 所以这里必须把内容（动机 / 成员 / 逐字引文）inline 序列化，而不是只给引用。
 * 纯函数，无 Electron 依赖，便于单测。
 *
 * 内置 prompt 统一英文（见 CLAUDE.md 核心规则）。
 */

import type { EvidenceSetDetail } from '@asci/shared'

/** 每个证据集最多注入的引文条数；超出截断并标注省略数，避免撑爆 prompt。 */
const MAX_QUOTES_PER_SET = 20
/** 单条引文最多字符数；超出按字符截断并加省略号。 */
const MAX_QUOTE_CHARS = 600

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}…`
}

/** 论文署名：>3 人折叠为 "First et al."，否则逗号连接。 */
function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return ''
  if (authors.length > 3) return `${authors[0]} et al.`
  return authors.join(', ')
}

export function buildEvidenceSetContextBlock(
  details: EvidenceSetDetail[],
): string | null {
  if (details.length === 0) return null

  const lines: string[] = ['<evidence-set-context>']
  lines.push(
    'The user referenced the following evidence set(s) in this message. Each set is a curated collection of verbatim excerpts gathered around a topic. There is no tool to fetch an evidence set, so use the content inlined below directly as grounded context. For member papers with a zoteroKey you may read the PDF (via Read) or query Zotero by that key for full text.',
  )

  for (const detail of details) {
    const name = detail.set.name?.trim() || 'Untitled evidence set'
    lines.push('')
    lines.push(`<evidence-set name="${name}" id="${detail.set.id}">`)

    const motivation = detail.note?.body?.trim()
    if (motivation) lines.push(`Motivation: ${clip(motivation, MAX_QUOTE_CHARS)}`)

    // 成员论文：标题 + 署名 + 年份 + zoteroKey（供 Agent 读 PDF / 查 Zotero）
    if (detail.memberPapers.length > 0) {
      lines.push('<papers>')
      for (const p of detail.memberPapers) {
        const byline = [formatAuthors(p.authors), p.year ? String(p.year) : '']
          .filter(Boolean)
          .join(' · ')
        const keyPart = p.zoteroKey ? ` · zoteroKey=${p.zoteroKey}` : ''
        const bylinePart = byline ? ` · ${byline}` : ''
        lines.push(`- "${p.title}"${bylinePart}${keyPart}`)
      }
      lines.push('</papers>')
    }

    // 成员综述：仅标题
    if (detail.memberReviews.length > 0) {
      lines.push('<reviews>')
      for (const r of detail.memberReviews) lines.push(`- "${r.title}"`)
      lines.push('</reviews>')
    }

    // 逐字引文（证据本体）：来源标签 + 派生 quote（伪引文已在查询层归一为空串，
    // issue #446 —— 不读 raw anchor，避免把用户正文冒充论文原文注入），截断 + 省略标注
    const quotes = detail.refs
      .map((rws) => {
        const text = rws.quote.trim()
        if (!text) return null
        const removed = rws.ref.source.kind === 'paper' && rws.sourcePaper.state === 'removed'
        const label = removed ? `${rws.ref.source.kind}, source removed` : rws.ref.source.kind
        return `- [${label}] "${clip(text, MAX_QUOTE_CHARS)}"`
      })
      .filter((x): x is string => x !== null)

    if (quotes.length > 0) {
      lines.push('<excerpts>')
      for (const q of quotes.slice(0, MAX_QUOTES_PER_SET)) lines.push(q)
      const omitted = quotes.length - MAX_QUOTES_PER_SET
      if (omitted > 0) lines.push(`(${omitted} more excerpt(s) omitted)`)
      lines.push('</excerpts>')
    }

    lines.push('</evidence-set>')
  }

  lines.push('</evidence-set-context>')
  return lines.join('\n')
}
