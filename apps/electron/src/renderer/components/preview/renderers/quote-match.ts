/**
 * PDF quote 高亮的模糊文本匹配
 *
 * 背景：综述 cite 的 quote 与 PDF textLayer 文本之间有多种"看起来一样但字符不同"的差异：
 *   1. 装饰字符：头尾带 `"..."` / `…` / 智能引号 / 中英文「『」 等
 *   2. 连字符断行：PDF 里 `re-\nsearch`、`co- llaboration`、软连字符 U+00AD
 *   3. 空白差异：PDF textLayer 把不同 span 直接拼接，行尾/段尾的 `\n` 数量不定，
 *      多个空格折叠之后才与 quote 对齐
 *   4. 大小写差异：偶尔人工编辑的 quote 与 PDF 大小写不一致
 *   5. Unicode 变体：NBSP (U+00A0) vs 普通空格、智能引号 vs ASCII 引号
 *   6. **中段 `…` / `...` 桥接**：综述 skill 允许（且历史 prompt 范例里用 `…` 桥接非关键
 *      片段），导致 quote 形如 `<前段>…<后段>` —— 这种字符串在 PDF 里不存在任何单一位置。
 *      由 findQuoteFragmentsInPage 拆 fragment 分段匹配处理（findQuoteInPage 不处理桥接）。
 *   7. **小型大写 / 拆词**：LaTeX `\textsc{FactAlign}` 在 textLayer 里被拆成多个 span
 *      （"F""ACT""A""LIGN"），joinPdfItems 插入空格后成 "F ACT A LIGN"，fold 正规化仍保留
 *      词间空格，对不上 quote 的 "FactAlign" → 整条 L1/L2 miss、只剩中段 fingerprint。
 *      由 squeezed 档（去掉**所有**空白再比）解决。
 *
 * 简单 `pageText.indexOf(quote)` 任一不一致就 miss。
 *
 * 策略：
 *   ① 把 pageText / quote **同时**正规化（折叠空白 + 去连字符断行 + 小写 +
 *      丢软连字符），并记录每个正规化字符在原字符串中的位置
 *   ② 在正规化空间用 indexOf 搜
 *   ③ 命中后把正规化 [start, end) 映射回原 pageText 的 [origStart, origEnd)
 *      —— 调用方用原位置去找覆盖的 textLayer spans
 *   ④ 多档降级：直接 / 去头尾装饰 / 去全部空白(治小型大写拆词) / 中段指纹 / 跨页首尾段
 *   ⑤ findQuoteFragmentsInPage：检测中段 `…/.../⋯` 拆 fragment，逐段走 ①–④ 返回所有命中
 *
 * 与 PdfRenderer 解耦：本文件不依赖 pdf.js / React，纯函数 + 易单测。
 */

/** 一次匹配的结果：在 *原* pageText 中的字符区间 [idx, idx+len) */
export interface QuoteMatch {
  idx: number
  len: number
  /** 命中的降级档位（仅供 log / 调试） */
  tier: 'strict' | 'trimmed' | 'squeezed' | 'fingerprint' | 'leading' | 'trailing'
}

/** 正规化文本：内部表示 + 反向定位 */
interface NormalizedText {
  /** 正规化后的字符串 */
  text: string
  /** 长度 == text.length；mapToOrig[i] 是 text[i] 在原字符串中的字符下标 */
  mapToOrig: number[]
}

/**
 * 把任意文本正规化为可比对的形式：
 *   - 去掉所有 ASCII 连字符 U+002D 与软连字符 U+00AD —— PDF 行末断字
 *     （`re-\nsearch`）与真实的复合词连字符（`state-of-the-art`）在 textLayer
 *     `items.join('')` 之后都呈现为 `re-search` / `state-of-the-art`，无法区分；
 *     **两边都剥**做对称损失（query 与 pageText 同一规则），既能命中断字也能
 *     命中复合词。en-/em-dash（–/—）保留，避免吃掉真实标点
 *   - 把任意空白序列（空格 / 制表 / 换行 / NBSP / 全角空格等）折叠为单个空格；
 *     首尾空白丢弃
 *   - 全部转小写
 *
 * 同时维护 `mapToOrig[]`：正规化后第 i 个字符对应原文哪个下标。命中后调用方用
 * `[mapToOrig[startNorm], mapToOrig[endNorm-1]+1)` 拿到原文区间，足以覆盖所有
 * 原始字符（即便中间有被丢弃的连字符 / 空白）。
 *
 * 不做 NFKC：循环外做 NFKC 会改长度破坏 mapToOrig；智能引号 / 省略号留给
 * `trimQuoteDecorations` 在 L2 档剥两端，NBSP 等空白在 \s 折叠里处理。
 */
function normalize(s: string, dropSpaces = false): NormalizedText {
  const out: string[] = []
  const map: number[] = []
  let i = 0
  let prevIsSpace = false

  while (i < s.length) {
    const ch = s[i]!
    const code = ch.charCodeAt(0)

    // ASCII hyphen-minus (U+002D) + 软连字符 (U+00AD)：一律丢弃；同时把紧随其后
    // 的空白也一并吃掉，让 PDF 断字 `value-\nincongruent` 与 quote 里的
    // `value-incongruent` 正规化结果对齐（都变 `valueincongruent`）
    if (code === 0x2d || code === 0xad) {
      i++
      while (i < s.length && /\s/.test(s[i]!)) {
        i++
      }
      continue
    }

    // 任意空白：fold 档折叠为单个空格；squeeze 档（dropSpaces）整个丢弃。
    // squeeze 治小型大写 / 拆词：textLayer 把 `\textsc{FactAlign}` 拆成 "F""ACT""A""LIGN"
    // 多 span，joinPdfItems 插空格 → "f act a lign"，fold 档对不齐 quote 的 "factalign"；
    // 去掉所有空白后两边都成 "factalign" 即可命中。
    if (/\s/.test(ch)) {
      if (!dropSpaces && !prevIsSpace && out.length > 0) {
        out.push(' ')
        map.push(i) // 记空白序列第一个字符的位置
        prevIsSpace = true
      }
      i++
      continue
    }

    // 普通字符：小写后入栈
    out.push(ch.toLowerCase())
    map.push(i)
    prevIsSpace = false
    i++
  }

  // 去掉末尾可能多出的一个空格
  while (out.length > 0 && out[out.length - 1] === ' ') {
    out.pop()
    map.pop()
  }

  return { text: out.join(''), mapToOrig: map }
}

/**
 * 头尾装饰字符集合：
 *   - 横向省略号 U+2026 (…) + ASCII 的两个/三个/多个点 `..`/`...`
 *   - ASCII / 智能 / 中英文引号 `"' "" ‘’ « » 「」『』`
 *   - 空白
 *
 * Note：仅剥两端，不动中段省略号（quote 中可能含合法的 `...`）。
 */
const DECOR_REGEX_HEAD = /^[\s"'«‘’“”「」『』…]+|^\.{2,}/u
const DECOR_REGEX_TAIL = /[\s"'»‘’“”「」『』…]+$|\.{2,}$/u

/** 把头尾的装饰字符剥干净。中段保持原样。 */
export function trimQuoteDecorations(s: string): string {
  let prev: string
  let cur = s
  do {
    prev = cur
    cur = cur.replace(DECOR_REGEX_HEAD, '').replace(DECOR_REGEX_TAIL, '')
  } while (cur !== prev)
  return cur
}

/** 取 quote 中间长度 [minLen, maxLen] 区间内的指纹片段；过短返回 null */
export function extractFingerprint(s: string, minLen = 20, maxLen = 50): string | null {
  if (s.length < minLen) return null
  const mid = Math.floor(s.length / 2)
  const targetLen = Math.min(maxLen, Math.max(minLen, Math.floor(s.length / 2)))
  const radius = Math.floor(targetLen / 2)
  const start = Math.max(0, mid - radius)
  const end = Math.min(s.length, start + targetLen)
  const fingerprint = s.slice(start, end)
  return fingerprint.length >= minLen ? fingerprint : null
}

/**
 * 在 *预先* 正规化好的 pageText 中找 query；命中映射回原 pageText 区间。
 * query 本身在这里正规化。
 */
interface NormalizedHit {
  /** 映射回原 pageText 的字符区间 [idx, idx+len) */
  idx: number
  len: number
  /** 命中片段在 np.text（正规化 pageText）中的起点 / 长度，供 expandHighlight 锚定扩展 */
  normStart: number
  normLen: number
}

function findInNormalized(np: NormalizedText, query: string, dropSpaces = false): NormalizedHit | null {
  const nq = normalize(query, dropSpaces)
  if (nq.text.length === 0) return null
  const hit = np.text.indexOf(nq.text)
  if (hit === -1) return null
  const origStart = np.mapToOrig[hit]!
  const origLastIdx = np.mapToOrig[hit + nq.text.length - 1]!
  return { idx: origStart, len: origLastIdx - origStart + 1, normStart: hit, normLen: nq.text.length }
}

/**
 * 锚点扩展：实现"定位用 Lx、高亮尽量 L1"。
 *
 * fingerprint / leading / trailing 这些低档只匹配到 quote 的**一个片段**，若高亮只画这片段
 * 会缩水（截图里"只亮中段"即此因）。以片段为锚点，在**同一正规化空间**用整条 quote 双向贪心
 * 扩展：只要 page 与 quote 逐字一致就继续外扩，遇分歧立即停。
 *
 * 结果区间 ≥ 锚点片段、≤ 整条 quote，且**绝不**画进与 quote 不一致的字符（保持 L1 那样的
 * 精确语义）：当 page 实际含完整 quote（只是首/尾被改写导致整条 miss）时，扩展能恢复到整句；
 * 当 page 与 quote 在某处真分歧时，扩展在分歧处停住，不会越界染到无关文本。
 *
 * @param np         已正规化的 pageText（与锚点同档：fold 或 squeeze）
 * @param nq         已正规化的整条 quote / corpus（同档）
 * @param normStart  锚点片段在 np.text 中的起点
 * @param normLen    锚点片段长度
 * @returns 扩展后映射回原 pageText 的 { idx, len }；锚点片段不在 nq 中（极端边界）时退回锚点本身
 */
function expandHighlight(np: NormalizedText, nq: NormalizedText, normStart: number, normLen: number): { idx: number; len: number } {
  let l = normStart
  let r = normStart + normLen
  const fragment = np.text.slice(l, r)
  const qPos = nq.text.indexOf(fragment)
  if (qPos >= 0) {
    // 向左：page 与 quote 锚点左侧逐字一致就同时左移
    let ql = qPos
    while (l > 0 && ql > 0 && np.text[l - 1] === nq.text[ql - 1]) {
      l--
      ql--
    }
    // 向右：锚点右侧逐字一致就同时右移
    let qr = qPos + fragment.length
    while (r < np.text.length && qr < nq.text.length && np.text[r] === nq.text[qr]) {
      r++
      qr++
    }
  }
  const origStart = np.mapToOrig[l]!
  const origLastIdx = np.mapToOrig[r - 1]!
  return { idx: origStart, len: origLastIdx - origStart + 1 }
}

/**
 * 在 pageText 中定位 quote；多档降级，每档都跑在正规化空间里。
 *
 * 定位 / 高亮解耦——"定位用 Lx、高亮尽量 L1"：
 *   - strict / trimmed / squeezed 整条命中 → 区间即整条 quote。
 *   - fingerprint / leading / trailing 只匹配到一个片段 → 以该片段为锚点走 expandHighlight
 *     双向扩展，把高亮恢复到 page 与 quote 最大连续一致区（≥ 片段、≤ 整条 quote，绝不越界）。
 *
 * 失败兜底：
 *   - rawQuote 空 / pageText 空 → null
 *   - 各档全 miss → null（调用方决定是否 log）
 */
export function findQuoteInPage(pageText: string, rawQuote: string): QuoteMatch | null {
  if (!rawQuote || !pageText) return null

  const np = normalize(pageText)
  if (np.text.length === 0) return null

  // L1：直接（已自动做 case / 连字符 / 空白折叠）。整条命中 → 区间即整条 quote，无需扩展。
  const m1 = findInNormalized(np, rawQuote)
  if (m1) return { idx: m1.idx, len: m1.len, tier: 'strict' }

  // L2：剥头尾装饰后再试。整条命中。
  const trimmed = trimQuoteDecorations(rawQuote)
  if (trimmed.length > 0 && trimmed !== rawQuote) {
    const m2 = findInNormalized(np, trimmed)
    if (m2) return { idx: m2.idx, len: m2.len, tier: 'trimmed' }
  }

  // L2.5 squeezed：去掉所有空白后再找整条 quote / trimmed。
  // 专治小型大写 / 拆词：textLayer 把 `\textsc{FactAlign}` 拆成多 span，join 插入的空格
  // 让 fold 档的 "f act a lign" 对不上 quote 的 "factalign"，整条 L1/L2 从开头就 miss，
  // 只剩中段 fingerprint 命中 → 高亮缩成中段。去掉所有空白即可让整条 quote 命中、
  // 高亮恢复成整句。仅对整条/trimmed 用：百字级长串在去空格空间里几乎不会误命中。
  const npSqueeze = normalize(pageText, true)
  if (npSqueeze.text.length > 0) {
    const sq1 = findInNormalized(npSqueeze, rawQuote, true)
    if (sq1) return { idx: sq1.idx, len: sq1.len, tier: 'squeezed' }
    if (trimmed.length > 0 && trimmed !== rawQuote) {
      const sq2 = findInNormalized(npSqueeze, trimmed, true)
      if (sq2) return { idx: sq2.idx, len: sq2.len, tier: 'squeezed' }
    }
  }

  // —— 以下为"片段定位"档：只匹配到 quote 的一段，命中后一律走 expandHighlight，
  //    以片段为锚点把高亮双向扩展到 page 与 quote 最大连续一致区（尽量逼近 L1 覆盖）。
  const corpus = trimmed.length > 0 ? trimmed : rawQuote
  const nqCorpus = normalize(corpus)

  // L3：取中段指纹定位 → 向两侧扩展
  const fingerprint = extractFingerprint(corpus)
  if (fingerprint) {
    const m3 = findInNormalized(np, fingerprint)
    if (m3) {
      const e = expandHighlight(np, nqCorpus, m3.normStart, m3.normLen)
      return { idx: e.idx, len: e.len, tier: 'fingerprint' }
    }
  }

  // L4 / L5：跨页 quote 兜底。用户跨两页选择文字时，保存的 quote 横跨页边界，
  // 任何单页都不包含完整 quote，L1~L3 全 miss。退而求其次：用 quote 的开头
  // 片段（前 60 字）与结尾片段（后 60 字）分别去定位；命中后同样 expandHighlight，
  // 把高亮从 60 字片段扩展到"该 quote 落在本页的全部"。
  const SEGMENT_LEN = 60
  if (corpus.length >= SEGMENT_LEN * 2) {
    const leading = corpus.slice(0, SEGMENT_LEN)
    const m4 = findInNormalized(np, leading)
    if (m4) {
      const e = expandHighlight(np, nqCorpus, m4.normStart, m4.normLen)
      return { idx: e.idx, len: e.len, tier: 'leading' }
    }
    const trailing = corpus.slice(-SEGMENT_LEN)
    const m5 = findInNormalized(np, trailing)
    if (m5) {
      const e = expandHighlight(np, nqCorpus, m5.normStart, m5.normLen)
      return { idx: e.idx, len: e.len, tier: 'trailing' }
    }
  }

  return null
}

// ===== Fragment 拆分（处理 `…` / `...` / `⋯` 桥接） =====

/**
 * Quote 中段桥接符号识别正则。匹配任一：
 *   - Unicode 横向省略号 `…` (U+2026)
 *   - Unicode 中省略号 `⋯` (U+22EF)
 *   - 连续 3 个或更多 ASCII 句点 `...`
 *
 * 注意：这是 *检测*用的，不是 *拆分* 用的——拆分时用同一字符类匹配并 split。
 */
const ELLIPSIS_BRIDGE_PATTERN = /…|⋯|\.{3,}/u

/**
 * Fragment 拆分后单段允许进入匹配的最小长度（字符数）。
 *
 * 不能过低：综述 quote 末尾常出现 "21 inorgan"（截断词）/ 短数字串等 ≤10 字符的"碎片"，
 * 进入三档降级匹配后 fingerprint 档基本必中（中段长度 < minLen 时 extractFingerprint 返
 * null，但 strict 档对短串本身就高误命中率）。
 *
 * 经验阈值：15 字符 —— 既允许 "structural stability" 这种 21 字符的有效短片段，又能挡掉
 * "21 inorgan" / "12,831" 这种纯数字 + 截断词组合。
 */
const MIN_FRAGMENT_LEN = 15

/**
 * 把含中段 `…/…/⋯/...` 桥接的 quote 拆成多个连续片段。
 *
 * 行为：
 *   - 输入空 → `[]`
 *   - 不含桥接 → `[rawQuote]`（保留原样，含头尾装饰，由 findQuoteInPage 的 L2 处理）
 *   - 含桥接 → 按桥接符 split，每段 trim 空白；空段丢弃；保留头尾装饰让下游 L2 处理
 *
 * 注意：拆出来的 fragment **不**做长度过滤——长度判定留给 `findQuoteFragmentsInPage`，
 * 让本函数职责单一（仅切分，可独立测）。
 */
export function splitQuoteFragments(rawQuote: string): string[] {
  if (!rawQuote) return []
  if (!ELLIPSIS_BRIDGE_PATTERN.test(rawQuote)) return [rawQuote]
  return rawQuote
    .split(/…|⋯|\.{3,}/u)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

/**
 * Fragment 匹配结果：在 QuoteMatch 基础上附带拆分上下文，便于 PdfRenderer / 调用方
 * 知道这是"第几段、共几段"——用于决定多段都高亮、还是只翻第一段所在页等行为。
 */
export interface QuoteFragmentMatch extends QuoteMatch {
  /** 命中的 fragment 在拆分数组中的下标（0-based） */
  fragmentIdx: number
  /** 拆分后总 fragment 数（≥1）；单 fragment（无桥接）= 1 */
  fragmentCount: number
}

/**
 * 在 pageText 中定位 quote，**支持中段 `…/⋯/...` 桥接的多片段匹配**。
 *
 * 与 findQuoteInPage 的语义差别：
 *   - findQuoteInPage：把整条 quote 当**单一连续字符串**找；中段含 `…` 时基本必 miss
 *   - findQuoteFragmentsInPage：检测中段桥接 → 拆 fragment → 每段独立走三档降级 →
 *     **返回所有命中段**（可能 0~N 条，按命中位置 idx 升序）
 *
 * 单 fragment（无桥接）路径完全等价于 `findQuoteInPage(pageText, rawQuote)` 包一层 ——
 * 不引入新匹配语义，仅多带 fragmentIdx/Count 上下文。
 *
 * 多 fragment 路径：每段须 ≥ `MIN_FRAGMENT_LEN` 才参与匹配，否则跳过（防止 "12,831" /
 * "21 inorgan" 这种短碎片在 PDF 里到处误命中）。
 *
 * 返回的命中区间**不保证非重叠**（理论上不同 fragment 不该在同一区间命中，但 fingerprint
 * 中段恰巧落到同一位置时有可能）；调用方应能容忍区间相同或包含。
 */
export function findQuoteFragmentsInPage(
  pageText: string,
  rawQuote: string,
): QuoteFragmentMatch[] {
  if (!pageText || !rawQuote) return []
  const fragments = splitQuoteFragments(rawQuote)
  if (fragments.length === 0) return []

  // 单 fragment：退化为 findQuoteInPage 的语义（保留 rawQuote 原样，让 L2 处理装饰）
  if (fragments.length === 1) {
    const m = findQuoteInPage(pageText, rawQuote)
    return m ? [{ ...m, fragmentIdx: 0, fragmentCount: 1 }] : []
  }

  // 多 fragment：逐段独立匹配；长度门槛挡掉短碎片
  const out: QuoteFragmentMatch[] = []
  fragments.forEach((frag, idx) => {
    if (frag.length < MIN_FRAGMENT_LEN) return
    const m = findQuoteInPage(pageText, frag)
    if (m) out.push({ ...m, fragmentIdx: idx, fragmentCount: fragments.length })
  })
  return out.sort((a, b) => a.idx - b.idx)
}
