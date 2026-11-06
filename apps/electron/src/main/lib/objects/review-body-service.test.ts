/**
 * review-body-service 集成测试（走真实 fs，但用 tmp HOME 隔离）
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ObjectId } from '@asci/shared'

let tmpHome: string
let originalHome: string | undefined
let originalDev: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-reviewbody-'))
  originalHome = process.env.ASCI_CONFIG_HOME
  originalDev = process.env.ASCI_DEV
  process.env.ASCI_CONFIG_HOME = tmpHome
  // 强制 .asci 目录名，绕过 dev/packaged 检测
  process.env.ASCI_DEV = ''
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  if (originalDev === undefined) delete process.env.ASCI_DEV
  else process.env.ASCI_DEV = originalDev
  rmSync(tmpHome, { recursive: true, force: true })
})

describe('review-body-service', () => {
  test('writeReviewBody 在不存在的目录下也能落盘（默认 .html 后缀，自动 mkdir）', async () => {
    const mod = await import(`./review-body-service.ts?cachebust=${Date.now()}`)
    const id = 'rev-001' as ObjectId
    mod.writeReviewBody(id, '<h1>hello</h1><p>正文</p>')
    const htmlPath = join(tmpHome, '.asci', 'reviews', 'rev-001.html')
    expect(existsSync(htmlPath)).toBe(true)
    expect(readFileSync(htmlPath, 'utf-8')).toBe('<h1>hello</h1><p>正文</p>')
  })

  test('writeReviewBody 显式传 ext=md 时仍可落 .md（兼容老数据）', async () => {
    const mod = await import(`./review-body-service.ts?cachebust=${Date.now()}`)
    const id = 'rev-md-001' as ObjectId
    mod.writeReviewBody(id, '# md body', 'md')
    expect(existsSync(join(tmpHome, '.asci', 'reviews', 'rev-md-001.md'))).toBe(true)
  })

  test('readReviewBody 优先读 .html，缺失时回退 .md（兼容老数据）', async () => {
    const mod = await import(`./review-body-service.ts?cachebust=${Date.now()}`)
    const idHtml = 'rev-html' as ObjectId
    mod.writeReviewBody(idHtml, 'html-body')
    expect(mod.readReviewBody(idHtml)).toBe('html-body')

    const idMd = 'rev-md-only' as ObjectId
    mod.writeReviewBody(idMd, 'md-body', 'md')
    expect(mod.readReviewBody(idMd)).toBe('md-body')
  })

  test('readReviewBody 同时存在 .html 和 .md → 取 .html', async () => {
    const mod = await import(`./review-body-service.ts?cachebust=${Date.now()}`)
    const id = 'rev-both' as ObjectId
    mod.writeReviewBody(id, 'md-old', 'md')
    mod.writeReviewBody(id, 'html-new', 'html')
    expect(mod.readReviewBody(id)).toBe('html-new')
  })

  test('readReviewBody(Review) 优先用 review.bodyPath（cwd 模式）', async () => {
    const mod = await import(`./review-body-service.ts?cachebust=${Date.now()}`)
    // 在 tmpHome 外造一个文件模拟 skill 写的位置
    const skillFile = join(tmpHome, 'fake-session', 'reviews', '2026-05-21.html')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(tmpHome, 'fake-session', 'reviews'), { recursive: true })
    writeFileSync(skillFile, '<h1>来自 skill 的原文</h1>', 'utf-8')

    const fakeReview = {
      id: 'rev-1' as ObjectId,
      title: 't',
      intent: 'i',
      sourceCapability: 'c',
      bodyPath: skillFile,
      visibility: 'visible' as const,
      createdAt: '2026-05-21T00:00:00Z' as never,
      updatedAt: '2026-05-21T00:00:00Z' as never,
    }
    expect(mod.readReviewBody(fakeReview)).toContain('来自 skill 的原文')
  })

  test('readReviewBody(Review) bodyPath 是老 .md 文件 → 仍可直读（不挑扩展名）', async () => {
    const mod = await import(`./review-body-service.ts?cachebust=${Date.now()}`)
    const legacyFile = join(tmpHome, 'legacy', 'reviews', '2025-old.md')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(tmpHome, 'legacy', 'reviews'), { recursive: true })
    writeFileSync(legacyFile, '# 老 markdown 综述', 'utf-8')

    const fakeReview = {
      id: 'rev-legacy' as ObjectId,
      title: 't',
      intent: 'i',
      sourceCapability: 'c',
      bodyPath: legacyFile,
      visibility: 'visible' as const,
      createdAt: '2025-01-01T00:00:00Z' as never,
      updatedAt: '2025-01-01T00:00:00Z' as never,
    }
    expect(mod.readReviewBody(fakeReview)).toContain('老 markdown 综述')
  })

  test('readReviewBody(Review) bodyPath 不存在时回退 ~/.asci/reviews/{id}', async () => {
    const mod = await import(`./review-body-service.ts?cachebust=${Date.now()}`)
    const id = 'rev-fallback' as ObjectId
    mod.writeReviewBody(id, 'fallback body')
    const fakeReview = {
      id,
      title: 't',
      intent: 'i',
      sourceCapability: 'c',
      bodyPath: '/non/existent/path.md',
      visibility: 'visible' as const,
      createdAt: '2026-05-21T00:00:00Z' as never,
      updatedAt: '2026-05-21T00:00:00Z' as never,
    }
    expect(mod.readReviewBody(fakeReview)).toBe('fallback body')
  })

  test('readReviewBody 不存在返回 null', async () => {
    const mod = await import(`./review-body-service.ts?cachebust=${Date.now()}`)
    expect(mod.readReviewBody('missing' as ObjectId)).toBeNull()
  })

  test('writeReviewBody 覆写已存在文件', async () => {
    const mod = await import(`./review-body-service.ts?cachebust=${Date.now()}`)
    const id = 'rev-002' as ObjectId
    mod.writeReviewBody(id, 'v1')
    mod.writeReviewBody(id, 'v2')
    expect(mod.readReviewBody(id)).toBe('v2')
  })

  test('deleteReviewBody 删除已有文件，且对不存在的文件不抛错', async () => {
    const mod = await import(`./review-body-service.ts?cachebust=${Date.now()}`)
    const id = 'rev-003' as ObjectId
    mod.writeReviewBody(id, 'x')
    mod.deleteReviewBody(id)
    expect(mod.readReviewBody(id)).toBeNull()
    // 重复调用不抛错
    expect(() => mod.deleteReviewBody(id)).not.toThrow()
  })
})
