/**
 * formatter 单元测试
 *
 * 覆盖三组场景：
 *  - 单 section（无 heading 前的 preamble 段，单个 numbered section）
 *  - 多 section（含未编号 heading + 编号 heading）
 *  - 含 subsection（1.1 / 1.1.1）的多级 heading
 *
 * 断言：outline 行数、`<p id="pS_P">` 锚点、heading 级别 / 编号格式
 */

import { test, expect } from 'bun:test'
import type { Token } from './classifier'
import { format } from './formatter'

function mkHeading(level: number, sectionNumber: number, text: string, rawNumber: string | null = null): Token {
  return { kind: 'heading', level, sectionNumber, text, rawNumber }
}

function mkText(sectionNumber: number, paragraphIndex: number, text: string, startsParagraph = false): Token {
  return { kind: 'text', sectionNumber, paragraphIndex, text, startsParagraph }
}

test('formatter: 单 section + preamble 原文输出', () => {
  const tokens: Token[] = [
    mkText(0, 1, 'Pre-heading abstract line', true),
    mkText(0, 1, 'continuation of abstract'),
    { kind: 'blank' },
    mkHeading(1, 1, 'Introduction', '1'),
    mkText(1, 1, 'This is the first paragraph.', true),
    { kind: 'blank' },
    mkText(1, 2, 'Second paragraph here.', true),
  ]
  const { outline, body } = format(tokens)

  expect(outline).toEqual(['1. Introduction'])
  // Preamble（section=0）：原文逐行展示，不加 <p>，不合并
  expect(body).toContain('Pre-heading abstract line')
  expect(body).toContain('continuation of abstract')
  expect(body).not.toContain('<p id="p0_1">')
  expect(body).not.toContain('<p id="p0_2">')
  // 正文 section 1：保留 <p>，同 paragraphIndex 合并
  expect(body).toContain('# 1. Introduction')
  expect(body).toContain('<p id="p1_1">This is the first paragraph.</p>')
  expect(body).toContain('<p id="p1_2">Second paragraph here.</p>')
})

test('formatter: preamble heading（如 PDF 标题）原文输出，不加 #', () => {
  // 模拟封面：标题（最大字号，sectionNumber=0）+ 作者行（text）→ 真 section 1
  const tokens: Token[] = [
    mkHeading(1, 0, 'Training language models to follow instructions'),
    mkHeading(1, 0, 'with human feedback'),
    mkText(0, 1, 'Long Ouyang*  Jeff Wu*  Xu Jiang*', true),
    mkText(0, 2, 'OpenAI', true),
    mkHeading(1, 1, 'Abstract'),
    mkText(1, 1, 'Making language models bigger...', true),
  ]
  const { outline, body } = format(tokens)

  expect(outline).toEqual(['1. Abstract'])
  // preamble 标题：不加 #、不加章节号
  expect(body).toContain('Training language models to follow instructions')
  expect(body).toContain('with human feedback')
  expect(body).not.toContain('# Training language models')
  // preamble 作者行：原文输出
  expect(body).toContain('Long Ouyang*  Jeff Wu*  Xu Jiang*')
  expect(body).toContain('OpenAI')
  expect(body).not.toContain('<p id="p0_')
  // 真实 section 仍走正常 # / <p> 渲染
  expect(body).toContain('# 1. Abstract')
  expect(body).toContain('<p id="p1_1">Making language models bigger...</p>')
})

test('formatter: 多 section 含未编号 heading', () => {
  const tokens: Token[] = [
    mkHeading(1, 1, 'Abstract'), // 非编号
    mkText(1, 1, 'Abstract paragraph.', true),
    { kind: 'blank' },
    mkHeading(1, 2, 'Introduction', '1'),
    mkText(2, 1, 'Intro p1', true),
    { kind: 'blank' },
    mkText(2, 2, 'Intro p2', true),
    { kind: 'blank' },
    mkHeading(1, 3, 'Method', '2'),
    mkText(3, 1, 'Method p1', true),
  ]
  const { outline, body } = format(tokens)

  expect(outline).toEqual(['1. Abstract', '2. Introduction', '3. Method'])
  // 顶层未编号 heading 也要强制带 "N." 前缀
  expect(body).toContain('# 1. Abstract')
  expect(body).toContain('# 2. Introduction')
  expect(body).toContain('# 3. Method')
  expect(body).toContain('<p id="p1_1">Abstract paragraph.</p>')
  expect(body).toContain('<p id="p2_1">Intro p1</p>')
  expect(body).toContain('<p id="p2_2">Intro p2</p>')
  expect(body).toContain('<p id="p3_1">Method p1</p>')
})

test('formatter: 含 subsection (1.1 / 1.1.1) 多级 heading', () => {
  const tokens: Token[] = [
    mkHeading(1, 1, 'Introduction', '1'),
    mkHeading(2, 1, 'Background', '1.1'),
    mkText(1, 1, 'Background paragraph', true),
    { kind: 'blank' },
    mkHeading(3, 1, 'Sub-detail', '1.1.1'),
    mkText(1, 2, 'Detail paragraph', true),
    { kind: 'blank' },
    mkHeading(2, 1, 'Motivation', '1.2'),
    mkText(1, 3, 'Motivation paragraph', true),
  ]
  const { outline, body } = format(tokens)

  // OUTLINE 只含顶层 heading
  expect(outline).toEqual(['1. Introduction'])
  expect(body).toContain('# 1. Introduction')
  // subsection 保留 rawNumber
  expect(body).toContain('## 1.1 Background')
  expect(body).toContain('### 1.1.1 Sub-detail')
  expect(body).toContain('## 1.2 Motivation')
  // paragraphIndex 在 section 内单调递增，跨 subsection 不重置
  expect(body).toContain('<p id="p1_1">Background paragraph</p>')
  expect(body).toContain('<p id="p1_2">Detail paragraph</p>')
  expect(body).toContain('<p id="p1_3">Motivation paragraph</p>')
})

test('formatter: 同段多 text token 用 \\n 拼接，保留 PDF 原换行', () => {
  const tokens: Token[] = [
    mkHeading(1, 1, 'Section', '1'),
    mkText(1, 1, 'First line', true),
    mkText(1, 1, 'second line'), // 同 section + 同 paragraphIndex → 落到同一 <p> 内
  ]
  const { body } = format(tokens)
  // 行内不再用空格强行连接，而是保留 PDF 原换行
  expect(body).toContain('<p id="p1_1">First line\nsecond line</p>')
})

test('formatter: 跨行连字符断开的单词还原（exam-\\nple → example）', () => {
  const tokens: Token[] = [
    mkHeading(1, 1, 'S', '1'),
    mkText(1, 1, 'inter-', true),
    mkText(1, 1, 'esting'),
  ]
  const { body } = format(tokens)
  expect(body).toContain('<p id="p1_1">interesting</p>')
})
