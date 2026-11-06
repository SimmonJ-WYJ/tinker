/**
 * lit-search-report 渲染契约测试（golden-file 风格）：
 * fixture data.json + judgments.json → 真跑 render_report.py → 断言输出 HTML 不变式。
 *
 * 钉住的契约（对应 PR #557 review）：
 *  1. 正文任何位置不出现 [N] 引用角标（检索报告不做综述式引用）
 *  2. References 按论文首次出现顺序连续编号 1..K，且只收正文出现过的论文
 *  3. lang=en 输出不含任何 CJK 字符（含全角标点）—— 单语言渲染（#549）
 *  4. §4 幽灵行：recurring author 在 top 集无代表作时整行跳过
 *  5. 推荐理由缺失时回落摘要首句，且英文 `.` 不截在 Fig. 1 / 3.5 mg 等缩写小数处
 *
 * 依赖 python3（与 skill 运行时一致，仅标准库）。
 */
import { beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'default-skills',
  'lit-search-report',
  'render_report.py',
)

// CJK 统一表意文字 + CJK 标点（。「」等）+ 全角形式（：（）等）
const CJK_RE = /[　-〿一-鿿＀-￯]/

const FULL_DATA = {
  tier: 'FULL',
  meta: {
    total_unique: 64,
    with_abstract: 50,
    years: [2018, 2025],
    by_source: { openalex: 40, crossref: 24 },
    rounds: [
      {
        round: 1,
        turn_id: 't1',
        rows: 80,
        new_unique: 64,
        by_source: { openalex: 40, crossref: 40 },
      },
    ],
    // Ghost Author 不在任何 top 论文的作者里 → §4 该行应被跳过（幽灵行契约）
    recurring_authors: [
      ['Alice Smith', 3],
      ['Ghost Author', 2],
    ],
  },
  papers: [
    {
      n: 1,
      title: 'Osimertinib resistance via EGFR C797S',
      authors: ['Bob Lee', 'Carol Wu'],
      year: 2023,
      venue: 'Nature Medicine',
      doi: '10.1000/osi-1',
      finalRelevance: 95,
      abstract: 'C797S is the dominant on-target mechanism.',
    },
    {
      n: 2,
      title: 'MET amplification under osimertinib pressure',
      authors: ['Dan Po'],
      year: 2022,
      venue: 'JCO',
      doi: '10.1000/osi-2',
      finalRelevance: 90,
      // 推荐理由缺失 → 回落摘要首句；首句须整句截到 cohorts. 而非 3.5 / Fig. 处
      abstract: 'We profiled 3.5 mg dosing in Fig. 2 cohorts. Resistance emerged early.',
    },
    {
      n: 3,
      title: 'Bypass signaling atlas in EGFR-mutant NSCLC',
      authors: ['Eve Xu', 'Frank Hu'],
      year: 2024,
      venue: 'Cancer Cell',
      doi: '10.1000/osi-3',
      finalRelevance: 88,
      abstract: 'Atlas of bypass pathways.',
    },
    {
      n: 4,
      title: 'Longitudinal ctDNA tracking of resistance clones',
      authors: ['Alice Smith', 'Gail Yo'],
      year: 2021,
      venue: 'Annals of Oncology',
      doi: '10.1000/osi-4',
      finalRelevance: 80,
      abstract: 'ctDNA tracking study.',
    },
    // 5/6 不进任何主题、也不是 recurring 代表作 → 不得出现在 References
    {
      n: 5,
      title: 'Unrelated immunotherapy benchmark',
      authors: ['Hank Zo'],
      year: 2020,
      venue: 'JITC',
      doi: '10.1000/osi-5',
      finalRelevance: 60,
      abstract: 'Benchmark paper.',
    },
    {
      n: 6,
      title: 'Old chemo era retrospective',
      authors: ['Ivy Qi'],
      year: 2018,
      venue: 'Lung Cancer',
      doi: null,
      finalRelevance: 55,
      abstract: '',
    },
  ],
}

const FULL_JUDG_EN = {
  lang: 'en',
  title: 'Osimertinib Resistance Mechanisms',
  slug: 'osimertinib-resistance',
  research_question: 'What are the mechanisms of acquired osimertinib resistance?',
  themes: [
    { name: 'On-target mutations', desc: 'EGFR C797S and related.', paper_ns: [1, 2] },
    { name: 'Bypass pathway activation', desc: 'MET amplification etc.', paper_ns: [3] },
  ],
  recommendations: { '1': 'Largest cohort to date.' },
  groups: { 'Alice Smith': 'Pioneered ctDNA resistance tracking.' },
  trends: ['Shift toward combination therapy.'],
  gaps: ['Few studies on long-term outcomes.'],
}

const FULL_JUDG_ZH = {
  ...FULL_JUDG_EN,
  lang: 'zh',
  title: '奥希替尼耐药机制检索报告',
  recommendations: { '1': '迄今最大队列。' },
  groups: { 'Alice Smith': '开创 ctDNA 耐药追踪。' },
  trends: ['转向联合治疗。'],
  gaps: ['长期随访研究缺乏。'],
}

const MIN_DATA = {
  tier: 'MINIMAL',
  meta: {
    total_unique: 2,
    with_abstract: 1,
    years: [2022, 2024],
    by_source: { openalex: 2 },
    rounds: [
      { round: 1, turn_id: 't1', rows: 2, new_unique: 2, by_source: { openalex: 2 } },
    ],
    recurring_authors: [],
  },
  papers: FULL_DATA.papers.slice(0, 2),
}

// 不带 title → 验证 per-lang 兜底标题（en 不得回落中文「文献检索报告」）
const MIN_JUDG_EN = { lang: 'en', top_findings: { '1': 'Key on-target evidence.' } }

function runRender(name: string, data: unknown, judgments: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), `lit-report-${name}-`))
  const dataPath = join(dir, 'data.json')
  const judgPath = join(dir, 'judgments.json')
  const outDir = join(dir, 'searches')
  writeFileSync(dataPath, JSON.stringify(data))
  writeFileSync(judgPath, JSON.stringify(judgments))
  const proc = Bun.spawnSync(
    ['python3', SCRIPT, 'render', '--data', dataPath, '--judgments', judgPath, '--out-dir', outDir],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  expect(proc.exitCode).toBe(0)
  const files = readdirSync(outDir).filter((f) => f.endsWith('.html'))
  expect(files.length).toBe(1)
  return readFileSync(join(outDir, files[0]!), 'utf-8')
}

let htmlEn = ''
let htmlZh = ''
let htmlMinEn = ''

beforeAll(() => {
  htmlEn = runRender('full-en', FULL_DATA, FULL_JUDG_EN)
  htmlZh = runRender('full-zh', FULL_DATA, FULL_JUDG_ZH)
  htmlMinEn = runRender('min-en', MIN_DATA, MIN_JUDG_EN)
})

describe('render_report.py 渲染契约', () => {
  it('是 sanitizer 友好的 article fragment', () => {
    for (const html of [htmlEn, htmlZh, htmlMinEn]) {
      expect(html).toStartWith('<article class="asci-search-report"')
      expect(html).toEndWith('</article>')
    }
  })

  it('正文任何位置不出现 [N] 角标', () => {
    for (const html of [htmlEn, htmlZh, htmlMinEn]) {
      expect(html).not.toMatch(/\[\d+\]/)
    }
  })

  it('References 仅收 §3 论文、连续编号 1..K（§4 代表作不计入）', () => {
    // §3 主题1 [1,2] → 主题2 [3]；§4 Alice 代表作 paper4 只展示标题、不进 References
    const refIds = [...htmlEn.matchAll(/id="ref-(\d+)"/g)].map((m) => Number(m[1]))
    expect(refIds).toEqual([1, 2, 3])
    const refsSection = htmlEn.slice(htmlEn.indexOf('id="refs"'))
    // 代表作（paper4）出现在 §4 正文，但不进 References
    expect(htmlEn).toContain('Longitudinal ctDNA tracking of resistance clones')
    expect(refsSection).not.toContain('Longitudinal ctDNA tracking of resistance clones')
    // ref-1 即首个出现的论文（主题 1 第一篇）
    const firstRef = refsSection.slice(refsSection.indexOf('id="ref-1"'))
    expect(firstRef.slice(0, firstRef.indexOf('</li>'))).toContain(
      'Osimertinib resistance via EGFR C797S',
    )
    expect(refsSection).toContain('data-doi="10.1000/osi-1"')
  })

  it('§3 单篇单主题：同一论文跨主题只列首个主题，序号连续不跳号', () => {
    // paper 2 同时被放进主题 A、B → 只在主题 A 列一次，主题 B 跳过它
    const html = runRender('full-dup', FULL_DATA, {
      ...FULL_JUDG_EN,
      themes: [
        { name: 'Theme A', desc: 'a', paper_ns: [1, 2] },
        { name: 'Theme B', desc: 'b', paper_ns: [2, 3] },
      ],
      recommendations: { '1': 'r1', '2': 'r2', '3': 'r3' },
    })
    const s3 = html.slice(html.indexOf('id="s3"'), html.indexOf('id="s4"'))
    const rows = [...s3.matchAll(/<tr><td>(\d+)<\/td><td><b>([^<]+)<\/b>/g)].map(
      (m) => [Number(m[1]), m[2]] as const,
    )
    expect(rows).toEqual([
      [1, 'Osimertinib resistance via EGFR C797S'],
      [2, 'MET amplification under osimertinib pressure'],
      [3, 'Bypass signaling atlas in EGFR-mutant NSCLC'],
    ])
    // References 同步去重、连续 1..3
    const refIds = [...html.matchAll(/id="ref-(\d+)"/g)].map((m) => Number(m[1]))
    expect(refIds).toEqual([1, 2, 3])
  })

  it('§3 推荐表首列序号 = References 编号，逐行一一对应', () => {
    // §3 段（到 §4 之前）
    const s3 = htmlEn.slice(htmlEn.indexOf('id="s3"'), htmlEn.indexOf('id="s4"'))
    expect(s3).toContain('<th>No.</th>') // 表头多出序号列（en）
    // 行序号自上而下：主题1 [1,2] → 主题2 [3]，与 References ref-1/2/3 同号
    const rows = [...s3.matchAll(/<tr><td>(\d+)<\/td><td><b>([^<]+)<\/b>/g)].map(
      (m) => [Number(m[1]), m[2]] as const,
    )
    expect(rows).toEqual([
      [1, 'Osimertinib resistance via EGFR C797S'],
      [2, 'MET amplification under osimertinib pressure'],
      [3, 'Bypass signaling atlas in EGFR-mutant NSCLC'],
    ])
    // 序号 1 的论文 = References ref-1（同一篇）
    const refsSection = htmlEn.slice(htmlEn.indexOf('id="refs"'))
    const firstRef = refsSection.slice(refsSection.indexOf('id="ref-1"'))
    expect(firstRef.slice(0, firstRef.indexOf('</li>'))).toContain(
      'Osimertinib resistance via EGFR C797S',
    )
  })

  it('序号列表头按 lang 渲染：en "No." / zh "序号"', () => {
    expect(htmlEn.slice(htmlEn.indexOf('id="s3"'))).toContain('<th>No.</th>')
    expect(htmlZh.slice(htmlZh.indexOf('id="s3"'))).toContain('<th>序号</th>')
  })

  it('References 只收正文出现过的论文（未被引用的候选不进表）', () => {
    expect(htmlEn).not.toContain('Unrelated immunotherapy benchmark')
    expect(htmlEn).not.toContain('Old chemo era retrospective')
  })

  it('lang=en 输出不含任何 CJK 字符（单语言渲染，#549）', () => {
    expect(htmlEn).not.toMatch(CJK_RE)
    expect(htmlMinEn).not.toMatch(CJK_RE)
  })

  it('主题标题按 lang 渲染：en "Theme N:" / zh "主题 N："', () => {
    expect(htmlEn).toContain('Theme 1: On-target mutations')
    expect(htmlZh).toContain('主题 1：On-target mutations')
  })

  it('en 缺 title 时回落英文默认标题', () => {
    expect(htmlMinEn).toContain('Literature Search Report')
  })

  it('§4 幽灵行：recurring author 在 top 集无代表作时整行跳过', () => {
    expect(htmlEn).not.toContain('Ghost Author')
    expect(htmlEn).toContain('Alice Smith')
  })

  it('推荐理由缺失时回落摘要首句，英文句末不截在缩写/小数点', () => {
    expect(htmlEn).toContain('We profiled 3.5 mg dosing in Fig. 2 cohorts.')
    expect(htmlEn).not.toContain('We profiled 3.</td>')
  })
})

// ── prepare 模式：相关度分取分链（#581）────────────────────────────────────────
// 钉住与右栏面板同口径的优先级链：score.finalScore → finalRelevance → relevance → 0，
// 且 data.json 落盘的 finalRelevance 键 = 排序所用分（展示与排序同源）。
interface PreparedData {
  papers: Array<{ title: string; finalRelevance: number }>
}

function runPrepare(name: string, rows: unknown[]): PreparedData {
  const dir = mkdtempSync(join(tmpdir(), `lit-prepare-${name}-`))
  const jsonlPath = join(dir, 'papers.jsonl')
  const outPath = join(dir, 'data.json')
  writeFileSync(jsonlPath, rows.map((r) => JSON.stringify(r)).join('\n'))
  const proc = Bun.spawnSync(
    ['python3', SCRIPT, 'prepare', '--jsonl', jsonlPath, '--out', outPath],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  expect(proc.exitCode).toBe(0)
  return JSON.parse(readFileSync(outPath, 'utf-8')) as PreparedData
}

describe('render_report.py prepare 取分链（#581）', () => {
  it('score.finalScore 优先于旧字段，排序与落盘分值同源', () => {
    const data = runPrepare('chain', [
      // v2 主路径：finalScore 高分，同行旧 F22 低分 → 不得被旧分压低
      { turn_id: 't1', ts: '1', title: 'v2 paper', extra: { score: { finalScore: 90 }, relevance: 10 } },
      { turn_id: 't1', ts: '1', title: 'finalRelevance paper', extra: { finalRelevance: 50 } },
      { turn_id: 't1', ts: '1', title: 'relevance paper', extra: { relevance: 30 } },
      { turn_id: 't1', ts: '1', title: 'unscored paper', extra: {} },
    ])
    expect(data.papers.map((p) => p.title)).toEqual([
      'v2 paper',
      'finalRelevance paper',
      'relevance paper',
      'unscored paper',
    ])
    expect(data.papers.map((p) => p.finalRelevance)).toEqual([90, 50, 30, 0])
  })

  it('旧会话 scoreV2 键兜底 — finalScore 仍优先排序', () => {
    // 评分键由 scoreV2 重命名为 score；旧会话 JSONL 仍带 extra.scoreV2，_score 须兜底读出
    const data = runPrepare('legacy-key', [
      { turn_id: 't1', ts: '1', title: 'legacy v2', extra: { scoreV2: { finalScore: 90 }, relevance: 10 } },
      { turn_id: 't1', ts: '1', title: 'finalRelevance paper', extra: { finalRelevance: 50 } },
    ])
    expect(data.papers.map((p) => [p.title, p.finalRelevance])).toEqual([
      ['legacy v2', 90],
      ['finalRelevance paper', 50],
    ])
  })

  it('兜底不回归：score 形状异常时落旧链，不抛异常', () => {
    const data = runPrepare('fallback', [
      // score 非 dict / finalScore 非数值 → 按旧字段兜底
      { turn_id: 't1', ts: '1', title: 'bad shape', extra: { score: 'oops', finalRelevance: 70 } },
      { turn_id: 't1', ts: '1', title: 'bad value', extra: { score: { finalScore: 'NaN-ish' }, relevance: 40 } },
    ])
    expect(data.papers.map((p) => [p.title, p.finalRelevance])).toEqual([
      ['bad shape', 70],
      ['bad value', 40],
    ])
  })
})
