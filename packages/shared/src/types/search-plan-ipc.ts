/**
 * lit-search present_search_plan IPC 契约（检索方案确认组件 · issue #435）
 *
 * 流程（与 litreview present_directions 对称）：
 *  1. lit-search 场景 Agent 在规划轮收口阶段调用 `mcp__searchplan__present_search_plan` 工具
 *  2. 主进程 SDK MCP server tool handler 拦截 → 通过 agent event stream 发请求给 renderer
 *  3. renderer 渲染 ChoiceCard（方案分项 + 确认/调整/取消）→ 用户操作
 *  4. renderer 调 IPC 回填 → tool resolve → Agent 据此执行/重出方案/收口
 *
 * 与 ExitPlanMode / present_directions 异步等待模式对称。
 */

/**
 * IPC 通道常量
 *
 * - 请求走 **agent event stream**（type: 'search_plan_request'），不占独立 IPC channel
 * - 回填走独立 IPC channel（renderer → main）
 */
export const SEARCH_PLAN_IPC_CHANNELS = {
  /** renderer → main：用户已确认/调整/取消，回填 tool result（ipcRenderer.invoke） */
  RESPOND: 'search-plan:confirm-respond',
} as const

export type SearchPlanIpcChannel = (typeof SEARCH_PLAN_IPC_CHANNELS)[keyof typeof SEARCH_PLAN_IPC_CHANNELS]

/**
 * 单项检索方案（UI 友好裁剪自 lit-search SEARCH PLAN）
 *
 * 只保留用户可理解的检索维度；steps / stop_conditions / needs_closing_turn 等
 * 执行编排细节不进 UI。
 */
export interface SearchPlanProposal {
  /** 研究问题（一句话，作为卡片副标题） */
  researchQuestion: string
  /** 关键词（核心概念 + 同义词），分项 chips 展示 */
  keywords: string[]
  /** 目标源：openalex / crossref / arxiv ... */
  sources: string[]
  /** 方法词（可选，分项展示） */
  methodTerms?: string[]
  /** 对象词（可选，分项展示） */
  objectTerms?: string[]
  /** 时间范围（可选，年份） */
  timeRange?: { from?: number; to?: number }
  /** 目标数量（可选，对应 retrieve top_k / stop_conditions 概数） */
  targetCount?: number
}

/** present_search_plan 请求（main → renderer，走 agent event stream） */
export interface SearchPlanConfirmRequest {
  /** 请求 ID — 用于回填时匹配 */
  requestId: string
  /** 触发的 agent session ID */
  sessionId: string
  /** 拟定的检索方案 */
  plan: SearchPlanProposal
}

/** present_search_plan 响应（renderer → main） */
export type SearchPlanConfirmResponse =
  | { requestId: string; choice: 'confirm' }
  | { requestId: string; choice: 'adjust'; adjustment: string }
  | { requestId: string; choice: 'cancel' }
