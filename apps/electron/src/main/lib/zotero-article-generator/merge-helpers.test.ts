/**
 * merge-helpers 单测：dedupSectionNumbers + rebuildOutline。
 *
 * 覆盖：
 *   - dedup 无冲突保持不变
 *   - dedup 续片重启编号 → 严格递增
 *   - dedup 跳号保留（1, 3 不动）
 *   - dedup 同一编号多次出现 → 都被改写但 renumberMap 只记首映射
 *   - rebuildOutline 多片场景下 OUTLINE 不全 → 补齐
 *   - rebuildOutline OUTLINE 缺失但 CONTENT 在 → 不动（保守）
 *   - rebuildOutline 都缺 → 不动
 *   - dedup + rebuildOutline 组合：duplicates → 去重 → OUTLINE 重建
 */

import { test, expect } from 'bun:test'
import { dedupSectionNumbers, rebuildOutline } from './merge-helpers'

test('dedupSectionNumbers: 无冲突保持原样', () => {
  const body = [
    '# CONTENT',
    '',
    '# 1. Intro',
    '<p id="p1_1">a</p>',
    '',
    '# 2. Method',
    '<p id="p2_1">b</p>',
  ].join('\n')
  const { body: out, renumberMap } = dedupSectionNumbers(body)
  expect(out).toBe(body)
  expect(renumberMap.size).toBe(0)
})

test('dedupSectionNumbers: chunk 2 重启编号 → 严格递增改写', () => {
  const body = [
    '# 1. Intro',
    'text',
    '# 2. Method',
    'text',
    '# 1. Results',      // 冲突，应改为 # 3
    'text',
    '# 2. Discussion',   // 冲突，应改为 # 4
    'text',
  ].join('\n')
  const { body: out, renumberMap } = dedupSectionNumbers(body)
  expect(out).toContain('# 1. Intro')
  expect(out).toContain('# 2. Method')
  expect(out).toContain('# 3. Results')
  expect(out).toContain('# 4. Discussion')
  expect(out).not.toContain('# 1. Results')
  expect(out).not.toContain('# 2. Discussion')
  // renumberMap 记 oldN → newN（每个 oldN 只记第一次冲突的改写）
  expect(renumberMap.get(1)).toBe(3)
  expect(renumberMap.get(2)).toBe(4)
})

test('dedupSectionNumbers: 跳号场景保留意图（runningMax < N 时不改）', () => {
  const body = [
    '# 1. Intro',
    '# 3. Results',  // 跳过 2，但 3 > runningMax=1，合法
    '# 5. Conclusion',
  ].join('\n')
  const { body: out, renumberMap } = dedupSectionNumbers(body)
  expect(out).toBe(body)
  expect(renumberMap.size).toBe(0)
})

test('dedupSectionNumbers: 同一编号多次出现都被改写', () => {
  const body = [
    '# 1. Intro',
    '# 1. Methods (chunk2)',  // → # 2
    '# 1. Results (chunk3)',  // → # 3
  ].join('\n')
  const { body: out, renumberMap } = dedupSectionNumbers(body)
  expect(out).toContain('# 1. Intro')
  expect(out).toContain('# 2. Methods (chunk2)')
  expect(out).toContain('# 3. Results (chunk3)')
  // renumberMap 只记首次映射 1 → 2（后续 1 → 3 重写但不更新 map，调试用足够）
  expect(renumberMap.get(1)).toBe(2)
})

test('dedupSectionNumbers: 容忍中文顿号 # N、Title', () => {
  const body = [
    '# 1、引言',
    '# 1、方法',  // 冲突，改 # 2
  ].join('\n')
  const { body: out } = dedupSectionNumbers(body)
  expect(out).toContain('# 1. 引言')   // 输出统一用 `. `
  expect(out).toContain('# 2. 方法')
})

test('rebuildOutline: 多片场景 OUTLINE 不全 → 用 CONTENT 真实标题补齐', () => {
  const body = [
    '# OUTLINE',
    '',
    '- 1. Intro',
    '- 2. Method',         // 只有 chunk 1 的章节
    '',
    '# CONTENT',
    '',
    '# 1. Intro',
    '<p id="p1_1">...</p>',
    '',
    '# 2. Method',
    '<p id="p2_1">...</p>',
    '',
    '# 3. Results',         // chunk 2 章节，OUTLINE 漏了
    '<p id="p3_1">...</p>',
    '',
    '# 4. Discussion',
    '<p id="p4_1">...</p>',
    '',
    '# 5. Conclusion',
    '<p id="p5_1">...</p>',
  ].join('\n')
  const out = rebuildOutline(body)
  expect(out).toContain('- 1. Intro')
  expect(out).toContain('- 2. Method')
  expect(out).toContain('- 3. Results')
  expect(out).toContain('- 4. Discussion')
  expect(out).toContain('- 5. Conclusion')
  // CONTENT 之后不动
  expect(out).toMatch(/<p id="p5_1">/)
  // OUTLINE 块只出现一次，重建后块紧跟 # OUTLINE
  const outlineHeaderCount = (out.match(/^# OUTLINE\b/gm) ?? []).length
  expect(outlineHeaderCount).toBe(1)
})

test('rebuildOutline: 缺 OUTLINE 但有 CONTENT → 保守不动', () => {
  const body = [
    '# CONTENT',
    '# 1. Intro',
  ].join('\n')
  const out = rebuildOutline(body)
  expect(out).toBe(body)
})

test('rebuildOutline: 缺 CONTENT → 保守不动（结构异常 LLM 已经罢工）', () => {
  const body = [
    '# OUTLINE',
    '- 1. Intro',
  ].join('\n')
  const out = rebuildOutline(body)
  expect(out).toBe(body)
})

test('rebuildOutline: CONTENT 之后无 # N. heading → 保守不动', () => {
  const body = [
    '# OUTLINE',
    '- 1. Intro',
    '',
    '# CONTENT',
    '',
    '<p id="p0_1">乱七八糟的段落，没有一级标题</p>',
  ].join('\n')
  const out = rebuildOutline(body)
  expect(out).toBe(body)
})

test('rebuildOutline: 不会把 # OUTLINE / # CONTENT 错认成一级章节', () => {
  // 防御性测试：headingRe 必须只匹配 `# N.` 格式，不能误抓 OUTLINE/CONTENT 这类无编号 header
  const body = [
    '# OUTLINE',
    '- 1. Intro',
    '',
    '# CONTENT',
    '',
    '# 1. Intro',
    '# 2. Method',
  ].join('\n')
  const out = rebuildOutline(body)
  // 重建后 OUTLINE 列表项里不应出现 "OUTLINE" / "CONTENT" 字样
  const outlineSection = out.slice(out.indexOf('# OUTLINE'), out.indexOf('# CONTENT'))
  expect(outlineSection).not.toContain('- OUTLINE')
  expect(outlineSection).not.toContain('- CONTENT')
  expect(outlineSection).toContain('- 1. Intro')
  expect(outlineSection).toContain('- 2. Method')
})

test('dedupSectionNumbers: 容忍无标点纯空格 # N Title（pdf-parse 抽出原文形式）', () => {
  const body = [
    '# 1 Introduction',
    'text',
    '# 2 Approach',
    'text',
    '# 3 Results',
    'text',
  ].join('\n')
  const { body: out, renumberMap } = dedupSectionNumbers(body)
  // 无冲突，编号不动；但格式被归一为带句点形式
  expect(out).toContain('# 1. Introduction')
  expect(out).toContain('# 2. Approach')
  expect(out).toContain('# 3. Results')
  expect(out).not.toContain('# 1 Introduction')
  expect(renumberMap.size).toBe(0)
})

test('dedupSectionNumbers: GPT-3 paper 真实场景 — 主章节无句点 + 附录带句点重启', () => {
  // 实例来自用户报告 (2I7482W5.article.md)：
  //   主章节 1-10 无句点（chunk 1 LLM 沿用 pdf-parse 原文格式）
  //   附录 1.G / 2.H / 3.References 带句点且从 1 重启（chunk 2 LLM 重启编号）
  const body = [
    '# 1 Introduction',
    'intro text',
    '# 2 Approach',
    'approach text',
    '# 3 Results',
    'results text',
    '# 7 Related Work',
    'rel work',
    '# 8 Conclusion',
    'conc',
    '# 1. G Details of Task Phrasing and Specifications',  // 冲突 with #1, 应改 # 9
    'appendix g',
    '# 2. H Results on All Tasks for All Model Sizes',     // 冲突, 应改 # 10
    'appendix h',
    '# 3. References',                                      // 冲突, 应改 # 11
    'refs',
  ].join('\n')
  const { body: out, renumberMap } = dedupSectionNumbers(body)

  // 主章节 1-8 不变（归一为带句点）
  expect(out).toContain('# 1. Introduction')
  expect(out).toContain('# 8. Conclusion')

  // 附录递增到 9 / 10 / 11
  expect(out).toContain('# 9. G Details of Task Phrasing and Specifications')
  expect(out).toContain('# 10. H Results on All Tasks for All Model Sizes')
  expect(out).toContain('# 11. References')

  // 老编号 1/2/3 都触发了重映射
  expect(renumberMap.get(1)).toBe(9)
  expect(renumberMap.get(2)).toBe(10)
  expect(renumberMap.get(3)).toBe(11)
})

test('rebuildOutline: 主章节无句点也能被扫描', () => {
  const body = [
    '# OUTLINE',
    '',
    '- 1. G Details',
    '- 2. H Results',
    '- 3. References',     // 老 OUTLINE 缺主章节
    '',
    '# CONTENT',
    '',
    '# 1 Introduction',   // 主章节无句点
    'text',
    '# 2 Approach',
    'text',
    '# 3 Results',
    'text',
  ].join('\n')
  const out = rebuildOutline(body)
  // 重建后 OUTLINE 应含全部 3 个主章节
  const outlineSection = out.slice(out.indexOf('# OUTLINE'), out.indexOf('# CONTENT'))
  expect(outlineSection).toContain('- 1. Introduction')
  expect(outlineSection).toContain('- 2. Approach')
  expect(outlineSection).toContain('- 3. Results')
  // 老的占位项被覆盖
  expect(outlineSection).not.toContain('- 1. G Details')
})

test('集成: GPT-3 paper 场景 dedup + rebuildOutline 完整链路', () => {
  // 模拟实际 article.md 结构：OUTLINE 只列了附录，CONTENT 主章节无句点，附录重启编号
  const body = [
    '# OUTLINE',
    '',
    '- 1. G Details of Task Phrasing and Specifications',
    '- 2. H Results on All Tasks for All Model Sizes',
    '- 3. References',
    '',
    '# CONTENT',
    '',
    '# 1 Introduction',
    '<p>intro</p>',
    '# 2 Approach',
    '<p>approach</p>',
    '# 3 Results',
    '<p>results</p>',
    '# 1. G Details of Task Phrasing and Specifications',
    '<p>appendix g</p>',
    '# 2. H Results on All Tasks for All Model Sizes',
    '<p>appendix h</p>',
    '# 3. References',
    '<p>refs</p>',
  ].join('\n')

  const { body: deduped } = dedupSectionNumbers(body)
  const final = rebuildOutline(deduped)

  // CONTENT 主章节归一为带句点
  expect(final).toContain('# 1. Introduction')
  expect(final).toContain('# 2. Approach')
  expect(final).toContain('# 3. Results')
  // 附录递增到 4/5/6
  expect(final).toContain('# 4. G Details of Task Phrasing and Specifications')
  expect(final).toContain('# 5. H Results on All Tasks for All Model Sizes')
  expect(final).toContain('# 6. References')

  // OUTLINE 重建后含 6 项
  const outlineSection = final.slice(final.indexOf('# OUTLINE'), final.indexOf('# CONTENT'))
  expect(outlineSection).toContain('- 1. Introduction')
  expect(outlineSection).toContain('- 2. Approach')
  expect(outlineSection).toContain('- 3. Results')
  expect(outlineSection).toContain('- 4. G Details of Task Phrasing and Specifications')
  expect(outlineSection).toContain('- 5. H Results on All Tasks for All Model Sizes')
  expect(outlineSection).toContain('- 6. References')
})

test('SECTION_HEADING_LINE_RE: 反例不应误匹配', () => {
  // 这里用 import 的 line-regex 做单元级断言
  const { SECTION_HEADING_LINE_RE } = require('./merge-helpers') as {
    SECTION_HEADING_LINE_RE: RegExp
  }
  // 反例
  expect('# OUTLINE').not.toMatch(SECTION_HEADING_LINE_RE)
  expect('# CONTENT').not.toMatch(SECTION_HEADING_LINE_RE)
  expect('# 10').not.toMatch(SECTION_HEADING_LINE_RE)         // 缺标题
  expect('# 1.').not.toMatch(SECTION_HEADING_LINE_RE)         // 句点后无内容
  expect('## 1.1 Subsection').not.toMatch(SECTION_HEADING_LINE_RE)  // 二级标题
  // 正例
  expect('# 1. Introduction').toMatch(SECTION_HEADING_LINE_RE)
  expect('# 10. References').toMatch(SECTION_HEADING_LINE_RE)
  expect('# 1 Introduction').toMatch(SECTION_HEADING_LINE_RE)
  expect('# 1、引言').toMatch(SECTION_HEADING_LINE_RE)
  expect('# 1.Introduction').toMatch(SECTION_HEADING_LINE_RE)  // 句点后无空格
})

test('集成: dedup + rebuildOutline 链式应用', () => {
  // 模拟 LLM 多片场景：chunk 2 重启编号 + OUTLINE 不全
  const body = [
    '# OUTLINE',
    '',
    '- 1. Intro',
    '- 2. Method',
    '',
    '# CONTENT',
    '',
    '# 1. Intro',
    '<p id="p1_1">...</p>',
    '',
    '# 2. Method',
    '<p id="p2_1">...</p>',
    '',
    '# 1. Results',       // chunk 2 重启编号
    '<p id="p1_1">...</p>',
    '',
    '# 2. Discussion',
    '<p id="p2_1">...</p>',
  ].join('\n')

  const { body: deduped } = dedupSectionNumbers(body)
  const final = rebuildOutline(deduped)

  // CONTENT 区域的标题已去重
  expect(final).toContain('# 3. Results')
  expect(final).toContain('# 4. Discussion')

  // OUTLINE 已重建包含全部 4 节
  const outlineSection = final.slice(final.indexOf('# OUTLINE'), final.indexOf('# CONTENT'))
  expect(outlineSection).toContain('- 1. Intro')
  expect(outlineSection).toContain('- 2. Method')
  expect(outlineSection).toContain('- 3. Results')
  expect(outlineSection).toContain('- 4. Discussion')
})
