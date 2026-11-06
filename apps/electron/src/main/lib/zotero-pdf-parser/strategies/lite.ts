/**
 * lite 策略：复用 extractTextFromFile 抽 plain text 作为 body 返回
 *
 * 是 wiki/{key}.md 的唯一来源，下游 article-generator 直接读取此 md 走 LLM 生成
 * .article.md。本策略稳态运行，不轻易改格式。
 *
 * 结构化富格式（YAML frontmatter + OUTLINE + `<p id>`）走独立的 `.txt` 链路，
 * 见 `lib/zotero-structured-txt/`。
 */

import { extractTextFromFile } from '../../document-extractor'
import type { ParseStrategy } from './index'

export const liteStrategy: ParseStrategy = {
  name: 'lite',
  async parse({ pdfPath }) {
    const text = await extractTextFromFile(pdfPath)
    return { body: text, actualStrategy: 'lite' }
  },
}
