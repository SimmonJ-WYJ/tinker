/**
 * 公共：把 record metadata + body 文本包成 wiki/{key}.md 的最终落地形态
 *
 * 输出形态（v1，单一格式，下游 article-generator 已适配，不可随意改）：
 *
 *   # {title}
 *
 *   > attachmentKey: `xxx`
 *   > parentItemKey: `xxx`
 *   > filename: `xxx.pdf`
 *   > source: `/abs/xxx.pdf`
 *   > parsedAt: ISO
 *   > length: NNNN chars
 *   > strategy: lite
 *
 *   ---
 *
 *   {plain text body}
 *
 * structured 富格式（YAML frontmatter + OUTLINE + `<p id>`）走独立 .txt 链路
 * 在 `lib/zotero-structured-txt/` 里产出，与本 wrap 无关。
 */

import type { ZoteroPdfActualStrategy, ZoteroPdfRecord } from '@asci/shared'
import { nowIso } from '@asci/shared'

export interface WrapInput {
  rec: ZoteroPdfRecord
  pdfPath: string
  /** 解析出来的正文（lite 直出 plain text） */
  body: string
  /** 写入 metadata header 的策略名 */
  actualStrategy: ZoteroPdfActualStrategy
}

export function wrapAsMarkdown({ rec, pdfPath, body, actualStrategy }: WrapInput): string {
  const title = rec.title || rec.filename || rec.attachmentKey
  const trimmed = body.trim()
  const lines = [
    `# ${title}`,
    '',
    `> attachmentKey: \`${rec.attachmentKey}\`  `,
    `> parentItemKey: \`${rec.parentItemKey ?? 'none'}\`  `,
    `> filename: \`${rec.filename}\`  `,
    `> source: \`${pdfPath}\`  `,
    `> parsedAt: ${nowIso()}  `,
    `> length: ${trimmed.length} chars  `,
    `> strategy: ${actualStrategy}`,
    '',
    '---',
    '',
    trimmed,
  ]
  return lines.join('\n')
}
