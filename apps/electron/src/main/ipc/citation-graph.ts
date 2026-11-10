/**
 * 引用图谱（Citation Graph）IPC 处理器
 *
 * 汇集图谱构建（流式 + 可取消）、取消、加入 Zotero、清缓存相关的 IPC 通道，
 * 并按 requestId 维护正在进行的构建任务以支持 cancel。
 */

import { ipcMain } from 'electron'
import { CITATION_GRAPH_IPC_CHANNELS } from '@asci/shared'
import type {
  CitationGraphBuildRequest,
  CitationGraphBuildAck,
  CitationGraphClearCacheInput,
  CitationGraphClearCacheResult,
} from '@asci/shared'
import { clearAllCache, clearCacheByKey, computeCacheKey } from '../lib/citation-graph/cache'


/** 注册引用图谱 IPC 处理器 */
export function registerCitationGraphIpc(): void {
  // ===== 引用图谱（Citation Graph） =====

  ipcMain.handle(
    CITATION_GRAPH_IPC_CHANNELS.BUILD,
    async (_event, req: CitationGraphBuildRequest): Promise<CitationGraphBuildAck> => ({
      requestId: req?.requestId ?? '', accepted: false, message: 'SCIENTIFIC_WORKFLOW_UNAVAILABLE',
    }),
  )
  ipcMain.handle(CITATION_GRAPH_IPC_CHANNELS.CANCEL, async () => ({ cancelled: true }))
  ipcMain.handle(CITATION_GRAPH_IPC_CHANNELS.ADD_TO_ZOTERO, async (): Promise<never> => {
    throw new Error('SCIENTIFIC_WORKFLOW_UNAVAILABLE: Existing data remains readable.')
  })

  ipcMain.handle(
    CITATION_GRAPH_IPC_CHANNELS.CLEAR_CACHE,
    async (_e, input: CitationGraphClearCacheInput): Promise<CitationGraphClearCacheResult> => {
      if (input.scope === 'all') {
        return { cleared: clearAllCache() }
      }
      if (!input.seed) return { cleared: 0 }
      // 单条清除：计算缓存 key 再删。当前仅支持 openalex provider。
      const key = computeCacheKey({
        provider: 'openalex',
        seed: input.seed,
        params: {
          refsLimit: input.refsLimit ?? 40,
          citedByLimit: input.citedByLimit ?? 25,
          hop2TopN: input.hop2TopN ?? 8,
          hop2RefsPerNode: input.hop2RefsPerNode ?? 5,
          hop2CitedByPerNode: input.hop2CitedByPerNode ?? 3,
        },
      })
      return { cleared: clearCacheByKey(key) ? 1 : 0 }
    },
  )
}
