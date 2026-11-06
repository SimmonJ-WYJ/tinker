/**
 * 段落总结增强（article 生成器）配置加载/保存
 *
 * 持久化路径：~/.asci/zotero-article.json（与 channels.json / settings.json 同级）。
 * 文件不存在或字段缺失时返回默认值，不主动写盘。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { ZoteroArticleConfig } from '@asci/shared'
import { getZoteroArticleConfigPath } from '../config-paths'

export const DEFAULT_ARTICLE_CONFIG: ZoteroArticleConfig = {
  enabled: false,
  channelId: null,
  model: null,
  concurrency: 1,
  // 单片 token 上限。
  //
  // 历史上曾经设到 200K 想"整篇一次性丢"，但实测上游聚合网关（opencode / kimi 代理等）
  // 经常在 60-120s idle 就 502，长论文整篇调一次必 timeout。
  //
  // 改回 40K 让长论文自动切 2-3 片，每片单次调用 ~60-90s，远低于网关 idle 上限。
  // 跨片错乱由 worker.ts 的 renumberPTags + rebuildOutline + dedupSectionNumbers 兜底修复。
  maxTokensPerChunk: 40000,
}

let cached: ZoteroArticleConfig | null = null

export function loadArticleConfig(): ZoteroArticleConfig {
  if (cached) return cached
  const path = getZoteroArticleConfigPath()
  if (!existsSync(path)) {
    cached = { ...DEFAULT_ARTICLE_CONFIG }
    return cached
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<ZoteroArticleConfig>
    cached = mergeWithDefaults(parsed)
    return cached
  } catch (err) {
    console.warn('[Zotero Article Config] 文件损坏，使用默认配置:', err)
    cached = { ...DEFAULT_ARTICLE_CONFIG }
    return cached
  }
}

export function saveArticleConfig(patch: Partial<ZoteroArticleConfig>): ZoteroArticleConfig {
  const current = loadArticleConfig()
  const next = mergeWithDefaults({ ...current, ...patch })
  try {
    writeFileSync(getZoteroArticleConfigPath(), JSON.stringify(next, null, 2), 'utf-8')
    cached = next
    return next
  } catch (err) {
    console.error('[Zotero Article Config] 写入失败:', err)
    throw new Error('写入 zotero-article.json 失败')
  }
}

/** 测试或显式刷新时重置内存缓存 */
export function resetArticleConfigCache(): void {
  cached = null
}

function mergeWithDefaults(input: Partial<ZoteroArticleConfig>): ZoteroArticleConfig {
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_ARTICLE_CONFIG.enabled,
    channelId:
      typeof input.channelId === 'string' && input.channelId.length > 0 ? input.channelId : null,
    model: typeof input.model === 'string' && input.model.length > 0 ? input.model : null,
    concurrency:
      typeof input.concurrency === 'number' && input.concurrency >= 1 && input.concurrency <= 8
        ? Math.floor(input.concurrency)
        : DEFAULT_ARTICLE_CONFIG.concurrency,
    // 合法区间 [5K, 1M]。
    //
    // 上一版下限是 50K（用于迁移"旧默认 8K"），但当时默认 200K 太大触发大量 502；
    // 现在默认压到 40K，下限相应下放到 5K（允许极小切片调试 / 慢通道兜底）。
    // ZoteroArticlePanel 还没暴露此字段，运行时主要靠默认值 + zotero-article.json 编辑。
    maxTokensPerChunk:
      typeof input.maxTokensPerChunk === 'number' &&
      input.maxTokensPerChunk >= 5_000 &&
      input.maxTokensPerChunk <= 1_000_000
        ? Math.floor(input.maxTokensPerChunk)
        : DEFAULT_ARTICLE_CONFIG.maxTokensPerChunk,
  }
}
