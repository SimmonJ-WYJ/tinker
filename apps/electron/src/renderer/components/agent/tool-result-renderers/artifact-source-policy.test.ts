import { test, expect, describe } from 'bun:test'
import { isHtmlArtifact } from './artifact-source-policy'

describe('isHtmlArtifact', () => {
  test('任意 .html / .htm 命中（对话流抑制源码）', () => {
    expect(isHtmlArtifact('index.html')).toBe(true)
    expect(isHtmlArtifact('ai-education-summary.html')).toBe(true)
    expect(isHtmlArtifact('/abs/foo/notes/x.html')).toBe(true)
    expect(isHtmlArtifact('page.htm')).toBe(true)
    // reviews/searches 下同样命中（窄判定的超集）
    expect(isHtmlArtifact('reviews/x.html')).toBe(true)
    expect(isHtmlArtifact('searches/x.html')).toBe(true)
    // 大小写不敏感
    expect(isHtmlArtifact('REPORT.HTML')).toBe(true)
  })

  test('非 html 不命中', () => {
    expect(isHtmlArtifact('notes.md')).toBe(false)
    expect(isHtmlArtifact('main.py')).toBe(false)
    expect(isHtmlArtifact('data.json')).toBe(false)
    // 仅文件名片段含 html 不误命中
    expect(isHtmlArtifact('my-html-notes.txt')).toBe(false)
  })
})
