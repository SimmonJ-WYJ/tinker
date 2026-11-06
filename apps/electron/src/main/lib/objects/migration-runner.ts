/**
 * SQLite migration runner —— PRAGMA user_version 驱动的幂等增量迁移
 *
 * 解耦 SQLite driver：runner 只依赖结构化接口 `MigrationDb`，生产挂
 * better-sqlite3（见 sqlite-connection.ts），测试挂 bun:sqlite。这样
 * Bun 不支持 better-sqlite3 native binding 的限制（oven-sh/bun#4290）
 * 不会卡住 migrations 与 SQL 本体的测试。
 *
 * 约束：
 *   - 每个 migration 包在独立事务里：失败 → ROLLBACK + user_version 不前进
 *   - manifest 按 version 单调递增，旧 version 不得修改（一律新加 migration）
 *   - 任何错误抛出，由调用方决定 fail-fast 行为
 */

export interface Migration {
  /** 单调递增，对应 SQLite PRAGMA user_version */
  readonly version: number
  /** 仅日志/审计用，不影响行为 */
  readonly name: string
  /** 整段 SQL（可含多条语句），由 db.exec() 执行 */
  readonly sql: string
}

/**
 * 迁移运行器对 DB 的最小依赖。两个 SQLite driver 的 native 接口都很
 * 容易包装到这个形状（better-sqlite3 走 db.pragma；bun:sqlite 走
 * db.exec('PRAGMA ...') + db.query('PRAGMA ...')）。
 */
export interface MigrationDb {
  exec(sql: string): void
  getUserVersion(): number
  setUserVersion(v: number): void
  /** 执行 fn 包裹在 BEGIN/COMMIT 中；抛错则 ROLLBACK 后重抛 */
  transaction<T>(fn: () => T): T
}

/**
 * 顺序应用所有 version > 当前 user_version 的 migration。
 * 已应用过的会跳过；未应用过的在事务内执行后推进 user_version。
 */
export function runMigrations(db: MigrationDb, manifest: readonly Migration[]): void {
  const current = db.getUserVersion()

  const pending = manifest.filter((m) => m.version > current)
  if (pending.length === 0) return

  // manifest 必须按 version 升序排列，避免误装
  for (let i = 1; i < pending.length; i++) {
    const prev = pending[i - 1]
    const curr = pending[i]
    if (!prev || !curr) continue
    if (curr.version <= prev.version) {
      throw new Error(
        `[objects] migration manifest 顺序错误：v${prev.version} 之后出现 v${curr.version}`,
      )
    }
  }

  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql)
      db.setUserVersion(m.version)
    })
    console.log(`[objects] applied migration v${m.version} (${m.name})`)
  }
}
