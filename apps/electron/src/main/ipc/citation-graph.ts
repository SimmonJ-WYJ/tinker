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
  CitationGraphStreamEvent,
  CitationGraphClearCacheInput,
  CitationGraphClearCacheResult,
  CitationGraphAddToZoteroInput,
  CitationGraphAddToZoteroResult,
} from '@asci/shared'
import { buildGraph as buildCitationGraph } from '../lib/citation-graph'
import { clearAllCache, clearCacheByKey, computeCacheKey } from '../lib/citation-graph/cache'
import { createItem as createZoteroItem, type ZoteroCreator } from '../lib/zotero-write'

// 按 requestId 维护正在进行的构建任务，支持 cancel
const citationGraphControllers = new Map<string, AbortController>()

/** 注册引用图谱 IPC 处理器 */
export function registerCitationGraphIpc(): void {
  // ===== 引用图谱（Citation Graph） =====

  ipcMain.handle(
    CITATION_GRAPH_IPC_CHANNELS.BUILD,
    async (event, req: CitationGraphBuildRequest): Promise<CitationGraphBuildAck> => {
      if (!req?.requestId) {
        return { requestId: '', accepted: false, message: 'requestId 不能为空' }
      }
      // 同一 requestId 若已存在正在进行的任务，拒绝重复提交
      if (citationGraphControllers.has(req.requestId)) {
        return {
          requestId: req.requestId,
          accepted: false,
          message: '已有相同 requestId 的图谱构建在进行中',
        }
      }

      const controller = new AbortController()
      citationGraphControllers.set(req.requestId, controller)

      const sender = event.sender
      const emit = (payload: CitationGraphStreamEvent) => {
        if (sender.isDestroyed()) return
        sender.send(CITATION_GRAPH_IPC_CHANNELS.STREAM_EVENT, payload)
      }

      // 异步执行，立即 ack
      buildCitationGraph(req, emit, controller.signal)
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          emit({ type: 'error', requestId: req.requestId, message })
        })
        .finally(() => {
          citationGraphControllers.delete(req.requestId)
        })

      return { requestId: req.requestId, accepted: true }
    },
  )

  ipcMain.handle(CITATION_GRAPH_IPC_CHANNELS.CANCEL, async (_e, requestId: string) => {
    const controller = citationGraphControllers.get(requestId)
    if (controller) {
      controller.abort()
      citationGraphControllers.delete(requestId)
      return { cancelled: true }
    }
    return { cancelled: false }
  })

  ipcMain.handle(
    CITATION_GRAPH_IPC_CHANNELS.ADD_TO_ZOTERO,
    async (
      _e,
      input: CitationGraphAddToZoteroInput,
    ): Promise<CitationGraphAddToZoteroResult> => {
      // 把节点 authors 字符串拆成 firstName/lastName
      const creators: ZoteroCreator[] = input.authors.map((displayName) => {
        const parts = displayName.trim().split(/\s+/).filter(Boolean)
        if (parts.length === 0) {
          return { creatorType: 'author', lastName: displayName }
        }
        if (parts.length === 1) {
          return { creatorType: 'author', lastName: parts[0] }
        }
        const lastName = parts[parts.length - 1]!
        const firstName = parts.slice(0, -1).join(' ')
        return { creatorType: 'author', firstName, lastName }
      })

      const result = await createZoteroItem(
        {
          title: input.title,
          creators,
          DOI: input.doi,
          date: input.year != null ? String(input.year) : null,
          publicationTitle: input.venue,
          url: input.url,
          abstractNote: null,
        },
        {
          tags: input.tags,
          itemType: 'journalArticle',
          targetTreeViewID: input.targetTreeViewID ?? null,
        },
      )
      return { key: result.key, pdfStatus: result.pdfStatus }
    },
  )

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
