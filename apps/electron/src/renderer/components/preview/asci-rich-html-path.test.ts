import { test, expect, describe } from 'bun:test'
import { isAsciRichHtmlPath } from './asci-rich-html-path'

describe('isAsciRichHtmlPath', () => {
  test('reviews/ 下的 html 命中', () => {
    expect(isAsciRichHtmlPath('reviews/2026-04-24_15-30-lora.html')).toBe(true)
    expect(isAsciRichHtmlPath('/abs/foo/reviews/x.html')).toBe(true)
  })

  test('searches/ 下的 html 命中（检索报告）', () => {
    expect(isAsciRichHtmlPath('searches/2026-06-03_10-00-llm.html')).toBe(true)
    expect(isAsciRichHtmlPath('/abs/session/searches/x.html')).toBe(true)
  })

  test('其它路径不命中（fall-through 到通用 HtmlRenderer）', () => {
    expect(isAsciRichHtmlPath('index.html')).toBe(false)
    expect(isAsciRichHtmlPath('/abs/foo/index.html')).toBe(false)
    expect(isAsciRichHtmlPath('notes/x.html')).toBe(false)
    // 仅作为文件名片段而非目录段时不误命中
    expect(isAsciRichHtmlPath('my-searches-summary.html')).toBe(false)
  })

  test('Windows 反斜杠绝对路径命中（#664）', () => {
    expect(isAsciRichHtmlPath('C:\\Users\\Administrator\\session\\reviews\\rag-review.html')).toBe(true)
    expect(isAsciRichHtmlPath('C:\\abs\\session\\searches\\x.html')).toBe(true)
  })

  test('反斜杠下非目录段不误命中', () => {
    expect(isAsciRichHtmlPath('C:\\Users\\my-searches-summary.html')).toBe(false)
    expect(isAsciRichHtmlPath('C:\\Users\\notes\\x.html')).toBe(false)
  })
})
