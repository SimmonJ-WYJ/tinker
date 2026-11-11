/**
 * Preload · media domain 片段
 *
 * 媒体识别缓存（mediaCache）、ASR 权重下载（asrWeights）、Paper Search MCP 集成
 * （paperSearch）、内置 4 工具 runtime 校验（runtime）、能力包管理（capabilityPack）。
 * 每个 namespace 各导出一个独立类型化片段。
 */
import type { PlatformTransport } from '../transport.ts'
import {
  MEDIA_IPC_CHANNELS,
  ASR_WEIGHTS_IPC_CHANNELS,
  RUNTIME_PROVISIONER_IPC_CHANNELS,
  PAPER_SEARCH_IPC_CHANNELS,
  CAPABILITY_PACK_IPC_CHANNELS,
} from '@asci/shared'
import type {
  MediaCacheStats,
  AsrWeightStatus,
  RuntimeProvisionerStatus,
  PaperSearchStatus,
  PaperSearchEnvConfig,
} from '@asci/shared'
import type { CapabilityPackListResponse } from '@asci/shared'
import { subscribe } from '../helpers.ts'

// ===== 媒体识别缓存 =====
export interface MediaCacheApi {
  /** 读取 ~/.asci/cache/zotero-media 的条目数 + 总字节数 */
  stats: () => Promise<MediaCacheStats>
  /** 清空整个 zotero-media 缓存目录 */
  clear: () => Promise<{ filesRemoved: number; bytesFreed: number }>
}

// ===== ASR 权重下载 =====
export interface AsrWeightsApi {
  /** 取当前状态（missing / downloading / extracting / ready / error + progress） */
  getStatus: () => Promise<AsrWeightStatus>
  /** 触发下载（幂等）。立即返回当前状态；实际进度通过 onStatusChanged 推送 */
  download: () => Promise<AsrWeightStatus>
  /** 取消下载 / 解压 */
  cancel: () => Promise<AsrWeightStatus>
  /** 删除已下载的权重 */
  delete: () => Promise<AsrWeightStatus>
  /** 订阅状态变更；返回取消订阅函数 */
  onStatusChanged: (cb: (status: AsrWeightStatus) => void) => () => void
}

// ===== Paper Search MCP 集成 =====
// paper-search 无独立总开关：uv 可用即自动启用（commit ef28c94）。
export interface PaperSearchApi {
  /** 获取当前 runtime 可用性（uv 是否就绪） */
  getStatus: () => Promise<PaperSearchStatus>
  /** 获取环境变量配置（API Key 等） */
  getEnv: () => Promise<PaperSearchEnvConfig>
  /** 保存环境变量配置 */
  setEnv: (config: PaperSearchEnvConfig) => Promise<void>
}

// ===== 内置 4 工具 runtime 校验 =====
export interface RuntimeApi {
  /** 查询 RuntimeProvisioner 校验状态 */
  getStatus: () => Promise<RuntimeProvisionerStatus>
  /** 订阅校验状态变更；返回取消订阅函数 */
  onStatusChanged: (cb: (status: RuntimeProvisionerStatus) => void) => () => void
}

/** 能力包管理（配置页 → 能力包板块 · Codex 风只读展示，#414 CP-6） */
export interface CapabilityPackApi {
  /** 枚举已安装能力包（manifest 校验状态）。只读：不可禁用/导入/卸载，故无 toggle。 */
  list: () => Promise<CapabilityPackListResponse>
}

// 媒体识别缓存
export function createMediaCacheApi(transport: PlatformTransport): MediaCacheApi {
  return {
    stats: (): Promise<MediaCacheStats> => transport.invoke(MEDIA_IPC_CHANNELS.CACHE_STATS),
    clear: (): Promise<{ filesRemoved: number; bytesFreed: number }> => transport.invoke(MEDIA_IPC_CHANNELS.CACHE_CLEAR),
  }
}

// ASR 权重下载
export function createAsrWeightsApi(transport: PlatformTransport): AsrWeightsApi {
  return {
    getStatus: (): Promise<AsrWeightStatus> =>
      transport.invoke(ASR_WEIGHTS_IPC_CHANNELS.GET_STATUS),
    download: (): Promise<AsrWeightStatus> =>
      transport.invoke(ASR_WEIGHTS_IPC_CHANNELS.DOWNLOAD),
    cancel: (): Promise<AsrWeightStatus> =>
      transport.invoke(ASR_WEIGHTS_IPC_CHANNELS.CANCEL),
    delete: (): Promise<AsrWeightStatus> =>
      transport.invoke(ASR_WEIGHTS_IPC_CHANNELS.DELETE),
    onStatusChanged: (cb: (status: AsrWeightStatus) => void): (() => void) => {
      return subscribe(transport, ASR_WEIGHTS_IPC_CHANNELS.STATUS_CHANGED, cb)
    },
  }
}

// Paper Search MCP 集成（无总开关，uv 可用即自动启用）
export function createPaperSearchApi(transport: PlatformTransport): PaperSearchApi {
  return {
    getStatus: (): Promise<PaperSearchStatus> =>
      transport.invoke(PAPER_SEARCH_IPC_CHANNELS.GET_STATUS),
    getEnv: (): Promise<PaperSearchEnvConfig> =>
      transport.invoke(PAPER_SEARCH_IPC_CHANNELS.GET_ENV),
    setEnv: (config: PaperSearchEnvConfig): Promise<void> =>
      transport.invoke(PAPER_SEARCH_IPC_CHANNELS.SET_ENV, config),
  }
}

// 内置 4 工具 runtime 校验
export function createRuntimeApi(transport: PlatformTransport): RuntimeApi {
  return {
    getStatus: (): Promise<RuntimeProvisionerStatus> =>
      transport.invoke(RUNTIME_PROVISIONER_IPC_CHANNELS.GET_STATUS),
    onStatusChanged: (cb: (status: RuntimeProvisionerStatus) => void): (() => void) => {
      return subscribe(transport, RUNTIME_PROVISIONER_IPC_CHANNELS.STATUS_CHANGED, cb)
    },
  }
}

// 能力包管理（配置页 → 能力包板块 · Codex 风只读展示，#414 CP-6）
export function createCapabilityPackApi(transport: PlatformTransport): CapabilityPackApi {
  return {
    list: (): Promise<CapabilityPackListResponse> =>
      transport.invoke(CAPABILITY_PACK_IPC_CHANNELS.LIST),
  }
}
