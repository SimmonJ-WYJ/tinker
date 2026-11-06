/**
 * wiki 语料切块器：md 全文 → 带锚点的 ~300 token chunk
 *
 * 双轨锚点（语料现实：lite 策略产出的 raw md 无 <p id> 锚点）：
 *   - 段落模式：内容含 `<p id="pS_P">`（structured md / .article.md）→ 锚点 = 段落 id（"p3_1"）
 *   - 纯文本模式：lite md → 按行分段，锚点 = body 内字节偏移（"b12345"），
 *     与 papers_read_context 工具的 byteOffset 寻址天然吻合
 *
 * 章节标注（仅段落模式）：按正文 "# N. Title" 顶层 heading 建 {N → 标题}，
 *   据每个 chunk 锚点的 N 写入 sectionIndex/sectionTitle（供向量检索按章节过滤/回显）；
 *   纯文本模式锚点无章节，保持 null。
 *
 * 质量处理（检索命中靠 snippet 在 PDF 文字层做文本搜索高亮定位，故 chunk 文本须干净连续）：
 *   1. 截断参考文献区（References/Bibliography/参考文献 之后不嵌）——去噪 + 省算力
 *   2. 过滤目录点线行（"3.1 xxx . . . . . 11"）、孤立页码等版面噪声
 *   3. 超长段落（structured 的 <p> 常把整块参考文献/长段堆成一段，实测可达 25KB）
 *      在段内按句/空白二次切到 ~300 token，子锚点 = "pS_P#i"，避免向量被前 512 token 稀释、
 *      snippet 过大无法作证据
 *   4. 丢弃低质量 chunk（参考文献列表 / 链接列表 / 公式表格 / base64-latex / 解析乱码）——
 *      见 isLowQualityText；这类内容与任何查询都不相关，却会在弱信号查询下占满向量 top-K
 *
 * 约定：
 *   - chunk 目标 ~300 token（估算），过短段落向后合并
 *   - 头部元数据块（"# PDF" + "> key: value" + 首个 "---"）不进语料
 */

import type { ZoteroPdfWikiIndexEntry } from '@asci/shared'
import type { ChunkInput } from './vector-db.ts'

/** chunk 目标 token 数（估算值，超过即封块） */
const TARGET_TOKENS = 300
/** 短于该 token 数的段落不单独成块（继续向后合并） */
const MIN_TOKENS = 40
/**
 * 段内二次切分的句级 overlap 字符预算（约 1 句）。
 *
 * 仅作用于「超长段被从中间切开」这唯一会割裂语义的场景——让相邻子片共享尾部约一句话，
 * 避免一个论点/一句被切两半后两侧都不完整。段落级切分是天然边界、不需要 overlap，
 * 故这里不做全量 chunk overlap（避免索引膨胀）。
 */
const SPLIT_OVERLAP_CHARS = 160

/** 与 papers-rg / article generator 一致的段落锚点正则 */
const P_TAG_RE = /<p id="([^"]+)">([\s\S]*?)<\/p>/g

/**
 * 顶层章节 heading 正则（与 papers-rg findArticleSections 同口径）：
 * `# N. Title` / `# N Title`，单 `#`（`## 3.1` 子节不匹配），`# OUTLINE`/`# CONTENT` 无数字不匹配。
 * 用于给段落 chunk 标注 section_title（章节号 N 对齐 `<p id="pN_P">` 的 N）。
 */
const SECTION_HEADING_RE = /^#[ \t]+(\d+)\.?[ \t]+(.+)$/gm

/** 段落锚点解析顶层章节号："p3_1" / "p3_1#0" → 3；字节锚点 "b123" / null → null */
function sectionIndexFromAnchor(anchor: string | null): number | null {
  if (!anchor) return null
  const m = /^p(\d+)_/.exec(anchor)
  return m?.[1] !== undefined ? parseInt(m[1], 10) : null
}

/** 扫 body 顶层 heading 建 {章节号 → 标题}（去编号前缀；同号取首个） */
function buildSectionTitleMap(body: string): Map<number, string> {
  const map = new Map<number, string>()
  SECTION_HEADING_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SECTION_HEADING_RE.exec(body)) !== null) {
    const idxStr = m[1]
    const title = m[2]?.trim()
    if (idxStr === undefined || !title) continue
    const idx = parseInt(idxStr, 10)
    if (!map.has(idx)) map.set(idx, title)
  }
  return map
}

/** 给段落模式 chunk 标注 section_index/section_title（就地修改）。纯文本模式锚点无章节，跳过 */
function annotateSections(chunks: ChunkInput[], body: string): void {
  const titleMap = buildSectionTitleMap(body)
  for (const c of chunks) {
    const idx = sectionIndexFromAnchor(c.anchorStart)
    if (idx === null) continue
    c.sectionIndex = idx
    const title = titleMap.get(idx)
    if (title) c.sectionTitle = title
  }
}

/**
 * 参考文献区起始 heading（截断点）。匹配整行：可带 markdown # 前缀、可带单个章节号。
 * 用 m+i flag，命中首个即截断其后全部内容。
 *
 * 注意：章节号用 `?`（0 或 1 个）而非 `*`——`(?:\d+[.)]?[ \t]*)*` 这类嵌套量词遇到
 * 数字密集行（目录 "10. 11. 12…"、参考文献编号）会灾难性回溯（ReDoS），V8 下可卡死。
 */
const REF_HEADING_RE =
  /^[ \t]*(?:#{1,6}[ \t]*)?(?:\d+[.)]?[ \t]*)?(?:references|reference|bibliography|参考文献|参考资料|引用文献)[ \t]*$/im

/**
 * token 数估算：CJK 字符 ≈ 1 token/字，其余 ≈ 4 字符/token。
 * 只用于切块阈值判断，不要求精确。
 */
export function estimateTokens(text: string): number {
  let cjk = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x2e80 && code <= 0x9fff) cjk++
  }
  return cjk + Math.ceil((text.length - cjk) / 4)
}

/** 是否版面噪声文本（目录点线 / 孤立页码 / 空白）——不进语料 */
function isNoiseText(text: string): boolean {
  const s = text.trim()
  if (!s) return true
  if (/(?:\.\s*){6,}/.test(s)) return true // 目录点线 "3.1 xxx . . . . . 11"
  if (/^\d{1,4}$/.test(s)) return true // 孤立页码行
  return false
}

/**
 * 是否低质量 chunk（参考文献列表 / 链接列表 / 公式表格 / base64-latex / 解析乱码）——不入语料。
 *
 * 评估发现（docs/superpowers/rag-eval-results）：这类 chunk 本身与任何查询都不相关，
 * 却在中文等弱信号查询下"浮"到向量 top-K 占满名额，是召回质量的主要污染源。
 * 这里用**保守且互不重叠的强信号**判定，避免误杀正文（含 Related Work 这类含少量行内引用的散文）：
 *   1. 链接列表：≥3 个 URL（如 "GNN https://github.com/... GIN https://..."）
 *   2. base64 / \latexit 等长无空白串（≥30 连续 [A-Za-z0-9+/]）
 *   3. 参考文献密度：编号/arXiv/「In:」/「et al」/doi 标记 ≥6 且占词比 >5%（整段参考文献）
 *   4. 字母/CJK 占比 <40%（公式符号汤、纯数字结果表）
 *   5. 紧邻无空白重复单元（解析乱码 "DRAGONDRAGON" / "(2.7B)(2.7B)"）
 */
export function isLowQualityText(text: string): boolean {
  const s = text.trim()
  const len = s.length
  if (len < 20) return false // 过短交给 MIN_TOKENS 合并逻辑，这里不误杀短正文
  if ((s.match(/https?:\/\//g) ?? []).length >= 3) return true
  // base64 / hash / latexit：≥20 长 token 且混合 ≥3 种字符类（大写/小写/数字/+/=）；
  // 纯重复字符（如 "xxxx…"）只 1 类，不误判
  for (const tok of s.split(/\s+/)) {
    if (tok.length < 20) continue
    let cls = 0
    if (/[a-z]/.test(tok)) cls++
    if (/[A-Z]/.test(tok)) cls++
    if (/[0-9]/.test(tok)) cls++
    if (/[+/=]/.test(tok)) cls++
    if (cls >= 3) return true
  }
  const refMarks = (s.match(/\[\d{1,3}\]|arXiv|In:\s|et al\.?|doi\.org/gi) ?? []).length
  const words = s.split(/\s+/).filter(Boolean).length || 1
  if (refMarks >= 6 && refMarks / words > 0.05) return true
  const wordChars = (s.match(/[A-Za-zÀ-ɏ一-鿿]/g) ?? []).length
  if (wordChars / len < 0.4) return true
  // 紧邻无空白重复单元（≥3 种不同字符，排除 "xxxx" 这类单字符填充）→ 解析乱码
  const rep = s.match(/(\S{6,})\1/)
  if (rep && new Set(rep[1]).size >= 3) return true
  return false
}

/** 既是版面噪声、又是低质量内容（合并判定，供段落/行级过滤复用） */
function isDroppable(text: string): boolean {
  return isNoiseText(text) || isLowQualityText(text)
}

/**
 * 剥离 wiki md 头部元数据块，返回正文及其在原文件中的字节偏移。
 *
 * lite/structured md 头部形如：
 *   # PDF\n\n> attachmentKey: ...\n> ...\n\n---\n\n<正文>
 * 找不到 "---" 分隔线时整个文件视为正文（容错）。
 */
export function stripWikiHeader(md: string): { body: string; bodyByteStart: number } {
  const sepRe = /^---\s*$/m
  const m = sepRe.exec(md)
  if (!m) return { body: md, bodyByteStart: 0 }
  const afterSep = m.index + m[0].length
  // 跳过分隔线后的空行
  let start = afterSep
  while (start < md.length && (md[start] === '\n' || md[start] === '\r')) start++
  return {
    body: md.slice(start),
    bodyByteStart: Buffer.byteLength(md.slice(0, start), 'utf-8'),
  }
}

/** 截断参考文献区：命中首个 References/参考文献 heading 行即丢弃其后全部内容 */
export function truncateAtReferences(body: string): string {
  const m = REF_HEADING_RE.exec(body)
  return m ? body.slice(0, m.index) : body
}

interface Segment {
  /** 段落锚点（段落模式 = p id；纯文本模式 = "b{字节偏移}"） */
  anchor: string
  text: string
}

/** 段落模式：抽取所有 <p id> 段落（过滤噪声段） */
function segmentsFromParagraphTags(body: string): Segment[] {
  const segs: Segment[] = []
  P_TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = P_TAG_RE.exec(body)) !== null) {
    const anchor = m[1]
    const text = m[2]?.trim()
    if (anchor && text && !isDroppable(text)) segs.push({ anchor, text })
  }
  return segs
}

/**
 * 纯文本模式：按行分段（lite 输出行短），锚点 = 行首在 body 内的字节偏移。
 * 空行与版面噪声行被跳过；行级 seg 由 mergeSegments 合并到 ~300 token，
 * 极少出现的超长行交给 mergeSegments 的段内二次切分统一处理。
 */
function segmentsFromPlainText(body: string): Segment[] {
  const segs: Segment[] = []
  let byteOffset = 0
  for (const line of body.split('\n')) {
    const lineBytes = Buffer.byteLength(line, 'utf-8')
    const text = line.trim()
    if (text && !isDroppable(text)) {
      const trimStartBytes = Buffer.byteLength(
        line.slice(0, line.length - line.trimStart().length),
        'utf-8',
      )
      segs.push({ anchor: `b${byteOffset + trimStartBytes}`, text })
    }
    byteOffset += lineBytes + 1 // +1 = '\n'
  }
  return segs
}

/**
 * 把超长文本按 ~TARGET_TOKENS 切片，优先在句末（. 。\n）断开，其次空白。
 * 相邻子片共享尾部约一句（SPLIT_OVERLAP_CHARS），落在句边界，避免论点被切两半。
 * 供段内二次切分使用；返回纯文本片段序列。
 */
function splitByTokens(text: string): string[] {
  const targetChars = TARGET_TOKENS * 4
  const pieces: string[] = []
  let pos = 0
  while (pos < text.length) {
    let end = Math.min(pos + targetChars, text.length)
    if (end < text.length) {
      const slice = text.slice(pos, end)
      const half = Math.floor(slice.length / 2)
      // 优先句末断点
      const sentence = Math.max(
        slice.lastIndexOf('. '),
        slice.lastIndexOf('。'),
        slice.lastIndexOf('\n'),
      )
      if (sentence > half) {
        end = pos + sentence + 1
      } else {
        const ws = text.lastIndexOf(' ', end)
        if (ws > pos) end = ws
      }
    }
    const piece = text.slice(pos, end).trim()
    if (piece) pieces.push(piece)
    if (end >= text.length) break
    // 下一片回退约一句形成 overlap；回退点落到句边界（句末标点后的首个非空白）
    let next = end - SPLIT_OVERLAP_CHARS
    if (next <= pos) {
      next = end // 本片太短，放弃 overlap 以保证前进、避免死循环
    } else {
      const m = text.slice(next, end).search(/(?<=[.。\n])\s*\S/)
      if (m >= 0) next += m
    }
    pos = next
  }
  return pieces
}

/** 把段落序列合并成 ~TARGET_TOKENS 的 chunk；超长单段在段内二次切分（子锚点 anchor#i） */
function mergeSegments(segs: Segment[]): ChunkInput[] {
  const chunks: ChunkInput[] = []
  let buf: Segment[] = []
  let bufTokens = 0

  const flush = () => {
    const first = buf[0]
    const last = buf[buf.length - 1]
    if (!first || !last) return
    chunks.push({
      anchorStart: first.anchor,
      anchorEnd: last.anchor,
      content: buf.map((s) => s.text).join('\n\n'),
    })
    buf = []
    bufTokens = 0
  }

  for (const seg of segs) {
    const t = estimateTokens(seg.text)
    // 超长单段：先封已积累块，再段内二次切（子锚点 anchor#0、anchor#1…）
    if (t > TARGET_TOKENS) {
      flush()
      splitByTokens(seg.text).forEach((piece, i) => {
        chunks.push({
          anchorStart: `${seg.anchor}#${i}`,
          anchorEnd: `${seg.anchor}#${i}`,
          content: piece,
        })
      })
      continue
    }
    if (bufTokens >= MIN_TOKENS && bufTokens + t > TARGET_TOKENS) flush()
    buf.push(seg)
    bufTokens += t
    if (bufTokens >= TARGET_TOKENS) flush()
  }
  flush()
  return chunks
}

/**
 * 把一份 wiki md（raw / structured / article 同构）切成带锚点的 chunk 序列。
 * 语料层归属由调用方在 replaceChunks 的 textKind 参数上声明（唯一事实源）。
 *
 * @param md 完整文件内容（含头部元数据块）
 */
export function chunkWikiMarkdown(md: string): ChunkInput[] {
  const { body: rawBody } = stripWikiHeader(md)
  const body = truncateAtReferences(rawBody)
  if (!body.trim()) return []
  const paragraphMode = body.includes('<p id="')
  const segs = paragraphMode ? segmentsFromParagraphTags(body) : segmentsFromPlainText(body)
  // 段内二次切分后再兜底过滤一遍：超长段被 splitByTokens 切碎后，
  // 个别子片（如夹在正文里的参考文献尾段）可能才暴露出低质量特征。
  const chunks = mergeSegments(segs).filter((c) => !isLowQualityText(c.content))
  // 段落模式（structured/article）按 <p id="pN_P"> 的 N 标注章节；纯文本模式锚点无章节，保持 null
  if (paragraphMode) annotateSections(chunks, body)
  return chunks
}

/**
 * 篇章级粗召回 chunk：title + authors + abstract 拼一条（无锚点）。
 * title 与 abstract 都缺失时返回 null（无可嵌内容）。
 */
export function buildTitleAbstractChunk(
  entry: Pick<ZoteroPdfWikiIndexEntry, 'title' | 'authors' | 'year' | 'abstract'>,
): ChunkInput | null {
  const parts: string[] = []
  if (entry.title) parts.push(entry.title)
  const authors = (entry.authors ?? []).slice(0, 8).join(', ')
  if (authors) parts.push(entry.year ? `${authors} (${entry.year})` : authors)
  if (entry.abstract) parts.push(entry.abstract)
  if (parts.length === 0 || (!entry.title && !entry.abstract)) return null
  return {
    anchorStart: null,
    anchorEnd: null,
    content: parts.join('\n'),
  }
}
