/**
 * structured .txt 链路的富格式 wrap
 *
 * 与 lite 的 wiki/{key}.md 输出**完全独立**，互不影响。
 *
 * 输出形态（format_version: 2）：
 *
 *   ---
 *   id: "<attachmentKey>"
 *   title: "<paper title>"
 *   authors: ["A", "B"]
 *   year: 2023
 *   tags: []
 *   source_pdf: "/abs/path.pdf"
 *   format_version: 2
 *   ---
 *
 *   # OUTLINE
 *
 *   - 1. Introduction
 *   - 2. Methods
 *   ...
 *
 *   # CONTENT
 *
 *   # 1. Introduction
 *
 *   <p id="p1_1">…</p>
 */

import type { ZoteroPdfRecord } from '@asci/shared'
import { extractAuthors, extractYear, pickRecTitle } from '../zotero-metadata'

export const STRUCTURED_TXT_FORMAT_VERSION = 2

export interface WrapStructuredInput {
  rec: ZoteroPdfRecord
  pdfPath: string
  /** classifier+formatter 产出的顶层 section 列表（含 "N. xxx" 前缀） */
  outline: string[]
  /** formatter 产出的富 markdown body（含 multi-level heading + `<p id="pS_P">`） */
  body: string
}

function escapeString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function formatFlowArray(values: string[]): string {
  if (values.length === 0) return '[]'
  return `[${values.map((v) => `"${escapeString(v)}"`).join(', ')}]`
}

function buildFrontmatter(rec: ZoteroPdfRecord, pdfPath: string): string {
  const title = pickRecTitle(rec)
  const authors = extractAuthors(rec.parent)
  const year = extractYear(rec.parent)
  return [
    '---',
    `id: "${escapeString(rec.attachmentKey)}"`,
    `title: "${escapeString(title)}"`,
    `authors: ${formatFlowArray(authors)}`,
    `year: ${year ?? 'null'}`,
    `tags: []`,
    `source_pdf: "${escapeString(pdfPath)}"`,
    `format_version: ${STRUCTURED_TXT_FORMAT_VERSION}`,
    '---',
  ].join('\n')
}

function buildOutlineBlock(outline: string[]): string {
  if (outline.length === 0) {
    return '# OUTLINE\n\n_（无章节）_'
  }
  return ['# OUTLINE', '', ...outline.map((s) => `- ${s}`)].join('\n')
}

export function wrapAsStructuredTxt({ rec, pdfPath, outline, body }: WrapStructuredInput): string {
  const fm = buildFrontmatter(rec, pdfPath)
  const outlineBlock = buildOutlineBlock(outline)
  return [fm, '', outlineBlock, '', '# CONTENT', '', body.trimEnd()].join('\n') + '\n'
}
