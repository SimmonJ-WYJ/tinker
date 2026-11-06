/**
 * token-parity.test.ts — ADR-003 B-8：守门 design.md ↔ tokens.css 漂移
 *
 * 双向严格：
 *   - tokens.css 全部 --xxx 必须在 docs/design.md 至少出现一次（命名严格匹配）
 *   - docs/design.md 引用的 --xxx 必须在 tokens.css 真实定义，DOC_ONLY_ALLOWLIST 豁免反例 / 讨论
 *
 * 任一断言失败则 `bun test` 红、CI 红。
 * 新增 token 时同步在 design.md 对应章节补表格 + 示例即可解锁。
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '..')
const CSS_PATH = join(REPO_ROOT, 'apps/electron/src/renderer/styles/tokens.css')
const DOC_PATH = join(REPO_ROOT, 'docs/design.md')

/**
 * DOC_ONLY_ALLOWLIST — design.md 中允许出现但不在 tokens.css 定义的 token。
 *
 * - `--red`：§3.1 反例引用（"用 `--destructive` 不用 `--red`"），不该被定义
 * - `--brand`：§13 未来待引入讨论占位；未来真正引入 brand token 时移除本条
 * - `--xxx`：§3.1 占位符示例（`hsl(var(--xxx) / <alpha-value>)`）
 * - `--diff` / `--search-hit` / `--choice` / `--code-container`：§2 引用 token 族
 *   时用 `--diff-*` / `--search-hit-*` 等通配前缀，正则只能匹配到不含通配的前缀部分
 * - `--tw-ring-color`：§9 反模式说明引用的 Tailwind 内置变量（focus ring 全局抹平机制，
 *   `html :focus-visible { --tw-ring-color: transparent }`），非 ASCI token，不在 tokens.css 定义
 */
const DOC_ONLY_ALLOWLIST = new Set([
  '--red',
  '--brand',
  '--xxx',
  '--diff',
  '--search-hit',
  '--choice',
  '--code-container',
  '--tw-ring-color',
])

const TOKEN_REGEX = /--([a-z][a-z0-9-]*[a-z0-9])/g

function extractTokens(content: string): Set<string> {
  const matches = Array.from(content.matchAll(TOKEN_REGEX))
  return new Set(matches.map((m) => `--${m[1]}`))
}

describe('design.md ↔ tokens.css 双向 parity（ADR-003 B-8 守门）', () => {
  const cssContent = readFileSync(CSS_PATH, 'utf-8')
  const docContent = readFileSync(DOC_PATH, 'utf-8')
  const cssTokens = extractTokens(cssContent)
  const docTokens = extractTokens(docContent)

  test('tokens.css 全部 token 必须在 design.md 至少出现一次', () => {
    const missingInDoc = [...cssTokens].filter((t) => !docTokens.has(t)).sort()
    if (missingInDoc.length > 0) {
      throw new Error(
        `以下 ${missingInDoc.length} 个 token 在 tokens.css 定义但 docs/design.md 未文档化：\n` +
          missingInDoc.map((t) => `  - ${t}`).join('\n') +
          '\n\n请在 docs/design.md 对应章节补充说明（默认色 / 用途 / 示例）。',
      )
    }
    expect(missingInDoc).toEqual([])
  })

  test('design.md 引用的 token 必须在 tokens.css 定义（DOC_ONLY_ALLOWLIST 豁免）', () => {
    const undefinedInCss = [...docTokens]
      .filter((t) => !cssTokens.has(t) && !DOC_ONLY_ALLOWLIST.has(t))
      .sort()
    if (undefinedInCss.length > 0) {
      throw new Error(
        `以下 ${undefinedInCss.length} 个 token 在 docs/design.md 引用但 tokens.css 未定义：\n` +
          undefinedInCss.map((t) => `  - ${t}`).join('\n') +
          '\n\n如属反例 / 未来待引入讨论，请加入 DOC_ONLY_ALLOWLIST；否则在 tokens.css 补定义。',
      )
    }
    expect(undefinedInCss).toEqual([])
  })
})
