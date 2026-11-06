/**
 * Preload 脚本
 *
 * 通过 contextBridge 安全地将 API 暴露给渲染进程
 * 使用上下文隔离确保安全性
 *
 * 本文件是聚合器：各 domain 片段实现拆到 domains/ 下，此处组装成
 * 完整的 electronAPI 并 expose；接口 ElectronAPI 由各片段接口组合而成。
 */

// Sentry preload 桥：contextIsolation 下为 renderer ↔ main 的崩溃上报提供 IPC 通路。
// renderer 侧是否真正上报由 renderer/lib/sentry.ts 的 DSN/dev 门控决定，
// 本桥仅暴露通道、无副作用，常驻无害（issue #416 / ADR-011）。
import '@sentry/electron/preload'
import { contextBridge, ipcRenderer } from 'electron'
import { THEME_IPC_CHANNELS } from '../types'
import type { ResolvedTheme } from '../types'
import { coreApi } from './domains/core'
import type { CoreApi } from './domains/core'
import { agentApi } from './domains/agent'
import type { AgentApi } from './domains/agent'
import { zoteroApi } from './domains/zotero'
import type { ZoteroApi } from './domains/zotero'
import {
  workspacePapersApi,
  notesApi,
  evidenceSetsApi,
  outputFeedbackApi,
  reviewsApi,
  papersApi,
  citationGraphApi,
} from './domains/papers'
import type {
  WorkspacePapersApi,
  NotesApi,
  EvidenceSetsApi,
  OutputFeedbackApi,
  ReviewsApi,
  PapersApi,
  CitationGraphApi,
} from './domains/papers'
import {
  mediaCacheApi,
  asrWeightsApi,
  paperSearchApi,
  runtimeApi,
  capabilityPackApi,
} from './domains/media'
import type {
  MediaCacheApi,
  AsrWeightsApi,
  PaperSearchApi,
  RuntimeApi,
  CapabilityPackApi,
} from './domains/media'
import { authApi, oauthApi } from './domains/auth'
import type { AuthApi, OAuthApi } from './domains/auth'

/**
 * 暴露给渲染进程的 API 接口定义 —— 由各 domain 片段接口组合而成。
 * 扁平方法来自 CoreApi / AgentApi；其余为嵌套 namespace。
 */
export interface ElectronAPI extends CoreApi, AgentApi {
  // ===== Zotero 集成 =====
  zotero: ZoteroApi

  /** 工作区论文库 */
  workspacePapers: WorkspacePapersApi

  /** Notes (v0.2 证据列表重构后)：划词建注 + 笔记列表 + 全局聚合 */
  notes: NotesApi

  /** EvidenceSets：聚合查询 + 关联操作 */
  evidenceSets: EvidenceSetsApi

  /** OutputFeedback：助手输出 👍/👎 直观反馈采集（issue #477） */
  outputFeedback: OutputFeedbackApi

  /** Reviews：辅助反查（综述 HTML 预览组件按 path 加载 → 反查 reviewId 启用 Add note here） */
  reviews: ReviewsApi

  /** Papers 反查（综述引文 → Library 联动用） */
  papers: PapersApi

  /** 引用图谱（Citation Graph） */
  citationGraph: CitationGraphApi

  // ===== 媒体识别缓存 =====
  mediaCache: MediaCacheApi

  // ===== ASR 权重下载 =====
  asrWeights: AsrWeightsApi

  // ===== Paper Search MCP 集成 =====
  paperSearch: PaperSearchApi

  // ===== 内置 4 工具 runtime 校验 =====
  runtime: RuntimeApi

  /** 能力包管理（配置页 → 能力包板块 · Codex 风只读展示，#414 CP-6） */
  capabilityPack: CapabilityPackApi

  /** 账户体系 - spec §五 */
  auth: AuthApi

  /** OAuth 协议 - spec §六 */
  oauth: OAuthApi
}

/**
 * 实现 ElectronAPI 接口 —— 扁平片段展开，嵌套片段按 key 赋值。
 * 组装后的运行时形状（keys / 嵌套 / 方法签名）与拆分前逐字一致。
 */
const electronAPI = {
  ...coreApi,
  ...agentApi,
  zotero: zoteroApi,
  workspacePapers: workspacePapersApi,
  notes: notesApi,
  evidenceSets: evidenceSetsApi,
  outputFeedback: outputFeedbackApi,
  reviews: reviewsApi,
  papers: papersApi,
  citationGraph: citationGraphApi,
  mediaCache: mediaCacheApi,
  asrWeights: asrWeightsApi,
  paperSearch: paperSearchApi,
  runtime: runtimeApi,
  capabilityPack: capabilityPackApi,
  auth: authApi,
  oauth: oauthApi,
} satisfies ElectronAPI

// 将 API 暴露到渲染进程的 window 对象上
contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// 启动期同步抓取已解析的初始主题，并暴露到 window.__INITIAL_THEME__；
// renderer 在 React mount 前可同步读到，避免首帧 .dark class 缺失导致白闪。
const initialTheme: ResolvedTheme = ipcRenderer.sendSync(THEME_IPC_CHANNELS.RESOLVE)
contextBridge.exposeInMainWorld('__INITIAL_THEME__', initialTheme)

// 扩展 Window 接口的类型定义
declare global {
  interface Window {
    electronAPI: ElectronAPI
    __INITIAL_THEME__: ResolvedTheme
  }
}
