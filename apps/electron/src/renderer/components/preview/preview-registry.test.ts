import { test, expect, describe } from 'bun:test'
import { resolveRenderer, registerRenderer, clearRegistry } from './preview-registry'
import type { PreviewRenderer } from './preview-registry'
import React from 'react'

const dummyRenderer = (extensions: string[], maxSize?: number): PreviewRenderer => ({
  extensions,
  maxSize,
  Component: React.lazy(() => Promise.resolve({ default: () => null })),
})

describe('resolveRenderer', () => {
  test('应当根据扩展名找到 renderer', () => {
    clearRegistry()
    registerRenderer(dummyRenderer(['md', 'markdown']))
    const r = resolveRenderer({ kind: 'file', path: '/a.md', ext: 'md', size: 100 })
    expect(r).not.toBe(null)
  })

  test('扩展名大小写不敏感', () => {
    clearRegistry()
    registerRenderer(dummyRenderer(['md']))
    const r = resolveRenderer({ kind: 'file', path: '/a.MD', ext: 'MD', size: 100 })
    expect(r).not.toBe(null)
  })

  test('未注册扩展名应当返回 null', () => {
    clearRegistry()
    registerRenderer(dummyRenderer(['md']))
    const r = resolveRenderer({ kind: 'file', path: '/a.xyz', ext: 'xyz', size: 100 })
    expect(r).toBe(null)
  })

  test('超过 maxSize 应当返回 null', () => {
    clearRegistry()
    registerRenderer(dummyRenderer(['md'], 1000))
    const r = resolveRenderer({ kind: 'file', path: '/a.md', ext: 'md', size: 2000 })
    expect(r).toBe(null)
  })

  test('未设置 maxSize 时不受大小限制', () => {
    clearRegistry()
    registerRenderer(dummyRenderer(['pdf']))
    const r = resolveRenderer({ kind: 'file', path: '/a.pdf', ext: 'pdf', size: 999999999 })
    expect(r).not.toBe(null)
  })

  test('matches 钩子返回 false 时跳到下一条注册项（path-aware 分发）', () => {
    clearRegistry()
    // 特化 renderer：扩展名 html + path 含 /reviews/
    const specialized: PreviewRenderer = {
      extensions: ['html'],
      matches: (t) => t.kind === 'file' && t.path.includes('/reviews/'),
      Component: React.lazy(() => Promise.resolve({ default: () => null })),
    }
    const generic = dummyRenderer(['html'])
    registerRenderer(specialized)
    registerRenderer(generic)

    const inReviews = resolveRenderer({
      kind: 'file',
      path: '/abs/foo/reviews/x.html',
      ext: 'html',
      size: 100,
    })
    const elsewhere = resolveRenderer({
      kind: 'file',
      path: '/abs/foo/index.html',
      ext: 'html',
      size: 100,
    })
    expect(inReviews).toBe(specialized)
    expect(elsewhere).toBe(generic)
  })

  test('maxSize 超限时跳到下一条注册项（不直接 return null）', () => {
    clearRegistry()
    const small = dummyRenderer(['html'], 100)
    const big = dummyRenderer(['html']) // 无上限
    registerRenderer(small)
    registerRenderer(big)
    const r = resolveRenderer({
      kind: 'file',
      path: '/a.html',
      ext: 'html',
      size: 1_000_000,
    })
    expect(r).toBe(big)
  })

  test('paper 类型应当通过独立入口解析，resolveRenderer 返回 null', () => {
    clearRegistry()
    registerRenderer(dummyRenderer(['md']))
    const target = {
      kind: 'paper' as const,
      record: {
        ts: '2026-04-22',
        query: null,
        source: 't',
        title: 'T',
        authors: [],
        year: null,
        venue: null,
        doi: null,
        url: null,
        abstract: null,
      },
    }
    // paper 类型不走扩展名匹配，返回 null；调用方自行 dispatch PaperDetailRenderer
    expect(resolveRenderer(target)).toBe(null)
  })
})
