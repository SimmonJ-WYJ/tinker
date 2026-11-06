/**
 * structured 策略 · 第 2 步：把 layout-aware line 序列分类成富 token
 *
 * 与第一版 classifier 相比，本版本额外维护：
 *  - sectionNumber：顶层章节编号，单调递增；用于 `<p id="pS_P">` 的 S 与 OUTLINE 行号
 *  - paragraphIndex：段落在当前章节内的序号，每次顶层 section 切换重置；用于 `<p>` 的 P
 *  - heading.level：编号 heading 按 depth 决定 markdown 级别（"1." → h1，"1.1" → h2，"1.1.1" → h3）；
 *    非编号 heading 按字号映射到 h1-h6，同时按出现顺序分配 sectionNumber（保证 OUTLINE 完整）
 *
 * 同时做两件清洗：
 *  - 重复页眉页脚剔除（首末行在 ≥60% 页上重复 + 字号不超 body 1.05× 才丢）
 *  - 纯页码行剔除（/^(page\s*)?\d+(\/\d+)?$/）
 */

import type { StructuredLine, StructuredPage } from './extractor'

const BULLET_RE = /^\s*[-•*·●○∙▪◦]\s+(.*)$/
// ORDERED_RE 故意不在这里：见 classifyLine 末尾注释（与参考文献伪 prefix 冲突，关闭）
// 章节正则：覆盖中英文 "第三章" / "Chapter 1" / "Part II" / "附录 A" / "Appendix B Multiple factors"
const CHAPTER_RE = /^(第[一二三四五六七八九十百千0-9]+[章节篇部回卷]|chapter\s+\d+|part\s+\d+|附录\s*[A-Z0-9]?|appendix\s+[A-Z\d]+)\b/i
// "1. Intro" / "2.3 Selecting…" / "2.3. Method"。要求标题首字符是大写，避免误吞 "100 million users…" 这类正文
const NUMBERED_HEADING_RE = /^(\d+(?:\.\d+)*\.?)\s+([A-Z].*)$/
// IEEE / ACM 风格的罗马数字顶层 heading："I. INTRODUCTION" / "II. RELATED WORK" / "VIII. CONCLUSION"
// 限制罗马数字长度 1-5 个字符（覆盖 I 到 XX 等正常论文章节数），避免误吞 "DM." / "MD." 等英文缩写
const ROMAN_HEADING_RE = /^([IVXLCDM]{1,5})\.\s+([A-Z].*)$/
const SENTENCE_END = /[.!?。！？]$/

/**
 * "悬空虚词"集合：被栏 / 页换行截断的正文行常停在冠词 / 介词 / 连词 / 系动词 /
 * 关系代词 / 限定词上（例："...are specific of the" 停在 "the"）。
 * 真实章节标题是名词短语，绝不会停在这些功能词上，故以它们结尾的"编号标题候选"
 * 几乎一定是被误判的正文截断行 —— 直接拒绝。
 */
const DANGLING_TAIL_WORDS = new Set<string>([
  // 冠词 / 限定词
  'a', 'an', 'the', 'this', 'these', 'those', 'that', 'such', 'its', 'their',
  'our', 'his', 'her', 'your', 'whose', 'each', 'every', 'any', 'some',
  // 介词
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto',
  'over', 'under', 'as', 'about', 'between', 'among', 'through', 'during',
  'without', 'within', 'upon', 'via', 'per',
  // 连词
  'and', 'or', 'nor', 'but', 'so', 'yet', 'if', 'which', 'while', 'whereas',
  'because', 'although', 'though', 'when', 'where', 'than', 'whether',
  // 系动词 / 助动词
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'has', 'have',
  'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'shall',
  'should', 'may', 'might', 'must',
])

/** 取标题末词（去尾随标点）并归一化为小写，用于 DANGLING_TAIL_WORDS 判定 */
function lastWordLower(s: string): string {
  const stripped = s.replace(/[)\].,;:'"’”]+$/u, '').trim()
  const parts = stripped.split(/\s+/)
  return (parts[parts.length - 1] ?? '').toLowerCase()
}

export type HeadingToken = {
  kind: 'heading'
  level: number
  /** 顶层 section 编号；只在 level === 1 的 heading 上有效 */
  sectionNumber: number
  /** 原始 heading 文本（不含 "N." 前缀；输出时由 formatter 决定是否加回） */
  text: string
  /** 编号 heading 的原始 number（"1"、"2.3"、"2.3.1"），无则 null */
  rawNumber: string | null
}

export type TextToken = {
  kind: 'text'
  text: string
  /** 段落所属顶层 section 号；为 0 表示 heading 出现前的"无章节"区域 */
  sectionNumber: number
  /** 段落在 section 内的 1-based 序号 */
  paragraphIndex: number
  /** 是否是该段的首个 line（用于 formatter 决定开新 `<p>` 还是合并） */
  startsParagraph: boolean
}

export type Token =
  | HeadingToken
  | TextToken
  | { kind: 'list'; text: string; sectionNumber: number }
  | { kind: 'ordered'; text: string; marker: string; sectionNumber: number }
  | { kind: 'blank' }

export interface FontStats {
  bodySize: number
  /** 字号 → heading level（h1 = 最大字号） */
  sizeToLevel: Map<number, number>
}

/**
 * 用"行总字符数"加权计算 body 字号；少量大字号标题不应压过正文。
 */
function analyzeFontStats(pages: StructuredPage[]): FontStats {
  const sizeCounts = new Map<number, number>()
  for (const page of pages) {
    for (const line of page.lines) {
      if (!line.text || !line.text.trim()) continue
      sizeCounts.set(line.size, (sizeCounts.get(line.size) ?? 0) + line.text.length)
    }
  }
  if (sizeCounts.size === 0) return { bodySize: 12, sizeToLevel: new Map() }

  let bodySize = 12
  let best = -1
  for (const [size, w] of sizeCounts) {
    if (w > best) {
      best = w
      bodySize = size
    }
  }
  const headingSizes = [...sizeCounts.keys()]
    .filter((s) => s >= bodySize * 1.05)
    .sort((a, b) => b - a)
  const sizeToLevel = new Map<number, number>()
  headingSizes.forEach((s, idx) => sizeToLevel.set(s, Math.min(6, idx + 1)))
  return { bodySize, sizeToLevel }
}

interface RepeatingChrome {
  firsts: Set<string>
  lasts: Set<string>
}

function findRepeatingLines(pages: StructuredPage[]): RepeatingChrome {
  if (pages.length < 3) return { firsts: new Set(), lasts: new Set() }
  const firstCounts = new Map<string, number>()
  const lastCounts = new Map<string, number>()
  for (const page of pages) {
    const ne = page.lines.filter((l) => l.text && l.text.trim())
    if (!ne.length) continue
    const f = ne[0]!.text.trim()
    const l = ne[ne.length - 1]!.text.trim()
    firstCounts.set(f, (firstCounts.get(f) ?? 0) + 1)
    lastCounts.set(l, (lastCounts.get(l) ?? 0) + 1)
  }
  const threshold = Math.ceil(pages.length * 0.6)
  const firsts = new Set([...firstCounts].filter(([, n]) => n >= threshold).map(([k]) => k))
  const lasts = new Set([...lastCounts].filter(([, n]) => n >= threshold).map(([k]) => k))
  return { firsts, lasts }
}

const isPageNumberLine = (s: string): boolean => /^(page\s*)?\d+\s*(\/\s*\d+)?$/i.test(s.trim())

/**
 * 不带 section meta 的初分类（line → "原型 token"）；section/paragraph 信息在 buildTokens 里二遍填充。
 */
type ProtoToken =
  | { kind: 'heading'; level: number; text: string; rawNumber: string | null }
  | { kind: 'list'; text: string }
  | { kind: 'ordered'; text: string; marker: string }
  | { kind: 'text'; text: string; startsParagraph: boolean }

/**
 * 接受 / 拒绝一个 numbered heading 候选。阿拉伯数字与罗马数字路径共用此筛选。
 *
 * 接受条件：
 *   - 总长度 ≤ 120（截掉超长正文句子）
 *   - 不以句末符号结尾（"...是的。" 类）
 *   - 不像引用条目（年份 / et al / ≥3 个逗号分号 → 是 References 内容）
 *   - 长度 ≤ 80 直通；80-120 需要 bold / 较大字号视觉证据兜底
 */
function acceptNumberedHeading(opts: {
  text: string
  titleText: string
  rawNumber: string
  level: number
  line: StructuredLine
  stats: FontStats
}): ProtoToken | null {
  const { text, titleText, rawNumber, level, line, stats } = opts
  if (text.length > 120) return null
  if (SENTENCE_END.test(text)) return null

  // 标题以"悬空虚词"结尾 → 几乎一定是被栏 / 页换行截断的正文行，不是 heading
  //   例："4 In order to examine if the detected pitfalls are specific of the"（结尾 "the"）
  //   真实章节标题是名词短语，绝不会停在冠词 / 介词 / 连词 / 系动词 / 关系代词上
  if (DANGLING_TAIL_WORDS.has(lastWordLower(titleText))) return null

  // Title 必须包含至少一个完整单词（连续 ≥3 字母）；否则可能是
  // "5. N" / "6. M m" 这种数学符号组合（公式编号 + 单字母变量）误进
  const hasRealWord = /[A-Za-z一-鿿]{3,}/.test(titleText)
  if (!hasRealWord) return null

  // 单词非关键词 → 必须有视觉证据（粗体 / 较大字号），避免表格里
  // "1. Closet" / "1. Open" / "2. Volume" 之类的单格数据被误识别为 heading。
  // 多词标题或匹配 SECTION_KEYWORD 的单词标题不受此限制。
  const titleWords = titleText.trim().split(/\s+/).filter(Boolean).length
  const isSingleNonKeywordWord =
    titleWords === 1 && !SECTION_KEYWORD_RE.test(titleText.trim())
  if (isSingleNonKeywordWord) {
    const hasVisualEvidence = line.bold || line.size >= stats.bodySize * 1.05
    if (!hasVisualEvidence) return null
  }

  // 公式 / 表格行排除：title 含数学运算符 / 下划线 / unicode 数学连字
  //   例："STD_2M ST D(CloseO pent−1"、"Closet−1"、"X = ∑a_i"
  const looksLikeFormula = /[_=∗*†‡§<>≤≥≈≠×÷±√∑∏∫]|−/.test(titleText)
  if (looksLikeFormula) return null

  // 多句话 → 不是 heading（heading 通常是名词短语，不会出现"句号 + 大写起手"的句间分隔）
  //   例："Release frequency (tempo) improves. Increasing the frequency of..."
  //   实际是正文里的编号列表项，被 NUMBERED_HEADING_RE 误吞
  const hasMultipleSentences = /\.\s+[A-Z]/.test(titleText)
  if (hasMultipleSentences) return null

  // 作者机构 affiliation 排除：典型的署名信息有 University / Institute / Department 等关键词
  //   例："Yuchen Gu Jiangsu Collaborative Innovation Center of Atmospheric"
  //       "School of Software, Nanjing University of Information"
  const looksLikeAffiliation = /\b(University|Institute|Department|School\s+of|College|Academy|Laboratory|Collaborative\s+Innovation|Faculty\s+of)\b/i.test(titleText)
  if (looksLikeAffiliation) return null

  const punctCount = (titleText.match(/[,;]/g) ?? []).length
  const looksLikeCitation =
    /\b(19|20)\d{2}\b/.test(titleText) ||
    /\bet\s+al\.?/i.test(titleText) ||
    punctCount >= 3
  if (looksLikeCitation) return null
  const tooLong = text.length > 80
  const hasVisual = line.bold || line.size >= stats.bodySize * 1.05
  if (tooLong && !hasVisual) return null
  return { kind: 'heading', level, text: titleText, rawNumber }
}

function classifyLine(line: StructuredLine, stats: FontStats): ProtoToken | null {
  const text = line.text.trim()
  if (!text) return null

  // 1a. 阿拉伯数字编号 heading："1. Intro" / "2.3 Method"
  //
  //   旧版要求 bold || size>=body*1.05；但 MDPI / IEEE 期刊里 "1. Introduction" 的字体
  //   并不一定比正文粗或大，导致 section heading 被吞回正文。
  //
  //   新策略：放宽视觉约束，靠"citation 特征"反向排除参考文献条目（见 acceptNumberedHeading）
  const numbered = text.match(NUMBERED_HEADING_RE)
  if (numbered) {
    const rawNumber = numbered[1]!.replace(/\.$/, '')
    const titleText = numbered[2]!.trim()
    const depth = rawNumber.split('.').length
    const tok = acceptNumberedHeading({ text, titleText, rawNumber, level: Math.min(6, depth), line, stats })
    if (tok) return tok
  }

  // 1b. 罗马数字编号 heading："I. INTRODUCTION" / "II. RELATED WORK"（IEEE / ACM 常见）
  //   罗马数字字符集 [IVXLCDM]，限定长度 ≤5（覆盖 I-XXXIX），同 acceptNumberedHeading 规则
  const roman = text.match(ROMAN_HEADING_RE)
  if (roman) {
    const rawNumber = roman[1]!
    const titleText = roman[2]!.trim()
    const tok = acceptNumberedHeading({ text, titleText, rawNumber, level: 1, line, stats })
    if (tok) return tok
  }

  // 2. 章节 regex（"第三章" / "Chapter 1" / "附录 A"）
  if (CHAPTER_RE.test(text)) return { kind: 'heading', level: 1, text, rawNumber: null }

  // 2b. 多研究论文的 "Study N: Title" / "Studies 2a and 2b: ..." / "Experiment 3"
  //     纯模式识别，不依赖字号 / 粗体 —— 这类标题在 MDPI / APA 期刊里常用 italic 而非 bold，
  //     而 italic 不在 line metadata 里
  if (STUDY_HEADING_RE.test(text)) return { kind: 'heading', level: 1, text, rawNumber: null }

  // 3. 字号驱动的标题（无编号的 heading：title / Abstract / References / ...）
  const lvl = stats.sizeToLevel.get(line.size)
  if (lvl) return { kind: 'heading', level: lvl, text, rawNumber: null }

  // 4. 粗体短行 —— h4 级子标题（典型："Method"、"Results"）
  if (line.bold && text.length <= 50 && !SENTENCE_END.test(text)) {
    return { kind: 'heading', level: 4, text, rawNumber: null }
  }

  // 5. bullet list（标题判定靠后才跑，避免 "1. Section" 被吞）
  //
  // 注意：原本这里还有 ORDERED_RE 检测（`1. foo` / `a) bar`），但参考文献正文里
  // "Calixto 2017. Multilingual ..." 跨行后会产生 "1. Multilingual" 之类的伪有序前缀，
  // 把段落硬切开。学术正文里真正的有序列表很少，误识别代价大于漏识别，故彻底关闭 ——
  // 这类行原样落入 `<p>` 文本，由读者从原文判断。
  const bullet = text.match(BULLET_RE)
  if (bullet) return { kind: 'list', text: bullet[1]!.trim() }

  return { kind: 'text', text, startsParagraph: line.startsParagraph }
}

/**
 * 非编号"顶层 section"的常见关键词；命中时强制按 level=1 + 进 OUTLINE
 *
 * 允许尾部冒号（"Background:"）与简短补充（"Methods and Materials"），
 * 因为 BMJ-style 临床论文常用 "Methods:" / "Results:" 作小标题。
 *
 * 新增覆盖 MDPI / Elsevier 末段的元信息节：Author Contributions / Funding /
 * Conflicts of Interest / Data Availability / Ethics Statement / Keywords /
 * Competing Interests / Open Access / Declarations。
 */
const SECTION_KEYWORD_RE = /^(abstract|introduction|background|related\s+work|method(?:s|ology)?(?:\s+(?:and|&)\s+materials?)?|materials?\s+and\s+methods?|results?(?:\s+and\s+discussion)?|findings?|discussion|conclusion[s]?|acknowledgements?|references?|appendix\s*[A-Z0-9]?|bibliography|supplement(?:ary)?(?:\s+material)?|author\s+contributions?|funding|conflicts?\s+of\s+interest|data\s+availability(?:\s+statement)?|ethics?\s+statement|keywords?|competing\s+interests?|open\s+access|declarations?|general\s+discussion|alternative\s+accounts?|overview|limitations(?:\s+and\s+future\s+(?:work|directions?))?)[:\.]?\s*$/i

/**
 * 多研究论文的研究段落标题，常见于心理学 / 行为经济学 / 实验科学论文。
 * 匹配：
 *   - "Study 1" / "Study 2a" / "Study 1: Twitter"
 *   - "Studies 2a and 2b: Multi-Issue Correlations"
 *   - "Experiment 1" / "Experiment 3: ..."
 *   - "Pilot Study" / "Pilot Studies"
 *
 * 命中后作为 level=1 顶层 section 处理，下层的 Method/Results/Discussion
 * 通过"关键词重复降级"规则自动落到 level=2。
 */
const STUDY_HEADING_RE = /^(stud(?:y|ies)|experiments?|pilot\s+stud(?:y|ies))\s+\d+[a-z]?(?:\s+and\s+\d+[a-z]?)*(?:\s*[:：].*)?$/i

/**
 * 内联 section 前缀（MDPI 风格 "Abstract: With ..." / "Acknowledgements This ..."）。
 *
 * 拆成 keyword + body 两部分：keyword 当 level=1 heading（落入 SECTION_KEYWORD_RE
 * 命中走"keyword 晋升顶层 section"路径），body 当正文首段。
 *
 * 分隔符兼容两种：
 *   - 冒号（"Abstract:"）  ← Springer / Elsevier 常见
 *   - 单纯空格（"Acknowledgements This work..."）  ← MDPI 偏好
 *
 * Body 必须以大写字母或数字起手（避免误吞 "References to prior work are..." 这类
 * 把关键词当首词的正文句子）。
 */
// 注意：故意不带 /i flag —— /i 会让字符类 [A-Z\d] 也匹配小写，
// 导致 "References to prior work are crucial." 这种正文句子被误吞为 inline section。
// 学术论文里 section 关键词都是 TitleCase 首字母大写，写死大小写是合理代价。
const INLINE_SECTION_PREFIX_RE = /^(Abstract|Keywords?|Author\s+Contributions?|Funding|Conflicts?\s+of\s+Interest|Competing\s+Interests?|Acknowledgements?|Data\s+Availability(?:\s+Statement)?|Ethical\s+and\s+informed\s+consent[^:\n]*?|Ethics?\s+Statement|References?|Bibliography|Open\s+Access|Declarations?)(?:[:：]\s*|\s+)([A-Z\d].+)$/

export interface BuildTokensResult {
  tokens: Token[]
  stats: FontStats
}

export function buildTokens(pages: StructuredPage[]): BuildTokensResult {
  const stats = analyzeFontStats(pages)
  const { firsts, lasts } = findRepeatingLines(pages)

  // 第一遍：line → proto token；先不填 section 信息
  const protos: ProtoToken[] = []
  /**
   * 跟踪上一个 heading 的源 line，用于"标题续行"合并：
   *   PDF 中长标题（如 "4. Multi-factor stock trading strategy based on DQN with
   *   Multi-BiGRU and Multi-head ProbSparse Self-attention"）经常跨 2-3 个 visual line。
   *   只有第一行匹配 NUMBERED_HEADING_RE 成为 heading，剩余行落到 text，OUTLINE 标题被截断。
   *   现在的合并规则：上一行刚出过 heading + 本行字号 ≈ heading line 字号 + 本行首字符小写
   *   → 视为标题续行，追加到上一个 heading 的 text
   */
  let lastHeadingLine: StructuredLine | null = null
  for (const page of pages) {
    const lines = page.lines.filter((l) => l.text && l.text.trim())
    let firstOnPage = true
    for (const line of lines) {
      const text = line.text.trim()

      // 仅当行字号属于 chrome 级（≤body 1.05x）时才剔除重复页眉页脚
      const isChromeSize = line.size <= stats.bodySize * 1.05
      if (isChromeSize && (firsts.has(text) || lasts.has(text))) continue
      if (isPageNumberLine(text)) continue
      // 仅极小字号（< body·0.6x）视为水印 / microprint，丢
      // 之前阈值 0.85 过于激进 —— MDPI / Springer 论文的参考文献条目字号常为正文 ~80%，
      // 0.85 会把整段 References 滤掉。降到 0.6 保留 references / 脚注 / 图表注释，
      // 仍能挡住真正的水印
      if (line.size < stats.bodySize * 0.6) continue

      // 内联 section 前缀拆解（"Abstract: With the improvement..." → heading + body）
      // 命中时同时塞两个 proto：keyword heading + 剩余 body 作首段
      const inline = text.match(INLINE_SECTION_PREFIX_RE)
      if (inline) {
        const keyword = inline[1]!.trim()
        const body = inline[2]!.trim()
        protos.push({ kind: 'heading', level: 1, text: keyword, rawNumber: null })
        if (body.length > 0) {
          protos.push({ kind: 'text', text: body, startsParagraph: true })
        }
        firstOnPage = false
        lastHeadingLine = null
        continue
      }

      const tok = classifyLine(line, stats)
      if (!tok) continue
      // 标题续行合并：多视觉信号共同识别（合并不论 classifyLine 把本行分到 text 还是 heading）
      //   - 上一行是 heading
      //   - 字号 ≈ heading 字号（±0.5pt）
      //   - 粗体状态一致
      //   - Y 距离在 0~3 倍 heading 字号内（典型行间距）
      //   - 本行不以句末符号结尾（真正的续行是短语，不会自带句号）
      //   - 本行 ≤ 80 字符（heading 级别，正文长句通常 > 80）
      //   - **本行不是独立 heading 起手**（避免把相邻的 "11. Foo" 合并到 "10. Bar" 里、
      //     或把 "Appendix B" 合并到 "Appendix A" 里）
      // 不强制首字符小写：很多论文标题续行含 PascalCase 专有名词（"Multi-head ProbSparse..."）
      const yDiff = lastHeadingLine ? lastHeadingLine.y - line.y : 0
      const startsLikeOwnHeading =
        NUMBERED_HEADING_RE.test(text) ||
        ROMAN_HEADING_RE.test(text) ||
        CHAPTER_RE.test(text)
      // 正文起手特征：内联 colon-label（"Motivating Example: Suppose..."、"Definition:" 等）
      // 或常见正文连接词起手（"The X is..."、"We propose"、"Suppose"、"Consider"、"In this"），
      // 命中说明这是正文段落首行，不是 heading 续行 —— 即便字号 / 粗体与 heading 一致
      // （MDPI / Elsevier 期刊里 bold italic lead-in 与 heading 视觉信号几乎一致）
      const looksLikeBodyStart =
        /^[A-Z][A-Za-z\s]{2,30}[：:]\s+[A-Z]/.test(text) ||
        /^(The|We|This|These|In\s+(?:this|the|a|an)|Suppose|Consider|Let|Assume|Note\s+that|Recall|For|To|If|When|While|Here|Our|Most|Many|Some|It\s+is|There\s+(?:is|are|exists?))\b\s+\S+\s+\S+/.test(text)
      const isContinuation =
        lastHeadingLine !== null &&
        !startsLikeOwnHeading &&
        !looksLikeBodyStart &&
        Math.abs(line.size - lastHeadingLine.size) <= 0.5 &&
        line.bold === lastHeadingLine.bold &&
        yDiff > 0 &&
        yDiff <= lastHeadingLine.size * 3 &&
        !SENTENCE_END.test(text) &&
        text.length <= 60
      if (isContinuation) {
        const lastProto = protos[protos.length - 1]
        if (lastProto && lastProto.kind === 'heading') {
          const merged = `${lastProto.text} ${text}`.replace(/\s+/g, ' ').trim()
          // 合并后超过 120 字符 → 视为非 heading 续行。真实多行论文标题极少超 120 字符，
          // 超过的几乎都是 body text 累积污染（典型："Motivating Example: Suppose an
          // e-commerce website observes that 5% of their visitors make a purchase ..."）
          if (merged.length <= 120) {
            lastProto.text = merged
            lastHeadingLine = line // 支持 3+ 行连续续行，每行基于上一续行 Y 计算
            firstOnPage = false
            continue
          }
          // 超长 → fall through，本行正常处理；lastHeadingLine 保持，下次还可能再次尝试合并
          // 但既然这条 heading 已经接近上限，后续大概率也不会满足约束
        }
      }
      // 页内首行强制视为新段开始，避免跨页错合并
      if (tok.kind === 'text' && firstOnPage) tok.startsParagraph = true
      firstOnPage = false
      // 更新 lastHeadingLine：heading 后允许下一行合并；其他 token 打断合并链
      lastHeadingLine = tok.kind === 'heading' ? line : null
      protos.push(tok)
    }
  }

  // 第二遍：维护 sectionNumber + paragraphIndex；遇到 heading（特别是 level=1）切换 section
  const out: Token[] = []
  let sectionCounter = 0
  let paragraphIndex = 0
  let inParagraph = false
  // 进入 References / Bibliography section 后，禁止再识别任何 heading ——
  // 参考文献条目"11. Multilingual multi-modal embeddings" 这种行的前缀数字
  // 是文献编号、不是 section number，识别为 heading 会让 OUTLINE 出现一堆假章节
  let inReferencesSection = false
  const REFS_KEYWORD_RE = /^(references?|bibliography)\b/i

  // 多研究论文的"关键词重复降级"：
  //   同一个 SECTION_KEYWORD（Method/Results/Discussion 等）在文档里出现 2 次以上时，
  //   第 2 次及之后的不再晋升 level=1 / 不进 OUTLINE，而是降级到 level=2 作为
  //   "Study N" 顶层 section 的子节。
  //
  //   归一化：lowercase + 去尾标点 + 折叠空白；这样 "Method:" / "Methods" / "Method"
  //   归一到同一 key。
  const seenKeywordTops = new Set<string>()
  const normalizeKeyword = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[:\.：]\s*$/, '')
      .replace(/s\b/g, '') // method/methods → method, result/results → result
      .replace(/\s+/g, ' ')
      .trim()

  // 终极兜底阈值：超长 heading（>120 字符）降级为 text。
  // 命中场景：编号正文列表项被 NUMBERED_HEADING_RE + 续行合并组合误识别。
  // 多层防御里这是最后一道：第一层 hasMultipleSentences、第二层合并停于 120，
  // 此处兜底保证最终 heading 严格短于 120。
  const MAX_HEADING_LEN = 120

  for (const p of protos) {
    if (p.kind === 'heading') {
      // 兜底：超长 heading 降级到 text
      if (p.text.length > MAX_HEADING_LEN) {
        if (!inParagraph) {
          paragraphIndex++
          inParagraph = true
        }
        const rebuilt = p.rawNumber ? `${p.rawNumber}. ${p.text}` : p.text
        out.push({
          kind: 'text',
          text: rebuilt,
          sectionNumber: sectionCounter,
          paragraphIndex,
          startsParagraph: false,
        })
        continue
      }
      // References / Bibliography 之后所有 heading proto 一律降级为正文文本
      // 把数字前缀拼回去，让"11. xxx"以原文形态留在 References 段落里
      if (inReferencesSection) {
        const rebuilt = p.rawNumber ? `${p.rawNumber}. ${p.text}` : p.text
        if (!inParagraph) {
          paragraphIndex++
          inParagraph = true
        }
        out.push({
          kind: 'text',
          text: rebuilt,
          sectionNumber: sectionCounter,
          paragraphIndex,
          startsParagraph: false,
        })
        continue
      }

      // 判定是否是"真·顶层 section"：
      //   (a) 编号 heading 且 depth=1（"1. Intro"、"2. Method"）
      //   (b) 字号驱动 + 文本命中常见 section 关键词（Abstract / References 等）
      //   (c) CHAPTER 类前缀（"Appendix A Glossary"、"第三章"、"附录 A"）也算独立顶层 section
      // 标题（最大字号但既无编号也非关键词也非 chapter）是 level=1 但**不**算 section ——
      // sectionCounter 不变，保持 0，title 落到 preamble，不进 OUTLINE
      const isNumberedTop = p.rawNumber !== null && !p.rawNumber.includes('.')
      const trimmedText = p.text.trim()
      const matchesKeyword = SECTION_KEYWORD_RE.test(trimmedText)
      const isStudyTop = p.rawNumber === null && STUDY_HEADING_RE.test(trimmedText)
      const isChapterTop = p.rawNumber === null && CHAPTER_RE.test(trimmedText)
      // 关键词重复降级：第 2 次出现同一关键词，不再算顶层 section
      const keywordKey = matchesKeyword ? normalizeKeyword(trimmedText) : ''
      const isKeywordRepeat = matchesKeyword && seenKeywordTops.has(keywordKey)
      const isKeywordTop =
        p.rawNumber === null && matchesKeyword && !isKeywordRepeat
      const isRealSection = isNumberedTop || isKeywordTop || isStudyTop || isChapterTop

      if (isRealSection) {
        sectionCounter++
        paragraphIndex = 0
        inParagraph = false
        if (isKeywordTop) seenKeywordTops.add(keywordKey)
        // 命中 References / Bibliography → 进入"参考文献状态"，后续 heading proto 全降级
        if (REFS_KEYWORD_RE.test(trimmedText)) {
          inReferencesSection = true
        }
      }
      // outLevel 决策：
      //   - keyword 晋升：强制 level=1
      //   - keyword 重复（Method 第 2 次以后）：强制 level=2，作为最近顶层 section 的子节
      //   - STUDY 顶层：强制 level=1
      //   - 其他：保留 proto level
      let outLevel = p.level
      if (isKeywordTop || isStudyTop) outLevel = 1
      else if (isKeywordRepeat) outLevel = 2
      out.push({
        kind: 'heading',
        level: outLevel,
        text: p.text.replace(/[:\.]\s*$/, ''),
        rawNumber: p.rawNumber,
        sectionNumber: sectionCounter,
      })
      inParagraph = false
      continue
    }
    if (p.kind === 'list') {
      out.push({ kind: 'list', text: p.text, sectionNumber: sectionCounter })
      inParagraph = false
      continue
    }
    if (p.kind === 'ordered') {
      out.push({
        kind: 'ordered',
        text: p.text,
        marker: p.marker,
        sectionNumber: sectionCounter,
      })
      inParagraph = false
      continue
    }
    // text
    // 段落边界策略（v2）：只在"heading / list / ordered 之后的首个 text"才 ++ paragraphIndex。
    // 不再用 annotateParagraphs 的启发式段落断点（gap / indent / column 切换），那种粒度
    // 对论文正文太碎了——一个标题下经常被切出 70+ 个 `<p>`，密集且没增量信息。
    // 现在的语义：一个 heading（含 subsection）下塞一个 `<p>`，正文段落语义由读者 / LLM 还原。
    if (!inParagraph) {
      paragraphIndex++
      inParagraph = true
    }
    // 首个 heading 出现前的文本（cover / abstract / 作者列表）归到 sectionNumber=0
    // —— preamble 在 formatter 里走"原文逐行展示"分支，不进 `<p>` 包装
    out.push({
      kind: 'text',
      text: p.text,
      sectionNumber: sectionCounter,
      paragraphIndex,
      startsParagraph: p.startsParagraph || out.at(-1)?.kind !== 'text',
    })
  }

  return { tokens: out, stats }
}
