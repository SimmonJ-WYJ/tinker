/**
 * chunker 单测：双轨锚点（<p id> 段落 / lite 字节偏移）+ 合并阈值 + 头部剥离
 */

import { describe, expect, test } from 'bun:test'

import {
  buildTitleAbstractChunk,
  chunkWikiMarkdown,
  estimateTokens,
  isLowQualityText,
  stripWikiHeader,
  truncateAtReferences,
} from './chunker.ts'

const LITE_HEADER = `# PDF

> attachmentKey: \`KEY1\`
> filename: \`x.pdf\`

---

`

describe('estimateTokens', () => {
  test('英文按 ~4 字符/token，CJK 按 1 字/token', () => {
    expect(estimateTokens('abcd'.repeat(10))).toBe(10)
    expect(estimateTokens('你好世界')).toBe(4)
    // 混合：4 个 CJK + 8 个 ascii → 4 + 2
    expect(estimateTokens('你好世界abcdefgh')).toBe(6)
  })
})

describe('stripWikiHeader', () => {
  test('剥离头部元数据块，bodyByteStart 指向正文起点', () => {
    const md = `${LITE_HEADER}first line`
    const { body, bodyByteStart } = stripWikiHeader(md)
    expect(body).toBe('first line')
    expect(md.slice(bodyByteStart)).toBe('first line')
  })

  test('无分隔线时整个文件视为正文', () => {
    const { body, bodyByteStart } = stripWikiHeader('no header at all')
    expect(body).toBe('no header at all')
    expect(bodyByteStart).toBe(0)
  })
})

describe('chunkWikiMarkdown — 段落模式（<p id> 锚点）', () => {
  test('正常长度段落用段落 id 作锚点；尾段独立', () => {
    const md = `${LITE_HEADER}<p id="p1_1">A moderately sized paragraph that stays under the token budget.</p>\n<p id="p1_2">short tail.</p>`
    const chunks = chunkWikiMarkdown(md)
    expect(chunks[0].anchorStart).toBe('p1_1')
    expect(chunks[chunks.length - 1].anchorEnd).toBe('p1_2')
  })

  test('短段落向后合并，锚点记录起止范围', () => {
    const md = `${LITE_HEADER}<p id="p1_1">a.</p>\n<p id="p1_2">b.</p>\n<p id="p2_1">c.</p>`
    const chunks = chunkWikiMarkdown(md)
    expect(chunks.length).toBe(1)
    expect(chunks[0].anchorStart).toBe('p1_1')
    expect(chunks[0].anchorEnd).toBe('p2_1')
    expect(chunks[0].content).toContain('a.')
    expect(chunks[0].content).toContain('c.')
  })
})

describe('chunkWikiMarkdown — 章节标注（structured/article 段落模式）', () => {
  // 每段 ~250 token（在 MIN..TARGET 之间），保证两节各自成块、不跨节合并
  const para = (s: string) => `${s} `.repeat(20).trim()
  const STRUCTURED = `${LITE_HEADER}# OUTLINE

- 1. Introduction
- 2. Methods

# CONTENT

# 1. Introduction

<p id="p1_1">${para('Background on attention mechanisms and their cost.')}</p>

# 2. Methods

## 2.1 Setup

<p id="p2_1">${para('We propose grouped query attention to reduce cost.')}</p>`

  test('按 "# N. Title" 给段落 chunk 标注 sectionIndex + sectionTitle（去编号前缀）', () => {
    const chunks = chunkWikiMarkdown(STRUCTURED)
    expect(chunks.length).toBe(2)
    expect(chunks[0].sectionIndex).toBe(1)
    expect(chunks[0].sectionTitle).toBe('Introduction')
    expect(chunks[1].sectionIndex).toBe(2)
    expect(chunks[1].sectionTitle).toBe('Methods') // 子节 "## 2.1 Setup" 不覆盖
  })

  test('段落有锚点但无对应顶层 heading → sectionIndex 取自锚点，sectionTitle 缺省', () => {
    const md = `${LITE_HEADER}<p id="p7_1">${para('Orphan paragraph without a numbered heading nearby.')}</p>`
    const chunks = chunkWikiMarkdown(md)
    expect(chunks[0].sectionIndex).toBe(7)
    expect(chunks[0].sectionTitle).toBeUndefined()
  })

  test('纯文本模式（字节锚点）不标注章节', () => {
    const md = `${LITE_HEADER}A plain text body line with enough words to form a chunk on its own here.`
    const chunks = chunkWikiMarkdown(md)
    expect(chunks[0].anchorStart).toMatch(/^b\d+$/)
    expect(chunks[0].sectionIndex).toBeUndefined()
    expect(chunks[0].sectionTitle).toBeUndefined()
  })
})

describe('chunkWikiMarkdown — 纯文本模式（字节偏移锚点）', () => {
  test('锚点 b{offset} 可在 body 中精确定位回原文', () => {
    // 行长 ~80 字符 × 40 行 ≈ 800 token → 应切成多块
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i} ${'x'.repeat(70)}`)
    const md = `${LITE_HEADER}${lines.join('\n')}`
    const chunks = chunkWikiMarkdown(md)
    expect(chunks.length).toBeGreaterThan(1)

    const { body } = stripWikiHeader(md)
    const bodyBuf = Buffer.from(body, 'utf-8')
    for (const c of chunks) {
      expect(c.anchorStart).toMatch(/^b\d+$/)
      const offset = Number(c.anchorStart!.slice(1))
      // 锚点处的字节应是该 chunk 第一行的开头
      const firstLine = c.content.split('\n')[0]
      const slice = bodyBuf.subarray(offset, offset + Buffer.byteLength(firstLine, 'utf-8')).toString('utf-8')
      expect(slice).toBe(firstLine)
    }
  })

  test('CJK 内容的字节偏移锚点正确（多字节字符）', () => {
    const md = `${LITE_HEADER}中文第一行内容比较长一些以便测试\n\n中文第二行`
    const chunks = chunkWikiMarkdown(md)
    expect(chunks.length).toBe(1)
    expect(chunks[0].anchorStart).toBe('b0')
    const { body } = stripWikiHeader(md)
    const secondOffset = Number(chunks[0].anchorEnd!.slice(1))
    const decoded = Buffer.from(body, 'utf-8').subarray(secondOffset).toString('utf-8')
    expect(decoded.startsWith('中文第二行')).toBe(true)
  })

  test('超长单行按字符兜底切分，子片锚点仍可定位', () => {
    const giant = `${'词组 word '.repeat(500)}END` // 单行 ~5000 字符
    const md = `${LITE_HEADER}${giant}`
    const chunks = chunkWikiMarkdown(md)
    expect(chunks.length).toBeGreaterThan(1)
    const { body } = stripWikiHeader(md)
    const bodyBuf = Buffer.from(body, 'utf-8')
    const last = chunks[chunks.length - 1]
    const offset = Number(last.anchorStart!.slice(1))
    const decoded = bodyBuf.subarray(offset).toString('utf-8')
    expect(decoded.startsWith(last.content.split('\n')[0].slice(0, 10))).toBe(true)
  })

  test('空正文返回空数组', () => {
    expect(chunkWikiMarkdown(`${LITE_HEADER}   \n  `)).toEqual([])
  })
})

describe('truncateAtReferences', () => {
  test('命中 References heading 截断其后内容', () => {
    const body = 'Main body text here.\n\nReferences\n\n[1] Foo et al. 2020\n[2] Bar 2021'
    expect(truncateAtReferences(body)).toBe('Main body text here.\n\n')
  })

  test('markdown heading + 章节号形式也识别（# 6. Bibliography）', () => {
    const body = 'content\n# 6. Bibliography\n[1] ...'
    expect(truncateAtReferences(body)).toBe('content\n')
  })

  test('中文「参考文献」识别', () => {
    const body = '正文内容\n参考文献\n[1] 张三'
    expect(truncateAtReferences(body)).toBe('正文内容\n')
  })

  test('正文里行内出现 references 不误截', () => {
    const body = 'see the references section below for details and more text'
    expect(truncateAtReferences(body)).toBe(body)
  })

  test('数字密集行不触发灾难性回溯（ReDoS 防护，必须秒内返回）', () => {
    // 目录/参考文献编号行 "1. 2. 3. …"，旧正则 (?:\d+[.)]?[ \t]*)* 在 V8 上会指数回溯卡死
    const numbers = Array.from({ length: 60 }, (_, i) => `${i + 1}. `).join('')
    const body = `${numbers}\nsome trailing content`
    const t0 = Date.now()
    truncateAtReferences(body)
    expect(Date.now() - t0).toBeLessThan(200)
  })
})

describe('chunkWikiMarkdown — 质量处理', () => {
  test('目录点线行与孤立页码被过滤', () => {
    const md = `${LITE_HEADER}3.1 Language Modeling . . . . . . . . . 11\n\n11\n\nThis is the real first sentence of actual content here.`
    const chunks = chunkWikiMarkdown(md)
    expect(chunks.length).toBe(1)
    expect(chunks[0].content).toContain('real first sentence')
    expect(chunks[0].content).not.toContain('. . .')
    expect(chunks[0].content).not.toMatch(/\bModeling\b.*\.\s*\./)
  })

  test('参考文献区不进语料（段落模式）', () => {
    const md = `${LITE_HEADER}<p id="p1_1">Core finding about attention.</p>\n# References\n<p id="p9_1">[1] huge reference dump...</p>`
    const chunks = chunkWikiMarkdown(md)
    expect(chunks.length).toBe(1)
    expect(chunks[0].content).toContain('Core finding')
    expect(chunks.some((c) => c.content.includes('reference dump'))).toBe(false)
  })

  test('超长段落段内二次切分，子锚点 pS_P#i 递增', () => {
    const huge = 'sentence number ' + 'x '.repeat(2500) // 远超 TARGET_TOKENS
    const md = `${LITE_HEADER}<p id="p4_2">${huge}</p>`
    const chunks = chunkWikiMarkdown(md)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].anchorStart).toBe('p4_2#0')
    expect(chunks[1].anchorStart).toBe('p4_2#1')
    // 每个子块都明显小于原段（不再是 512 token 截断 + 巨型 snippet）
    expect(estimateTokens(chunks[0].content)).toBeLessThanOrEqual(400)
  })

  test('段内二次切分相邻子片有句级 overlap（共享边界句）', () => {
    // 造一个超长段：多句、有句号，确保按句末切并产生 overlap
    const sentences = Array.from({ length: 80 }, (_, i) => `This is sentence number ${i} with enough words to add length.`)
    const md = `${LITE_HEADER}<p id="p1_1">${sentences.join(' ')}</p>`
    const chunks = chunkWikiMarkdown(md)
    expect(chunks.length).toBeGreaterThan(1)
    // 后一片开头应能在前一片结尾找到公共片段（overlap）
    const prevTail = chunks[0].content.slice(-120)
    const nextHead = chunks[1].content.slice(0, 120)
    // 取前片末尾的一句，验证它出现在后片开头区域
    const lastSentenceMatch = prevTail.match(/[^.]+\.$/)
    expect(lastSentenceMatch).not.toBeNull()
    const sharedSentence = lastSentenceMatch![0].trim()
    expect(nextHead).toContain(sharedSentence.slice(0, 20))
  })

  test('无句末标点的超长段仍能切分且不死循环', () => {
    const md = `${LITE_HEADER}<p id="p2_1">${'token '.repeat(3000)}</p>`
    const chunks = chunkWikiMarkdown(md)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => estimateTokens(c.content) <= 400)).toBe(true)
  })
})

describe('buildTitleAbstractChunk', () => {
  test('title + authors + abstract 拼接，无锚点', () => {
    const chunk = buildTitleAbstractChunk({
      title: 'GQA for Long-Context',
      authors: ['Chen, Yingfa', 'Wu, Yutong'],
      year: '2025',
      abstract: 'Grouped-Query Attention ...',
    })
    expect(chunk).not.toBeNull()
    expect(chunk!.anchorStart).toBeNull()
    expect(chunk!.content).toContain('GQA for Long-Context')
    expect(chunk!.content).toContain('(2025)')
    expect(chunk!.content).toContain('Grouped-Query')
  })

  test('title 与 abstract 都缺失 → null', () => {
    expect(
      buildTitleAbstractChunk({ title: '', authors: ['A'], year: '2020', abstract: null }),
    ).toBeNull()
  })
})

describe('isLowQualityText（垃圾 chunk 过滤，案例取自真实评估噪声）', () => {
  test('参考文献列表 → 低质量', () => {
    const ref =
      '[26] Yang A, Yang B, Zhang B, et al. Qwen2 technical report. arXiv preprint arXiv:2407.10671. ' +
      '[97] Behrouz A, Zhong P. Titans: learning to memorize. In: Proceedings of ICLR, 2024. ' +
      '[98] Zhang T, Bi S. Foo. In: Proceedings of NeurIPS, 2023, et al. doi.org/10.x [12] Vaswani A.'
    expect(isLowQualityText(ref)).toBe(true)
  })

  test('GitHub 链接列表 → 低质量', () => {
    const links =
      'GNN https://github.com/mlvlab/SELAR GIN https://github.com/THUDM/GCC GCN https://github.com/CRIPAC-DIG/GCA'
    expect(isLowQualityText(links)).toBe(true)
  })

  test('base64 / latexit 串 → 低质量', () => {
    const latex =
      'Lpos 0ele Clsh x<latexit sha1_base64="jOUc7TtJsOrnW7p8koaJSHU4jmg=">AAAB+XicbVBNS8NAEN3Ur1q</latexit>'
    expect(isLowQualityText(latex)).toBe(true)
  })

  test('纯数字结果表行 → 低质量（字母占比过低）', () => {
    const table = '0 29.9 68.0 64 4.15 7.61 14.0 19.7 31.3 38.7 41.8 64.3 4.19 12.9 20.5 26.5 35.9 44.4 51.3 68.0'
    expect(isLowQualityText(table)).toBe(true)
  })

  test('解析乱码（紧邻无空白重复单元）→ 低质量', () => {
    expect(isLowQualityText('(2.7B)(2.7B)DRAGONDRAGON')).toBe(true)
  })

  test('正常英文正文（含少量行内引用）→ 保留', () => {
    const prose =
      'Grouped-query attention divides query heads into groups, each sharing a single key and value head. ' +
      'Prior work (Shazeer, 2019) showed multi-query attention reduces memory bandwidth at some quality cost [12].'
    expect(isLowQualityText(prose)).toBe(false)
  })

  test('正常中文正文 → 保留', () => {
    const prose =
      '分组查询注意力把查询头分成若干组，每组共享一对键值头，从而在显存带宽和模型质量之间取得平衡，是长上下文推理的常用优化手段。'
    expect(isLowQualityText(prose)).toBe(false)
  })

  test('chunkWikiMarkdown 端到端：参考文献巨段被丢弃，正文保留', () => {
    const refDump = Array.from(
      { length: 40 },
      (_, i) => `[${i + 1}] Author ${i} A, Author ${i} B, et al. Some Title ${i}. In: Proceedings, 2024. arXiv:24${i}.0001.`,
    ).join(' ')
    const md = `# PDF\n\n> attachmentKey: \`K\`\n\n---\n\n<p id="p1_1">This is a genuine finding about attention efficiency and memory cost.</p>\n<p id="p9_1">${refDump}</p>`
    const chunks = chunkWikiMarkdown(md)
    expect(chunks.some((c) => c.content.includes('genuine finding'))).toBe(true)
    expect(chunks.some((c) => c.content.includes('Proceedings'))).toBe(false)
  })
})
