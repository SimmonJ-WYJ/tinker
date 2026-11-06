/**
 * citation-transform 单元测试
 *
 * 重点覆盖：
 *   - 规范形式 `[N]<quote>X</quote>` 与反向形式 `<quote>X</quote> [N]`
 *   - 孤儿 / 落单 quote 标签的清理
 *   - Pass 5（弱角标兜底）：裸 [N] 在 §7 之前被改写、§7 内不被改写、
 *     连写 [16][17]、引用式链接 [text][1] / 链接定义 [1]: url / 行内链接 [1](url) 都正确处理
 */

import { describe, it, expect } from 'bun:test'
import { transformQuoteCitations, parseCitationHref, CITATION_HREF_PREFIX } from './citation-transform.ts'

describe('transformQuoteCitations — quote forms', () => {
  it('规范形式 [N]<quote>X</quote> → 改写为 markdown 链接', () => {
    const input = '波光学模型 [1]<quote>原文片段</quote>是 LFM 的标准框架。'
    const out = transformQuoteCitations(input)
    expect(out).toContain(`[[1]](${CITATION_HREF_PREFIX}`)
    expect(out).not.toContain('<quote>')
  })

  it('反向形式 <quote>X</quote> [N]', () => {
    const input = '<quote>引用片段</quote> [2] 之前提出。'
    const out = transformQuoteCitations(input)
    expect(out).toContain(`[[2]](${CITATION_HREF_PREFIX}`)
    expect(out).not.toContain('<quote>')
  })

  it('孤儿 <quote>X</quote>（两侧都无 [N]）→ 去标签留内容', () => {
    const input = '本节背景 <quote>独立片段</quote> 仍可读。'
    const out = transformQuoteCitations(input)
    expect(out).toBe('本节背景 独立片段 仍可读。')
  })

  it('单边残留 <quote> / </quote> → 直接删除', () => {
    const input = '左残留 <quote> 文字\n后面 </quote> 右残留。'
    const out = transformQuoteCitations(input)
    expect(out).not.toContain('<quote>')
    expect(out).not.toContain('</quote>')
  })
})

describe('transformQuoteCitations — Pass 5 bare citation fallback', () => {
  it('§7 之前的裸 [N] 改写为弱角标（href 末尾无 fragment）', () => {
    const input = [
      '## 1. Introduction',
      '前人工作 [3] 提出了基础。',
      '## 7. References',
      '- [3] Authors. *Title*. (2020)',
    ].join('\n')
    const out = transformQuoteCitations(input)
    expect(out).toContain(`[[3]](${CITATION_HREF_PREFIX})`)
    // §7 内仍是裸 [3]，不被改写
    expect(out).toContain('- [3] Authors. *Title*. (2020)')
  })

  it('连写 [16][17] 两个都被改写（之前漏 quote 的常见 bug）', () => {
    const input = '## 1. Introduction\n协作安全 [16][17] 的研究。\n## 7. References\n- [16] X. *T*. (2020)\n- [17] Y. *T*. (2021)'
    const out = transformQuoteCitations(input)
    expect(out).toContain(`[[16]](${CITATION_HREF_PREFIX})`)
    expect(out).toContain(`[[17]](${CITATION_HREF_PREFIX})`)
  })

  it('已带 quote 的 [N] 不被 Pass 5 重复改写', () => {
    const input = '## 1. Introduction\n波光学 [1]<quote>原文</quote>。\n## 7. References\n- [1] B. *T*. (2013)'
    const out = transformQuoteCitations(input)
    // 应该只有一个 [1] 角标，且 fragment 非空（来自 quote 的 base64）
    const matches = [...out.matchAll(/\[\[1\]\]\(#asci-cite-([^)]*)\)/g)]
    expect(matches.length).toBe(1)
    const fragment = matches[0]?.[1]
    expect(fragment).not.toBe('') // pass 1 走的是 base64 fragment，非空
  })

  it('§7 References 内的行首 [N] 不被改写', () => {
    const input = [
      '## 7. References',
      '- [1] Author A. *Title 1*. (2020)',
      '- [2] Author B. *Title 2*. (2021)',
    ].join('\n')
    const out = transformQuoteCitations(input)
    expect(out).toBe(input)
  })

  it('容忍 §7 前缀：## §7 References 块内的 [N] 不被改写', () => {
    // abstract-only 路径 LLM 常输出 `## §7 References`；正则未容忍时 Pass 5
    // 会把整篇当 §7 之外，导致 §7 行首 [N] 被错误改写为弱角标，破坏 MarkdownRenderer
    // 的 data-asci-ref-n 锚点（首子节点变成 <a>，extractRefNumber 拿不到 [N] 文本）
    const input = [
      '## §1 Introduction',
      '正文 [1]。',
      '## §7 References',
      '[1] Lo et al. *A Closer Look*. NAACL, 2025.',
      '[2] He et al. *Upcycling*. arXiv:2410.07524, 2024.',
    ].join('\n')
    const out = transformQuoteCitations(input)
    // §1 的裸 [1] 被改写
    expect(out.split('## §7 References')[0]).toContain(`[[1]](${CITATION_HREF_PREFIX})`)
    // §7 内两行 [N] 保持原样，作为 MarkdownRenderer.extractRefNumber 的可解析前缀
    expect(out).toContain('[1] Lo et al. *A Closer Look*. NAACL, 2025.')
    expect(out).toContain('[2] He et al. *Upcycling*. arXiv:2410.07524, 2024.')
  })

  it('§7 之后还有 §8 时，§8 的裸 [N] 仍被改写（§8 不是 References，应保持可 hover）', () => {
    const input = [
      '## 1. Introduction',
      '正文 [1]。',
      '## 7. References',
      '- [1] A. *T*. (2020)',
      '## 8. Decisions',
      '深读 [1]：选定方向。',
    ].join('\n')
    const out = transformQuoteCitations(input)
    // §1 的 [1] 改写
    expect(out.split('## 7. References')[0]).toContain(`[[1]](${CITATION_HREF_PREFIX})`)
    // §7 的列表行 [1] 不变
    expect(out).toContain('- [1] A. *T*. (2020)')
    // §8 的 [1] 改写
    expect(out.split('## 8. Decisions')[1]).toContain(`[[1]](${CITATION_HREF_PREFIX})`)
  })

  it('引用式链接 [link text][1] 中的 [1] 不被改写', () => {
    const input = '## 1. Introduction\n详见 [配套表格][1]。\n## 7. References\n- [1] X. *T*. (2020)'
    const out = transformQuoteCitations(input)
    expect(out).toContain('[配套表格][1]')
    expect(out).not.toContain(`[配套表格][[1]](${CITATION_HREF_PREFIX})`)
  })

  it('链接定义 [1]: url 不被改写', () => {
    const input = '## 1. Introduction\n正文 [1]。\n\n[1]: https://example.com\n## 7. References\n- [1] X. *T*. (2020)'
    const out = transformQuoteCitations(input)
    // 正文 [1] 改写
    expect(out).toContain(`正文 [[1]](${CITATION_HREF_PREFIX})。`)
    // 链接定义保留
    expect(out).toContain('[1]: https://example.com')
  })

  it('行内链接 [1](url) 不被改写', () => {
    const input = '## 1. Introduction\n详见 [1](https://example.com)。\n## 7. References\n- [1] X. *T*. (2020)'
    const out = transformQuoteCitations(input)
    expect(out).toContain('[1](https://example.com)')
    expect(out).not.toContain(`[[1]](${CITATION_HREF_PREFIX})(https://example.com)`)
  })

  it('文档没有 §7 时 Pass 5 仍生效', () => {
    const input = '一些文字 [3] 引用。'
    const out = transformQuoteCitations(input)
    expect(out).toContain(`[[3]](${CITATION_HREF_PREFIX})`)
  })
})

describe('Pass 4.5 — 引用块承载引文 `> 原文 [N]`（#448）', () => {
  it('引用块行尾 [N] → 带 quote 的角标，原文保留可见', () => {
    const input = '> Chinchilla reaches 67.5% on MMLU, a 7% improvement over Gopher. [2]\n'
    const out = transformQuoteCitations(input)
    const m = out.match(/\[\[2\]\]\(#asci-cite-([^)]+)\)/)
    expect(m).not.toBeNull()
    const parsed = parseCitationHref(`#asci-cite-${m![1]}`, '[2]')
    expect(parsed?.n).toBe(2)
    expect(parsed?.quote).toBe('Chinchilla reaches 67.5% on MMLU, a 7% improvement over Gopher.')
    expect(out).toContain('Chinchilla reaches 67.5% on MMLU')
    expect(out.startsWith('>')).toBe(true)
  })

  it('正文内联裸 [N] 不被本 Pass 改（仍由 Pass 5 兜成空 quote 弱角标）', () => {
    const input = '模型规模翻倍，loss 下降约 5% [1]。\n\n> The loss scales as a power-law. [1]\n'
    const out = transformQuoteCitations(input)
    expect(out).toMatch(/> The loss scales as a power-law\. \[\[1\]\]\(#asci-cite-[^)]+\)/)
    expect(out).toContain(`[[1]](${CITATION_HREF_PREFIX})。`)
  })

  it('引用块内若已是 [N]<quote> 规范形式则不受影响', () => {
    const input = '正文 [1]<quote>原句</quote>。\n'
    const out = transformQuoteCitations(input)
    expect(out).toContain(`[[1]](${CITATION_HREF_PREFIX}`)
  })
})

describe('parseCitationHref — 空 fragment（弱角标）', () => {
  it('空 fragment 解析为 quote = ""', () => {
    const result = parseCitationHref(`${CITATION_HREF_PREFIX}`, '[7]')
    expect(result).toEqual({ n: 7, quote: '' })
  })

  it('非 asci-cite href 返回 null', () => {
    const result = parseCitationHref('https://example.com', '[1]')
    expect(result).toBeNull()
  })
})
