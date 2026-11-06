/**
 * 测试公用：bun:sqlite → RawVectorDb 极薄适配
 *
 * 背景同 object-store.test.ts：Bun 测试运行时不支持 better-sqlite3 native binding，
 * SQL 行为用 bun:sqlite 验证（同一份 SQLite C lib）；vec0 真路径由 Electron 冒烟覆盖。
 * 仅供 *.test.ts 引用。
 */

import { Database } from 'bun:sqlite'

import { ZoteroVectorDb, type RawVectorDb } from './vector-db.ts'

export function openTestRawDb(): RawVectorDb {
  const db = new Database(':memory:')
  return {
    exec: (sql) => {
      db.exec(sql)
    },
    prepare: (sql) => {
      const stmt = db.prepare(sql)
      return {
        run: (...args) => {
          const r = stmt.run(...(args as never[]))
          return { lastInsertRowid: r.lastInsertRowid }
        },
        get: (...args) => stmt.get(...(args as never[])),
        all: (...args) => stmt.all(...(args as never[])),
      }
    },
    transaction: <T,>(fn: () => T) => db.transaction(fn) as () => T,
    close: () => db.close(),
  }
}

export function openTestVectorDb(
  expected: { modelId: string; embedDim: number } = { modelId: 'test-model', embedDim: 4 },
): ZoteroVectorDb {
  return ZoteroVectorDb.openWithRaw(openTestRawDb(), expected)
}
