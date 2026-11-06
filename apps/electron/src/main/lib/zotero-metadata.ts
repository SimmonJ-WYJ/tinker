/**
 * Zotero record / parent item 的 metadata 派生工具
 *
 * 多处需要从 `ZoteroPdfRecord` / `ZoteroParentItemInfo` 提取
 * "title / authors / year"，集中到这里避免重复实现。
 *
 * 使用方：
 * - `zotero-pdf-parser/strategies/wrap.ts`（写 wiki md 的 YAML frontmatter）
 * - `zotero-article-generator/worker.ts`（写 article.md 的 frontmatter，覆盖 LLM 输出）
 * - `zotero-pdf-parser/index-writer.ts`（wiki/index.json 摘要）
 */

import type { ZoteroParentItemInfo, ZoteroPdfRecord } from '@asci/shared'

/**
 * 选 record 的 title：优先 parent.title → record.title → filename
 *
 * filename 是最不可靠的来源（"author 等 - 2023 - Title.pdf" 拼接），仅在前两者为空时兜底。
 */
export function pickRecTitle(rec: ZoteroPdfRecord): string {
  if (rec.parent?.title && rec.parent.title.trim().length > 0) return rec.parent.title.trim()
  if (rec.title && rec.title.trim().length > 0) return rec.title.trim()
  return rec.filename
}

/**
 * 把 Zotero creators 折成 "First Last" 字符串数组
 *
 * 只取 creatorType === 'author'；机构作者（仅 name 字段）原样输出。
 * 这是面向人类读者 / LLM 的格式；wiki/index.json 还有另一种 "Last, First" 格式
 * （见 index-writer.foldAuthors），用于程序化排序，二者并存。
 */
export function extractAuthors(parent: ZoteroParentItemInfo | null): string[] {
  if (!parent) return []
  return parent.creators
    .filter((c) => c.creatorType === 'author')
    .map((c) => {
      if (c.name && c.name.trim().length > 0) return c.name.trim()
      const f = (c.firstName ?? '').trim()
      const l = (c.lastName ?? '').trim()
      return `${f} ${l}`.trim()
    })
    .filter((s) => s.length > 0)
}

/**
 * 从 parent.date 抽 4 位年份；超出合理范围（1800-2100）的视为脏数据返回 null
 *
 * 返回数字而非字符串，方便 frontmatter 序列化时直接 number。
 */
export function extractYear(parent: ZoteroParentItemInfo | null): number | null {
  if (!parent?.date) return null
  const m = /\b(\d{4})\b/.exec(parent.date)
  if (!m) return null
  const y = parseInt(m[1] ?? '', 10)
  if (!Number.isFinite(y) || y < 1800 || y > 2100) return null
  return y
}
