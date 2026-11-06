/**
 * better-sqlite3 连接工厂 + 开机 PRAGMA 配置
 *
 * 单例由 object-store.ts 持有；本文件只负责"如何正确打开一个 DB"。
 *
 * PRAGMA 选择理由：
 *   - journal_mode = WAL：读写并发友好；代价是多出 .db-wal / .db-shm 两个 sidecar
 *   - synchronous = NORMAL：WAL 模式下安全且快（FULL 在 WAL 下基本无收益）
 *   - foreign_keys = ON：SQLite 默认 OFF，必须显式开，否则 FK 约束 / CASCADE 失效
 *   - busy_timeout = 5000：5 秒等锁后再抛 SQLITE_BUSY，对偶发并发写有缓冲
 */

import Database from 'better-sqlite3'

import type { MigrationDb } from './migration-runner.ts'

export type ObjectsDb = Database.Database

export function openDb(path: string): ObjectsDb {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return db
}

/**
 * 把 better-sqlite3 实例包装成 MigrationDb 结构接口，供 migration-runner 使用。
 * 见 migration-runner.ts 的接口注释。
 */
export function asMigrationDb(db: ObjectsDb): MigrationDb {
  return {
    exec: (sql) => {
      db.exec(sql)
    },
    getUserVersion: () => db.pragma('user_version', { simple: true }) as number,
    setUserVersion: (v) => {
      db.pragma(`user_version = ${v}`)
    },
    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
  }
}
