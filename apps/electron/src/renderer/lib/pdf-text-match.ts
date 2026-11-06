/**
 * PDF 文本鲁棒匹配（综述 quote ↔ pdfjs textContent）
 *
 * 背景：综述 `<q>...</q>` 是 LLM 摘出的"逻辑文本"，pdfjs `getTextContent()` 给的
 * 是"布局还原文本"。两者几乎不可能逐字节相等，差异类别包括：
 *
 *   - PDF 行末连字符：`trans-\nformer` → 综述里是 `transformer`
 *   - 行内引用标记：`attention [12] yields` → 综述里是 `attention yields`
 *   - 多空格 / 换行 / NBSP 差异
 *   - 连字符家族：`-` / `–` / `—` / `−`
 *   - Unicode ligature：`ﬁ` (U+FB01) vs `fi`
 *   - 智能引号：`""''` vs `""''`
 *   - 公式/上下标：`1.5 × 10^6` 拆 7 个 item vs `1.5×10⁶`
 *
 * 三级匹配策略：
 *   Level 1：双侧归一化后 `indexOf` 精确包含（90% case）
 *   Level 2：token 化 + sliding window + 字符 bigram Sørensen–Dice 相似度
 *           阈值 ≥ 0.75 且与第二名拉开 ≥ 0.05
 *   Level 3：anchor + extend 兜底（取 quote 头/中/尾 8 token，最长精确锚定后扩展）
 *
 * 同时维护 normalized → original 字符位置反向索引（reverseIdx[k] = 原始起始下标），
 * 命中区间走 reverse index 回填到 pdfjs textContent 原始坐标。
 */

/** 单次归一化结果。 */
export interface NormalizeResult {
  /** 归一化后的小写字符串。 */
  text: string
  /**
   * normalized → original 反向索引。
   * `reverse[k]` = `text[k]` 对应原始字符串中的起始下标。
   * 长度 = `text.length + 1`，末尾哨兵 `reverse[text.length] = original.length`，
   * 便于 `[a, b)` 区间映射：`origRange = [reverse[a], reverse[b]]`。
   */
  reverse: Uint32Array
}

/** 综述 quote 在 pdfjs pageText 中的匹配结果（原始字符坐标）。 */
export interface MatchResult {
  /** `exact` = 归一化后精确包含；`fuzzy` = Dice / anchor 匹配 */
  mode: 'exact' | 'fuzzy'
  /** 在原始 pageText 中的起始位置（含） */
  origStart: number
  /** 在原始 pageText 中的结束位置（不含） */
  origEnd: number
  /** fuzzy 模式的 Dice 分数；exact 为 1 */
  score: number
}

const CITATION_MARKER_RE = /^\[\s*\d+(?:\s*[,–—\-]\s*\d+)*\s*\]/
const DASH_FAMILY_RE = /[‐‑‒–—―−]/
const SINGLE_QUOTE_RE = /[‘’‚‛]/
const DOUBLE_QUOTE_RE = /[“”„‟]/
const LETTER_RE = /\p{L}/u
const WHITESPACE_RE = /[\s ]/
const HYPHEN_LIKE = new Set(['-', '‐', '‑'])

/**
 * 归一化字符串：NFKC + 小写 + 行末连字符复原 + 引用标记移除 + dash/智能引号统一
 * + 空白塌缩 + trim。**保留** normalized→original 反向索引。
 *
 * 单次顺序扫描；遇 ligature `ﬁ` 会通过 NFKC 展开为 `fi`，两个输出字符均指向同一源下标。
 */
export function normalize(input: string): NormalizeResult {
  const out: string[] = []
  const reverse: number[] = []
  let i = 0
  let lastWasSpace = true // 行首 leading space 视为已有，避免开头插空格

  while (i < input.length) {
    const c = input[i]!

    // 1) 引用标记 `[12]` / `[1, 2]` / `[1-3]` 整体跳过
    if (c === '[') {
      const m = input.slice(i, Math.min(i + 64, input.length)).match(CITATION_MARKER_RE)
      if (m) {
        i += m[0].length
        continue
      }
    }

    // 2) 行末断词连字符：`letter-` + **含换行**的空白 + `letter` → 直接拼接
    //    必须含 \n / \r 才合并：避免误伤 `state- of-the-art` 这种"分隔符 hyphen +
    //    空格"型；PDF 真实的 EOL 断词总是带换行符。
    if (HYPHEN_LIKE.has(c) && i > 0 && i + 1 < input.length) {
      const prev = input[i - 1]!
      if (LETTER_RE.test(prev)) {
        let j = i + 1
        let hasNewline = false
        while (j < input.length && WHITESPACE_RE.test(input[j]!)) {
          if (input[j] === '\n' || input[j] === '\r') hasNewline = true
          j++
        }
        if (hasNewline && j < input.length && LETTER_RE.test(input[j]!)) {
          // 跳过 `- + 空白`，下一轮处理 input[j]
          i = j
          continue
        }
      }
    }

    // 3) dash 家族 → '-'
    if (DASH_FAMILY_RE.test(c)) {
      pushChar(out, reverse, '-', i)
      lastWasSpace = false
      i++
      continue
    }

    // 4) 智能引号 → ASCII
    if (SINGLE_QUOTE_RE.test(c)) {
      pushChar(out, reverse, "'", i)
      lastWasSpace = false
      i++
      continue
    }
    if (DOUBLE_QUOTE_RE.test(c)) {
      pushChar(out, reverse, '"', i)
      lastWasSpace = false
      i++
      continue
    }

    // 5) 空白塌缩（NBSP / TAB / 换行均视同空格；连续多空格 → 单空格）
    if (WHITESPACE_RE.test(c)) {
      if (!lastWasSpace) {
        pushChar(out, reverse, ' ', i)
        lastWasSpace = true
      }
      i++
      continue
    }

    // 6) 一般字符：NFKC + lowercase；ligature 展开后多输出几个，全指回同一源下标
    const expanded = c.normalize('NFKC').toLowerCase()
    for (const nc of expanded) {
      pushChar(out, reverse, nc, i)
    }
    lastWasSpace = false
    i++
  }

  // trim 尾部空格
  while (out.length > 0 && out[out.length - 1] === ' ') {
    out.pop()
    reverse.pop()
  }

  // 末尾哨兵：reverse[len] = input.length，区间映射用
  reverse.push(input.length)

  return {
    text: out.join(''),
    reverse: Uint32Array.from(reverse),
  }
}

function pushChar(out: string[], reverse: number[], c: string, orig: number): void {
  out.push(c)
  reverse.push(orig)
}

/**
 * 归一化坐标区间 → 原始坐标区间。
 *
 * `origRange = [reverse[a], reverse[b]]` —— b 是 normalized end (exclusive)，
 * `reverse[b]` 给出下一个归一化字符在原始的起始下标，刚好等价 "原始 end"。
 * 边界：a == b → 空区间；b > reverse.length-1 → 截到 reverse 末尾。
 */
export function normalizedRangeToOriginal(
  res: NormalizeResult,
  a: number,
  b: number,
): { origStart: number; origEnd: number } {
  const maxIdx = res.reverse.length - 1
  const clampedA = Math.max(0, Math.min(a, maxIdx))
  const clampedB = Math.max(clampedA, Math.min(b, maxIdx))
  return {
    origStart: res.reverse[clampedA]!,
    origEnd: res.reverse[clampedB]!,
  }
}

/** Level 1：归一化后精确包含。命中返回原始坐标。 */
export function findExactMatch(pageText: string, quote: string): MatchResult | null {
  if (!quote.trim()) return null
  const pn = normalize(pageText)
  const qn = normalize(quote)
  if (!qn.text) return null
  const idx = pn.text.indexOf(qn.text)
  if (idx === -1) return null
  const { origStart, origEnd } = normalizedRangeToOriginal(pn, idx, idx + qn.text.length)
  return { mode: 'exact', origStart, origEnd, score: 1 }
}

/** token 化结果（normalized 坐标） */
interface Token {
  /** token 字符串（已归一化） */
  text: string
  /** 在 normalized 文本中的起始下标 */
  start: number
  /** 在 normalized 文本中的结束下标（exclusive） */
  end: number
}

const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu

/** 把 normalized 文本拆 token；丢弃 length < 2 的（噪声 + 减少匹配偏移） */
function tokenize(normText: string): Token[] {
  const out: Token[] = []
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(normText)) !== null) {
    if (m[0].length >= 2) {
      out.push({ text: m[0], start: m.index, end: m.index + m[0].length })
    }
  }
  return out
}

/** 字符 bigram 集合。串短于 2 → 单元素集合。 */
function charBigrams(s: string): Set<string> {
  const set = new Set<string>()
  if (s.length < 2) {
    if (s.length === 1) set.add(s)
    return set
  }
  for (let i = 0; i < s.length - 1; i++) {
    set.add(s.slice(i, i + 2))
  }
  return set
}

/** Sørensen–Dice 系数：`2|A∩B| / (|A|+|B|)`，A/B 同为空时返回 0。 */
function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  // 遍历较小的集合，减少 has() 次数
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const x of small) if (large.has(x)) inter++
  return (2 * inter) / (a.size + b.size)
}

const DICE_THRESHOLD = 0.75
const DICE_AMBIGUITY_MARGIN = 0.05

/**
 * Level 2：token-window + 字符 bigram Dice 模糊匹配。
 *
 * 算法：
 *   1. 双方 tokenize
 *   2. 取 quote 全部 tokens 拼成参考串（空格连接），算 bigram 集
 *   3. 在 page tokens 上滑 `m = Qtokens.length` 大小的窗口，步长 1
 *   4. 对每个窗口取 token 串、算 bigram、与参考串做 Dice
 *   5. 取最高分窗口；要求 best ≥ DICE_THRESHOLD 且 best - second ≥ DICE_AMBIGUITY_MARGIN
 *   6. 命中 → 原始坐标 = 窗口首/末 token 的 normalized 坐标 → reverseIdx 回填
 *
 * 复杂度：O(W × m_chars) where W ≈ |Tp|, m_chars ≈ quote 字符数；
 *         一页 ~3K 字符 × ~300 bigram ≈ 1M 操作，浏览器单页 < 20ms 可接受。
 */
export function findDiceMatch(pageText: string, quote: string): MatchResult | null {
  if (!quote.trim()) return null
  const pn = normalize(pageText)
  const qn = normalize(quote)
  const Qtokens = tokenize(qn.text)
  const Ptokens = tokenize(pn.text)
  const m = Qtokens.length
  if (m === 0 || Ptokens.length < m) return null

  const qStr = Qtokens.map((t) => t.text).join(' ')
  const qBigrams = charBigrams(qStr)

  // 第一遍：算所有窗口分
  const scores = new Float32Array(Ptokens.length - m + 1)
  for (let i = 0; i + m <= Ptokens.length; i++) {
    const windowStr = Ptokens.slice(i, i + m).map((t) => t.text).join(' ')
    const wBigrams = charBigrams(windowStr)
    scores[i] = diceCoefficient(qBigrams, wBigrams)
  }
  // 选 best
  let bestIdx = -1
  let bestScore = 0
  for (let i = 0; i < scores.length; i++) {
    if (scores[i]! > bestScore) {
      bestScore = scores[i]!
      bestIdx = i
    }
  }
  if (bestIdx < 0 || bestScore < DICE_THRESHOLD) return null

  // 选 second-best **非重叠** 窗口 —— 相邻 m 范围内的窗口都覆盖同一真位置，不算竞争者。
  // 没有非重叠候选 → secondScore = 0，margin check 自动通过（单峰情况）。
  let secondScore = 0
  for (let i = 0; i < scores.length; i++) {
    if (i + m <= bestIdx || i >= bestIdx + m) {
      if (scores[i]! > secondScore) secondScore = scores[i]!
    }
  }
  if (bestScore - secondScore < DICE_AMBIGUITY_MARGIN) return null

  const winStart = Ptokens[bestIdx]!.start
  const winEnd = Ptokens[bestIdx + m - 1]!.end
  const { origStart, origEnd } = normalizedRangeToOriginal(pn, winStart, winEnd)
  return { mode: 'fuzzy', origStart, origEnd, score: bestScore }
}

const ANCHOR_TOKEN_COUNT = 8

/**
 * Level 3：anchor + extend 兜底。
 *
 * 在 quote 中取头/中/尾 8 个 token 三组 anchor，分别归一化精确查找 page；
 * 命中 anchor 数最多者为定位锚，从锚位左右扩展到 quote 长度（按 token 数）。
 *
 * 用途：Level 1/2 都失败时（如 quote 包含 OCR 错字、跨栏拼接错位）的最后一道，
 * 命中即视为 approx 匹配（score 给个固定 0.5，与 Dice 区分）。
 */
export function findAnchorMatch(pageText: string, quote: string): MatchResult | null {
  if (!quote.trim()) return null
  const pn = normalize(pageText)
  const qn = normalize(quote)
  const Qtokens = tokenize(qn.text)
  const Ptokens = tokenize(pn.text)
  if (Qtokens.length === 0 || Ptokens.length === 0) return null

  const anchors = pickAnchors(Qtokens, ANCHOR_TOKEN_COUNT)
  if (anchors.length === 0) return null

  // 找每个 anchor 的最佳 page 起点（token-window 精确匹配）
  let bestAnchorPos = -1
  let bestAnchorLen = 0
  let bestAnchorOffsetInQuote = 0
  for (const a of anchors) {
    const pos = findTokenSequence(Ptokens, a.tokens)
    if (pos >= 0 && a.tokens.length > bestAnchorLen) {
      bestAnchorPos = pos
      bestAnchorLen = a.tokens.length
      bestAnchorOffsetInQuote = a.offsetInQuote
    }
  }
  if (bestAnchorPos < 0) return null

  // 扩展：锚位代表 quote 中 offsetInQuote 处的位置；左右扩展直到覆盖整个 quote 长度
  const winStartIdx = Math.max(0, bestAnchorPos - bestAnchorOffsetInQuote)
  const winEndIdx = Math.min(Ptokens.length, winStartIdx + Qtokens.length)
  const winStart = Ptokens[winStartIdx]!.start
  const winEnd = Ptokens[winEndIdx - 1]!.end
  const { origStart, origEnd } = normalizedRangeToOriginal(pn, winStart, winEnd)
  return { mode: 'fuzzy', origStart, origEnd, score: 0.5 }
}

interface Anchor {
  tokens: string[]
  /** 该 anchor 在 quote tokens 中的起始索引 */
  offsetInQuote: number
}

function pickAnchors(qt: Token[], size: number): Anchor[] {
  const out: Anchor[] = []
  if (qt.length === 0) return out
  const take = Math.min(size, qt.length)
  // head
  out.push({ tokens: qt.slice(0, take).map((t) => t.text), offsetInQuote: 0 })
  if (qt.length > take) {
    // middle
    const midStart = Math.floor((qt.length - take) / 2)
    out.push({
      tokens: qt.slice(midStart, midStart + take).map((t) => t.text),
      offsetInQuote: midStart,
    })
    // tail
    const tailStart = qt.length - take
    out.push({
      tokens: qt.slice(tailStart).map((t) => t.text),
      offsetInQuote: tailStart,
    })
  }
  return out
}

/** 在 Ptokens 中精确查找一段 token 序列；返回首次匹配的 P 索引或 -1。 */
function findTokenSequence(Ptokens: Token[], seq: string[]): number {
  if (seq.length === 0) return -1
  outer: for (let i = 0; i + seq.length <= Ptokens.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (Ptokens[i + j]!.text !== seq[j]) continue outer
    }
    return i
  }
  return -1
}

/**
 * 三级综合匹配：依次跑 Level 1 → 2 → 3，首个命中即返回。
 * 全失败返回 null。
 */
export function findBestMatch(pageText: string, quote: string): MatchResult | null {
  return (
    findExactMatch(pageText, quote)
    ?? findDiceMatch(pageText, quote)
    ?? findAnchorMatch(pageText, quote)
  )
}

/** 测试导出 */
export const __testing__ = { tokenize, charBigrams, diceCoefficient, pickAnchors }
