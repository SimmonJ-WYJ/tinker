/**
 * 中文文案标点守门
 *
 * 中文句子里不应夹英文半角标点：逗号 `,`、冒号 `:`、分号 `;`、单引号 `'`、双引号 `"`
 * （应分别为全角 `，` `：` `；` 和中文弯引号 `‘’` `“”`）。
 *
 * 判定规则："ASCII 标点紧邻 CJK 字符任一侧"即违规。只查与中文相邻的，
 * 因此夹在 ASCII/空格之间的语法/英文写法不会误报。
 *
 * 不会误报的边界（标点不与中文相邻）：
 * - 快捷键 `⌘,` / `Ctrl+,`
 * - 英文示例 `methods, GPT, ASCI`、`PAPER_KEY_A, PAPER_KEY_B`、CLI 参数 `-y, @...`
 * - 内嵌冒号 `localhost:3000`、`Key: Value`、`http://host:port`、`KEY=VALUE`
 * - 英文词后的冒号 `编辑 Notebook: {{path}}`（冒号紧邻 ASCII 字母，不视为违规）
 */

import { test, expect } from 'bun:test'
import { defaultResources, I18N_NAMESPACES } from './index.ts'
import { collectStringLeaves } from './test-helpers.ts'

/** 需要管控的英文半角标点 */
const ASCII_PUNCT = `,:;'"`
/** CJK 字符与上述任一英文标点相邻（任一侧）即视为违规 */
const CJK_ADJACENT_PUNCT = new RegExp(`[一-鿿][${ASCII_PUNCT}]|[${ASCII_PUNCT}][一-鿿]`)

for (const ns of I18N_NAMESPACES) {
  test(`zh 标点守门：命名空间 "${ns}" 中文文案无夹英文标点`, () => {
    const offenders = collectStringLeaves(defaultResources.zh[ns])
      .filter(([, value]) => CJK_ADJACENT_PUNCT.test(value))
      .map(([key, value]) => `${key}: ${value}`)

    expect(
      offenders,
      `命名空间 "${ns}"：以下中文文案夹了英文标点（应改全角 ，：； 或中文弯引号 “”）\n${offenders.join('\n')}`,
    ).toEqual([])
  })
}
