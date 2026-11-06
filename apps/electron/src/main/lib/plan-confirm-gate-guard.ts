/**
 * createPlanConfirmGateGuard —— lit-search 检索确认门的确定性 harness 保证（issue #774，#517 路线 b 续）。
 *
 * 背景：lit-search 的 `general-query` / `citation-tracing` PLAN 必带顶层 `confirm` 字段，约定
 * **主 Agent**（orchestrator）在派发 `searcher` / `citation-explorer` 检索步**之前**先调
 * `mcp__searchplan__present_search_plan` 弹确认卡（ChoiceCard），用户 confirm 后才开检索。但这条链路
 * 全靠主 Agent 自觉遵守 PLAN dispatch protocol（agent-prompt-builder.ts §"Confirmation gate"）——
 * 弱模型（Kimi / flash）可能跳过确认门直接派 searcher，用户对「检索方向」的控制权就丢了。
 *
 * 本 guard 用确定性代码把这条红线兜住，对标 #590 的 plan-terminal-skill-guard，但方向相反：
 * #590 是「漏调终结 skill → 事后补」，本 guard 是「未过确认门 → 事前拦」。
 *
 *   - **arm（PostToolUse on Task|Agent）**：scenario Agent 的 PLAN 作为 Task tool_result 返回时，
 *     若是 lit-search scenario（resolver 判定）且 PLAN 含 `confirm` 字段 → `planHasConfirm = true`。
 *     **单调**：一旦本 query 见过含 confirm 的 PLAN，arm 不可再被后续 PLAN 清零。否则 adjust 回环里
 *     一个漏写 `confirm` 字段的 revised PLAN（弱模型漏字段恰是本 guard 要防的场景）会把 arm 降级成
 *     false → searcher 直接放行、确认门被绕过。降级即漏洞，故只升不降（issue #774 对抗审查定位）。
 *   - **确认门通过标记（PostToolUse on present_search_plan）**：tool_response 的 `choice === 'confirm'`
 *     → `confirmGatePassed = true`。`adjust`（重规划回环）/ `cancel`（取消）均**不**置真——确认门未通过。
 *   - **拦截（PreToolUse on Task|Agent）**：主 Agent 试图派发检索子 Agent（`searcher` /
 *     `citation-explorer`）时，若 `planHasConfirm && !confirmGatePassed` → `permissionDecision: 'deny'`
 *     并回注「先经确认门」指令。SDK 把 deny reason 喂回主 Agent，等价于「拦下 + 回注补调指令」。
 *
 * **范围（对标 #590）**：仅 lit-search 的确认门；
 *   - 只拦检索子 Agent（searcher / citation-explorer）；打分自 #745 起下沉为 score_window
 *     确定性工具，已无 scorer 子 Agent 派发可拦；
 *   - 不碰 terminal_skill（#590 已覆盖）；lit-review 另议。
 *
 * **happy path 零开销**：未 arm（无 confirm 字段，如 exact-lookup）或已通过确认门时，PreToolUse 只做
 * 一次内存布尔检查即放行——deepseek-pro 实测 0 跳门，本 guard 几乎不触发，对检索延迟无影响。
 *
 * **取消即停的兜底**：cancel 后 confirmGatePassed 恒为 false，本 query 内任何检索派发都被拦——
 * 即使主 Agent 行为异常也绝不会在用户取消后偷偷开检索。
 *
 * 状态隔离：闭包绑 sessionId，每次 query 重新 assemble 即归零（retry / teams auto-resume 各起新实例）。
 * lit-search 的 PLAN → confirm → 检索派发全在同一 query 内完成；同 session 的下一轮检索是新 query、
 * 新实例，需重新经过确认门——契合「每个新检索方向都要用户确认」的产品红线。
 */
import { SUBAGENT_TOOL_NAMES, isSubagentToolUse } from '@asci/shared'

/** present_search_plan 确认门工具名（in-process SDK MCP，见 search-plan-sdk-mcp.ts） */
export const PRESENT_SEARCH_PLAN_TOOL = 'mcp__searchplan__present_search_plan'

/**
 * 受确认门保护的「检索子 Agent」集合（lit-search 包的 worker 名）。
 *  - `searcher`：general-query 的检索执行步
 *  - `citation-explorer`：citation-tracing 的检索执行步
 * **不含 `scorer`**——打分自 #745 起下沉为 score_window 确定性工具，无子 Agent 派发。
 */
export const RETRIEVAL_SUBAGENTS: ReadonlySet<string> = new Set(['searcher', 'citation-explorer'])

/** 子 Agent 派发工具的 matcher（CLI matcher 是正则）—— 收敛 SDK Task / Agent 双名 */
const SUBAGENT_TOOL_MATCHER = SUBAGENT_TOOL_NAMES.join('|')

interface HookCallbackInput {
  hook_event_name: 'PreToolUse' | 'PostToolUse'
  tool_name?: string
  tool_input?: unknown
  tool_response?: unknown
}

interface HookEntry {
  matcher: string
  hooks: ((input: HookCallbackInput) => unknown)[]
}

export interface PlanConfirmGateGuardHooks {
  PreToolUse: HookEntry[]
  PostToolUse: HookEntry[]
}

/**
 * 判定某 subagent_type 是否为 lit-search 能力包的 scenario Agent（复用 #590 同款）。
 * 命中返回 true，其余（非 subagent / 非该包 / worker / 未注册）返回 false。
 * 真实实现走 SubagentRegistry（见 run-orchestrator-query.ts 装配点）；测试注入 stub。
 */
export type LitSearchScenarioResolver = (subagentType: string) => boolean

/** 测试 / 监控用：读当前闭包状态快照。生产路径不应依赖（状态是闭包内部） */
export interface PlanConfirmGateGuardState {
  /** 本 query 是否见过含 `confirm` 字段的 lit-search PLAN（arm 标志，单调：只升不降） */
  planHasConfirm: boolean
  /** present_search_plan 是否已返回 confirm（确认门通过） */
  confirmGatePassed: boolean
  /** 本 query 拦下的检索派发次数（仅日志 / 监控可定位性） */
  denials: number
}

/**
 * 从 tool_response 提取文本，兼容三种形态：
 *  - `string`：SDK 版本差异兜底
 *  - `{ content: [{type:'text',text}] }`：SDK 内置工具（如 Task）的结构化输出
 *  - `[{type:'text',text}]`：**in-process SDK MCP 工具**（如 `present_search_plan`）的响应——
 *    真机实测其 tool_response 顶层直接就是 content 数组，不再包一层 `.content`（#774 真机定位）。
 * 任何无法识别的形态返回 null（调用方据此跳过，不影响正常流程）。
 */
function extractTextFromToolResponse(response: unknown): string | null {
  if (typeof response === 'string') return response
  if (!response || typeof response !== 'object') return null
  // 顶层数组（in-process MCP）或 `.content` 数组（内置工具）统一取出 blocks 数组
  const content = Array.isArray(response) ? response : (response as { content?: unknown }).content
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text)
    }
  }
  return parts.length > 0 ? parts.join('') : null
}

/**
 * 从 scenario 回复文本里抽出 SEARCH PLAN 对象：扫描全部 ```json fence，返回第一个「顶层对象且含
 * string 类型 intent 字段」的（PLAN 协议以 intent 为识别特征，比锚定标题更鲁棒）。
 */
function extractSearchPlanObject(text: string): Record<string, unknown> | null {
  const fenceRe = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(text)) !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(m[1]!)
    } catch {
      continue
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof (parsed as { intent?: unknown }).intent === 'string'
    ) {
      return parsed as Record<string, unknown>
    }
  }
  return null
}

/** Task tool_response → PLAN 是否含 `confirm` 对象字段，失败 / 无 PLAN 返回 null（导出供单测断言） */
export function planHasConfirmField(response: unknown): boolean | null {
  const text = extractTextFromToolResponse(response)
  if (!text) return null
  const obj = extractSearchPlanObject(text)
  if (!obj) return null
  return obj.confirm != null && typeof obj.confirm === 'object' && !Array.isArray(obj.confirm)
}

/** present_search_plan tool_response → choice（'confirm' | 'adjust' | 'cancel'），解析失败返回 null */
export function extractConfirmChoice(response: unknown): string | null {
  const text = extractTextFromToolResponse(response)
  if (!text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const choice = (parsed as { choice?: unknown }).choice
  return typeof choice === 'string' ? choice : null
}

/**
 * 连续 deny 到此阈值后，把回注文案升级为「终止指令」——防止主 Agent 被 deny 后死命重试 searcher
 * 而不补调 present_search_plan 造成的空转（每次重试空烧一个 turn + 累积 reason 进上下文）。
 * 门**始终保持关闭**（升级的只是文案，绝不翻成放行），只是给 Agent 一个明确的退出：停止重试、
 * 把「需你先确认检索方案」转达给用户（贴合 CLAUDE.md「错误必须可见」）。
 */
export const DENY_ESCALATION_THRESHOLD = 3

/** 拦截时回注给主 Agent 的 deny reason（英文，对齐内置 prompt 语言约定 / #590 注入文案） */
function buildDenyReason(subagentType: string): string {
  return [
    'Orchestration guard (deterministic): this lit-search PLAN declares a `confirm` field, so the user MUST approve the search strategy before any retrieval runs.',
    `You attempted to dispatch the \`${subagentType}\` retrieval sub-agent, but \`${PRESENT_SEARCH_PLAN_TOOL}\` has not returned a \`confirm\` yet.`,
    `Call \`${PRESENT_SEARCH_PLAN_TOOL}\` with the PLAN's \`confirm.input\` first, and dispatch retrieval only after the user confirms.`,
    '(adjust → re-Task the scenario Agent for a revised PLAN and re-present; cancel → run no search and end the round with a brief one-line note.)',
  ].join(' ')
}

/**
 * 连续 deny 到阈值后的升级文案：止住「反复重试 searcher」的空转，给 Agent 终止性指令。
 * 门仍关闭（retrieval 仍被拦），但要求 Agent 停止重试并把待确认状态转达给用户。
 */
function buildEscalatedDenyReason(subagentType: string, denials: number): string {
  return [
    `Orchestration guard (deterministic): you have attempted to dispatch retrieval (\`${subagentType}\`) ${denials} times without passing the confirmation gate.`,
    '**STOP retrying** — repeating the dispatch will keep being denied and wastes turns.',
    `Either call \`${PRESENT_SEARCH_PLAN_TOOL}\` exactly once and wait for the user, OR if you cannot, end your turn now and tell the user (in their language): the search plan needs their confirmation before any retrieval can run.`,
  ].join(' ')
}

export function createPlanConfirmGateGuard(
  sessionId: string,
  resolver: LitSearchScenarioResolver,
  /** 测试钩子：默认 console.warn；可注入以验证日志 */
  logger: (msg: string) => void = (m) => console.warn(m),
): PlanConfirmGateGuardHooks & { readState: () => PlanConfirmGateGuardState } {
  const state: PlanConfirmGateGuardState = {
    planHasConfirm: false,
    confirmGatePassed: false,
    denials: 0,
  }

  // arm：lit-search scenario PLAN 含 confirm 字段时置位（last-PLAN-wins）
  const onScenarioPost = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'PostToolUse') return {}
    if (!isSubagentToolUse({ name: input.tool_name })) return {}
    const subagentType = (input.tool_input as { subagent_type?: unknown } | undefined)?.subagent_type
    if (typeof subagentType !== 'string') return {}

    let isScenario = false
    try {
      isScenario = resolver(subagentType)
    } catch (error) {
      console.error('[plan-confirm-gate-guard] resolver 抛错（已 swallow）:', error)
      return {}
    }
    if (!isScenario) return {}

    const hasConfirm = planHasConfirmField(input.tool_response)
    if (hasConfirm === null) {
      // 解析不出 PLAN（async_launched / 形态异常）→ 不改 arm 状态，不影响正常流程
      return {}
    }
    // 单调 arm：只在「首次见到含 confirm 的 PLAN」时升起，永不被后续漏写 confirm 的 PLAN 降级清零。
    // 漏写 confirm 的 PLAN（hasConfirm=false）不改变已 armed 状态——否则 adjust 回环里弱模型漏字段会绕过门。
    if (hasConfirm && !state.planHasConfirm) {
      state.planHasConfirm = true
      logger(
        `[plan-confirm-gate-guard session=${sessionId}] scenario(${subagentType}) PLAN 含 confirm 字段 → arm（确认门启用）`,
      )
    }
    return {}
  }

  // 确认门通过标记：present_search_plan 返回 confirm 时置真（adjust / cancel 不置）
  const onConfirmPost = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'PostToolUse') return {}
    if (input.tool_name !== PRESENT_SEARCH_PLAN_TOOL) return {}
    const choice = extractConfirmChoice(input.tool_response)
    if (choice === 'confirm') {
      state.confirmGatePassed = true
      logger(`[plan-confirm-gate-guard session=${sessionId}] 确认门通过（choice=confirm）→ 放行检索派发`)
    } else if (choice != null) {
      logger(`[plan-confirm-gate-guard session=${sessionId}] 确认门未通过（choice=${choice}）→ 检索派发继续被拦`)
    }
    return {}
  }

  // 拦截：未过确认门时 deny 检索子 Agent 派发
  const onDispatchPre = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'PreToolUse') return {}
    if (!isSubagentToolUse({ name: input.tool_name })) return {}
    const subagentType = (input.tool_input as { subagent_type?: unknown } | undefined)?.subagent_type
    if (typeof subagentType !== 'string' || !RETRIEVAL_SUBAGENTS.has(subagentType)) return {}
    // 未 arm（PLAN 无 confirm，如 exact-lookup）或已通过确认门 → 放行（happy path 零开销）
    if (!state.planHasConfirm || state.confirmGatePassed) return {}

    state.denials += 1
    // 门始终关闭；连续 deny 到阈值后只把文案升级为终止指令，止住空转（绝不翻成放行）
    const escalated = state.denials >= DENY_ESCALATION_THRESHOLD
    logger(
      `[plan-confirm-gate-guard session=${sessionId}] 拦截检索派发：subagent=${subagentType}，确认门未通过（denials=${state.denials}${escalated ? '，已升级为终止指令' : ''}）→ deny`,
    )
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse' as const,
        permissionDecision: 'deny' as const,
        permissionDecisionReason: escalated
          ? buildEscalatedDenyReason(subagentType, state.denials)
          : buildDenyReason(subagentType),
      },
    }
  }

  return {
    PreToolUse: [{ matcher: SUBAGENT_TOOL_MATCHER, hooks: [onDispatchPre] }],
    PostToolUse: [
      { matcher: SUBAGENT_TOOL_MATCHER, hooks: [onScenarioPost] },
      { matcher: PRESENT_SEARCH_PLAN_TOOL, hooks: [onConfirmPost] },
    ],
    readState: () => ({ ...state }),
  }
}
