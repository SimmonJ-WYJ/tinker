/**
 * Repo 测试公用脚手架 + 自检 smoke test
 *
 * 命名采用 `.test.ts` 后缀，让 `apps/electron/tsconfig.json` 的
 * `exclude: ["src/**\/*.test.ts"]` 自动排除——不会被 main bundle 误打入。
 * （这是一个 test-only 模块；任何生产代码不应 import 它。）
 *
 * 集中两个共享脚手架：
 *   - bun:sqlite Database → MigrationDb 适配器（与 object-store.test.ts 同一份逻辑）
 *   - 在内存 DB 上跑完 001-initial migration 的 `openTestDb()`
 *
 * 文末挂一个最小 smoke test，让 bun test 在发现本文件时报"1 pass"
 * 而不是"0 tests"，输出更干净。
 */

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../migrations/index.ts'
import { runMigrations, type MigrationDb } from '../migration-runner.ts'

import type { RepoDb } from '../internal/repo-db.ts'

export function asMigrationDb(db: Database): MigrationDb {
  return {
    exec: (sql) => {
      db.exec(sql)
    },
    getUserVersion: () => {
      const row = db.query('PRAGMA user_version').get() as { user_version: number } | null
      return row?.user_version ?? 0
    },
    setUserVersion: (v) => {
      db.exec(`PRAGMA user_version = ${v}`)
    },
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
  }
}

export function openTestDb(): { db: Database; repo: RepoDb } {
  const db = new Database(':memory:')
  db.exec('PRAGMA journal_mode = MEMORY')
  db.exec('PRAGMA foreign_keys = ON')
  runMigrations(asMigrationDb(db), MIGRATIONS)
  return { db, repo: db as unknown as RepoDb }
}

// ---------------- self-check ----------------

describe('_helpers (test fixtures)', () => {
  test('openTestDb 返回一个已跑完 migrations 的内存 DB', () => {
    const { db } = openTestDb()
    const { n } = db
      .query(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`)
      .get() as { n: number }
    expect(n).toBeGreaterThan(0)
  })
})
