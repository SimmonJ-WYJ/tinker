/**
 * OcrCacheStore — 按绝对路径哈希索引的 OCR 结果缓存
 *
 * 不依赖 Zotero 概念：缓存键 = sha256(absPath) + modelId + mtime。
 * 路径布局：{root}/{sha256(absPath)}/{modelId}.json
 * 命中条件：文件存在 AND entry.mtime === 当前文件 mtime
 * 原子写：临时 .tmp 文件 + rename
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'

export interface OcrCacheBBox {
  x: number
  y: number
  width: number
  height: number
}

export interface OcrCacheLine {
  text: string
  confidence: number
  bbox: OcrCacheBBox
}

export interface OcrCacheEntry {
  absPath: string           // 原始图片绝对路径（便于排查，非缓存键）
  modelId: string           // 'paddleocr-v5-mobile' 等
  mtime: number             // POSIX ms，缓存键一部分
  text: string              // 按阅读顺序拼接的完整文本
  lines: OcrCacheLine[]     // 逐行详情
  recognizedAt: number      // 完成时间戳
  durationMs: number        // 推理耗时
  sourceSize: number        // 源文件字节数
}

export interface OcrCacheStats {
  entryCount: number
  totalBytes: number
}

export class OcrCacheStore {
  constructor(private readonly root: string) {}

  /** 读取缓存；mtime 不匹配或文件损坏 → 删除旧条目 + 返 null */
  get(absPath: string, modelId: string, currentMtime: number): OcrCacheEntry | null {
    const filePath = this.filePathFor(absPath, modelId)
    if (!existsSync(filePath)) return null

    let parsed: OcrCacheEntry
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as OcrCacheEntry
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

  /** 写入缓存；原子：tmp + rename */
  put(entry: OcrCacheEntry): void {
    const dir = this.dirFor(entry.absPath)
    mkdirSync(dir, { recursive: true })
    const target = join(dir, `${entry.modelId}.json`)
    const tmp = join(dir, `.${randomUUID()}.tmp`)
    writeFileSync(tmp, JSON.stringify(entry), 'utf-8')
    renameSync(tmp, target)
  }

  /** 清空整个缓存目录 */
  clearAll(): { filesRemoved: number; bytesFreed: number } {
    if (!existsSync(this.root)) return { filesRemoved: 0, bytesFreed: 0 }
    const before = this.stats()
    rmSync(this.root, { recursive: true, force: true })
    return { filesRemoved: before.entryCount, bytesFreed: before.totalBytes }
  }

  /** 统计：遍历所有 *.json，忽略 .tmp */
  stats(): OcrCacheStats {
    if (!existsSync(this.root)) return { entryCount: 0, totalBytes: 0 }
    let entryCount = 0
    let totalBytes = 0
    for (const hashDir of readdirSync(this.root)) {
      const dirPath = join(this.root, hashDir)
      if (!existsSync(dirPath)) continue
      let isDir = false
      try { isDir = statSync(dirPath).isDirectory() } catch { continue }
      if (!isDir) continue
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
