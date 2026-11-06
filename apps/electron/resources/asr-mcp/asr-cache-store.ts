/**
 * AsrCacheStore — 按绝对路径哈希的 ASR 结果缓存
 *
 * 路径布局：{root}/{sha256(absPath)}/{modelId}.json
 * 命中条件：文件存在 AND entry.mtime === 当前文件 mtime
 * 原子写：tmp + rename
 */

import {
  existsSync, mkdirSync, readdirSync, readFileSync,
  renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'

export interface AsrCacheEntry {
  absPath: string
  modelId: string
  mtime: number
  text: string
  language?: string
  emotion?: string
  event?: string
  recognizedAt: number
  durationMs: number
  audioDurationSeconds: number
  sourceSize: number
}

export interface AsrCacheStats {
  entryCount: number
  totalBytes: number
}

export class AsrCacheStore {
  constructor(private readonly root: string) {}

  get(absPath: string, modelId: string, currentMtime: number): AsrCacheEntry | null {
    const filePath = this.filePathFor(absPath, modelId)
    if (!existsSync(filePath)) return null
    let parsed: AsrCacheEntry
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as AsrCacheEntry
    } catch {
      try { unlinkSync(filePath) } catch {}
      return null
    }
    if (parsed.mtime !== currentMtime) {
      try { unlinkSync(filePath) } catch {}
      return null
    }
    return parsed
  }

  put(entry: AsrCacheEntry): void {
    const dir = this.dirFor(entry.absPath)
    mkdirSync(dir, { recursive: true })
    const target = join(dir, `${entry.modelId}.json`)
    const tmp = join(dir, `.${randomUUID()}.tmp`)
    writeFileSync(tmp, JSON.stringify(entry), 'utf-8')
    renameSync(tmp, target)
  }

  clearAll(): { filesRemoved: number; bytesFreed: number } {
    if (!existsSync(this.root)) return { filesRemoved: 0, bytesFreed: 0 }
    const before = this.stats()
    rmSync(this.root, { recursive: true, force: true })
    return { filesRemoved: before.entryCount, bytesFreed: before.totalBytes }
  }

  stats(): AsrCacheStats {
    if (!existsSync(this.root)) return { entryCount: 0, totalBytes: 0 }
    let entryCount = 0
    let totalBytes = 0
    for (const hashDir of readdirSync(this.root)) {
      const dirPath = join(this.root, hashDir)
      if (!existsSync(dirPath)) continue
      try { if (!statSync(dirPath).isDirectory()) continue } catch { continue }
      for (const file of readdirSync(dirPath)) {
        if (!file.endsWith('.json') || file.startsWith('.')) continue
        try {
          totalBytes += statSync(join(dirPath, file)).size
          entryCount += 1
        } catch { /* raced delete */ }
      }
    }
    return { entryCount, totalBytes }
  }

  private dirFor(absPath: string): string {
    const hash = createHash('sha256').update(absPath).digest('hex')
    return join(this.root, hash)
  }

  private filePathFor(absPath: string, modelId: string): string {
    return join(this.dirFor(absPath), `${modelId}.json`)
  }
}
