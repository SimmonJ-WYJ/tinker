/**
 * Zotero 数据目录探测
 *
 * 默认值：macOS ~/Zotero, Windows %USERPROFILE%\Zotero, Linux ~/Zotero。
 * 用户可通过环境变量 ZOTERO_DATA_DIR 覆盖（主进程启动 MCP 时注入）。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

export function getZoteroDataDir(): string {
  const override = process.env.ZOTERO_DATA_DIR
  if (override && override.trim()) return override.trim()
  return join(homedir(), 'Zotero')
}

export function buildAttachmentPath(attachmentKey: string, filename: string): string {
  return join(getZoteroDataDir(), 'storage', attachmentKey, filename)
}

/**
 * Zotero 主数据库路径 ~/Zotero/zotero.sqlite
 *
 * 用作"零成本脏位"：fs.statSync(path).mtimeMs 仅 ~0.1ms，SQLite 任何写入
 * 都会 bump mtime；自动触发层据此判断是否需要跑 full diff。
 */
export function getZoteroSqlitePath(): string {
  return join(getZoteroDataDir(), 'zotero.sqlite')
}
