/**
 * review-artifact-parser 单元测试
 */

import { describe, expect, test } from 'bun:test'

import { extractReviewArtifact } from './review-artifact-parser.ts'

describe('extractReviewArtifact', () => {
  test('提取最小合法 artifact', () => {
    const text = [
      'some chat preamble...',
      '<asci-review-artifact>',
      '---',
      'title: RAG vs Long-context',
      'topic: 检索增强生成',
      '---',
      '<!DOCTYPE html><html><body><h1>RAG</h1></body></html>',
      '</asci-review-artifact>',
    ].join('\n')
    const a = extractReviewArtifact(text)
    expect(a).not.toBeNull()
    expect(a!.title).toBe('RAG vs Long-context')
    expect(a!.topic).toBe('检索增强生成')
    expect(a!.html).toContain('<h1>RAG</h1>')
  })

  test('topic 缺失 → topic 为 undefined，但 artifact 仍有效', () => {
    const text = `<asci-review-artifact>
---
title: only-title
---
<p>body</p>
</asci-review-artifact>`
    const a = extractReviewArtifact(text)
    expect(a).not.toBeNull()
    expect(a!.topic).toBeUndefined()
    expect(a!.html).toBe('<p>body</p>')
  })

  test('title 缺失 → 返回 null', () => {
    const text = `<asci-review-artifact>
---
topic: t
---
<p>body</p>
</asci-review-artifact>`
    expect(extractReviewArtifact(text)).toBeNull()
  })

  test('title 为空字符串 → 返回 null', () => {
    const text = `<asci-review-artifact>
---
title:
topic: t
---
<p>body</p>
</asci-review-artifact>`
    expect(extractReviewArtifact(text)).toBeNull()
  })

  test('没有 marker → 返回 null', () => {
    expect(extractReviewArtifact('hello world')).toBeNull()
    expect(extractReviewArtifact('')).toBeNull()
  })

  test('只有开标签缺闭合 → 返回 null', () => {
    const text = `<asci-review-artifact>
---
title: t
---
<p>x</p>`
    expect(extractReviewArtifact(text)).toBeNull()
  })

  test('多个 artifact 取最后一个', () => {
    const text = `<asci-review-artifact>
---
title: first
---
<p>1</p>
</asci-review-artifact>
中间一些聊天...
<asci-review-artifact>
---
title: second
---
<p>2</p>
</asci-review-artifact>`
    const a = extractReviewArtifact(text)
    expect(a?.title).toBe('second')
    expect(a?.html).toBe('<p>2</p>')
  })

  test('frontmatter value 带引号 → 去引号', () => {
    const text = `<asci-review-artifact>
---
title: "Quoted Title"
topic: 'single-quoted'
---
<p>x</p>
</asci-review-artifact>`
    const a = extractReviewArtifact(text)
    expect(a?.title).toBe('Quoted Title')
    expect(a?.topic).toBe('single-quoted')
  })

  test('大小写不敏感的标签匹配', () => {
    const text = `<ASCI-REVIEW-ARTIFACT>
---
title: t
---
<p>x</p>
</Asci-Review-Artifact>`
    const a = extractReviewArtifact(text)
    expect(a?.title).toBe('t')
  })
})
