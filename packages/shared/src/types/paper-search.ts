/**
 * Paper Search MCP 集成的共享类型与 IPC 通道常量
 *
 * paper-search 是内建 MCP，与 zotero/ocr/asr 一样由运行时拼接、不写盘。
 * 启用条件：uv 可用即自动启用（无独立 UI 开关）；用户配置仅限 API Key 等环境变量。
 */

export const PAPER_SEARCH_IPC_CHANNELS = {
  /** 获取 paper-search MCP 当前运行时可用性 */
  GET_STATUS: 'paper-search:get-status',
  /** 设置 paper-search 环境变量（API Key 等） */
  SET_ENV: 'paper-search:set-env',
  /** 获取 paper-search 环境变量配置 */
  GET_ENV: 'paper-search:get-env',
} as const

/** paper-search MCP 运行状态 */
export interface PaperSearchStatus {
  /** Python（uv）是否可用 —— 即 paper-search 是否实际可启用 */
  runtimeAvailable: boolean
}

/** paper-search 环境变量配置（用户可编辑的 API Key 等） */
export interface PaperSearchEnvConfig {
  /** Unpaywall 邮箱（OA PDF 解析必需） */
  unpaywall_email?: string
  /** Semantic Scholar API Key（可选，提高速率限制） */
  semantic_scholar_api_key?: string
  /** CORE API Key（可选，激活 CORE 数据源） */
  core_api_key?: string
  /** IEEE API Key（可选） */
  ieee_api_key?: string
}
