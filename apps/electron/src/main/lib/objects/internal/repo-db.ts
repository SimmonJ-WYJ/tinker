/**
 * Repo 层最小 DB 接口
 *
 * 为何不直接用 `better-sqlite3.Database.Database` 类型：
 *   - 测试侧用 `bun:sqlite`（Bun 不支持 better-sqlite3 native binding，
 *     见 oven-sh/bun#4290），两个 driver API 形状一致但 TS 类型互不兼容
 *   - migration-runner.ts 已经走过同样的取舍：定义 MigrationDb 结构接口，
 *     让 driver 用各自的 adapter 适配
 *
 * 本接口只声明 repo 层用到的方法，保持小而稳：
 *   - `prepare(sql).run/get/all`：参数化查询
 *   - `transaction(fn)()`：多表写入打包
 *
 * 生产侧的 better-sqlite3 Database 与测试侧的 bun:sqlite Database 都
 * 结构性满足本接口，调用方直接传入即可（必要时一次 `as RepoDb` 收窄）。
 */

export interface RepoStmt {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface RepoDb {
  prepare(sql: string): RepoStmt
  /**
   * better-sqlite3 与 bun:sqlite 都把 `db.transaction(fn)` 包成"接受同样
   * 参数的函数 wrapper"，调用方需要再 `()` 一次执行。本接口对齐该形状。
   */
  transaction<T>(fn: () => T): () => T
}
