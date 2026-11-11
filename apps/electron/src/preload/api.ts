/** 纯桌面 API 聚合器：所有平台能力由调用方显式注入。 */
import type { PlatformTransport } from './transport.ts'
import { createCoreApi } from './domains/core.ts'
import type { CoreApi } from './domains/core.ts'
import { createAgentApi } from './domains/agent.ts'
import type { AgentApi } from './domains/agent.ts'
import { createZoteroApi } from './domains/zotero.ts'
import type { ZoteroApi } from './domains/zotero.ts'
import {
  createWorkspacePapersApi,
  createNotesApi,
  createEvidenceSetsApi,
  createOutputFeedbackApi,
  createReviewsApi,
  createPapersApi,
  createCitationGraphApi,
} from './domains/papers.ts'
import type {
  WorkspacePapersApi,
  NotesApi,
  EvidenceSetsApi,
  OutputFeedbackApi,
  ReviewsApi,
  PapersApi,
  CitationGraphApi,
} from './domains/papers.ts'
import {
  createMediaCacheApi,
  createAsrWeightsApi,
  createPaperSearchApi,
  createRuntimeApi,
  createCapabilityPackApi,
} from './domains/media.ts'
import type {
  MediaCacheApi,
  AsrWeightsApi,
  PaperSearchApi,
  RuntimeApi,
  CapabilityPackApi,
} from './domains/media.ts'
import { createAuthApi, createOAuthApi } from './domains/auth.ts'
import type { AuthApi, OAuthApi } from './domains/auth.ts'

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
export function createDesktopApi(transport: PlatformTransport): ElectronAPI {
  return {
    ...createCoreApi(transport),
    ...createAgentApi(transport),
    zotero: createZoteroApi(transport),
    workspacePapers: createWorkspacePapersApi(transport),
    notes: createNotesApi(transport),
    evidenceSets: createEvidenceSetsApi(transport),
    outputFeedback: createOutputFeedbackApi(transport),
    reviews: createReviewsApi(transport),
    papers: createPapersApi(transport),
    citationGraph: createCitationGraphApi(transport),
    mediaCache: createMediaCacheApi(transport),
    asrWeights: createAsrWeightsApi(transport),
    paperSearch: createPaperSearchApi(transport),
    runtime: createRuntimeApi(transport),
    capabilityPack: createCapabilityPackApi(transport),
    auth: createAuthApi(transport),
    oauth: createOAuthApi(transport),
  } satisfies ElectronAPI
}
