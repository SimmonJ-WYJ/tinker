import { describe, it, expect } from 'bun:test'
import { htmlToMarkdown } from './rich-text-input.tsx'

describe('htmlToMarkdown — PastedBlock 还原', () => {
  it('data-pasted-text 还原为完整原文', () => {
    const full = '第一行\n第二行 with "quotes" & <tags>'
    const html = `<div data-pasted-text="${encodeURIComponent(full)}"></div>`
    expect(htmlToMarkdown(html)).toContain(full)
  })

  it('原位：前文 + 卡片 + 后文 顺序正确', () => {
    const full = 'PASTED-BODY'
    const html =
      `<p>before</p>` +
      `<div data-pasted-text="${encodeURIComponent(full)}"></div>` +
      `<p>after</p>`
    const md = htmlToMarkdown(html)
    expect(md.indexOf('before')).toBeLessThan(md.indexOf('PASTED-BODY'))
    expect(md.indexOf('PASTED-BODY')).toBeLessThan(md.indexOf('after'))
  })
})
