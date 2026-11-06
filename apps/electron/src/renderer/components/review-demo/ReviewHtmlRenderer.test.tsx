/**
 * ReviewHtmlRenderer 单测：
 *   - sanitize 输入/输出快照 + XSS 防御（happy-dom 下纯字符串校验）
 *   - Portal 集成：<cite> 被替换为 mount slot；§7 <li> 被打 data-asci-ref-n
 *     （不深入 CitationBadge 渲染细节 —— 那套交互由 CitationBadge 自己的单测覆盖）
 *
 * 不测 KaTeX auto-render（动态 import + 浏览器特定）。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'

import { ReviewHtmlRenderer, sanitizeReviewHtml } from './ReviewHtmlRenderer.tsx'

afterEach(() => {
  cleanup()
})

describe('sanitizeReviewHtml', () => {
  test('保留 contract 内的标签和属性', () => {
    const input = `<article class="asci-review" data-version="1">
      <header><h1>Title</h1></header>
      <section id="s1"><h2>§1</h2>
        <p>claim<cite data-ref="1"><q>quote</q></cite>.</p>
      </section>
      <section id="s7" class="references">
        <ol class="refs">
          <li id="ref-1" data-ref="1" data-paper-id="p-1" data-doi="10.x/y">
            A. <i>Title</i>. (2020)
          </li>
        </ol>
      </section>
    </article>`
    const out = sanitizeReviewHtml(input)
    expect(out).toContain('<article')
    expect(out).toContain('class="asci-review"')
    expect(out).toContain('data-version="1"')
    expect(out).toContain('<cite data-ref="1">')
    expect(out).toContain('<q>quote</q>')
    expect(out).toContain('data-paper-id="p-1"')
    expect(out).toContain('data-doi="10.x/y"')
  })

  // 注意：happy-dom 与 DOMPurify 在「同一 sanitize 调用同时含 <script> + 其它
  // 待清理属性」时存在已知交互 quirk —— sanitize 中断在 script 处理后，后续元素
  // 不再深度遍历。生产 Electron 真 Chromium 没这问题。本测试有意分开输入以规避。
  test('XSS：剥 <script> 标签', () => {
    const out = sanitizeReviewHtml(`<p>safe<script>alert(1)</script></p>`)
    expect(out.toLowerCase()).not.toContain('<script')
    expect(out).toContain('<p>safe</p>')
  })

  test('XSS：剥 onclick 事件属性', () => {
    const out = sanitizeReviewHtml(`<p onclick="alert('xss')">handler</p>`)
    expect(out.toLowerCase()).not.toContain('onclick')
    expect(out).toContain('handler')
  })

  test('XSS：剥 onerror 事件属性', () => {
    // 注：白名单不含 <img>，整个元素会被剥；但属性 onerror 也不应留存
    const out = sanitizeReviewHtml(`<p>x<span onerror="alert(1)">y</span></p>`)
    expect(out.toLowerCase()).not.toContain('onerror')
  })

  test('XSS：javascript: URL 被剥', () => {
    const out = sanitizeReviewHtml(`<p><a href="javascript:alert(1)">danger</a></p>`)
    expect(out.toLowerCase()).not.toContain('javascript:')
    expect(out).toContain('danger')
  })

  test('剥 inline style（防 CSS 注入 / 视觉劫持）', () => {
    const input = `<p style="position:fixed;top:0;background:red;width:100vw;">hi</p>`
    const out = sanitizeReviewHtml(input)
    expect(out.toLowerCase()).not.toContain('style=')
    expect(out).toContain('hi')
  })

  test('剥 <iframe>', () => {
    const out = sanitizeReviewHtml(`<p>before</p><iframe src="evil"></iframe>`)
    expect(out.toLowerCase()).not.toContain('<iframe')
  })

  test('剥 <form> tag（happy-dom quirk：嵌套子元素分别测）', () => {
    const out = sanitizeReviewHtml(`<form action="evil">x</form>`).toLowerCase()
    expect(out).not.toContain('<form')
    expect(out).toContain('x')
  })

  test('剥 <input>（独立出现时）', () => {
    const out = sanitizeReviewHtml(`<p>before</p><input type="text" />`).toLowerCase()
    expect(out).not.toContain('<input')
  })

  test('剥 <button>（独立出现时）', () => {
    const out = sanitizeReviewHtml(`<p>before</p><button>click</button>`).toLowerCase()
    expect(out).not.toContain('<button')
  })

  test('保留 http(s) / mailto / 锚点 href', () => {
    const input = `<p>
      <a href="https://example.com">ok</a>
      <a href="#ref-1">anchor</a>
      <a href="mailto:a@b.com">mail</a>
    </p>`
    const out = sanitizeReviewHtml(input).toLowerCase()
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('href="#ref-1"')
    expect(out).toContain('href="mailto:a@b.com"')
  })

  test('剥 data: URL href', () => {
    const out = sanitizeReviewHtml(
      `<p><a href="data:text/html,hello">bad</a></p>`,
    ).toLowerCase()
    expect(out).not.toContain('data:text/html')
  })

  test('保留数学公式 LaTeX 源（KaTeX auto-render 在下游处理）', () => {
    const input = `<p>Inline \\(x^2 + y^2 = z^2\\) and block \\[E=mc^2\\].</p>`
    const out = sanitizeReviewHtml(input)
    // 反斜杠 + 圆括号 / 方括号是文本字符，sanitizer 不会动它
    expect(out).toContain('\\(x^2 + y^2 = z^2\\)')
    expect(out).toContain('\\[E=mc^2\\]')
  })

  test('keep <cite> 即使没 data-ref（contract 违规但内容仍保留）', () => {
    // contract 上 <cite> 必须带 data-ref；这里测最坏情况下不丢内容
    const input = `<p>x<cite>foo</cite>y</p>`
    const out = sanitizeReviewHtml(input)
    expect(out).toContain('<cite>foo</cite>')
  })

  test('未知标签 <marquee> 被剥，内容保留', () => {
    const out = sanitizeReviewHtml(`<p><marquee>scroll</marquee></p>`).toLowerCase()
    expect(out).not.toContain('<marquee')
    expect(out).toContain('scroll')
  })

  test('未知自定义标签 <custom-tag> 被剥，内容保留', () => {
    const out = sanitizeReviewHtml(`<p><custom-tag>x</custom-tag></p>`).toLowerCase()
    expect(out).not.toContain('<custom-tag')
    expect(out).toContain('x')
  })

  test('<div> 不在白名单 → 被剥（说明白名单严格）', () => {
    const out = sanitizeReviewHtml(`<div>x</div>`).toLowerCase()
    expect(out).not.toContain('<div')
    expect(out).toContain('x')
  })

  test('standalone HTML 文档作为输入：<html>/<head>/<body>/<style>/<script> 被剥，<article> 保留', () => {
    // persistence 层会把 fragment 包成完整文档；renderer 收到的可能是 wrapped 形态
    const wrapped = `<!doctype html><html><head><title>X</title><style>p{color:red}</style><script>alert(1)</script></head><body><article class="asci-review" data-version="1"><header><h1>T</h1></header><section id="s1"><p>hello<cite data-ref="1"><q>q</q></cite>.</p></section></article></body></html>`
    const out = sanitizeReviewHtml(wrapped).toLowerCase()
    // 注意：用 `<head>` 而非 `<head` 检查，否则会误命中 `<header>`
    expect(out).not.toContain('<html')
    expect(out).not.toContain('<head>')
    expect(out).not.toContain('<body')
    expect(out).not.toContain('<style')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert(1)')
    expect(out).toContain('<article')
    expect(out).toContain('<header>') // header 在白名单里，应保留
    expect(out).toContain('<cite data-ref="1">')
  })
})

describe('ReviewHtmlRenderer（Portal 集成）', () => {
  const sample = `<article class="asci-review" data-version="1">
    <header><h1>T</h1></header>
    <section id="s1"><h2>§1</h2>
      <p>claim<cite data-ref="1"><q>quote-one</q></cite>.</p>
      <p>multi<cite data-ref="3"><q>quote-three</q></cite>.</p>
    </section>
    <section id="s7" class="references">
      <h2>§7 References</h2>
      <ol class="refs">
        <li id="ref-1" data-ref="1">A. <i>T1</i>. (2020)</li>
        <li id="ref-3" data-ref="3">B. <i>T3</i>. (2021)</li>
      </ol>
    </section>
  </article>`

  test('原始 <cite data-ref> 被替换为 mount slot；不再保留在 DOM', () => {
    const { container } = render(
      <TooltipProvider>
        <ReviewHtmlRenderer html={sample} />
      </TooltipProvider>,
    )
    // <cite> 全部被替换
    expect(container.querySelectorAll('cite[data-ref]').length).toBe(0)
    // mount slot 出现，数量与 cite 一致
    const slots = container.querySelectorAll('[data-asci-cite-mount]')
    expect(slots.length).toBe(2)
  })

  test('§7 <li> 被打上 data-asci-ref-n（CitationBadge 跳转锚点）', () => {
    const { container } = render(
      <TooltipProvider>
        <ReviewHtmlRenderer html={sample} />
      </TooltipProvider>,
    )
    expect(container.querySelector('[data-asci-ref-n="1"]')).not.toBeNull()
    expect(container.querySelector('[data-asci-ref-n="3"]')).not.toBeNull()
  })

  test('容器被打上 data-asci-citations-root（限定跳转作用域）', () => {
    const { container } = render(
      <TooltipProvider>
        <ReviewHtmlRenderer html={sample} />
      </TooltipProvider>,
    )
    expect(container.querySelector('[data-asci-citations-root]')).not.toBeNull()
  })

  test('每个 mount slot 内部已被 CitationBadge 接管（出现 [N] 文本）', () => {
    const { container } = render(
      <TooltipProvider>
        <ReviewHtmlRenderer html={sample} />
      </TooltipProvider>,
    )
    const slots = Array.from(
      container.querySelectorAll<HTMLElement>('[data-asci-cite-mount]'),
    )
    // CitationBadge 渲染出来的 trigger 是 [N] 文本
    const texts = slots.map((s) => s.textContent?.trim())
    expect(texts).toContain('[1]')
    expect(texts).toContain('[3]')
  })

  test('initialActiveAnchor 命中 sectionId|paragraphIndex → 自动激活 EvidenceTraceCard（quote 可见）', async () => {
    const anchor = {
      type: 'html' as const,
      snapshotText: 'quote-three',
      locationData: {
        kind: 'html' as const,
        sectionId: 's1',
        paragraphIndex: 1,
        citeIndex: 0,
      },
    }
    const { findAllByText } = render(
      <TooltipProvider>
        <ReviewHtmlRenderer html={sample} initialActiveAnchor={anchor} reviewId={'rev-1' as never} />
      </TooltipProvider>,
    )
    // 卡片激活后 quote 文本应可见（trace card 内）；effect + portal → 用 findAllBy 等待
    const hits = await findAllByText('quote-three')
    expect(hits.length).toBeGreaterThan(0)
  })

  test('contract 违规的裸 <cite>（缺 data-ref）不被替换，作为普通元素保留', () => {
    const { container } = render(
      <TooltipProvider>
        <ReviewHtmlRenderer html={`<article><p>x<cite>plain</cite>y</p></article>`} />
      </TooltipProvider>,
    )
    expect(container.querySelector('cite')?.textContent).toBe('plain')
    expect(container.querySelectorAll('[data-asci-cite-mount]').length).toBe(0)
  })
})

// issue #538（B 计划）：§8 Per-Paper Decisions 默认折叠 + 点标题展开/收起
describe('§8 Per-Paper Decisions 折叠', () => {
  const decisionsSample = `<article class="asci-review">
    <section id="s1"><h2>§1 Intro</h2><p>body</p></section>
    <section id="s8" class="decisions">
      <h2>§8 Per-Paper Decisions</h2>
      <ul>
        <li data-ref="1">Deep-Read — read raw mdPath</li>
        <li data-ref="2">Abstract-Only — full text unavailable</li>
      </ul>
    </section>
  </article>`

  test('默认折叠：正文搬进 body 容器并隐藏，toggle aria-expanded=false', () => {
    const { container } = render(
      <TooltipProvider>
        <ReviewHtmlRenderer html={decisionsSample} />
      </TooltipProvider>,
    )
    const section = container.querySelector('section#s8') as HTMLElement
    expect(section.hasAttribute('data-asci-decisions-collapsible')).toBe(true)
    const body = section.querySelector('[data-asci-decisions-body]') as HTMLElement
    expect(body).not.toBeNull()
    // <ul> 被搬进折叠 body 容器
    expect(body.querySelector('ul')).not.toBeNull()
    expect(body.hidden).toBe(true)
    // h2 保留 heading 语义（不被 role=button 覆盖），交互在内嵌 button 上
    const heading = section.querySelector(':scope > h2') as HTMLElement
    expect(heading.hasAttribute('role')).toBe(false)
    const toggle = section.querySelector('[data-asci-decisions-toggle]') as HTMLButtonElement
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  test('点击 toggle 展开，再点收起', () => {
    const { container } = render(
      <TooltipProvider>
        <ReviewHtmlRenderer html={decisionsSample} />
      </TooltipProvider>,
    )
    const toggle = container.querySelector('[data-asci-decisions-toggle]') as HTMLElement
    const body = container.querySelector('[data-asci-decisions-body]') as HTMLElement
    fireEvent.click(toggle)
    expect(body.hidden).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(body.hidden).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  test('无 §8 的综述：不报错也不加折叠容器', () => {
    const { container } = render(
      <TooltipProvider>
        <ReviewHtmlRenderer html={`<article><section id="s1"><h2>§1</h2><p>x</p></section></article>`} />
      </TooltipProvider>,
    )
    expect(container.querySelector('[data-asci-decisions-collapsible]')).toBeNull()
    expect(container.querySelector('[data-asci-decisions-body]')).toBeNull()
  })
})
