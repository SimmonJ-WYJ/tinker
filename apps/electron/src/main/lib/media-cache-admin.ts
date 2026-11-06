/**
 * 媒体缓存管理（主进程侧）
 *
 * 不复用 MCP 子进程里的 MediaCacheStore —— 避免把 resources/ 代码 bundle 进主进程。
 * 直接 fs walker，够用即可。
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { MediaCacheStats } from '@asci/shared'

/**
 * 规范缓存根目录：~/.asci/cache/zotero-media/
 * 测试场景下接受任意绝对路径覆盖。
 *
 * electron 模块延迟 require，避免在测试环境（非 Electron 进程）中崩溃。
 */
export function getDefaultMediaCacheRoot(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron')
  return join(app.getPath('home'), '.asci', 'cache', 'zotero-media')
}

export function getMediaCacheStats(cacheRoot: string): MediaCacheStats {
  if (!existsSync(cacheRoot)) return { entryCount: 0, totalBytes: 0 }
  let entryCount = 0
  let totalBytes = 0
  for (const itemKey of readdirSync(cacheRoot)) {
    const itemDir = join(cacheRoot, itemKey)
    if (!existsSync(itemDir) || !statSync(itemDir).isDirectory()) continue
    for (const attachmentKey of readdirSync(itemDir)) {
      const attDir = join(itemDir, attachmentKey)
      if (!existsSync(attDir) || !statSync(attDir).isDirectory()) continue
      for (const file of readdirSync(attDir)) {
        if (!file.endsWith('.json') || file.startsWith('.')) continue
        try {
          totalBytes += statSync(join(attDir, file)).size
          entryCount += 1
        } catch { /* raced delete */ }
      }
    }
  }
  return { entryCount, totalBytes }
}

export function clearMediaCache(cacheRoot: string): { filesRemoved: number; bytesFreed: number } {
  if (!existsSync(cacheRoot)) return { filesRemoved: 0, bytesFreed: 0 }
  const before = getMediaCacheStats(cacheRoot)
  rmSync(cacheRoot, { recursive: true, force: true })
  return { filesRemoved: before.entryCount, bytesFreed: before.totalBytes }
}
