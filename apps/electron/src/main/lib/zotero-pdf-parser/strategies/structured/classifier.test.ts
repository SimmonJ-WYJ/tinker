/**
 * classifier 段落合并语义测试
 *
 * 核心约定（v2）：一个 heading（含 subsection）下 = 一个 `<p>`，正文行
 * 不再按"启发式段落断点"切碎。验证：
 *  - heading 之间的多行 text 都拿到同一个 paragraphIndex
 *  - subsection heading 后 paragraphIndex 递增
 *  - list / ordered 也作为段落边界
 *  - 顶层 section 切换时 paragraphIndex 重置到 1
 */

import { test, expect } from 'bun:test'
import type { StructuredLine, StructuredPage } from './extractor'
import { buildTokens, type Token } from './classifier'

function mkLine(opts: Partial<StructuredLine> & { text: string }): StructuredLine {
  return {
    text: opts.text,
    y: opts.y ?? 700,
    x: opts.x ?? 100,
    xEnd: opts.xEnd ?? 500,
    size: opts.size ?? 10,
    bold: opts.bold ?? false,
    column: opts.column ?? 'full',
    startsParagraph: opts.startsParagraph ?? false,
  }
}

function mkPage(lines: StructuredLine[]): StructuredPage {
  return { page: 1, lines, pageWidth: 612 }
}

/** 提取 text token 的 (section, paragraphIndex, text) 三元组，便于断言 */
function textKey(tok: Token): string {
  if (tok.kind !== 'text') return `[${tok.kind}]`
  return `s${tok.sectionNumber}p${tok.paragraphIndex}:${tok.text}`
}

test('classifier: heading 之间所有 text 共享 paragraphIndex', () => {
  const pages = [
    mkPage([
      // 编号 heading "1. Intro"（粗体 + 略大字号 → 命中 NUMBERED_HEADING_RE）
      mkLine({ text: '1. Introduction', size: 11, bold: true, y: 700 }),
      // 三行正文 —— 即便 startsParagraph 误标也应合并
      mkLine({ text: 'Line one of intro.', y: 680, startsParagraph: true }),
      mkLine({ text: 'Line two of intro.', y: 660, startsParagraph: true }),
      mkLine({ text: 'Line three of intro.', y: 640, startsParagraph: true }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const texts = tokens.filter((t) => t.kind === 'text')
  expect(texts.length).toBe(3)
  expect(texts.every((t) => t.kind === 'text' && t.sectionNumber === 1)).toBe(true)
  expect(texts.every((t) => t.kind === 'text' && t.paragraphIndex === 1)).toBe(true)
})

test('classifier: subsection heading 后 paragraphIndex 递增', () => {
  const pages = [
    mkPage([
      mkLine({ text: '1. Introduction', size: 11, bold: true, y: 700 }),
      mkLine({ text: 'Intro line 1', y: 680 }),
      mkLine({ text: 'Intro line 2', y: 660 }),
      // subsection "1.1 Background"（depth=2）
      mkLine({ text: '1.1 Background', size: 11, bold: true, y: 620 }),
      mkLine({ text: 'BG line 1', y: 600 }),
      mkLine({ text: 'BG line 2', y: 580 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const keys = tokens.map(textKey).filter((k) => k.startsWith('s'))
  expect(keys).toEqual([
    's1p1:Intro line 1',
    's1p1:Intro line 2',
    's1p2:BG line 1',
    's1p2:BG line 2',
  ])
})

test('classifier: 顶层 section 切换重置 paragraphIndex 到 1', () => {
  const pages = [
    mkPage([
      mkLine({ text: '1. Introduction', size: 11, bold: true, y: 700 }),
      mkLine({ text: 'Intro p1 line a', y: 680 }),
      mkLine({ text: 'Intro p1 line b', y: 660 }),
      mkLine({ text: '2. Methods', size: 11, bold: true, y: 620 }),
      mkLine({ text: 'Methods line a', y: 600 }),
      mkLine({ text: 'Methods line b', y: 580 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const keys = tokens.map(textKey).filter((k) => k.startsWith('s'))
  expect(keys).toEqual([
    's1p1:Intro p1 line a',
    's1p1:Intro p1 line b',
    's2p1:Methods line a',
    's2p1:Methods line b',
  ])
})

test('classifier: 罗马数字顶层 heading（IEEE / ACM 风格）', () => {
  const pages = [
    mkPage([
      mkLine({ text: 'I. INTRODUCTION', size: 10, bold: false, y: 700 }),
      mkLine({ text: 'Body of intro section.', y: 680 }),
      mkLine({ text: 'II. RELATED WORK', size: 10, bold: false, y: 640 }),
      mkLine({ text: 'Body of related work.', y: 620 }),
      mkLine({ text: 'VIII. CONCLUSION', size: 10, bold: false, y: 580 }),
      mkLine({ text: 'Body of conclusion.', y: 560 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  expect(headings.length).toBe(3)
  // sectionCounter 顺序 1, 2, 3（auto 编号，与 paper 原本的 I/II/VIII 解耦）
  const headingMeta = headings.map((h) =>
    h.kind === 'heading' ? `s${h.sectionNumber}:L${h.level}:${h.rawNumber}:${h.text}` : '',
  )
  expect(headingMeta).toEqual([
    's1:L1:I:INTRODUCTION',
    's2:L1:II:RELATED WORK',
    's3:L1:VIII:CONCLUSION',
  ])
})

test('classifier: 单词非 keyword 标题 + 无视觉证据 → 拒绝（避免吞表格 "1. Closet"）', () => {
  const pages = [
    mkPage([
      mkLine({ text: '1. Closet', y: 800 }), // 1 个非关键词单词 + 无 bold + 无大字号
      mkLine({ text: '2. Open', y: 780 }),
      mkLine({ text: '3. Introduction', y: 760 }), // keyword "Introduction" → 通过
      mkLine({ text: '4. Algorithm', size: 12, bold: true, y: 740 }), // 单词非 keyword + 视觉证据 → 通过
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  expect(headings.length).toBe(2)
  const titles = headings.map((h) => (h.kind === 'heading' ? h.text : ''))
  expect(titles).toEqual(['Introduction', 'Algorithm'])
})

test('classifier: MDPI 风格内联 section（无冒号）"Acknowledgements This..." / "References 1. ..."', () => {
  const pages = [
    mkPage([
      mkLine({ text: '1. Introduction', size: 12, bold: true, y: 1000 }),
      mkLine({ text: 'Some body text here.', size: 10, y: 980 }),
      mkLine({ text: 'Acknowledgements This work is supported by funding', size: 10, y: 900 }),
      mkLine({ text: 'References 1. Smith J 2020 Some paper', size: 10, y: 800 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  const headingTexts = headings.map((h) => (h.kind === 'heading' ? h.text : ''))
  expect(headingTexts).toEqual(['Introduction', 'Acknowledgements', 'References'])
  const allTexts = tokens
    .filter((t) => t.kind === 'text')
    .map((t) => (t.kind === 'text' ? t.text : ''))
  expect(allTexts).toContain('This work is supported by funding')
})

test('classifier: 关键词位于句首但 body 小写起手 → 不被误识别为 inline section', () => {
  const pages = [
    mkPage([
      mkLine({ text: '1. Introduction', size: 12, bold: true, y: 800 }),
      mkLine({ text: 'References to prior work are crucial.', size: 10, y: 780 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  expect(headings.length).toBe(1)
})

test('classifier: CHAPTER_RE 命中（Appendix A）也算真 section，递增 counter', () => {
  // 之前 bug：Conclusion 是 section 6，Appendix A 没递增 counter 也输出 "6. Appendix A"
  const pages = [
    mkPage([
      mkLine({ text: '1. Introduction', y: 800 }),
      mkLine({ text: '2. Conclusion', y: 780 }),
      mkLine({ text: 'Appendix A Glossary', size: 12, bold: true, y: 740 }),
      mkLine({ text: 'Appendix B Multiple factors', size: 12, bold: true, y: 700 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  // 4 个 heading 都该入 OUTLINE，且 sectionNumber 1→2→3→4
  expect(headings.length).toBe(4)
  const meta = headings.map((h) => (h.kind === 'heading' ? `s${h.sectionNumber}:${h.text}` : ''))
  expect(meta).toEqual([
    's1:Introduction',
    's2:Conclusion',
    's3:Appendix A Glossary',
    's4:Appendix B Multiple factors',
  ])
})

test('classifier: 正文里的编号列表项（含"句号 + 大写"多句话）不被识别为 heading', () => {
  // 真实场景：论文里 "Lessons learned: 1. Foo improves... 2. Bar matters..." 这种
  // 编号正文段，每条以句号 + 大写起手继续，是普通正文不是 section
  const pages = [
    mkPage([
      mkLine({ text: '1. Introduction', size: 12, bold: true, y: 800 }),
      mkLine({
        text: '3. Release frequency improves. Increasing the frequency of software developments',
        y: 780,
      }),
      mkLine({
        text: '4. Agreement on OEC matters. An experiment scorecard shows thousands of results.',
        y: 760,
      }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  // 只保留 Introduction，3/4 项因多句话被拒
  expect(headings.length).toBe(1)
  const headingText = headings[0]?.kind === 'heading' ? headings[0].text : ''
  expect(headingText).toBe('Introduction')
})

test('classifier: 超长合并兜底 —— 续行累积 > 200 字符 → 不再合并 + 后续降级', () => {
  // 模拟编号正文项第一行短，可绕过 hasMultipleSentences，但续行不断累积
  const longLine = 'evaluated in isolation allow quick corrections before major maldevelopments have big consequences and rollbacks may take place'
  const pages = [
    mkPage([
      mkLine({ text: '3. Release frequency improves', size: 10, y: 800 }),
      mkLine({ text: longLine, size: 10, y: 780 }),
      mkLine({ text: longLine, size: 10, y: 760 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  // heading 文本应 ≤ 200 字符（合并停于阈值）
  for (const h of headings) {
    if (h.kind === 'heading') expect(h.text.length).toBeLessThanOrEqual(200)
  }
})

test('classifier: 公式 / 表格行（含 _ / − / 数学符号）不被识别为 heading', () => {
  const pages = [
    mkPage([
      mkLine({ text: '1. Introduction', y: 800 }),
      mkLine({ text: '7. STD_2M ST D(CloseO pent−1', y: 700 }),
      mkLine({ text: '8. Closet−1', y: 680 }),
      mkLine({ text: '9. X = ∑ a_i * b_i', y: 660 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  expect(headings.length).toBe(1) // 只剩 Introduction
})

test('classifier: 作者机构 affiliation 不被识别为 heading', () => {
  const pages = [
    mkPage([
      mkLine({ text: '1. Introduction', y: 800 }),
      mkLine({ text: '2. Yuchen Gu Jiangsu Collaborative Innovation Center', y: 700 }),
      mkLine({ text: '3. School of Software, Nanjing University of Information', y: 680 }),
      mkLine({ text: '4. Department of Computer Science', y: 660 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  expect(headings.length).toBe(1) // 只剩 Introduction
})

test('classifier: Appendix A/B/C 被识别为顶层 section', () => {
  const pages = [
    mkPage([
      mkLine({ text: '1. Introduction', y: 800 }),
      mkLine({ text: 'Appendix A Glossary', y: 700, size: 12, bold: true }),
      mkLine({ text: 'Appendix B Multiple factors', y: 680, size: 12, bold: true }),
      mkLine({ text: 'Appendix C Multi-factor data of 40 A-shares', y: 660, size: 12, bold: true }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  expect(headings.length).toBe(4) // Introduction + 3 个 Appendix
})

test('classifier: 标题跨行合并（含 PascalCase 续行 "Multi-head ProbSparse"）', () => {
  const pages = [
    mkPage([
      mkLine({ text: '4. Multi-factor stock trading strategy based', size: 12, bold: true, y: 800 }),
      mkLine({ text: 'on DQN with Multi-BiGRU and Multi-head', size: 12, bold: true, y: 780 }),
      // 大写起始（PascalCase 专有名词）也应合并 —— 靠 size+bold+Y+短+无句末符号
      mkLine({ text: 'ProbSparse Self-attention', size: 12, bold: true, y: 760 }),
      mkLine({ text: 'The proposed model is...', size: 10, y: 740 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  expect(headings.length).toBe(1)
  const h = headings[0]
  if (h?.kind === 'heading') {
    expect(h.text).toBe(
      'Multi-factor stock trading strategy based on DQN with Multi-BiGRU and Multi-head ProbSparse Self-attention',
    )
  }
})

test('classifier: 大写起始 / 不同字号 → 不被合并到 heading', () => {
  const pages = [
    mkPage([
      mkLine({ text: '1. Introduction', size: 12, bold: true, y: 800 }),
      // 首字符大写 + 句号结尾 → 不命中续行也不命中 bold-short-line（避免吞 heading）
      mkLine({ text: 'Some sentence starting with capital letter ending in period.', size: 10, y: 780 }),
      // 字号不同（body）→ 不像续行
      mkLine({ text: 'normal body text here', size: 10, y: 760 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  expect(headings.length).toBe(1)
  const h = headings[0]
  if (h?.kind === 'heading') {
    expect(h.text).toBe('Introduction')
  }
})

test('classifier: 公式编号 + 数学变量"5. N" / "6. M m" 不被识别为 heading', () => {
  // PDF 提取经常把等式右栏编号 "(5)" 和正文里的数学变量挤到同一行 → "5. N"
  // title 没有任何"完整单词"（≥3 字母）→ 拒绝当 heading
  const pages = [
    mkPage([
      mkLine({ text: '1. Introduction', size: 10, bold: false, y: 700 }),
      mkLine({ text: '5. N', size: 10, bold: false, y: 680 }),
      mkLine({ text: '6. M m', size: 10, bold: false, y: 660 }),
      mkLine({ text: '7. Discussion', size: 10, bold: false, y: 640 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  // 只识别 Introduction 和 Discussion 两个真 heading，数学符号被过滤
  expect(headings.length).toBe(2)
  const headingTexts = headings.map((h) => (h.kind === 'heading' ? h.text : ''))
  expect(headingTexts).toEqual(['Introduction', 'Discussion'])
})

test('classifier: 进入 References 后不再识别后续 heading（避免引用条目伪 section）', () => {
  // 模拟"正文足够多 → bodySize=10"，References + 条目都在 10pt（避免字号干扰投票）
  const bodyLines: StructuredLine[] = []
  for (let i = 0; i < 10; i++) {
    bodyLines.push(mkLine({ text: 'normal body line of paper content here', y: 800 - i * 20 }))
  }
  const pages = [
    mkPage([
      mkLine({ text: '1. Introduction', y: 1000 }),
      ...bodyLines,
      mkLine({ text: 'References', y: 600, bold: true }),
      mkLine({ text: '11. Multilingual multi-modal embeddings', y: 580 }),
      mkLine({ text: '12. Associating neural word embeddings', y: 560 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  const headingTexts = headings.map((h) => (h.kind === 'heading' ? h.text : ''))
  // 只剩 Introduction + References；11/12 条目被降级为 text
  expect(headingTexts).toEqual(['Introduction', 'References'])
  const refsRelatedTexts = tokens
    .filter((t) => t.kind === 'text')
    .map((t) => (t.kind === 'text' ? t.text : ''))
  expect(refsRelatedTexts).toContain('11. Multilingual multi-modal embeddings')
  expect(refsRelatedTexts).toContain('12. Associating neural word embeddings')
})

test('classifier: 罗马数字 heading 不吞 citation（"V. Smith et al. 2020"）', () => {
  // citation 特征命中（年份 + et al）→ 拒绝当 heading
  const pages = [
    mkPage([
      mkLine({ text: 'V. Smith, J. et al. 2020. Some paper title.', y: 700 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  // 没有 heading 被识别，原行保留为 text
  expect(tokens.filter((t) => t.kind === 'heading').length).toBe(0)
})

test('classifier: list / ordered 作为段落边界', () => {
  const pages = [
    mkPage([
      mkLine({ text: '1. Introduction', size: 11, bold: true, y: 700 }),
      mkLine({ text: 'Before list', y: 680 }),
      mkLine({ text: '- item 1', y: 660 }),
      mkLine({ text: '- item 2', y: 640 }),
      mkLine({ text: 'After list', y: 620 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const texts = tokens.filter((t) => t.kind === 'text')
  // before list = p1，after list = p2（list 之间隔断）
  expect(texts.length).toBe(2)
  const t0 = texts[0]
  const t1 = texts[1]
  expect(t0.kind === 'text' && t0.paragraphIndex === 1).toBe(true)
  expect(t1.kind === 'text' && t1.paragraphIndex === 2).toBe(true)
})

test('classifier: 多研究论文（Study N + 重复 Method/Results/Discussion）', () => {
  // 模拟心理学多研究论文：Study 1/2/3 是顶层 section，
  // 每个 Study 下的 Method/Results/Discussion 应作为子节，不应在 OUTLINE 里重复刷屏
  const pages = [
    mkPage([
      mkLine({ text: 'Overview', size: 11, bold: true, y: 760 }),
      mkLine({ text: 'Some overview text', y: 740 }),
      mkLine({ text: 'Study 1: Twitter', size: 11, bold: true, y: 700 }),
      mkLine({ text: 'Method', size: 10, bold: true, y: 680 }),
      mkLine({ text: 'Twitter method body', y: 660 }),
      mkLine({ text: 'Results', size: 10, bold: true, y: 620 }),
      mkLine({ text: 'Twitter result body', y: 600 }),
      mkLine({ text: 'Studies 2a and 2b: Multi-Issue Correlations', size: 11, bold: true, y: 560 }),
      mkLine({ text: 'Method', size: 10, bold: true, y: 540 }),
      mkLine({ text: 'S2 method', y: 520 }),
      mkLine({ text: 'Results', size: 10, bold: true, y: 480 }),
      mkLine({ text: 'S2 results', y: 460 }),
      mkLine({ text: 'Discussion', size: 10, bold: true, y: 420 }),
      mkLine({ text: 'S2 discussion', y: 400 }),
      mkLine({ text: 'Study 3: In-Lab Experiment', size: 11, bold: true, y: 360 }),
      mkLine({ text: 'Method', size: 10, bold: true, y: 340 }),
      mkLine({ text: 'S3 method', y: 320 }),
      mkLine({ text: 'General Discussion', size: 11, bold: true, y: 280 }),
      mkLine({ text: 'wrap up', y: 260 }),
      mkLine({ text: 'References', size: 11, bold: true, y: 220 }),
      mkLine({ text: 'Ref 1', y: 200 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  // 顶层 section（level=1）应当只有：Overview, Study 1, Studies 2a/2b, Study 3, General Discussion, References
  // Method/Results/Discussion 第一次以外都被降级为 level=2 子节
  const topLevel = headings.filter((h) => h.kind === 'heading' && h.level === 1)
  const topLevelTexts = topLevel.map((h) => (h.kind === 'heading' ? h.text : ''))
  expect(topLevelTexts).toEqual([
    'Overview',
    'Study 1: Twitter',
    'Method',
    'Results',
    'Studies 2a and 2b: Multi-Issue Correlations',
    'Discussion',
    'Study 3: In-Lab Experiment',
    'General Discussion',
    'References',
  ])
  // 重复的 Method/Results 应当 level=2
  const subHeadings = headings.filter((h) => h.kind === 'heading' && h.level === 2)
  const subTexts = subHeadings.map((h) => (h.kind === 'heading' ? h.text : ''))
  // Method 出现 3 次：1 次 level=1（首次进入 OUTLINE），后 2 次 level=2
  expect(subTexts.filter((t) => t === 'Method').length).toBe(2)
  // Results 出现 2 次：1 次 level=1，1 次 level=2
  expect(subTexts.filter((t) => t === 'Results').length).toBe(1)
})

test('classifier: heading 不应吞掉 "Motivating Example:" 正文 lead-in', () => {
  // 回归：BFLULDFY 论文 "2. Sensitivity and Small Treatment Effects" 后紧跟
  // bold italic lead-in "Motivating Example: Suppose ..."，旧逻辑把整段正文累积合并
  // 进 heading 导致 OUTLINE 出现 165 字符的怪标题
  const pages = [
    mkPage([
      mkLine({ text: '2. Sensitivity and Small Treatment Effects', size: 11, bold: true, y: 700 }),
      mkLine({ text: 'Motivating Example: Suppose an e-commerce', size: 11, bold: true, y: 680 }),
      mkLine({ text: 'website observes that 5% of their visitors', size: 11, bold: false, y: 660 }),
      mkLine({ text: 'make a purchase and the average purchase', size: 11, bold: false, y: 640 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  // 顶层 heading（level=1，进 OUTLINE）应当只保留原始章节标题，不吞 "Motivating Example..." 正文
  const topHeading = tokens.find((t) => t.kind === 'heading' && t.level === 1)
  expect(topHeading).toBeDefined()
  expect(topHeading?.kind === 'heading' && topHeading.text).toBe('Sensitivity and Small Treatment Effects')
  // 重点：OUTLINE 文本不应当包含 "Motivating Example"
  if (topHeading?.kind === 'heading') {
    expect(topHeading.text.includes('Motivating Example')).toBe(false)
    expect(topHeading.text.length).toBeLessThan(80)
  }
})

test('classifier: 编号正文截断行（结尾悬空虚词）不被识别为 heading', () => {
  // 回归：frai-03-00020 论文里被换行截断的正文行
  //   "4 In order to examine if the detected pitfalls are specific of the"
  // 被 NUMBERED_HEADING_RE 误判成 "# 4 ..." 伪一级标题（缺真实 §1/§3，编号跳到 2,4,5,6）。
  // 该行结尾是悬空冠词 "the" —— 真实章节标题是名词短语，绝不停在虚词上。
  const pages = [
    mkPage([
      mkLine({ text: '2. METHODS', size: 11, bold: true, y: 800 }),
      mkLine({ text: 'Method body text here.', y: 780 }),
      // 误判源：行首被挤入 "4"，正文句被栏换行截断在 "the"
      mkLine({ text: '4 In order to examine if the detected pitfalls are specific of the', y: 700 }),
      mkLine({ text: 'firstly observed company or generalizable across companies', y: 680 }),
      mkLine({ text: '5. RESULTS', size: 11, bold: true, y: 600 }),
      mkLine({ text: 'Result body.', y: 580 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headings = tokens.filter((t) => t.kind === 'heading')
  const headingTexts = headings.map((h) => (h.kind === 'heading' ? h.text : ''))
  // 只剩两个真章节，伪 "In order to ..." 标题被拒
  expect(headingTexts).toEqual(['METHODS', 'RESULTS'])
  // 被截断的正文行应原样落到 text（含 "4" 前缀，由读者从原文还原）
  const allTexts = tokens
    .filter((t) => t.kind === 'text')
    .map((t) => (t.kind === 'text' ? t.text : ''))
  expect(allTexts).toContain('4 In order to examine if the detected pitfalls are specific of the')
})

test('classifier: 多种悬空虚词结尾（of / and / are / this）均被拒', () => {
  const pages = [
    mkPage([
      mkLine({ text: '1. Introduction', size: 11, bold: true, y: 900 }),
      mkLine({ text: '2 We evaluate the impact of the proposed approach and', y: 860 }),
      mkLine({ text: '3 The results show that these effects are', y: 840 }),
      mkLine({ text: '4 Furthermore the experiments confirm this', y: 820 }),
      // 对照：正常名词短语标题（结尾内容词）应通过
      mkLine({ text: '5. Experimental Results', size: 11, bold: true, y: 780 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const headingTexts = tokens
    .filter((t) => t.kind === 'heading')
    .map((h) => (h.kind === 'heading' ? h.text : ''))
  expect(headingTexts).toEqual(['Introduction', 'Experimental Results'])
})

test('classifier: heading 不应吞掉 "The/We/Suppose" 正文连接词起手', () => {
  // 回归：BFLULDFY 论文 "6. Conclusion" 后紧跟 "The value of experimentation and the
  // accompanying philos- ophy of trial and error has been observed..."
  const pages = [
    mkPage([
      mkLine({ text: '6. Conclusion', size: 11, bold: true, y: 700 }),
      mkLine({ text: 'The value of experimentation and the', size: 11, bold: true, y: 680 }),
      mkLine({ text: 'accompanying philosophy of trial and error', size: 11, bold: false, y: 660 }),
    ]),
  ]
  const { tokens } = buildTokens(pages)
  const topHeading = tokens.find((t) => t.kind === 'heading' && t.level === 1)
  expect(topHeading).toBeDefined()
  expect(topHeading?.kind === 'heading' && topHeading.text).toBe('Conclusion')
  if (topHeading?.kind === 'heading') {
    expect(topHeading.text.includes('value of experimentation')).toBe(false)
  }
})
