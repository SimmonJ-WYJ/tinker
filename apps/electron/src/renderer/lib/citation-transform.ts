/**
 * 综述 [N]<quote>...</quote> 引用语法的渲染前预处理
 *
 * skill literature-review-result 产出的 markdown 形如：
 *   Broxton 等人建立的波光学模型 [1]<quote>相关原文…</quote>。
 *
 * 需求：
 *   - 正文**隐藏** <quote>...</quote> 标签和内容
 *   - [N] 保留为可 hover 的角标，hover 时 tooltip 展示"引用原文"
 *
 * 实现策略：把 `[N]<quote>X</quote>` 重写成 markdown 链接
 *   `[[N]](#asci-cite-<base64url(X)>)`
 * 然后在 react-markdown 的 `components.a` 里识别 `#asci-cite-` 前缀，
 * 替换为 <CitationBadge>。
 *
 * 选 base64url 是因为它
 *   1. 不含 / + =（URL 安全，不被 markdown 转义）
 *   2. 能无损容纳 Unicode（引用含中文 / 标点）
 */

const CITE_PREFIX = 'asci-cite-'

/** 对 fragment 部分加 `#` 前缀（react-markdown 会把它作为 href 传入 `a` 组件） */
export const CITATION_HREF_PREFIX = `#${CITE_PREFIX}`

export function encodeQuoteToFragment(quote: string): string {
  const bytes = new TextEncoder().encode(quote)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function decodeFragmentToQuote(fragment: string): string {
  const b64 = fragment.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4
  const padded = pad ? b64 + '='.repeat(4 - pad) : b64
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    return ''
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  try {
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

/**
 * 从 a 标签 href 里解出 citation 信息
 * - 匹配 → 返回 { n, quote }
 * - 不匹配 → 返回 null（调用方按普通 <a> 渲染）
 */
export function parseCitationHref(href: string | undefined, linkText: string | undefined): { n: number; quote: string } | null {
  if (!href || !href.startsWith(CITATION_HREF_PREFIX)) return null
  const fragment = href.slice(CITATION_HREF_PREFIX.length)
  const quote = decodeFragmentToQuote(fragment)
  // linkText 形如 "[1]"，抽数字
  const m = (linkText ?? '').match(/^\[(\d+)\]$/)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return { n, quote }
}

/**
 * 把 quote 标签改写成 markdown 链接，使其在 react-markdown 里可被 `a` 组件替换为角标。
 *
 * 兼容两种顺序（LLM 输出不总是严格遵守 skill 规则，实测 qwen3.6 经常反写）：
 *   1. `[N]<quote>X</quote>` — skill 规定的规范形式
 *   2. `<quote>X</quote> [N]` — 反向形式（[N] 位于闭标签之后，可能有空白）
 *
 * 两种都改写为 `[[N]](#asci-cite-<base64url(X)>)`，保证 `[N]` 角标在视觉位置上
 * 与原文等价（规范形式的 `[N]` 在 quote 前，改后仍在前；反向形式的 `[N]` 在 quote 后，
 * 改后也还在后，因为整个 `<quote>...</quote> [N]` 被整体替换为 `[[N]](...)`）。
 *
 * 之后还有三道兜底：
 *   3. 孤儿 `<quote>X</quote>`（没配对到 [N]）→ 去掉标签保留内容（文字不丢，但没角标）
 *   4. 单边残留的 `<quote>` 或 `</quote>`（嵌套 / 跨段导致）→ 直接删掉
 *   5. 裸 `[N]`（既无 <quote> 也未已转换）→ 改写为 `[[N]](#asci-cite-)` 弱角标。
 *      LLM 经常在 §1–§6 漏写 <quote>，导致部分 [N] 既无高亮也无 hover；这道兜底让
 *      它们至少能 hover 出 §7 References 解析到的 title/authors/year，保持视觉一致。
 *      只在 §7 References 块**之外**生效，避免污染 References 列表本身的行首 [N]。
 *
 * 非贪婪匹配 `[\s\S]*?` 允许 quote 跨行，但不会跨到下一个 `</quote>` 之外。
 */
export function transformQuoteCitations(markdown: string): string {
  let out = markdown

  // Pass 1: [N]<quote>X</quote> — skill 规定的规范顺序
  out = out.replace(
    /\[(\d+)\]\s*<quote>([\s\S]*?)<\/quote>/g,
    (_match, n: string, quote: string) => renderCite(n, quote),
  )

  // Pass 2: <quote>X</quote> [N] — LLM 反向输出
  out = out.replace(
    /<quote>([\s\S]*?)<\/quote>\s*\[(\d+)\]/g,
    (_match, quote: string, n: string) => renderCite(n, quote),
  )

  // Pass 3: 孤儿 <quote>X</quote>（两侧都没 [N]）→ 保留内容，去掉标签
  out = out.replace(/<quote>([\s\S]*?)<\/quote>/g, (_match, quote: string) => quote)

  // Pass 4: 单边残留（嵌套 / 跨段导致的落单标签）→ 直接删掉
  out = out.replace(/<\/?quote>/g, '')

  // Pass 4.5: 引用块承载引文 `> 原文… [N]`（对话流主 Agent 的自然格式，#448）。
  // 把块尾 [N] 转成带 quote 的角标 → 点击不仅打开 PDF 还高亮该句；引用块文本保留可见。
  out = transformBlockquoteCitations(out)

  // Pass 5: 裸 [N] → 弱角标（仅 §7 References 块之外）
  out = transformBareCitationsOutsideReferences(out)

  return out
}

/**
 * 把"引用块行尾的 [N]"转成带 quote 的角标。
 *   `> Verbatim sentence from the paper. [2]`
 * → `> Verbatim sentence from the paper. [[2]](#asci-cite-<base64url(句子)>)`
 * 仅匹配以 `>` 开头、行尾恰为 `[N]` 的单行引用块；quote 取 `>` 与 `[N]` 之间的正文。
 * 必须在 Pass 5 之前跑，否则块尾 [N] 会先被当成无 quote 的弱角标。
 */
function transformBlockquoteCitations(text: string): string {
  return text.replace(
    /^(>[ \t]?)(.*?)\s*\[(\d+)\][ \t]*$/gm,
    (_match, prefix: string, quote: string, n: string) => {
      const trimmed = quote.trim()
      if (!trimmed) return _match
      return `${prefix}${quote} ${renderCite(n, trimmed)}`
    },
  )
}

function renderCite(n: string, quote: string): string {
  const trimmed = quote.trim()
  if (!trimmed) return `[${n}]`
  const fragment = encodeQuoteToFragment(trimmed)
  return `[[${n}]](${CITATION_HREF_PREFIX}${fragment})`
}

/** 同 citation-references.ts 的边界检测，独立写避免循环依赖；编号（含 §）可有可无（#448） */
const REFERENCES_HEADING_RE = /^#{1,6}\s+§?\s*\d*\.?\s*References?\b.*$/im
const NEXT_HEADING_RE = /^#{1,6}\s+\S/m

function transformBareCitationsOutsideReferences(text: string): string {
  const headingMatch = REFERENCES_HEADING_RE.exec(text)
  if (!headingMatch || headingMatch.index === undefined) {
    return transformBareCitations(text)
  }
  const refsStart = headingMatch.index
  const afterHeadingOffset = refsStart + headingMatch[0].length
  const nextMatch = NEXT_HEADING_RE.exec(text.slice(afterHeadingOffset))
  const refsEnd = nextMatch ? afterHeadingOffset + nextMatch.index : text.length

  const before = text.slice(0, refsStart)
  const refsBlock = text.slice(refsStart, refsEnd)
  const after = text.slice(refsEnd)
  return transformBareCitations(before) + refsBlock + transformBareCitations(after)
}

/**
 * 跳过四类已经是合法 markdown 结构的 [N]：
 *   - `[[N]](...)` — pass 1/2 已转换，inner [N] 前面是 `[`（同字符分支）
 *   - `[link text][N]` — 引用式链接目标（preceding `]` 来自非纯数字的 link text）
 *   - `[N]: url` — 引用式链接定义
 *   - `[N](url)` — 行内链接
 *
 * 用 replace 回调内手动检查上下文，比纯正则 lookbehind/lookahead 更稳（JS 引擎
 * 对变长 lookbehind 支持不一致，且组合 `[16][17]` 的连写情况无法用单一 lookbehind 分辨）。
 */
function transformBareCitations(text: string): string {
  return text.replace(/\[(\d+)\]/g, (match, n: string, offset: number) => {
    if (typeof offset !== 'number') return match
    if (isInsideAlreadyTransformedLink(text, offset)) return match
    if (isReferenceStyleLinkTarget(text, offset)) return match
    if (isLinkDefinitionOrInlineLink(text, offset, match.length)) return match
    return `[[${n}]](${CITATION_HREF_PREFIX})`
  })
}

/** 已转换形式 `[[N]](...)` 的 inner `[N]`：前一个字符是 `[` */
function isInsideAlreadyTransformedLink(s: string, offset: number): boolean {
  return offset > 0 && s.charAt(offset - 1) === '['
}

/**
 * 引用式链接 `[link text][N]`：紧邻前面是 `]`，且其匹配的 `[` 内容**非纯数字**
 * （纯数字 `[1][2]` 是连写引用，应当转换；带文字 `[caption][1]` 是引用式链接，跳过）。
 */
function isReferenceStyleLinkTarget(s: string, offset: number): boolean {
  if (offset === 0 || s.charAt(offset - 1) !== ']') return false
  let depth = 1
  for (let i = offset - 2; i >= 0; i--) {
    const c = s.charAt(i)
    if (c === ']') depth++
    else if (c === '[') {
      depth--
      if (depth === 0) {
        const inside = s.slice(i + 1, offset - 1)
        return !/^\d+$/.test(inside)
      }
    }
  }
  return false
}

/** `[N]: url`（链接定义）或 `[N](url)`（行内链接） */
function isLinkDefinitionOrInlineLink(s: string, offset: number, matchLen: number): boolean {
  const after = s.slice(offset + matchLen)
  if (after.startsWith('(')) return true
  if (/^\s*:\s/.test(after)) return true
  return false
}
