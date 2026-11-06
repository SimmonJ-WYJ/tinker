/**
 * 向量索引（语义检索）配置加载/保存
 *
 * 持久化路径：~/.asci/zotero-embedding.json（与 zotero-article.json 同级）。
 * 文件不存在或字段缺失时返回默认值，不主动写盘。
 *
 * mode 是**评估三档开关**（vector / papers-rg / both）：同时门控索引构建 worker 与
 * Agent 检索工具注册（每会话判定一次）。旧版布尔 enabled 自动迁移（true→both / false→papers-rg）。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { ZoteroEmbeddingConfig } from '@asci/shared'
import { DEFAULT_ZOTERO_EMBEDDING_CONFIG } from '@asci/shared'
import { getZoteroEmbeddingConfigPath } from '../config-paths.ts'

let cached: ZoteroEmbeddingConfig | null = null

export function loadEmbeddingConfig(): ZoteroEmbeddingConfig {
  if (cached) return cached
  const path = getZoteroEmbeddingConfigPath()
  if (!existsSync(path)) {
    cached = { ...DEFAULT_ZOTERO_EMBEDDING_CONFIG }
    return cached
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ZoteroEmbeddingConfig>
    cached = mergeWithDefaults(parsed)
    return cached
  } catch (err) {
    console.warn('[向量索引 Config] 文件损坏，使用默认配置:', err)
    cached = { ...DEFAULT_ZOTERO_EMBEDDING_CONFIG }
    return cached
  }
}

export function saveEmbeddingConfig(patch: Partial<ZoteroEmbeddingConfig>): ZoteroEmbeddingConfig {
  const current = loadEmbeddingConfig()
  const next = mergeWithDefaults({ ...current, ...patch })
  try {
    writeFileSync(getZoteroEmbeddingConfigPath(), JSON.stringify(next, null, 2), 'utf-8')
    cached = next
    return next
  } catch (err) {
    console.error('[向量索引 Config] 写入失败:', err)
    throw new Error('写入 zotero-embedding.json 失败')
  }
}

/** 测试或显式刷新时重置内存缓存 */
export function resetEmbeddingConfigCache(): void {
  cached = null
}

const VALID_MODES: ReadonlySet<string> = new Set(['vector', 'papers-rg', 'both'])

function mergeWithDefaults(
  input: Partial<ZoteroEmbeddingConfig> & { enabled?: boolean },
): ZoteroEmbeddingConfig {
  return {
    mode: resolveMode(input),
    concurrency:
      typeof input.concurrency === 'number' && input.concurrency >= 1 && input.concurrency <= 4
        ? Math.floor(input.concurrency)
        : DEFAULT_ZOTERO_EMBEDDING_CONFIG.concurrency,
  }
}

/** 解析检索模式：优先 mode 字段；否则迁移旧布尔 enabled（true→both / false→papers-rg） */
function resolveMode(
  input: Partial<ZoteroEmbeddingConfig> & { enabled?: boolean },
): ZoteroEmbeddingConfig['mode'] {
  if (typeof input.mode === 'string' && VALID_MODES.has(input.mode)) return input.mode
  if (typeof input.enabled === 'boolean') return input.enabled ? 'both' : 'papers-rg'
  return DEFAULT_ZOTERO_EMBEDDING_CONFIG.mode
}
