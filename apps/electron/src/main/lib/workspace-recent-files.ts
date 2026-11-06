/**
 * 工作区最近文件扫描
 *
 * 递归扫描工作区 workspace-files/ 目录，按 mtime 倒序取前 N 个。
 * 带 MAX_SCAN_FILES 兜底防止超大目录拖慢 UI。
 */

import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import { getWorkspaceFilesDir } from './config-paths'
import type { RecentFileEntry, ListRecentWorkspaceFilesOutput } from '@asci/shared'

const MAX_SCAN_FILES = 2000

/** 忽略的目录名（根目录下不递归） */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.asci-tmp'])

/** 忽略的文件名 */
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db'])

/**
 * 对外入口：给 workspaceSlug，扫描 workspace-files/
 */
export async function listRecentWorkspaceFiles(
  workspaceSlug: string,
  limit: number,
): Promise<ListRecentWorkspaceFilesOutput> {
  const dir = getWorkspaceFilesDir(workspaceSlug)
  return listRecentWorkspaceFilesInDir(dir, limit)
}

/**
 * 给定根目录执行递归扫描。便于测试注入临时目录。
 */
export async function listRecentWorkspaceFilesInDir(
  rootDir: string,
  limit: number,
): Promise<ListRecentWorkspaceFilesOutput> {
  const entries: RecentFileEntry[] = []
  let totalCount = 0
  let capped = false

  async function walk(dir: string): Promise<void> {
    if (capped) return
    let children: import('node:fs').Dirent[]
    try {
      children = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const child of children) {
      if (capped) return
      const name = child.name
      if (name.startsWith('.') && child.isDirectory()) continue
      if (SKIP_DIRS.has(name)) continue
      if (SKIP_FILES.has(name)) continue

      const full = join(dir, name)
      let stat: import('node:fs').Stats
      try {
        stat = await fs.lstat(full)
      } catch {
        continue
      }

      if (stat.isSymbolicLink()) continue

      if (stat.isDirectory()) {
        await walk(full)
      } else if (stat.isFile()) {
        totalCount++
        if (totalCount > MAX_SCAN_FILES) {
          totalCount = MAX_SCAN_FILES
          capped = true
          return
        }
        entries.push({
          relPath: relative(rootDir, full),
          name,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
        })
      }
    }
  }

  await walk(rootDir)

  entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const files = entries.slice(0, limit)

  return { files, totalCount, capped }
}
