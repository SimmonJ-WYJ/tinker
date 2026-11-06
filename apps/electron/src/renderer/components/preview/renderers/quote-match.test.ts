/**
 * quote-match.ts 单元测试
 *
 * 覆盖：
 *   - L1 直接命中（基于正规化空间：连字符断行 / 空白折叠 / 大小写自动容错）
 *   - L2 去装饰命中（"..." / "…" / "" "" 头尾）
 *   - L3 指纹命中（中段一致，头尾在 PDF 里被分页 / 改写）
 *   - 三档都 miss 返回 null
 *   - 命中后映射回原 pageText 的字符区间正确
 *   - trimQuoteDecorations / extractFingerprint 边界
 */
import { describe, expect, test } from 'bun:test'

import {
  extractFingerprint,
  findQuoteFragmentsInPage,
  findQuoteInPage,
  splitQuoteFragments,
  trimQuoteDecorations,
} from './quote-match.ts'

describe('trimQuoteDecorations: 仅剥两端装饰', () => {
  test('剥 ASCII 三个点 + 引号', () => {
    expect(trimQuoteDecorations('"...participants exhibited..."')).toBe('participants exhibited')
  })

  test('剥 Unicode 横向省略号 …', () => {
    expect(trimQuoteDecorations('…some text…')).toBe('some text')
  })

  test('剥智能引号 “”', () => {
    expect(trimQuoteDecorations('“claim X holds.”')).toBe('claim X holds.')
  })

  test('剥头尾混合：引号 + 省略号 + 空白', () => {
    expect(trimQuoteDecorations('  "…  N400 amplitudes ...  "  ')).toBe('N400 amplitudes')
  })

  test('中段省略号不动', () => {
    expect(trimQuoteDecorations('A ... and B')).toBe('A ... and B')
  })

  test('全装饰 → 空字符串', () => {
    expect(trimQuoteDecorations('"..."')).toBe('')
  })

  test('空字符串 round-trip', () => {
    expect(trimQuoteDecorations('')).toBe('')
  })

  test('无装饰原样返回', () => {
    expect(trimQuoteDecorations('plain text')).toBe('plain text')
  })
})

describe('extractFingerprint: 中段指纹', () => {
  test('短文本（< minLen 20）→ null', () => {
    expect(extractFingerprint('short')).toBeNull()
  })

  test('刚好 minLen 取得', () => {
    const s = 'x'.repeat(20)
    expect(extractFingerprint(s)?.length).toBeGreaterThanOrEqual(20)
  })

  test('长文本截到 maxLen', () => {
    const s = 'x'.repeat(200)
    const fp = extractFingerprint(s)
    expect(fp?.length).toBeLessThanOrEqual(50)
    expect(fp?.length).toBeGreaterThanOrEqual(20)
  })

  test('指纹取中段（不在首尾）', () => {
    const s = 'AAAA' + 'M'.repeat(40) + 'ZZZZ'
    const fp = extractFingerprint(s)
    expect(fp).not.toBeNull()
    expect(fp!.includes('M')).toBe(true)
  })
})

describe('findQuoteInPage: 三档降级 + 正规化', () => {
  const pageText =
    'In our study, participants exhibited larger N400 amplitudes when reading value-incongruent arguments, ' +
    'indicating heightened cognitive conflict in moral judgments.'

  test('L1 直接命中', () => {
    const r = findQuoteInPage(pageText, 'participants exhibited larger N400')
    expect(r).not.toBeNull()
    expect(r!.tier).toBe('strict')
    expect(pageText.slice(r!.idx, r!.idx + r!.len)).toBe('participants exhibited larger N400')
  })

  test('L2 去装饰后命中（头尾带 "..."）', () => {
    const r = findQuoteInPage(pageText, '"...participants exhibited larger N400..."')
    expect(r).not.toBeNull()
    expect(r!.tier).toBe('trimmed')
    expect(pageText.slice(r!.idx, r!.idx + r!.len)).toBe('participants exhibited larger N400')
  })

  test('L2 头尾带 Unicode 省略号 …', () => {
    const r = findQuoteInPage(pageText, '…N400 amplitudes when reading value-incongruent…')
    expect(r).not.toBeNull()
    expect(r!.tier).toBe('trimmed')
  })

  test('L3 指纹命中：原 quote 头尾被改但中段保留', () => {
    const quote =
      'NONEXISTENT_PREFIX participants exhibited larger N400 amplitudes when reading value-incongruent arguments NONEXISTENT_SUFFIX'
    const r = findQuoteInPage(pageText, quote)
    expect(r).not.toBeNull()
    expect(r!.tier).toBe('fingerprint')
    expect(r!.idx).toBeGreaterThanOrEqual(0)
    expect(r!.idx + r!.len).toBeLessThanOrEqual(pageText.length)
  })

  test('三档全 miss → null', () => {
    expect(findQuoteInPage(pageText, 'completely unrelated text that does not appear')).toBeNull()
  })

  test('空 quote / 空 pageText → null', () => {
    expect(findQuoteInPage('', 'x')).toBeNull()
    expect(findQuoteInPage('x', '')).toBeNull()
    expect(findQuoteInPage(pageText, '')).toBeNull()
  })
})

describe('findQuoteInPage: 模糊容错（正规化）', () => {
  test('大小写不一致 → L1 命中', () => {
    const r = findQuoteInPage('Heightened Cognitive Conflict in Moral Judgments.', 'cognitive conflict in moral judgments')
    expect(r).not.toBeNull()
    expect(r!.tier).toBe('strict')
  })

  test('PDF 中含硬连字符 + 换行（断字）→ L1 命中', () => {
    // PDF 行尾常断字：`re-\nsearch` 应被合成 `research` 与 quote 匹配
    const pageText = 'Our re-\nsearch shows that learners adapt.'
    const r = findQuoteInPage(pageText, 'our research shows')
    expect(r).not.toBeNull()
    expect(r!.tier).toBe('strict')
    // 命中区间应该覆盖原文的 "Our re-\nsearch shows"
    const slice = pageText.slice(r!.idx, r!.idx + r!.len)
    expect(slice.includes('re-')).toBe(true)
    expect(slice.includes('search')).toBe(true)
  })

  test('PDF 中含软连字符 U+00AD → L1 命中', () => {
    const softHyphen = '­'
    const pageText = `co${softHyphen}llaboration is key.`
    const r = findQuoteInPage(pageText, 'collaboration is key')
    expect(r).not.toBeNull()
    expect(r!.tier).toBe('strict')
  })

  test('多空格 + 换行折叠为单空格 → 命中', () => {
    const pageText = 'In  our\n   study,\nparticipants  exhibited  larger N400.'
    const r = findQuoteInPage(pageText, 'in our study, participants exhibited larger N400')
    expect(r).not.toBeNull()
    expect(r!.tier).toBe('strict')
  })

  test('NBSP (U+00A0) 折叠 → 命中', () => {
    const pageText = 'Figure 1: results show heightened conflict.'
    const r = findQuoteInPage(pageText, 'figure 1: results show heightened')
    expect(r).not.toBeNull()
  })

  test('普通行内连字符不被吃（state-of-the-art）', () => {
    const pageText = 'we propose a state-of-the-art method for retrieval.'
    const r = findQuoteInPage(pageText, 'state-of-the-art method')
    expect(r).not.toBeNull()
  })

  test('quote 跨段（PDF 多空格 / 换行）+ 头尾带 "..." → L2 命中', () => {
    const pageText =
      'Method.\n\nIn  our experiment,\n  participants  exhibited  larger N400  amplitudes\n' +
      'when reading value-incongruent arguments, indicating heightened cognitive conflict.\n\nDiscussion.'
    const quote =
      '"...participants exhibited larger N400 amplitudes when reading value-incongruent arguments..."'
    const r = findQuoteInPage(pageText, quote)
    expect(r).not.toBeNull()
    expect(r!.tier).toBe('trimmed')
    // 区间应覆盖到 PDF 里那段的"原始"字符范围
    const slice = pageText.slice(r!.idx, r!.idx + r!.len)
    expect(slice.includes('participants')).toBe(true)
    expect(slice.includes('arguments')).toBe(true)
  })
})

describe('findQuoteInPage: 真实场景回归', () => {
  test('截图里的 N400 引文（带头尾 "..."）能命中 PDF 文本', () => {
    const quote =
      '"...participants exhibited larger N400 amplitudes when reading value-incongruent arguments, indicating heightened cognitive conflict in moral judgments..."'
    const pageText =
      'Method ... Results. In our experiment, participants exhibited larger N400 amplitudes when reading value-incongruent arguments, indicating heightened cognitive conflict in moral judgments. Discussion ...'
    const r = findQuoteInPage(pageText, quote)
    expect(r).not.toBeNull()
    expect(r!.tier).toBe('trimmed')
  })

  test('跨页 quote：前半命中前一页', () => {
    const quote =
      'We present AgentTrust, a real-time, semantics-aware safety-interception framework that sits between an agent and its tools and produces a structured verdict'
    // 前一页只包含 quote 的前半段
    const pageText =
      'Modern AI agents execute real-world side-effects through tool calls. ' +
      'We present AgentTrust, a real-time, semantics-aware safety-interception framework'
    const r = findQuoteInPage(pageText, quote)
    expect(r).not.toBeNull()
    expect(r!.tier).toBe('leading')
  })

  test('跨页 quote：后半命中后一页', () => {
    const quote =
      'We present AgentTrust, a real-time, semantics-aware safety-interception framework that sits between an agent and its tools and produces a structured verdict before every action is executed'
    // 后一页只包含 quote 的后半段
    const pageText =
      'between an agent and its tools and produces a structured verdict before every action is executed. ' +
      'AgentTrust contributes four capabilities that, to our knowledge, no prior open framework combines.'
    const r = findQuoteInPage(pageText, quote)
    expect(r).not.toBeNull()
    expect(r!.tier).toBe('trailing')
  })

  test('截图引文 + PDF 多空格断行 + 大小写差异 综合', () => {
    const quote =
      '"...participants exhibited larger N400 amplitudes when reading value-incongruent arguments..."'
    const pageText =
      'METHOD\n\nIn our experiment, Participants Exhibited larger\nN400  amplitudes when  reading value-\nincongruent arguments,\nindicating heightened cognitive conflict.'
    const r = findQuoteInPage(pageText, quote)
    expect(r).not.toBeNull()
    // 命中区间至少覆盖到关键词
    const slice = pageText.slice(r!.idx, r!.idx + r!.len)
    expect(slice.toLowerCase().includes('participants')).toBe(true)
    expect(slice.toLowerCase().includes('arguments')).toBe(true)
  })

  test('小型大写拆词：FactAlign 被 textLayer 拆成多 span（空格分隔）整条命中（squeezed 档）', () => {
    // 真实 bug：\textsc{FactAlign} 在 pdf.js textLayer 里拆成 "F""ACT""A""LIGN" 多 span，
    // joinPdfItems 单空格 join → "F ACT A LIGN"，fold 档保留词间空格 → 对不上 quote 的
    // "FactAlign"，整条 L1/L2 miss、只剩中段 fingerprint（高亮缩成中段）。squeezed 档去掉
    // 所有空白后整条命中、高亮恢复整句。
    const quote =
      'FactAlign is capable of training LLMs to provide more information without losing factual precision, thus improving the factual F1 score.'
    // 拆词 + 行末连字符断行 "fac-\ntual" → "fac- tual" + 句尾脚注标记 "1"
    const pageText =
      'Further analyses identify that F ACT A LIGN is capable of training LLMs to provide more information without losing fac- tual precision, thus improving the factual F1 score.1 1 Introduction'
    const r = findQuoteInPage(pageText, quote)
    expect(r).not.toBeNull()
    expect(r!.tier).toBe('squeezed')
    // 命中区间从被拆开的 "F ACT A LIGN" 起、到 "score." 止（去空白后即整条 quote）
    const squeezed = pageText.slice(r!.idx, r!.idx + r!.len).toLowerCase().replace(/[\s-]/g, '')
    expect(squeezed.startsWith('factalign')).toBe(true)
    expect(squeezed.endsWith('f1score.')).toBe(true)
  })
})

describe('findQuoteInPage: 定位用 Lx、高亮尽量 L1（锚点扩展）', () => {
  test('fingerprint 定位后双向扩展到最大对齐区，不止画中段', () => {
    // quote 首词 "Notably" 与 PDF 的 "In summary" 不一致 → L1/L2/squeezed 全 miss，
    // 只有中段 fingerprint 命中。扩展后高亮应覆盖从 "the model" 到 "this study"
    // （quote 里除首词外的全部），但不越界到 PDF 的 "and beyond" / "In summary"。
    const quote =
      'Notably the model achieves state of the art performance on every benchmark we evaluated in this study'
    const pageText =
      'In summary the model achieves state of the art performance on every benchmark we evaluated in this study and beyond'
    const r = findQuoteInPage(pageText, quote)
    expect(r).not.toBeNull()
    expect(r!.tier).toBe('fingerprint')
    const slice = pageText.slice(r!.idx, r!.idx + r!.len).toLowerCase()
    // 扩展生效：覆盖远超中段指纹
    expect(slice.includes('the model achieves state of the art performance')).toBe(true)
    expect(slice.includes('this study')).toBe(true)
    // 精确边界：不染到 quote 之外
    expect(slice.includes('beyond')).toBe(false)
    expect(slice.includes('summary')).toBe(false)
  })

  test('扩展遇真分歧即停，不越界染无关文本（分歧在尾部）', () => {
    // 中段（fingerprint 区）干净一致，quote 尾部 "our comprehensive study" 与 PDF 的
    // "a different way here" 不同：扩展从指纹向右到分歧处 "in " 后即停。
    const quote = 'the proposed method significantly improves accuracy on all evaluated datasets in our comprehensive study'
    const pageText = 'the proposed method significantly improves accuracy on all evaluated datasets in a different way here'
    const r = findQuoteInPage(pageText, quote)
    expect(r).not.toBeNull()
    expect(r!.tier).toBe('fingerprint')
    const slice = pageText.slice(r!.idx, r!.idx + r!.len).toLowerCase()
    // 左/中扩展到完整的一致前缀
    expect(slice.includes('the proposed method significantly improves accuracy on all evaluated datasets')).toBe(true)
    // 右侧在分歧处停住：不染 PDF 尾部 quote 没有的词
    expect(slice.includes('different')).toBe(false)
    expect(slice.includes('here')).toBe(false)
    expect(r!.idx + r!.len).toBeLessThanOrEqual(pageText.length)
  })
})

describe('splitQuoteFragments: 中段 … 桥接拆分', () => {
  test('空 quote → []', () => {
    expect(splitQuoteFragments('')).toEqual([])
  })

  test('无桥接 → 原样单元素（保留头尾装饰）', () => {
    expect(splitQuoteFragments('  "plain text"  ')).toEqual(['  "plain text"  '])
  })

  test('中段 Unicode … → 拆两段', () => {
    expect(splitQuoteFragments('alpha bravo… charlie delta')).toEqual([
      'alpha bravo',
      'charlie delta',
    ])
  })

  test('中段 ASCII ... → 拆两段', () => {
    expect(splitQuoteFragments('alpha bravo...charlie delta')).toEqual([
      'alpha bravo',
      'charlie delta',
    ])
  })

  test('中段 Unicode ⋯（U+22EF）→ 拆', () => {
    expect(splitQuoteFragments('alpha bravo⋯charlie delta')).toEqual([
      'alpha bravo',
      'charlie delta',
    ])
  })

  test('多个 … → 拆多段', () => {
    expect(splitQuoteFragments('A long enough… B long enough… C long enough')).toEqual([
      'A long enough',
      'B long enough',
      'C long enough',
    ])
  })

  test('尾部 … → 末段为空被丢弃', () => {
    expect(splitQuoteFragments('alpha bravo charlie…')).toEqual(['alpha bravo charlie'])
  })

  test('头尾 + 中段都有 … → 头尾段被 trim 掉空段', () => {
    expect(splitQuoteFragments('…alpha bravo…charlie delta…')).toEqual([
      'alpha bravo',
      'charlie delta',
    ])
  })

  test('两个点 .. 不是桥接（保留原样不拆）', () => {
    expect(splitQuoteFragments('alpha bravo..charlie delta')).toEqual([
      'alpha bravo..charlie delta',
    ])
  })

  test('CJK 间 … → 拆', () => {
    expect(splitQuoteFragments('中文片段一…中文片段二')).toEqual(['中文片段一', '中文片段二'])
  })

  test('PDF 截断 + ASCII ... 混合', () => {
    expect(
      splitQuoteFragments(
        '12,831 Ionic conductivity, electrical conductivity…structural stability, material cost, 21 inorgan…',
      ),
    ).toEqual([
      '12,831 Ionic conductivity, electrical conductivity',
      'structural stability, material cost, 21 inorgan',
    ])
  })
})

describe('findQuoteFragmentsInPage: 单 fragment 兼容 + 多 fragment 拆分匹配', () => {
  const pageText =
    'Background. In our study, participants exhibited larger N400 amplitudes when reading ' +
    'value-incongruent arguments. Methods. We further analyzed structural stability and ' +
    'material cost across 21 inorganic solid electrolytes from a database of 12,831 entries.'

  test('无 … → 与 findQuoteInPage 行为等价（命中 + tier）', () => {
    const results = findQuoteFragmentsInPage(pageText, 'participants exhibited larger N400')
    expect(results).toHaveLength(1)
    expect(results[0]!.fragmentCount).toBe(1)
    expect(results[0]!.fragmentIdx).toBe(0)
    expect(results[0]!.tier).toBe('strict')
  })

  test('无 … 且 miss → []', () => {
    expect(findQuoteFragmentsInPage(pageText, 'totally unrelated string of words')).toEqual([])
  })

  test('头尾装饰 "..." 也被识别为桥接：拆成多段，引号短段丢弃，正文段 strict 命中', () => {
    // 副作用：含 ASCII "..." 头尾的 quote 不再走 findQuoteInPage 的 L2 trimmed 档，
    // 而是被 splitQuoteFragments 拆成 3 段（["\"", "participants...N400", "\""]），
    // 头尾引号短段 < MIN_FRAGMENT_LEN 被丢弃，中段直接走 L1 strict。
    // 这是优于 L2 的行为：装饰内容剥得更干净 + 仍能精确命中。
    const results = findQuoteFragmentsInPage(pageText, '"...participants exhibited larger N400..."')
    expect(results).toHaveLength(1)
    expect(results[0]!.tier).toBe('strict')
    expect(results[0]!.fragmentCount).toBe(3) // 拆 3 段：引号 / 正文 / 引号
    expect(results[0]!.fragmentIdx).toBe(1) // 命中的是中段
  })

  test('头尾装饰 Unicode `…` 走单 fragment 路径，rawQuote 透传给 L2 trimmed 命中', () => {
    // Unicode `…` 不被 splitQuoteFragments 当作中段桥接（只触发头尾），split 后只剩
    // 一个非空段 → 走单 fragment 路径，直接把 rawQuote 透传给 findQuoteInPage；rawQuote
    // 头尾仍带 `…`，L1 strict 因装饰 miss，L2 trimmed 剥掉装饰命中。
    const results = findQuoteFragmentsInPage(pageText, '…participants exhibited larger N400…')
    expect(results).toHaveLength(1)
    expect(results[0]!.tier).toBe('trimmed')
    expect(results[0]!.fragmentCount).toBe(1)
  })

  test('多 fragment：两段都长且都在页里 → 两段都命中，按 idx 升序', () => {
    const quote =
      'participants exhibited larger N400 amplitudes when reading value-incongruent arguments' +
      '…' +
      'structural stability and material cost across 21 inorganic solid electrolytes'
    const results = findQuoteFragmentsInPage(pageText, quote)
    expect(results).toHaveLength(2)
    expect(results[0]!.fragmentIdx).toBe(0)
    expect(results[1]!.fragmentIdx).toBe(1)
    expect(results[0]!.fragmentCount).toBe(2)
    expect(results[0]!.idx).toBeLessThan(results[1]!.idx)
  })

  test('多 fragment：只有一段在页里 → 仅那段命中', () => {
    const quote =
      'structural stability and material cost across 21 inorganic solid electrolytes' +
      '…' +
      'XYZ completely missing phrase that does not appear anywhere'
    const results = findQuoteFragmentsInPage(pageText, quote)
    expect(results).toHaveLength(1)
    expect(results[0]!.fragmentIdx).toBe(0)
    expect(results[0]!.fragmentCount).toBe(2)
  })

  test('多 fragment：两段都不在页里 → []', () => {
    const quote = 'XYZ first missing piece long enough…ABC second missing piece also long enough'
    expect(findQuoteFragmentsInPage(pageText, quote)).toEqual([])
  })

  test('多 fragment：包含短碎片（<15 字符）被跳过，长段仍命中', () => {
    // "12,831" 是 6 字符短碎片，按 MIN_FRAGMENT_LEN=15 应跳过；不跳过的话它在 PDF
    // 里很多页都可能误命中。
    const quote =
      '12,831' +
      '…' +
      'structural stability and material cost across 21 inorganic solid electrolytes'
    const results = findQuoteFragmentsInPage(pageText, quote)
    expect(results).toHaveLength(1)
    expect(results[0]!.fragmentIdx).toBe(1) // 短段 idx=0 被跳过，命中的是第二段
  })

  test('多 fragment：fragmentCount 反映拆分总数，不受门槛影响', () => {
    const quote = 'short' + '…' + 'structural stability and material cost'
    const results = findQuoteFragmentsInPage(pageText, quote)
    expect(results).toHaveLength(1)
    // 拆出 2 段但首段 < 15 字符被跳过，fragmentCount 仍报 2
    expect(results[0]!.fragmentCount).toBe(2)
  })

  test('真实截图样例：12,831 Ionic conductivity… 拆段后能定位某段', () => {
    // 真实截图的 quote 来自材料学综述里的 Table —— 拆段后某段在 PDF 表格附近的正文里
    // 连续出现。这里构造一个更接近的 pageText：包含 fragment 2 的连续片段。
    const realPageText =
      'We evaluated 21 inorganic solid electrolytes on five axes: ionic conductivity, ' +
      'electrical conductivity, structural stability, material cost, and stability against ' +
      'lithium, drawing from a database of 12,831 candidate entries.'
    const quote =
      '12,831 Ionic conductivity, electrical conductivity…structural stability, material cost, 21 inorgan'
    const results = findQuoteFragmentsInPage(realPageText, quote)
    // 两段中至少有一段能命中（fragment 2 含连续 "structural stability, material cost"）
    expect(results.length).toBeGreaterThanOrEqual(1)
  })
})
