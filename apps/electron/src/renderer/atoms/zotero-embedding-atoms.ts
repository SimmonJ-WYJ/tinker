/**
 * 向量索引（语义检索）渲染端状态
 *
 * 数据来源：
 *   - config 来自 zotero.embedding.getConfig / setConfig（持久化在 ~/.asci/zotero-embedding.json）
 *   - status summary 主进程通过 EMBED_STATUS_CHANGED 主动 push；渲染端 onMount 也主动拉一次
 *   - model status 主进程通过 EMBED_MODEL_STATUS_CHANGED 推送下载进度
 */

import { atom } from 'jotai'
import type {
  ZoteroEmbeddingConfig,
  ZoteroEmbeddingModelStatus,
  ZoteroEmbeddingStatusSummary,
} from '@asci/shared'
import { DEFAULT_ZOTERO_EMBEDDING_CONFIG } from '@asci/shared'

const DEFAULT_SUMMARY: ZoteroEmbeddingStatusSummary = {
  mode: DEFAULT_ZOTERO_EMBEDDING_CONFIG.mode,
  modelState: 'missing',
  total: 0,
  byStatus: {
    idle: 0,
    pending: 0,
    embedding: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  },
  runningKeys: [],
  recentFailed: [],
  chunkCount: 0,
}

const DEFAULT_MODEL_STATUS: ZoteroEmbeddingModelStatus = {
  modelId: '',
  displayName: '',
  state: 'missing',
  expectedBytes: 0,
}

export const zoteroEmbeddingConfigAtom = atom<ZoteroEmbeddingConfig>({
  ...DEFAULT_ZOTERO_EMBEDDING_CONFIG,
})
export const zoteroEmbeddingStatusAtom = atom<ZoteroEmbeddingStatusSummary>(DEFAULT_SUMMARY)
export const zoteroEmbeddingModelStatusAtom = atom<ZoteroEmbeddingModelStatus>(DEFAULT_MODEL_STATUS)
