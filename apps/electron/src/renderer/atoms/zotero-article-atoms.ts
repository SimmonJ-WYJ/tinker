/**
 * 段落总结增强（article 生成器）渲染端状态
 *
 * 数据来源：
 *   - config 来自 zotero.article.getConfig / setConfig（持久化在 ~/.asci/zotero-article.json）
 *   - status summary 主进程通过 ARTICLE_STATUS_CHANGED 主动 push；渲染端 onMount 也主动拉一次
 */

import { atom } from 'jotai'
import type { ZoteroArticleConfig, ZoteroPdfArticleStatusSummary } from '@asci/shared'

const DEFAULT_CONFIG: ZoteroArticleConfig = {
  enabled: false,
  channelId: null,
  model: null,
  concurrency: 1,
  maxTokensPerChunk: 200000,
}

const DEFAULT_SUMMARY: ZoteroPdfArticleStatusSummary = {
  enabled: false,
  total: 0,
  byStatus: {
    idle: 0,
    pending: 0,
    generating: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  },
  runningKeys: [],
  recentFailed: [],
}

export const zoteroArticleConfigAtom = atom<ZoteroArticleConfig>(DEFAULT_CONFIG)
export const zoteroArticleStatusAtom = atom<ZoteroPdfArticleStatusSummary>(DEFAULT_SUMMARY)
