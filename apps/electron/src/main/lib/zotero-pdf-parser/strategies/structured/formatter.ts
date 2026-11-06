/**
 * structured 策略 · 第 3 步：富 markdown 拼接器
 *
 * 输入：classifier 输出的 token 流（含 sectionNumber / paragraphIndex / level）
 * 输出：
 *   {
 *     outline: string[],   // 顶层 section 标题数组（用于 wrap 写 `# OUTLINE` 块）
 *     body:    string      // markdown 正文：多级 heading + `<p id="pS_P">` 段落 + 列表
 *   }
 *
 * 关键行为：
 *  - 顶层 section heading 渲染为 `# {N}. {title}`（强制带 "N." 前缀，N = sectionNumber）
 *  - 子级 heading 渲染为 `## {rawNumber} {title}` / `### {rawNumber} {title}`（保留原编号）
 *  - 非编号 heading（"Abstract"、"References"）按 level 渲染，不加编号
 *  - 段落用 `<p id="p{S}_{P}">…</p>` 包；同段多 text token 合并到一个 `<p>` 内
 *    - 跨行 "exam-\nple" 还原；CJK 行间不补空格
 *  - 列表打成 `- xxx` / `1. xxx`，**不**塞 `<p id>`
 *  - sectionNumber=0 的段落（首个 heading 出现前的 preamble）用 `<p id="p0_X">`，
 *    不出现在 OUTLINE
 */

import type { HeadingToken, TextToken, Token } from './classifier'

/**
 * 把同一个 `<p>` 内的多行 text token 拼成最终内容。
 *
 * 设计原则：**不强行格式化**。
 * - 保留 PDF 原有的视觉换行（用 `\n` 隔开），不把所有行强行用空格连成一行 ——
 *   这样参考文献、长公式块、代码引用等"复杂结构"在 `<p>` 内仍然可读
 * - 仅做一项启发式还原：跨行单词的连字符（"exam-\nple" → "example"），
 *   这是排版伪结构，不还原会污染搜索 / 拷贝
 */
function joinParagraph(lines: string[]): string {
  if (!lines.length) return ''
  let out = lines[0]!
  for (let i = 1; i < lines.length; i++) {
    const prev = out
    const cur = lines[i]!
    const curFirst = cur[0] ?? ''
    // 行尾 "-" + 下一行小写字母 → 单词被排版断开，无缝接回不留换行
    if (prev.endsWith('-') && /^[a-z]/.test(curFirst)) {
      out = prev.slice(0, -1) + cur
    } else {
      // 其余情况一律保留原换行，让原文复杂格式（list / 引用 / 多行公式）原样呈现
      out = prev + '\n' + cur
    }
  }
  return out
}

function renderHeading(h: HeadingToken): string {
  // Preamble（sectionNumber=0）：题外区域（标题 / 装饰大字号块），
  // 启发式难以稳定区分时一律原文输出 —— 不加 `#`、不加章节号
  if (h.sectionNumber === 0) {
    return h.text
  }
  const hashes = '#'.repeat(Math.max(1, Math.min(6, h.level)))
  // level=1 且属于真实 section（sectionNumber>0）：强制 "N." 前缀
  if (h.level === 1) {
    return `${hashes} ${h.sectionNumber}. ${h.text}`
  }
  // 子级 heading：保留原始 rawNumber（"1.1"、"1.1.1"），无 rawNumber 则纯标题
  if (h.rawNumber) {
    return `${hashes} ${h.rawNumber} ${h.text}`
  }
  return `${hashes} ${h.text}`
}

function renderParagraph(section: number, index: number, lines: string[]): string {
  const text = joinParagraph(lines)
  return `<p id="p${section}_${index}">${text}</p>`
}

export interface FormatResult {
  /** 顶层 section 标题数组（含 "N. xxx" 前缀），用于 `# OUTLINE` 块 */
  outline: string[]
  body: string
}

export function format(tokens: Token[]): FormatResult {
  const blocks: string[] = []
  const outline: string[] = []

  // 当前段落 buffer：(section, index, text-lines)
  let curPara: { section: number; index: number; lines: string[] } | null = null
  // 列表 buffer
  let curList: { kind: 'list' | 'ordered'; items: string[] } | null = null

  const flushParagraph = () => {
    if (curPara && curPara.lines.length) {
      blocks.push(renderParagraph(curPara.section, curPara.index, curPara.lines))
    }
    curPara = null
  }
  const flushList = () => {
    if (curList) {
      const lines = curList.items.map((t, i) =>
        curList!.kind === 'ordered' ? `${i + 1}. ${t}` : `- ${t}`,
      )
      blocks.push(lines.join('\n'))
      curList = null
    }
  }

  for (const tok of tokens) {
    switch (tok.kind) {
      case 'blank':
        flushParagraph()
        flushList()
        break
      case 'heading': {
        flushParagraph()
        flushList()
        blocks.push(renderHeading(tok))
        // 仅"真·顶层 section"（sectionNumber > 0 且 level=1）进 OUTLINE；
        // 论文标题 / 装饰大字号块（sectionNumber=0）不入
        if (tok.level === 1 && tok.sectionNumber > 0) {
          outline.push(`${tok.sectionNumber}. ${tok.text}`)
        }
        break
      }
      case 'list': {
        flushParagraph()
        if (!curList || curList.kind !== 'list') {
          flushList()
          curList = { kind: 'list', items: [] }
        }
        curList.items.push(tok.text)
        break
      }
      case 'ordered': {
        flushParagraph()
        if (!curList || curList.kind !== 'ordered') {
          flushList()
          curList = { kind: 'ordered', items: [] }
        }
        curList.items.push(tok.text)
        break
      }
      case 'text': {
        flushList()
        const t = tok as TextToken
        // Preamble（section=0）：每个 text token 单独成块 —— 不合并、不加 `<p>` 标签
        // 这样 cover page 作者、机构、奇怪的引用脚注等"难以稳定结构化的区域"原文展示
        if (t.sectionNumber === 0) {
          flushParagraph()
          blocks.push(t.text)
          break
        }
        // 真实 section：同段 (section, paragraphIndex) → 追加到当前 buffer；
        // 否则 flush 旧段、开新 buffer
        if (
          curPara &&
          curPara.section === t.sectionNumber &&
          curPara.index === t.paragraphIndex
        ) {
          curPara.lines.push(t.text)
        } else {
          flushParagraph()
          curPara = { section: t.sectionNumber, index: t.paragraphIndex, lines: [t.text] }
        }
        break
      }
    }
  }
  flushParagraph()
  flushList()

  // 去掉连续空块
  const body =
    blocks.filter((b, i, a) => b !== '' || (i > 0 && a[i - 1] !== '')).join('\n\n') + '\n'

  return { outline, body }
}
