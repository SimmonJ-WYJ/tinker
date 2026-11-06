/**
 * lit-review present_directions IPC 契约（spec §5.4 Turn 1 方向选择）
 *
 * 流程：
 *  1. lit-review 场景 Agent 在 Turn 1 收口阶段调用 `mcp__litreview__present_directions` 工具
 *  2. 主进程 SDK MCP server tool handler 拦截调用 → 通过 IPC 发请求给 renderer
 *  3. renderer 渲染 ChoiceCardShell + 方向卡片 → 用户选择
 *  4. renderer 调 IPC 回填 → tool resolve → Agent 进入 Turn 2 综述生成
 *
 * 与 ExitPlanMode 异步等待模式对称（agent-exit-plan-service.ts）。
 */

/**
 * IPC 通道常量
 *
 * 模式与 ExitPlanMode 对称：
 * - 请求走 **agent event stream**（type: 'litreview_present_directions_request'），不占独立 IPC channel
 * - 回填走独立 IPC channel（renderer → main）
 */
export const LITREVIEW_IPC_CHANNELS = {
  /** renderer → main：用户已选择，回填 tool result（ipcRenderer.invoke） */
  RESPOND: 'litreview:present-directions-respond',
} as const

export type LitReviewIpcChannel = (typeof LITREVIEW_IPC_CHANNELS)[keyof typeof LITREVIEW_IPC_CHANNELS]

/**
 * 单个候选综述方向
 *
 * 字段与 spec §3.4 / 编排说明 lit-review 文档 ChoiceCard 渲染数据对齐。
 */
export interface LitReviewDirection {
  /** 选项 key — '1' / '2' / '3' */
  key: '1' | '2' | '3'
  /** 方向标题（短，作为卡片头） */
  title: string
  /** 一句话主张 */
  thesis: string
  /** 6 章 outline 标题 */
  outlinePreview: string[]
  /** 范围内论文 handle 列表（用于 Turn 2 派活时传给 synthesizer） */
  papersInScope: string[]
  /** 论文总数 / 含全文数（用于卡片角标显示） */
  paperCount: number
  paperWithFulltextCount: number
}

/** present_directions 请求（main → renderer） */
export interface LitReviewPresentDirectionsRequest {
  /** 请求 ID — 用于回填时匹配 */
  requestId: string
  /** 触发的 agent session ID */
  sessionId: string
  /** 3 个候选方向 */
  directions: LitReviewDirection[]
  /** "reroll" 按钮文案（默认 "都不满意，再来一组" / "Try another set"） */
  rerollLabel?: string
  /** "custom" 按钮文案（默认 "我自己写方向" / "Write my own direction"） */
  customLabel?: string
  /** "comprehensive" 按钮文案（默认 "全面综述（覆盖全部论文）" / "Comprehensive review"） */
  comprehensiveLabel?: string
  /**
   * "comprehensive" 按钮说明文案（默认走卡片 i18n = UI 语言）。
   * 由场景 Agent 按**本轮回复语言**传入，使其与方向 1/2/3 文案语言一致；
   * 缺省时卡片回退到 `t('agent.litReviewDirections.comprehensiveDescription')`（UI 语言）。
   */
  comprehensiveDescription?: string
}

/** present_directions 响应（renderer → main） */
export type LitReviewPresentDirectionsResponse =
  | { requestId: string; choice: '1' | '2' | '3' }
  /** 全面综述：不收敛到单方向，对整个 EvidenceSet 做全景综述 */
  | { requestId: string; choice: 'comprehensive' }
  | { requestId: string; choice: 'reroll' }
  | { requestId: string; choice: 'custom'; customDirection: string }
  | { requestId: string; choice: 'cancel' }
