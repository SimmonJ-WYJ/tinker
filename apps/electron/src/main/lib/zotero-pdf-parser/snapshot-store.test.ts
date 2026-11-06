import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getZoteroPdfSnapshotPath } from '../config-paths.ts'
import { loadSnapshot } from './snapshot-store.ts'

let tempHome: string

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'asci-snap-test-'))
  process.env.ASCI_CONFIG_HOME = tempHome
  process.env.ASCI_DEV = '1'
})

afterEach(() => {
  delete process.env.ASCI_CONFIG_HOME
  delete process.env.ASCI_DEV
  rmSync(tempHome, { recursive: true, force: true })
})

describe('snapshot schema 迁移', () => {
  test('v3 snapshot 自动补 article=null 并升到 v4', () => {
    const v3Snap = {
      schemaVersion: 3,
      capturedAt: '2026-05-01T00:00:00Z',
      pdfs: {
        K1: {
          attachmentKey: 'K1',
          parentItemKey: null,
          version: 0,
          linkMode: 'imported_file',
          contentType: 'application/pdf',
          filename: 'paper.pdf',
          title: 'Old Paper',
          dateModified: null,
          parse: {
            status: 'completed',
            mdPath: '/tmp/K1.md',
            strategy: 'lite',
            parsedAt: '2026-05-01T00:00:00Z',
            error: null,
            attempts: 1,
            sourceMtimeMs: 0,
            sourceSize: 0,
          },
          parent: null,
          // 故意不提供 article 字段
        },
      },
    }
    writeFileSync(getZoteroPdfSnapshotPath(), JSON.stringify(v3Snap, null, 2), 'utf-8')

    const loaded = loadSnapshot()
    expect(loaded).not.toBeNull()
    expect(loaded?.schemaVersion).toBe(4)
    const rec = loaded?.pdfs.K1
    expect(rec).toBeDefined()
    expect(rec?.article).toBeNull()
  })

  test('v4 snapshot 直接读出，article 字段保留', () => {
    const v4Snap = {
      schemaVersion: 4,
      capturedAt: '2026-05-06T00:00:00Z',
      pdfs: {
        K2: {
          attachmentKey: 'K2',
          parentItemKey: null,
          version: 0,
          linkMode: 'imported_file',
          contentType: 'application/pdf',
          filename: 'p.pdf',
          title: '',
          dateModified: null,
          parse: {
            status: 'completed',
            mdPath: '/tmp/K2.md',
            strategy: 'lite',
            parsedAt: null,
            error: null,
            attempts: 1,
            sourceMtimeMs: 0,
            sourceSize: 0,
          },
          parent: null,
          article: {
            status: 'completed',
            articlePath: '/tmp/K2.article.md',
            generatedAt: '2026-05-06T00:00:00Z',
            articleCreated: '2026-05-06',
            sourceMdMtimeMs: 100,
            error: null,
            attempts: 1,
            channelId: 'CH1',
            model: 'm-1',
            promptVersion: 1,
          },
        },
      },
    }
    writeFileSync(getZoteroPdfSnapshotPath(), JSON.stringify(v4Snap, null, 2), 'utf-8')

    const loaded = loadSnapshot()
    expect(loaded?.schemaVersion).toBe(4)
    expect(loaded?.pdfs.K2?.article?.status).toBe('completed')
    expect(loaded?.pdfs.K2?.article?.articleCreated).toBe('2026-05-06')
  })

  test('未知 schema 版本返回 null', () => {
    writeFileSync(
      getZoteroPdfSnapshotPath(),
      JSON.stringify({ schemaVersion: 99, capturedAt: '', pdfs: {} }),
      'utf-8',
    )
    expect(loadSnapshot()).toBeNull()
  })
})
