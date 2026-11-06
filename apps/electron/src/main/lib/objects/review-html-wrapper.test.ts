/**
 * review-html-wrapper 单测：纯字符串变换，幂等性 + 模板完整性。
 */
import { describe, expect, test } from 'bun:test'

import {
  isReviewHtmlWrapped,
  wrapReviewHtmlFragment,
} from './review-html-wrapper.ts'

const SAMPLE_FRAGMENT = `<article class="asci-review" data-version="1">
  <header><h1>LFM Reconstruction</h1></header>
  <section id="s1"><h2>§1</h2><p>x<cite data-ref="1"><q>q</q></cite>.</p></section>
</article>`

// 检索报告 fragment（searches/*.html）—— 与综述共用 wrapper，仅 article class 不同
const SEARCH_REPORT_FRAGMENT = `<article class="asci-search-report" data-version="1">
  <header><h1>Literature Search Report: AI in Education</h1></header>
  <section id="s1"><h2>§1 Search overview</h2><table><tbody><tr><th>Sources</th><td>crossref</td></tr></tbody></table></section>
</article>`

describe('isReviewHtmlWrapped', () => {
  test('fragment 返回 false', () => {
    expect(isReviewHtmlWrapped(SAMPLE_FRAGMENT)).toBe(false)
  })

  test('<!doctype html> 返回 true', () => {
    expect(isReviewHtmlWrapped('<!doctype html><html>...')).toBe(true)
    expect(isReviewHtmlWrapped('<!DOCTYPE html>\n<html>')).toBe(true)
  })

  test('<html ...> 不带 doctype 也算 wrapped', () => {
    expect(isReviewHtmlWrapped('<html lang="en">...')).toBe(true)
  })

  test('前导空白不影响判断', () => {
    expect(isReviewHtmlWrapped('   \n<!doctype html>\n<html>')).toBe(true)
  })

  test('只有 fragment（<article> 起头）→ false', () => {
    expect(isReviewHtmlWrapped('<article class="asci-review">...')).toBe(false)
  })
})

describe('wrapReviewHtmlFragment', () => {
  test('已 wrapped 输入 → 原样返回（幂等）', () => {
    const wrapped = '<!doctype html><html><head></head><body><article class="asci-review">x</article></body></html>'
    expect(wrapReviewHtmlFragment(wrapped)).toBe(wrapped)
  })

  test('fragment → 完整 HTML5 文档', () => {
    const out = wrapReviewHtmlFragment(SAMPLE_FRAGMENT)
    expect(out.startsWith('<!doctype html>')).toBe(true)
    expect(out).toContain('<html lang="en">')
    expect(out).toContain('<meta charset="utf-8">')
    expect(out).toContain('</html>')
    // fragment 原文 verbatim 嵌入
    expect(out).toContain('<article class="asci-review"')
    expect(out).toContain('<cite data-ref="1">')
  })

  test('title 从 fragment 首个 <h1> 自动提取', () => {
    const out = wrapReviewHtmlFragment(SAMPLE_FRAGMENT)
    expect(out).toContain('<title>LFM Reconstruction</title>')
  })

  test('options.title 优先级高于 h1', () => {
    const out = wrapReviewHtmlFragment(SAMPLE_FRAGMENT, { title: 'Override Title' })
    expect(out).toContain('<title>Override Title</title>')
    expect(out).not.toContain('<title>LFM Reconstruction</title>')
  })

  test('title 中的 HTML 特殊字符被转义（防注入到 <title>）', () => {
    const out = wrapReviewHtmlFragment(SAMPLE_FRAGMENT, { title: '<script>x</script>' })
    expect(out).toContain('<title>&lt;script&gt;x&lt;/script&gt;</title>')
    // 同时<head>里不会出现真的<script>x</script>，否则会被浏览器执行
    const head = out.slice(0, out.indexOf('</head>'))
    expect(head).not.toContain('<script>x</script>')
  })

  test('无 <h1> 的 fragment → 默认 title "Review"', () => {
    const out = wrapReviewHtmlFragment('<article class="asci-review"><p>no h1</p></article>')
    expect(out).toContain('<title>Review</title>')
  })

  test('包出来的文档包含 KaTeX CDN + asci-cite-badge 样式 + 引用 JS 关键标识', () => {
    const out = wrapReviewHtmlFragment(SAMPLE_FRAGMENT)
    expect(out).toContain('katex@0.16/dist/katex.min.css')
    expect(out).toContain('katex.min.js')
    expect(out).toContain('auto-render.min.js')
    expect(out).toContain('.asci-cite-badge')
    expect(out).toContain('data-asci-citations-root')
    // 角标颜色与 CitationBadge 对齐
    expect(out).toContain('#fde68a')
    expect(out).toContain('#fcd34d')
    expect(out).toContain('#78350f')
  })

  test('Evidence trace 卡片 CSS / JS 标识；不再包含 hover Tooltip 与 §7 返回按钮', () => {
    const out = wrapReviewHtmlFragment(SAMPLE_FRAGMENT)
    // 新增：trace 卡片样式 + 行为
    expect(out).toContain('.asci-evidence-trace-card')
    expect(out).toContain('data-asci-evidence-trace-slot')
    expect(out).toContain('data-asci-evidence-trace-card')
    // 已移除：tooltip & return button & §7 跳转高亮
    expect(out).not.toContain('id="asci-tooltip"')
    expect(out).not.toContain('#asci-return-btn')
    expect(out).not.toContain('asci-ref-highlight')
    // 不应内联应用内才有的两个按钮文案
    expect(out).not.toContain('Open full context in Paper')
    expect(out).not.toContain('Add note here')
  })

  test('包二次（已 wrapped 的产物再包一次）→ 不变（幂等）', () => {
    const out1 = wrapReviewHtmlFragment(SAMPLE_FRAGMENT)
    const out2 = wrapReviewHtmlFragment(out1)
    expect(out2).toBe(out1)
  })

  test('强制主题：含 data-asci-theme override + hash 解析 JS', () => {
    const out = wrapReviewHtmlFragment(SAMPLE_FRAGMENT)
    // CSS：light/dark 强制 override 块都在（属性选择器覆盖 prefers-color-scheme）
    expect(out).toContain(':root[data-asci-theme="light"]')
    expect(out).toContain(':root[data-asci-theme="dark"]')
    // head 内同步脚本从 hash 读 #asci-theme 设 data-asci-theme
    expect(out).toContain('asci-theme=(light|dark)')
    expect(out).toContain("setAttribute('data-asci-theme'")
    // 浏览器双击兜底仍保留 prefers-color-scheme 媒体查询
    expect(out).toContain('@media (prefers-color-scheme: dark)')
  })

  test('检索报告 fragment（asci-search-report）→ 复用 wrapper，CSS/JS 选择器覆盖', () => {
    const out = wrapReviewHtmlFragment(SEARCH_REPORT_FRAGMENT)
    expect(out.startsWith('<!doctype html>')).toBe(true)
    expect(out).toContain('<article class="asci-search-report"')
    // title 从 search 报告 h1 提取
    expect(out).toContain('<title>Literature Search Report: AI in Education</title>')
    // CSS/JS 选择器已泛化覆盖两种 article class（不再只 .asci-review）
    expect(out).toContain('article.asci-search-report')
    expect(out).toContain("querySelector('article.asci-review, article.asci-search-report')")
    // 表格样式存在（检索报告 §1 概览是表格）
    expect(out).toContain('article table')
  })
})
