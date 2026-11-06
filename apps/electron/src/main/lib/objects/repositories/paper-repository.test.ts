/**
 * Paper repo 集成测试
 *
 * 测试 driver 用 bun:sqlite（理由同 object-store.test.ts）。schema 走完整
 * 001-initial migration，确保 CHECK / FK / UNIQUE 约束都生效。
 */

import type { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'

import type { ObjectId } from '@asci/shared'

import type { RepoDb } from '../internal/repo-db.ts'

import { openTestDb } from './_helpers.test.ts'
import {
  createPaper,
  findOrCreatePaperByZoteroKey,
  findPaperByZoteroKey,
  getPaperByDoi,
  getPaperById,
  listPapers,
  softDeletePaper,
  updatePaper,
} from './paper-repository.ts'

describe('paper-repository: create + read', () => {
  let db: Database
  let repo: RepoDb
  beforeEach(() => {
    ;({ db, repo } = openTestDb())
  })

  test('createPaper 生成主进程 ID，填默认时间戳与 visibility', () => {
    const p = createPaper(repo, { title: 'Long-context vs RAG', authors: ['Alice', 'Bob'] })
    expect(p.id.length).toBeGreaterThan(0)
    expect(p.title).toBe('Long-context vs RAG')
    expect(p.authors).toEqual(['Alice', 'Bob'])
    expect(p.visibility).toBe('visible')
    expect(p.createdAt).toBe(p.updatedAt)
    // 行确实落库
    const row = db.query('SELECT id, authors_json FROM papers WHERE id = ?').get(p.id) as {
      id: string
      authors_json: string
    }
    expect(row.id).toBe(p.id)
    expect(JSON.parse(row.authors_json)).toEqual(['Alice', 'Bob'])
  })

  test('createPaper 完整可选字段都被持久化', () => {
    const p = createPaper(repo, {
      title: 't',
      authors: [],
      abstract: 'abs',
      year: 2025,
      venue: 'NeurIPS',
      doi: '10.1/foo',
      url: 'https://example.com',
      zoteroKey: 'ABC123',
    })
    const fetched = getPaperById(repo, p.id)
    expect(fetched).toEqual(p)
  })

  test('getPaperById 未找到返回 null', () => {
    expect(getPaperById(repo, 'nope' as ObjectId)).toBeNull()
  })
})

describe('paper-repository: update', () => {
  test('updatePaper 改 title + 推进 updated_at；其他字段保留', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 'orig', authors: ['A'], year: 2024 })
    // 强制时间推进
    const before = p.updatedAt
    // sleep 1ms 避免同毫秒
    const start = Date.now()
    while (Date.now() === start) {
      // busy wait
    }
    const updated = updatePaper(repo, p.id, { title: 'new' })
    expect(updated.title).toBe('new')
    expect(updated.authors).toEqual(['A'])
    expect(updated.year).toBe(2024)
    expect(updated.updatedAt >= before).toBe(true)
    expect(updated.createdAt).toBe(p.createdAt)
  })

  test('updatePaper 用 null 清空可选字段', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 't', authors: [], doi: '10.1/foo' })
    const updated = updatePaper(repo, p.id, { doi: null })
    expect(updated.doi).toBeUndefined()
  })

  test('updatePaper 不存在的 id 抛错', () => {
    const { repo } = openTestDb()
    expect(() => updatePaper(repo, 'ghost' as ObjectId, { title: 'x' })).toThrow(/not found/)
  })
})

describe('paper-repository: softDelete + list', () => {
  test('softDeletePaper 保留行并置 visibility=deleted + deleted_at', () => {
    const { db, repo } = openTestDb()
    const p = createPaper(repo, { title: 't', authors: [] })
    softDeletePaper(repo, p.id)
    const row = db
      .query('SELECT visibility, deleted_at FROM papers WHERE id = ?')
      .get(p.id) as { visibility: string; deleted_at: string }
    expect(row.visibility).toBe('deleted')
    expect(row.deleted_at).toBeTruthy()
  })

  test('listPapers 默认排除 deleted，includeDeleted=true 包含全部', () => {
    const { repo } = openTestDb()
    const alive = createPaper(repo, { title: 'a', authors: [] })
    const dead = createPaper(repo, { title: 'b', authors: [] })
    softDeletePaper(repo, dead.id)
    const defaultList = listPapers(repo)
    expect(defaultList.map((p) => p.id)).toEqual([alive.id])
    const allList = listPapers(repo, { includeDeleted: true })
    expect(allList.length).toBe(2)
  })

  test('listPapers 按 createdAt DESC 排序', async () => {
    const { repo } = openTestDb()
    const p1 = createPaper(repo, { title: '1', authors: [] })
    await new Promise((r) => setTimeout(r, 10))
    const p2 = createPaper(repo, { title: '2', authors: [] })
    const ordered = listPapers(repo)
    expect(ordered.map((p) => p.id)).toEqual([p2.id, p1.id])
  })
})

describe('paper-repository: getPaperByDoi', () => {
  test('getPaperByDoi 命中已落库 paper', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 't', authors: [], doi: '10.1234/abc' })
    expect(getPaperByDoi(repo, '10.1234/abc')?.id).toBe(p.id)
  })

  test('getPaperByDoi 未命中返回 null', () => {
    const { repo } = openTestDb()
    expect(getPaperByDoi(repo, 'no-such-doi')).toBeNull()
  })

  test('getPaperByDoi 跳过已软删的记录', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 't', authors: [], doi: '10.x/del' })
    softDeletePaper(repo, p.id)
    expect(getPaperByDoi(repo, '10.x/del')).toBeNull()
  })
})

describe('paper-repository: findByZoteroKey + lazy upsert', () => {
  test('findPaperByZoteroKey 命中已存在的 Paper', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 't', authors: [], zoteroKey: 'ZKEY-1' })
    const found = findPaperByZoteroKey(repo, 'ZKEY-1')
    expect(found?.id).toBe(p.id)
  })

  test('findPaperByZoteroKey 未命中返回 null', () => {
    const { repo } = openTestDb()
    expect(findPaperByZoteroKey(repo, 'NONE')).toBeNull()
  })

  test('findPaperByZoteroKey 排除已软删的 Paper', () => {
    const { repo } = openTestDb()
    const p = createPaper(repo, { title: 't', authors: [], zoteroKey: 'ZKEY-DEL' })
    softDeletePaper(repo, p.id)
    expect(findPaperByZoteroKey(repo, 'ZKEY-DEL')).toBeNull()
  })

  test('findOrCreatePaperByZoteroKey 首次未命中 → 创建一行新 Paper', () => {
    const { repo } = openTestDb()
    const created = findOrCreatePaperByZoteroKey(repo, 'NEW-Z', {
      title: 'Brand-new paper',
      authors: ['Alice'],
      year: 2026,
    })
    expect(created.zoteroKey).toBe('NEW-Z')
    expect(created.title).toBe('Brand-new paper')
    expect(created.year).toBe(2026)
  })

  test('findOrCreatePaperByZoteroKey 二次调用复用同一 Paper（不更新 fallback）', () => {
    const { repo } = openTestDb()
    const first = findOrCreatePaperByZoteroKey(repo, 'REUSE-Z', {
      title: 'orig',
      authors: ['A'],
    })
    const second = findOrCreatePaperByZoteroKey(repo, 'REUSE-Z', {
      title: 'should-be-ignored',
      authors: ['Z'],
    })
    expect(second.id).toBe(first.id)
    expect(second.title).toBe('orig') // fallback 不覆盖
  })
})
