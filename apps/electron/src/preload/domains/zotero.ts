/**
 * Preload · zotero domain 片段
 *
 * Zotero 集成 namespace：桌面版探测/启动、数据目录与安装路径配置、
 * PDF diff / 解析状态、structured txt 生成，以及嵌套的 library（文献库只读）、
 * article（段落总结）、embedding（向量索引）子接口。
 */
import type { PlatformTransport } from '../transport.ts'
import { ZOTERO_IPC_CHANNELS } from '@asci/shared'
import type {
  ZoteroArticleConfig,
  ZoteroEmbeddingConfig,
  ZoteroEmbeddingModelStatus,
  ZoteroEmbeddingStatusSummary,
  ZoteroInstallStatus,
  ZoteroLaunchResult,
  ZoteroPdfArticleStatusSummary,
  ZoteroPingStatus,
  ZoteroSelectedTarget,
  ZoteroCollectionTarget,
  ZoteroPdfDiffResult,
  ZoteroPdfParseStatusSummary,
  ZoteroStructuredTxtGenerationResult,
  ZoteroValidatePathResult,
} from '@asci/shared'
import type {
  ItemSummary,
  CollectionSummary,
  ZoteroGetItemResult,
  GetAttachmentPathResult,
} from '@asci/core/zotero'
import { subscribe } from '../helpers.ts'

export interface ZoteroApi {
  /** 探测 Zotero 桌面版运行状态 */
  ping: () => Promise<ZoteroPingStatus>
  /** 探测 Zotero 是否已安装 */
  detectInstall: () => Promise<ZoteroInstallStatus>
  /** 启动 Zotero 桌面版 */
  launchApp: () => Promise<ZoteroLaunchResult>
  /** 全局启用 / 禁用 Zotero MCP 集成 */
  setEnabled: (enabled: boolean) => Promise<void>
  /** 获取 Zotero 数据目录配置 */
  getDataDir: () => Promise<string | null>
  /** 设置 Zotero 数据目录 */
  setDataDir: (dir: string | null) => Promise<void>
  /** 读取用户自定义 Zotero 安装路径（未设置返回 null） */
  getInstallPath: () => Promise<string | null>
  /** 设置/清除用户自定义 Zotero 安装路径；传 null 清除并回退到自动探测 */
  setInstallPath: (
    path: string | null,
  ) => Promise<{ ok: true; normalizedPath?: string } | { ok: false; reason?: ZoteroValidatePathResult['reason'] }>
  /** 校验给定路径，UI 选完文件后调用以预先反馈 */
  validateInstallPath: (path: string) => Promise<ZoteroValidatePathResult>
  /** 唤起平台文件选择器，选择 Zotero 安装位置；取消返回 null */
  browseInstallPath: () => Promise<string | null>
  /** 主动跑一次 PDF 被动 diff，与上次快照比对并打印日志，返回结果对象 */
  runPdfDiff: () => Promise<ZoteroPdfDiffResult>
  /** 拉取一次 PDF 解析队列状态摘要（不主动推送，UI 主动 poll） */
  getPdfParseStatus: () => Promise<ZoteroPdfParseStatusSummary>
  /**
   * 手动触发 structured .txt 链路全量生成；返回汇总（成功 / 跳过 / 失败）。
   * 与 lite worker 队列产 .md 完全独立，重入安全（运行中重入会复用 promise）。
   */
  generateStructuredTxtAll: () => Promise<ZoteroStructuredTxtGenerationResult>
  /** 文献库 V2 只读接口 */
  library: {
    listCollections: () => Promise<CollectionSummary[]>
    searchItems: (input: { query: string; limit?: number; offset?: number }) => Promise<ItemSummary[]>
    getCollectionItems: (input: { collectionKey: string | null; limit?: number; offset?: number }) => Promise<ItemSummary[]>
    getItem: (input: { itemKey: string }) => Promise<ZoteroGetItemResult>
    getAttachmentPath: (input: { itemKey: string }) => Promise<GetAttachmentPathResult>
    readPdfAsBase64: (input: { path: string }) => Promise<string>
    getSelectedTarget: () => Promise<ZoteroSelectedTarget | null>
    listCollectionTargets: () => Promise<ZoteroCollectionTarget[]>
  }
  /** 段落总结增强（article.md 生成器） */
  article: {
    /** 读配置（含开关、渠道、模型、并发、切片阈值） */
    getConfig: () => Promise<ZoteroArticleConfig>
    /** 写配置；enabled 切换会触发 worker 启停 */
    setConfig: (patch: Partial<ZoteroArticleConfig>) => Promise<ZoteroArticleConfig>
    /** 拉取队列状态摘要 */
    getStatus: () => Promise<ZoteroPdfArticleStatusSummary>
    /** 把 failed 全部重置为 idle 并入队，返回入队总数 */
    retryAll: () => Promise<number>
    /** 把所有 article（含 completed）重置并全部入队，返回入队总数 */
    regenerateAll: () => Promise<number>
    /** 订阅状态变更；返回取消订阅函数 */
    onStatusChanged: (cb: (status: ZoteroPdfArticleStatusSummary) => void) => () => void
  }
  /** 向量索引（语义检索）：评估开关 + 索引状态 + 嵌入模型下载 */
  embedding: {
    /** 读配置（评估总开关 + 并发） */
    getConfig: () => Promise<ZoteroEmbeddingConfig>
    /** 写配置；enabled 切换会触发 worker 启停 + 新会话工具注册门控 */
    setConfig: (patch: Partial<ZoteroEmbeddingConfig>) => Promise<ZoteroEmbeddingConfig>
    /** 拉取索引状态摘要（含模型状态 + chunk 总数） */
    getStatus: () => Promise<ZoteroEmbeddingStatusSummary>
    /** 清空索引库并全量重扫，返回入队总数 */
    rebuildAll: () => Promise<number>
    /** 订阅索引状态变更；返回取消订阅函数 */
    onStatusChanged: (cb: (status: ZoteroEmbeddingStatusSummary) => void) => () => void
    /** 取嵌入模型权重下载状态 */
    getModelStatus: () => Promise<ZoteroEmbeddingModelStatus>
    /** 触发模型下载（幂等）。立即返回当前状态；进度通过 onModelStatusChanged 推送 */
    downloadModel: () => Promise<ZoteroEmbeddingModelStatus>
    /** 订阅模型下载状态/进度；返回取消订阅函数 */
    onModelStatusChanged: (cb: (status: ZoteroEmbeddingModelStatus) => void) => () => void
  }
}

export function createZoteroApi(transport: PlatformTransport): ZoteroApi {
  return {
    ping: (): Promise<ZoteroPingStatus> => transport.invoke(ZOTERO_IPC_CHANNELS.PING),
    detectInstall: (): Promise<ZoteroInstallStatus> => transport.invoke(ZOTERO_IPC_CHANNELS.DETECT_INSTALL),
    launchApp: (): Promise<ZoteroLaunchResult> => transport.invoke(ZOTERO_IPC_CHANNELS.LAUNCH_APP),
    setEnabled: (enabled: boolean): Promise<void> => transport.invoke(ZOTERO_IPC_CHANNELS.SET_ENABLED, enabled),
    getDataDir: (): Promise<string | null> => transport.invoke(ZOTERO_IPC_CHANNELS.GET_DATA_DIR),
    setDataDir: (dir: string | null): Promise<void> => transport.invoke(ZOTERO_IPC_CHANNELS.SET_DATA_DIR, dir),
    getInstallPath: (): Promise<string | null> => transport.invoke(ZOTERO_IPC_CHANNELS.GET_INSTALL_PATH),
    setInstallPath: (path: string | null) => transport.invoke(ZOTERO_IPC_CHANNELS.SET_INSTALL_PATH, path),
    validateInstallPath: (path: string): Promise<ZoteroValidatePathResult> =>
      transport.invoke(ZOTERO_IPC_CHANNELS.VALIDATE_INSTALL_PATH, path),
    browseInstallPath: (): Promise<string | null> => transport.invoke(ZOTERO_IPC_CHANNELS.BROWSE_INSTALL_PATH),
    runPdfDiff: (): Promise<ZoteroPdfDiffResult> => transport.invoke(ZOTERO_IPC_CHANNELS.PDF_DIFF_NOW),
    getPdfParseStatus: (): Promise<ZoteroPdfParseStatusSummary> => transport.invoke(ZOTERO_IPC_CHANNELS.PDF_PARSE_STATUS),
    generateStructuredTxtAll: (): Promise<ZoteroStructuredTxtGenerationResult> =>
      transport.invoke(ZOTERO_IPC_CHANNELS.PDF_STRUCTURED_TXT_GENERATE_ALL),
    library: {
      listCollections: () => transport.invoke(ZOTERO_IPC_CHANNELS.LIB_LIST_COLLECTIONS),
      searchItems: (input) => transport.invoke(ZOTERO_IPC_CHANNELS.LIB_SEARCH_ITEMS, input),
      getCollectionItems: (input) => transport.invoke(ZOTERO_IPC_CHANNELS.LIB_GET_COLLECTION_ITEMS, input),
      getItem: (input) => transport.invoke(ZOTERO_IPC_CHANNELS.LIB_GET_ITEM, input),
      getAttachmentPath: (input) => transport.invoke(ZOTERO_IPC_CHANNELS.LIB_GET_ATTACHMENT_PATH, input),
      readPdfAsBase64: (input) => transport.invoke(ZOTERO_IPC_CHANNELS.LIB_READ_PDF_BASE64, input),
      getSelectedTarget: () => transport.invoke(ZOTERO_IPC_CHANNELS.LIB_GET_SELECTED_TARGET),
      listCollectionTargets: () => transport.invoke(ZOTERO_IPC_CHANNELS.LIB_LIST_COLLECTION_TARGETS),
    },
    article: {
      getConfig: (): Promise<ZoteroArticleConfig> =>
        transport.invoke(ZOTERO_IPC_CHANNELS.ARTICLE_CONFIG_GET),
      setConfig: (patch: Partial<ZoteroArticleConfig>): Promise<ZoteroArticleConfig> =>
        transport.invoke(ZOTERO_IPC_CHANNELS.ARTICLE_CONFIG_SET, patch),
      getStatus: (): Promise<ZoteroPdfArticleStatusSummary> =>
        transport.invoke(ZOTERO_IPC_CHANNELS.ARTICLE_STATUS_SUMMARY),
      retryAll: (): Promise<number> =>
        transport.invoke(ZOTERO_IPC_CHANNELS.ARTICLE_RETRY_ALL),
      regenerateAll: (): Promise<number> =>
        transport.invoke(ZOTERO_IPC_CHANNELS.ARTICLE_REGENERATE_ALL),
      onStatusChanged: (cb: (status: ZoteroPdfArticleStatusSummary) => void) => {
        return subscribe(transport, ZOTERO_IPC_CHANNELS.ARTICLE_STATUS_CHANGED, cb)
      },
    },
    embedding: {
      getConfig: (): Promise<ZoteroEmbeddingConfig> =>
        transport.invoke(ZOTERO_IPC_CHANNELS.EMBED_CONFIG_GET),
      setConfig: (patch: Partial<ZoteroEmbeddingConfig>): Promise<ZoteroEmbeddingConfig> =>
        transport.invoke(ZOTERO_IPC_CHANNELS.EMBED_CONFIG_SET, patch),
      getStatus: (): Promise<ZoteroEmbeddingStatusSummary> =>
        transport.invoke(ZOTERO_IPC_CHANNELS.EMBED_STATUS_SUMMARY),
      rebuildAll: (): Promise<number> =>
        transport.invoke(ZOTERO_IPC_CHANNELS.EMBED_REBUILD_ALL),
      onStatusChanged: (cb: (status: ZoteroEmbeddingStatusSummary) => void) => {
        return subscribe(transport, ZOTERO_IPC_CHANNELS.EMBED_STATUS_CHANGED, cb)
      },
      getModelStatus: (): Promise<ZoteroEmbeddingModelStatus> =>
        transport.invoke(ZOTERO_IPC_CHANNELS.EMBED_MODEL_STATUS),
      downloadModel: (): Promise<ZoteroEmbeddingModelStatus> =>
        transport.invoke(ZOTERO_IPC_CHANNELS.EMBED_MODEL_DOWNLOAD),
      onModelStatusChanged: (cb: (status: ZoteroEmbeddingModelStatus) => void) => {
        return subscribe(transport, ZOTERO_IPC_CHANNELS.EMBED_MODEL_STATUS_CHANGED, cb)
      },
    },
  }
}
