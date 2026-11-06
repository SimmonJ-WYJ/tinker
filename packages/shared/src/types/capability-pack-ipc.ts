/**
 * 能力包管理 IPC 契约（0.3 Epic 2 / spec §6 能力包基础设施 · Codex 风开箱即用）
 *
 * 本文件**仅**承载"配置页 → 能力包板块"前后端通讯，**不**触碰对象层 / Proposal Repository。
 *
 * 范围（#414 CP-6）：能力包默认启用、不可禁用、不导入/卸载，板块为**只读展示**。
 * 因此仅保留 list（只读枚举），无 toggle / import / uninstall 通道。
 */

/** 能力包 IPC 通道常量集合 */
export const CAPABILITY_PACK_IPC_CHANNELS = {
  /** 枚举所有已安装能力包（scenarioAgent 名、skill / mcp 引用、manifest 校验状态）。只读。 */
  LIST: 'capability-pack:list',
} as const

export type CapabilityPackIpcChannel =
  (typeof CAPABILITY_PACK_IPC_CHANNELS)[keyof typeof CAPABILITY_PACK_IPC_CHANNELS]

/**
 * 能力包列表项（list 响应单元）
 *
 * 字段映射规则（main 端 capability-pack-service 派生，UI 不直接耦合 manifest schema）：
 * - packId            → manifest.packId（== 目录名）
 * - version           → manifest.version
 * - scenarioAgentName → manifest.scenarioAgent.name
 * - skillRefs         → manifest.skillRefs
 * - mcpRefs           → manifest.mcpRefs
 * - manifestValid     → zod safeParse 结果
 *
 * 注：能力包恒为启用（Codex 风不可禁用），故无 `enabled` 字段。
 */
export interface CapabilityPackListItem {
  /** 包唯一标识，对应目录名（同 manifest.packId） */
  packId: string
  /** 版本号 */
  version: string
  /** 场景 Agent 名（manifest.scenarioAgent.name） */
  scenarioAgentName: string
  // 安全边界 #710：刻意不暴露 scenarioAgent.description（写给 LLM 的路由 prompt 全文，L3）——
  // 根本原则「发到 renderer 的数据视同用户可见」。UI 仅消费 summaryI18n；routing prompt 留 main/loader 内部。
  /** 引用的 Skill slug 列表（manifest.skillRefs） */
  skillRefs: string[]
  /** 引用的 MCP 名列表（manifest.mcpRefs） */
  mcpRefs: string[]
  /** manifest 加载是否成功；false 表示 manifest 校验失败（仍在列表中可见但场景能力不可用） */
  manifestValid: boolean
  /** manifest 校验失败时的错误信息（manifestValid === false 时填） */
  manifestError?: string
  /** 面向用户的一句话能力摘要（manifest.summaryI18n）；UI 取 summaryI18n[lang] ?? summaryI18n[other]，缺失则中性占位（不回退 routing prompt） */
  summaryI18n?: { zh?: string; en?: string }
}

/** list 请求无参数 */
export type CapabilityPackListRequest = void

/** list 响应：包列表 */
export interface CapabilityPackListResponse {
  packs: CapabilityPackListItem[]
}
