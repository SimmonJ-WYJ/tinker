/**
 * export-service 集成测试（DO-2，issue #419）
 *
 * 内存 DB 植入 5 类对象（含软删 + 正文缺失 Review）→ 导出 → 解 zip 断言：
 *   - 结构完整（manifest / 5 数据文件 / 正文文件 / 内嵌 schema）
 *   - manifest 计数与 warnings 正确
 *   - reviews.json 的 bodyPath 已改写为包内相对路径
 *   - 数据文件用 **zip 内嵌的 schema 副本** 经 ajv 独立复验通过（DO-2 验收口径）
 *   - 校验失败路径：中止 + 不落盘 + 错误含类型与 ID
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Anchor, EvidenceSet, ObjectId, Paper, Review, ExportManifest } from '@asci/shared'
import Ajv from 'ajv'
import { strFromU8, unzipSync } from 'fflate'

import { ExportValidationError, exportMyData } from './export-service.ts'
import { createEvidenceRef } from './repositories/evidence-ref-repository.ts'
import { createEvidenceSet } from './repositories/evidence-set-repository.ts'
import { createNote } from './repositories/note-repository.ts'
import { createPaper, softDeletePaper } from './repositories/paper-repository.ts'
import { createReview } from './repositories/review-repository.ts'
import { openTestDb } from './repositories/_helpers.test.ts'

let tmpDir: string
let originalConfigHome: string | undefined
let originalDev: string | undefined

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'asci-export-'))
  // 隔离 ~/.asci：正文兜底路径 / getReviewBodyPath 不碰真实用户目录
  originalConfigHome = process.env.ASCI_CONFIG_HOME
  originalDev = process.env.ASCI_DEV
  process.env.ASCI_CONFIG_HOME = tmpDir
  process.env.ASCI_DEV = ''
})

afterEach(() => {
  if (originalConfigHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalConfigHome
  if (originalDev === undefined) delete process.env.ASCI_DEV
  else process.env.ASCI_DEV = originalDev
  rmSync(tmpDir, { recursive: true, force: true })
})

const anchor = (text: string): Anchor => ({ type: 'md', snapshotText: text })

/** 植入 5 类对象各至少 1 条；返回断言用的关键对象 */
function seed(repo: ReturnType<typeof openTestDb>['repo']): {
  deletedPaper: Paper
  reviewWithBody: Review
  reviewMissingBody: Review
  evidenceSet: EvidenceSet
} {
  const paperA = createPaper(repo, { title: '论文 A', authors: ['张三'], year: 2024 })
  const paperB = createPaper(repo, { title: '论文 B', authors: ['李四', 'Smith'] })
  softDeletePaper(repo, paperB.id)

  const note = createNote(repo, { body: '一条解读笔记' })
  const evidenceSet = createEvidenceSet(repo, {
    noteId: note.id,
    persisted: true,
    name: '主题集合',
    savedAt: '2026-06-01T00:00:00.000Z',
    evidenceRefIds: [],
    source: 'user-highlight',
    workspaceId: 'ws-test',
  })
  createEvidenceRef(repo, {
    source: { kind: 'paper', id: paperA.id, anchor: anchor('被引用的段落') },
    target: { kind: 'evidence-set', id: evidenceSet.id },
  })

  const bodyFile = join(tmpDir, 'review-body.html')
  writeFileSync(bodyFile, '<h1>综述正文</h1>')
  const reviewWithBody = createReview(repo, {
    title: '有正文的综述',
    intent: '梳理领域进展',
    sourceCapability: 'lit-review',
    bodyPath: bodyFile,
  })
  const reviewMissingBody = createReview(repo, {
    title: '正文丢失的综述',
    intent: '正文文件已不存在',
    sourceCapability: 'lit-review',
    bodyPath: join(tmpDir, 'gone.html'),
  })
  return { deletedPaper: paperB, reviewWithBody, reviewMissingBody, evidenceSet }
}

function readZip(outPath: string): Record<string, Uint8Array> {
  return unzipSync(readFileSync(outPath))
}

const readJson = <T>(entries: Record<string, Uint8Array>, path: string): T => {
  const entry = entries[path]
  if (!entry) throw new Error(`zip 内缺少 ${path}`)
  return JSON.parse(strFromU8(entry)) as T
}

describe('exportMyData', () => {
  test('导出包结构完整：manifest + 5 数据文件 + 正文 + 内嵌 schema', () => {
    const { repo } = openTestDb()
    const { reviewWithBody } = seed(repo)
    const outPath = join(tmpDir, 'export.zip')

    const result = exportMyData(repo, { outPath, appVersion: '0.0.0-test' })

    const entries = readZip(outPath)
    const paths = Object.keys(entries)
    for (const expected of [
      'manifest.json',
      'papers.json',
      'evidence-refs.json',
      'notes.json',
      'evidence-sets.json',
      'reviews.json',
      `reviews/bodies/${reviewWithBody.id}.html`,
      'schema/manifest.schema.json',
      'schema/objects/paper.schema.json',
      'schema/objects/evidence-ref.schema.json',
      'schema/objects/note.schema.json',
      'schema/objects/evidence-set.schema.json',
      'schema/objects/review.schema.json',
      'schema/objects/proposal.schema.json',
    ]) {
      expect(paths).toContain(expected)
    }
    expect(strFromU8(entries[`reviews/bodies/${reviewWithBody.id}.html`]!)).toBe(
      '<h1>综述正文</h1>',
    )
    // 2 papers + 1 ref + 1 note + 1 set + 2 reviews
    expect(result.objectCount).toBe(7)
  })

  test('#710 P0-8：普通导出仅 L0 研究对象，0 命中内部 prompt / raw tool I/O / thinking 字段', () => {
    const { repo } = openTestDb()
    seed(repo)
    const outPath = join(tmpDir, 'export-canary.zip')
    exportMyData(repo, { outPath, appVersion: '0.0.0-test' })
    const entries = readZip(outPath)
    // 拼接所有数据文件文本（不含 schema/manifest）；普通导出不得出现内部 prompt / 原始工具 I/O / thinking 字段
    const dataText = Object.entries(entries)
      .filter(([p]) => p.endsWith('.json') && !p.startsWith('schema/') && p !== 'manifest.json')
      .map(([, v]) => strFromU8(v))
      .join('\n')
    for (const forbidden of ['"toolInput"', '"systemPrompt"', '"masterPrompt"', '"thinking"', 'scenarioAgent']) {
      expect(dataText).not.toContain(forbidden)
    }
  })

  test('manifest 计数 / warnings 正确，正文缺失为非致命警告', () => {
    const { repo } = openTestDb()
    const { reviewMissingBody } = seed(repo)
    const outPath = join(tmpDir, 'export.zip')

    const result = exportMyData(repo, {
      outPath,
      appVersion: '0.0.0-test',
      exportedAt: '2026-06-02T00:00:00.000Z',
    })

    const manifest = readJson<ExportManifest>(readZip(outPath), 'manifest.json')
    expect(manifest.exportFormatVersion).toBe(1)
    expect(manifest.appVersion).toBe('0.0.0-test')
    expect(manifest.exportedAt).toBe('2026-06-02T00:00:00.000Z')
    const countByPath = Object.fromEntries(manifest.files.map((f) => [f.path, f.count]))
    expect(countByPath).toEqual({
      'papers.json': 2,
      'evidence-refs.json': 1,
      'notes.json': 1,
      'evidence-sets.json': 1,
      'reviews.json': 2,
    })
    expect(manifest.warnings).toEqual([
      `review ${reviewMissingBody.id} 正文文件缺失，导出仅含元数据`,
    ])
    expect(result.warnings).toEqual(manifest.warnings)
  })

  test('软删对象在导出包内且保留 visibility（D3）', () => {
    const { repo } = openTestDb()
    const { deletedPaper } = seed(repo)
    const outPath = join(tmpDir, 'export.zip')

    exportMyData(repo, { outPath, appVersion: '0.0.0-test' })

    const papers = readJson<Paper[]>(readZip(outPath), 'papers.json')
    const deleted = papers.find((p) => p.id === deletedPaper.id)
    expect(deleted?.visibility).toBe('deleted')
  })

  test('reviews.json 的 bodyPath 改写为包内相对路径；缺正文则置空', () => {
    const { repo } = openTestDb()
    const { reviewWithBody, reviewMissingBody } = seed(repo)
    const outPath = join(tmpDir, 'export.zip')

    exportMyData(repo, { outPath, appVersion: '0.0.0-test' })

    const reviews = readJson<Review[]>(readZip(outPath), 'reviews.json')
    expect(reviews.find((r) => r.id === reviewWithBody.id)?.bodyPath).toBe(
      `reviews/bodies/${reviewWithBody.id}.html`,
    )
    expect(reviews.find((r) => r.id === reviewMissingBody.id)?.bodyPath).toBeUndefined()
  })

  test('DO-2 验收：数据文件用 zip 内嵌 schema 经 ajv 独立复验通过', () => {
    const { repo } = openTestDb()
    seed(repo)
    const outPath = join(tmpDir, 'export.zip')

    exportMyData(repo, { outPath, appVersion: '0.0.0-test' })

    const entries = readZip(outPath)
    const ajv = new Ajv()
    const manifest = readJson<ExportManifest>(entries, 'manifest.json')
    const validateManifest = ajv.compile(
      readJson<Record<string, unknown>>(entries, 'schema/manifest.schema.json'),
    )
    expect(validateManifest(manifest)).toBe(true)
    for (const file of manifest.files) {
      const validate = ajv.compile(readJson<Record<string, unknown>>(entries, file.schema))
      const objects = readJson<unknown[]>(entries, file.path)
      expect(objects).toHaveLength(file.count)
      for (const object of objects) {
        const ok = validate(object)
        if (!ok) throw new Error(`${file.path} 复验失败：${ajv.errorsText(validate.errors)}`)
        expect(ok).toBe(true)
      }
    }
  })

  test('校验失败：中止导出、不落盘、错误含对象类型与 ID（D5）', () => {
    const { db, repo } = openTestDb()
    const paper = createPaper(repo, { title: '将被注入脏数据的论文', authors: [] })
    // 绕过 repository 注入 DB CHECK 管不住、但 O1 schema 能抓的类型漂移：
    // papers.year 列是 INTEGER 但表非 STRICT，SQLite 弱类型允许塞 TEXT
    db.exec(`UPDATE papers SET year = 'not-a-year' WHERE id = '${paper.id}'`)
    const outPath = join(tmpDir, 'export.zip')

    let thrown: unknown
    try {
      exportMyData(repo, { outPath, appVersion: '0.0.0-test' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ExportValidationError)
    const validationError = thrown as ExportValidationError
    expect(validationError.dataFile).toBe('papers.json')
    expect(validationError.objectId).toBe(paper.id)
    expect(existsSync(outPath)).toBe(false)
  })

  test('空库也能导出：全部计数为 0，结构仍完整', () => {
    const { repo } = openTestDb()
    const outPath = join(tmpDir, 'export.zip')

    const result = exportMyData(repo, { outPath, appVersion: '0.0.0-test' })

    expect(result.objectCount).toBe(0)
    const manifest = readJson<ExportManifest>(readZip(outPath), 'manifest.json')
    expect(manifest.files.every((f) => f.count === 0)).toBe(true)
  })
})
