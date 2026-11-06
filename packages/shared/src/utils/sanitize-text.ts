/**
 * 论文标题 / 摘要文本清洗：统一去脏逻辑，作唯一真相源（display + source 两层共用）。
 *
 * 历史上渲染层 stripHtmlTags 只剥标签、数据层 decodeXml / stripMarkup 各自为政
 * （decodeXml 仅覆盖 Atom XML 路径、stripMarkup 不解实体、Zotero summarizer 原样
 * 拷贝），导致用户可见三类脏数据：
 *   1. HTML 实体直显 —— 如 `&amp;ndash;`（双重编码：先 `&amp;`→`&`，剩 `&ndash;`
 *      应为 `–`）；
 *   2. 诡异控制 / 不可见字符 —— 零宽、bidi、NUL 等夹在词中间；
 *   3. JATS / XML 标签直显 —— 如摘要里的 `<jats:p>`（出版商抓取常见）。
 *
 * 处理顺序：块级标签→空格（保段落边界）→ 内联标签零宽剥 → 迭代解实体（处理双重编码）
 * → 再剥一次标签（堵 `&lt;i&gt;` 解出 `<i>` 的重引入洞）→ 去控制 / 不可见 / bidi
 * 字符 → 折叠空白 → trim。
 *
 * **永不丢文本节点**：标签被剥但其内文本保留。块级标签（`<p>`/`<jats:p>`/`<br>`...）
 * 替换为空格，避免 `<jats:p>A</jats:p><jats:p>B</jats:p>` 把相邻段落词粘连成 `AB`
 * （正确得 `A B`）；内联标签（`<i>`/`<sub>`...）零宽剥除，不在词内插空格。
 *
 * 幂等：sanitizeText(sanitizeText(x)) === sanitizeText(x)。
 */

// 常见出版商具名实体表（键不含 & 与 ;）。未知具名原样保留，不丢数据。
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  deg: '°',
  times: '×',
  minus: '−',
  plusmn: '±',
  micro: 'µ',
  copy: '©',
  reg: '®',
  trade: '™',
}

// 块级 / 分隔语义标签：剥除时替换为空格，保段落与列表项边界（避免相邻文本节点粘连）。
// 含 JATS 段落 `<jats:p>` / 章节 `<jats:sec>` 等出版商摘要常见块级标签。
const BLOCK_TAG_RX =
  /<\/?(?:p|div|br|hr|li|ul|ol|dd|dt|dl|tr|td|th|thead|tbody|table|section|article|header|footer|h[1-6]|blockquote|pre|figure|figcaption|jats:p|jats:sec|jats:title|jats:list|jats:list-item)\b[^>]*\/?>/gi

// 其余（内联）标签正则：复用历史上 stripHtmlTags / stripMarkup 的同款式，零宽剥除
// （`<i>`/`<sub>` 等不在词内插空格，保 `A<sub>2</sub>` → `A2`）。
const TAG_RX = /<\/?[a-zA-Z][^>]*>/g

// 控制 / 不可见 / bidi 字符类（全部用 \u 转义，避免源码里嵌裸控制符；保留 \t \n 交给空白折叠步）：
//   C0 除 \t \n: \u0000-\u0008 \u000B \u000C \u000E-\u001F
//   DEL + C1:      \u007F-\u009F
//   软连字符:       \u00AD
//   零宽 / joiner / 方向标记: \u200B-\u200F
//   bidi 嵌入 / 覆盖:        \u202A-\u202E
//   bidi isolate:           \u2066-\u2069
//   BOM / 零宽不换行空格:    \uFEFF
//   替换符 / 非字符(上游解码失败残留的 � 等，应剥): \uFFFD-\uFFFF
const INVISIBLE_RX =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\uFFFD-\uFFFF]/g

// 安全码点转字符：越界 / 非法 → ''（用于过滤实体里编码的控制符，如 &#x1F;）。
function safeCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return ''
  try {
    return String.fromCodePoint(cp)
  } catch {
    return ''
  }
}

// 单趟解码：十六进制数字 → 十进制数字 → 具名。双重编码由外层迭代收敛。
function decodeOnce(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name: string) => {
      const mapped = NAMED_ENTITIES[name]
      return mapped !== undefined ? mapped : m
    })
}

// 剥标签：先块级→空格（保边界），再内联→零宽。两步内联调用复用，避免重复逻辑。
function stripTags(s: string): string {
  return s.replace(BLOCK_TAG_RX, ' ').replace(TAG_RX, '')
}

/**
 * 清洗标题 / 摘要文本。null / undefined / 空 → ''（占位符 fallback 由调用方接管）。
 */
export function sanitizeText(text: string | null | undefined): string {
  if (!text) return ''
  let s = String(text)
  // 1. 剥 HTML/XML 标签（块级→空格、内联→零宽）
  s = stripTags(s)
  // 2. 迭代解实体（双重编码 `&amp;ndash;` → `&ndash;` → `–`）。上限 5 趟防死循环，
  //    每趟若无变化即停。
  for (let i = 0; i < 5; i++) {
    const next = decodeOnce(s)
    if (next === s) break
    s = next
  }
  // 3. 解码后可能重现标签（`&lt;i&gt;` → `<i>`），再剥一次
  s = stripTags(s)
  // 4. 去控制 / 不可见 / bidi
  s = s.replace(INVISIBLE_RX, '')
  // 5. 折叠空白 + trim
  s = s.replace(/\s+/g, ' ').trim()
  return s
}
