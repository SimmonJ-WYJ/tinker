/**
 * Object Store 公共入口
 *
 * 0.2 北极星 6 个核心对象的 SQLite 持久层单例。主进程启动时调用
 * `initObjectStore()` 完成连接 + 迁移；业务侧通过 `getDb()` 获取连接。
 *
 * 设计要点：
 *   - 单例 + sync API：better-sqlite3 是同步的，单例最朴素
 *   - fail-fast：初始化失败抛出，由调用方决定（建议主进程 crash + 提示）
 *   - 测试隔离：环境变量 `ASCI_CONFIG_HOME` 切到 tmpdir + `closeForTests()` 复位
 */

import { getObjectsDbPath, migrateLegacyObjectsDbName } from '../config-paths.ts'

import { MIGRATIONS } from './migrations/index.ts'
import { runMigrations } from './migration-runner.ts'
import { asMigrationDb, openDb, type ObjectsDb } from './sqlite-connection.ts'

let dbInstance: ObjectsDb | null = null

/**
 * 打开 ~/.asci/asci.db，应用所有未跑过的 migration，建立单例。
 *
 * 幂等：重复调用直接返回，不重开 DB。
 */
export function initObjectStore(): void {
  if (dbInstance) return
  // 打开前先把历史 objects.db 改名为 asci.db（含 WAL/SHM sidecar），保住老用户数据
  migrateLegacyObjectsDbName()
  const path = getObjectsDbPath()
  const db = openDb(path)
  try {
    runMigrations(asMigrationDb(db), MIGRATIONS)
  } catch (err) {
    db.close()
    throw err
  }
  dbInstance = db
  const version = db.pragma('user_version', { simple: true })
  console.log(`[objects] store ready at ${path} (user_version=${version})`)
}

/**
 * 取出已初始化的 DB 单例。未初始化时抛出（防止误用）。
 */
export function getDb(): ObjectsDb {
  if (!dbInstance) {
    throw new Error('[objects] store not initialized; call initObjectStore() first')
  }
  return dbInstance
}

/**
 * 测试用：关闭并清空单例，让下一个测试拿到全新 DB。
 * 生产代码不应调用。
 */
export function closeForTests(): void {
  dbInstance?.close()
  dbInstance = null
}
