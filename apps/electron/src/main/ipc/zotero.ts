/**
 * Zotero 集成 IPC 处理器
 *
 * 汇集 Zotero 安装检测/启动/ping/路径配置、文献库 V2（集合 / 检索 / 条目 / 附件 / PDF）、
 * PDF 解析与结构化 txt、article 生成器、向量索引（语义检索）、媒体识别缓存、ASR 权重下载、
 * 选中目标反查相关的 IPC 通道，并订阅各 service 状态变更向所有渲染窗口广播。
 */

import { BrowserWindow, dialog, ipcMain } from 'electron'
import {
  ZOTERO_IPC_CHANNELS,
  MEDIA_IPC_CHANNELS,
  ASR_WEIGHTS_IPC_CHANNELS,
  ZOTERO_CONNECTOR_PING_URL,
  ZOTERO_LOCAL_API_BASE,
  ZOTERO_PING_TIMEOUT_MS,
} from '@asci/shared'
import { getDefaultMediaCacheRoot, getMediaCacheStats, clearMediaCache } from '../lib/media-cache-admin'
import { getAsrWeightsService } from '../lib/asr-weights-service'
import { getSettings, updateSettings } from '../lib/settings-service'
import {
  detectZoteroInstalled,
  launchZotero,
  validateZoteroPath,
} from '../lib/zotero-integration'
import {
  listCollections as libListCollections,
  searchItems as libSearchItems,
  getCollectionItems as libGetCollectionItems,
  getItem as libGetItem,
  getAttachmentPath as libGetAttachmentPath,
  readPdfAsBase64,
  type SearchItemsInput,
  type GetCollectionItemsInput,
  type GetItemInput,
  type GetAttachmentPathInput,
} from '../lib/zotero-library'
import {
  getParseStatusSummary,
} from '../lib/zotero-pdf-parser/index'
import {
  getArticleConfig,
  getStatusSummary as getArticleStatusSummary,
  setStatusChangedListener as setArticleStatusListener,
} from '../lib/zotero-article-generator/index'
import {
  getEmbeddingConfig,
  getEmbeddingStatusSummary,
  setEmbeddingStatusChangedListener,
} from '../lib/zotero-embedding-index/index'
import { getEmbeddingModelService } from '../lib/embedding-model-service'

/** 注册 Zotero 集成 IPC 处理器 */
export function registerZoteroIpc(): void {
  // ===== Zotero 集成 =====

  ipcMain.handle(ZOTERO_IPC_CHANNELS.DETECT_INSTALL, () => {
    return detectZoteroInstalled()
  })

  ipcMain.handle(ZOTERO_IPC_CHANNELS.LAUNCH_APP, async () => {
    return launchZotero()
  })

  ipcMain.handle(ZOTERO_IPC_CHANNELS.PING, async () => {
    try {
      const runningResp = await fetch(ZOTERO_CONNECTOR_PING_URL, { signal: AbortSignal.timeout(ZOTERO_PING_TIMEOUT_MS) })
      const running = runningResp.ok
      if (!running) return { running: false, remoteEnabled: false }
      try {
        const apiResp = await fetch(`${ZOTERO_LOCAL_API_BASE}/users/0/items?limit=1`, {
          headers: { 'Zotero-API-Version': '3', Accept: 'application/json' },
          signal: AbortSignal.timeout(ZOTERO_PING_TIMEOUT_MS),
        })
        const contentType = apiResp.headers.get('content-type') ?? ''
        // 仅当 HTTP ok 且 content-type 是 JSON 时才认为远程可用
        // （其他服务占用 23119 时可能回 200 HTML，避免误报）
        const remoteEnabled = apiResp.ok && contentType.includes('application/json')
        return { running: true, remoteEnabled }
      } catch {
        return { running: true, remoteEnabled: false }
      }
    } catch {
      return { running: false, remoteEnabled: false }
    }
  })

  const unavailable = (): never => { throw new Error('SCIENTIFIC_WORKFLOW_UNAVAILABLE: This scientific workflow has been retired. Existing data remains readable.') }
  for (const channel of [
    ZOTERO_IPC_CHANNELS.SET_ENABLED,
    ZOTERO_IPC_CHANNELS.PDF_DIFF_NOW,
    ZOTERO_IPC_CHANNELS.PDF_STRUCTURED_TXT_GENERATE_ALL,
    ZOTERO_IPC_CHANNELS.ARTICLE_CONFIG_SET,
    ZOTERO_IPC_CHANNELS.ARTICLE_RETRY_ALL,
    ZOTERO_IPC_CHANNELS.ARTICLE_REGENERATE_ALL,
    ZOTERO_IPC_CHANNELS.EMBED_CONFIG_SET,
    ZOTERO_IPC_CHANNELS.EMBED_REBUILD_ALL,
    ZOTERO_IPC_CHANNELS.EMBED_MODEL_DOWNLOAD,
  ]) ipcMain.handle(channel, unavailable)

  ipcMain.handle(ZOTERO_IPC_CHANNELS.GET_DATA_DIR, () => {
    const settings = getSettings()
    return settings.zoteroDataDir ?? null
  })

  ipcMain.handle(ZOTERO_IPC_CHANNELS.SET_DATA_DIR, async (_event, dir: string | null) => {
    await updateSettings({ zoteroDataDir: dir ?? undefined })
  })

  ipcMain.handle(ZOTERO_IPC_CHANNELS.GET_INSTALL_PATH, () => {
    const settings = getSettings()
    return settings.zoteroInstallPath ?? null
  })

  // 设置/清除用户自定义安装路径；传 null 清除。
  // 写入前主进程已校验过（renderer 也校验，但主进程是最终守门）。
  ipcMain.handle(ZOTERO_IPC_CHANNELS.SET_INSTALL_PATH, async (_event, path: string | null) => {
    if (path == null || path.trim() === '') {
      await updateSettings({ zoteroInstallPath: undefined })
      return { ok: true }
    }
    const result = validateZoteroPath(path)
    if (!result.valid) {
      return { ok: false, reason: result.reason }
    }
    await updateSettings({ zoteroInstallPath: result.normalizedPath })
    return { ok: true, normalizedPath: result.normalizedPath }
  })

  ipcMain.handle(ZOTERO_IPC_CHANNELS.VALIDATE_INSTALL_PATH, (_event, path: string) => {
    return validateZoteroPath(path)
  })

  // 唤起平台文件选择器，按当前 OS 设定过滤器：
  // - macOS：.app 包
  // - Windows：.exe
  // Linux 不在支持范围，filter 给 * 仅做兜底，主进程 validateZoteroPath 会再拒绝。
  ipcMain.handle(ZOTERO_IPC_CHANNELS.BROWSE_INSTALL_PATH, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return null

    const filters: Electron.FileFilter[] =
      process.platform === 'win32'
        ? [{ name: 'Zotero', extensions: ['exe'] }]
        : process.platform === 'darwin'
          ? [{ name: 'Zotero', extensions: ['app'] }]
          : [{ name: 'Zotero', extensions: ['*'] }]

    // macOS 默认把 .app 当文件挑（不传 treatPackageAsDirectory）。
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters,
      title: 'Select Zotero',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]!
  })

  // ===== Zotero 文献库 V2 =====

  ipcMain.handle(ZOTERO_IPC_CHANNELS.LIB_LIST_COLLECTIONS, async () => {
    return await libListCollections()
  })

  ipcMain.handle(ZOTERO_IPC_CHANNELS.LIB_SEARCH_ITEMS, async (_event, input: SearchItemsInput) => {
    return await libSearchItems(input)
  })

  ipcMain.handle(ZOTERO_IPC_CHANNELS.LIB_GET_COLLECTION_ITEMS, async (_event, input: GetCollectionItemsInput) => {
    return await libGetCollectionItems(input)
  })

  ipcMain.handle(ZOTERO_IPC_CHANNELS.LIB_GET_ITEM, async (_event, input: GetItemInput) => {
    return await libGetItem(input)
  })

  ipcMain.handle(ZOTERO_IPC_CHANNELS.LIB_GET_ATTACHMENT_PATH, async (_event, input: GetAttachmentPathInput) => {
    return await libGetAttachmentPath(input)
  })

  ipcMain.handle(
    ZOTERO_IPC_CHANNELS.LIB_READ_PDF_BASE64,
    async (_, input: { path: string }): Promise<string> => {
      return readPdfAsBase64(input)
    },
  )



  ipcMain.handle(ZOTERO_IPC_CHANNELS.PDF_PARSE_STATUS, () => {
    return getParseStatusSummary()
  })



  // ===== Zotero PDF article 生成器（段落总结增强） =====

  // 主动 push article 状态变更到所有渲染窗口
  setArticleStatusListener(summary => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(ZOTERO_IPC_CHANNELS.ARTICLE_STATUS_CHANGED, summary)
      }
    }
  })

  ipcMain.handle(ZOTERO_IPC_CHANNELS.ARTICLE_CONFIG_GET, () => {
    return getArticleConfig()
  })



  ipcMain.handle(ZOTERO_IPC_CHANNELS.ARTICLE_STATUS_SUMMARY, () => {
    return getArticleStatusSummary()
  })





  // ===== Zotero 向量索引（语义检索）=====

  // 主动 push 索引状态变更到所有渲染窗口
  setEmbeddingStatusChangedListener((summary) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(ZOTERO_IPC_CHANNELS.EMBED_STATUS_CHANGED, summary)
      }
    }
  })

  // 主动 push 模型下载状态/进度
  getEmbeddingModelService().on('status-changed', (status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(ZOTERO_IPC_CHANNELS.EMBED_MODEL_STATUS_CHANGED, status)
      }
    }
  })

  ipcMain.handle(ZOTERO_IPC_CHANNELS.EMBED_CONFIG_GET, () => {
    return getEmbeddingConfig()
  })



  ipcMain.handle(ZOTERO_IPC_CHANNELS.EMBED_STATUS_SUMMARY, () => {
    return getEmbeddingStatusSummary()
  })



  ipcMain.handle(ZOTERO_IPC_CHANNELS.EMBED_MODEL_STATUS, () => {
    return getEmbeddingModelService().getStatus()
  })



  // ===== 媒体识别缓存 =====

  ipcMain.handle(MEDIA_IPC_CHANNELS.CACHE_STATS, () => {
    return getMediaCacheStats(getDefaultMediaCacheRoot())
  })

  ipcMain.handle(MEDIA_IPC_CHANNELS.CACHE_CLEAR, () => {
    return clearMediaCache(getDefaultMediaCacheRoot())
  })

  // ===== ASR 权重下载 =====

  const asrWeights = getAsrWeightsService()
  // 向所有渲染窗口广播状态变更
  asrWeights.on('status', (status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(ASR_WEIGHTS_IPC_CHANNELS.STATUS_CHANGED, status)
      }
    }
  })

  ipcMain.handle(ASR_WEIGHTS_IPC_CHANNELS.GET_STATUS, () => {
    return asrWeights.getStatus()
  })

  ipcMain.handle(ASR_WEIGHTS_IPC_CHANNELS.DOWNLOAD, async () => {
    // 不 await：后台开始；渲染进程通过 STATUS_CHANGED 事件追进度
    asrWeights.startDownload().catch((err) => {
      console.warn('[ASR 权重] 下载失败:', err)
    })
    return asrWeights.getStatus()
  })

  ipcMain.handle(ASR_WEIGHTS_IPC_CHANNELS.CANCEL, () => {
    asrWeights.cancel()
    return asrWeights.getStatus()
  })

  ipcMain.handle(ASR_WEIGHTS_IPC_CHANNELS.DELETE, async () => {
    await asrWeights.delete()
    return asrWeights.getStatus()
  })

  ipcMain.handle(ZOTERO_IPC_CHANNELS.LIB_GET_SELECTED_TARGET, async () => {
    const { getSelectedTarget } = await import('../lib/zotero-selected-target.ts')
    return getSelectedTarget()
  })

  ipcMain.handle(ZOTERO_IPC_CHANNELS.LIB_LIST_COLLECTION_TARGETS, async () => {
    const { listCollectionTargets } = await import('../lib/zotero-selected-target.ts')
    return listCollectionTargets()
  })
}
