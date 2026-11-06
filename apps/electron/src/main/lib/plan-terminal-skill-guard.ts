/**
 * createPlanTerminalSkillGuard —— general-query 检索报告 terminal_skill 的确定性护栏（issue #575）。
 *
 * 背景：lit-search 的「大主题检索」（intent = general-query）本应在 PLAN JSON 里携带条件
 *   `terminal_skill: { name: 'lit-search-report', condition: 'process_search_results.display_count >= 20' }`
 * 主 Agent 跑完 steps 后按条件调 lit-search-report skill 生成完整检索报告。但这条链路全靠两层
 * LLM 自觉：① scenario Agent（planner）每次输出 PLAN 时自觉写上该字段；② 主 Agent 自觉按 prompt
 * 协议（agent-prompt-builder.ts §"Scenario Agent PLAN dispatch protocol" 第 5 步）执行。运营实测
 * 两次出现 planner 漏写 → 报告整体不触发 → 用户交付物（报告）凭空消失。本 hook 用确定性代码兜住，
 * 分两层、主次分明：
 *
 *   - **主防线（PostToolUse on Task|Agent）**：scenario Agent 的 PLAN 作为 Task tool_result 返回时，
 *     若 intent === 'general-query' 且漏写 terminal_skill → 通过 `additionalContext` 给主 Agent 注入
 *     一段确定性构造的 terminal_skill 字段 + 执行指令。SDK 的 hook 无法改写 tool_result 本体
 *     （PostToolUseHookSpecificOutput 只给 additionalContext / updatedMCPToolOutput，后者仅对 MCP 工具，
 *     Task 是内置工具），additionalContext 是行为等效的「补标」——主 Agent 拿到的上下文因此永远完整。
 *     planner 已写 / 非 general-query / 解析失败 → 不注入。
 *   - **保险网（Stop hook）**：query 收尾时，若 planIntent === 'general-query' 且累计 display_count ≥ 阈值
 *     但 lit-search-report 始终未被调用 → `decision: 'block'` 强制主 Agent 立即补调，并落一条可定位日志。
 *     兜底是探测器——一旦触发即说明主防线或主 Agent 执行失效，日志让失效可见。保险网只看 intent，
 *     **不要求**主防线注入过：planner 写对了但主 Agent 漏执行的场景（dispatch protocol 执行端漏洞）同样被兜住。
 *
 * 归一化只针对 terminal_skill 这一个字段，不把整个 PLAN 协议代码化（那是 #517 范围）。
 *
 * 状态隔离：闭包绑 sessionId，每次 query 重新 assemble 即归零（retry / teams auto-resume 各起新实例）。
 * lit-search 的 PLAN → steps → Stop 全在同一 query 内完成，可接受此边界。
 *
 * 阈值常量 AUTO_REPORT_MIN_RESULTS = 20 在三处同值，改一处需同步：本文件、scenario prompt 的
 * `AUTO_REPORT_MIN_RESULTS`（default-capability-packs/lit-search/scenario/system-prompt.md）、
 * renderer 的 `REPORT_BUTTON_MIN_RESULTS`（SessionPapersToolbar.tsx）。
 */
import { SUBAGENT_TOOL_NAMES, isSubagentToolUse } from '@asci/shared'

/** 自动检索报告触发阈值（display_count）—— 与 scenario prompt / renderer 按钮三处同值 */
export const AUTO_REPORT_MIN_RESULTS = 20

/** 本 guard 专属的能力包 —— 只对 lit-search 的 general-query PLAN 生效，不波及 lit-review 等其他包 */
export const LIT_SEARCH_PACK_ID = 'lit-search'

/** 检索报告 Skill 名 */
export const REPORT_SKILL_NAME = 'lit-search-report'

/**
 * display_count 来源工具（paper-search MCP）。两条都要监听：
 *  - `retrieve`：现行主路径（searcher 唯一一次调用，服务端吞掉 process_search_results、自己返回 display_count）
 *  - `process_search_results`：逃生路径（retrieve 返回 error 时 searcher 降级到 search_papers + 它）
 * 两者 tool_response 同形（顶层 JSON 含 display_count），复用同一解析。多轮检索每轮各产一个，求和。
 */
export const RETRIEVE_TOOL = 'mcp__paper-search__retrieve'
export const PROCESS_SEARCH_RESULTS_TOOL = 'mcp__paper-search__process_search_results'
/** 二者集合，计数 hook 用（亦供 search-telemetry-hook 复用，统一"检索完成"工具口径） */
export const DISPLAY_COUNT_TOOLS: ReadonlySet<string> = new Set([RETRIEVE_TOOL, PROCESS_SEARCH_RESULTS_TOOL])

/** 子 Agent 派发工具的 matcher（CLI matcher 是正则）—— 收敛 SDK v2.1.63 前后的 Task / Agent 双名 */
const SUBAGENT_TOOL_MATCHER = SUBAGENT_TOOL_NAMES.join('|')

interface HookCallbackInput {
  hook_event_name: 'PostToolUse' | 'Stop'
  tool_name?: string
  tool_input?: unknown
  tool_response?: unknown
  /** 仅 subagent 内部工具调用时出现；本 guard 仅带进日志，计数不按 agent 过滤 */
  agent_type?: string
  /** Stop hook：SDK 因上一次 block 重入时为 true，用于防循环 */
  stop_hook_active?: boolean
}

interface HookEntry {
  matcher: string
  hooks: ((input: HookCallbackInput) => unknown)[]
}

export interface PlanTerminalSkillGuardHooks {
  PostToolUse: HookEntry[]
  Stop: HookEntry[]
}

/**
 * 判定某 subagent_type 是否为 lit-search 能力包的 scenario Agent。
 * 命中（lit-search 包 + role==='scenario'）返回 true，其余（非 subagent / 非该包 / worker / 未注册）返回 false。
 * 真实实现走 SubagentRegistry（见 run-orchestrator-query.ts 装配点）；测试注入 stub。
 */
export type LitSearchScenarioResolver = (subagentType: string) => boolean

/** 测试 / 监控用：读当前闭包状态快照。生产路径不应依赖（状态是闭包内部） */
export interface PlanTerminalSkillGuardState {
  /** 最近一个 PLAN 的 intent（last-PLAN-wins）；未见过 PLAN 时为 null */
  planIntent: string | null
  /** 本 query 主防线是否注入过 additionalContext（仅用于日志可定位性） */
  injected: boolean
  /** 累计 process_search_results 的 display_count（多轮求和，对齐面板累计语义） */
  displayCountSum: number
  /** lit-search-report 是否已被主 Agent 调用 */
  reportSkillInvoked: boolean
  /** 保险网是否已强制补调过（防 Stop 循环 block） */
  forced: boolean
}

/** 解析得到的 PLAN 关键字段（仅本 guard 关心的子集） */
export interface ParsedSearchPlan {
  intent: string
  hasTerminalSkill: boolean
  planSummary: {
    keywords: string[]
    sources: string[]
    method_terms: string[]
    object_terms: string[]
  }
}

/**
 * 从 Task tool_response 提取文本。
 *
 * SDK 的 Task 返回体是结构化 AgentOutput（sdk-tools.d.ts）：
 *   - completed 变体：`{ content: [{type:'text', text}], status:'completed', ... }`
 *   - async_launched 变体：无 content → 返回 null（无 PLAN 可解析）
 * MCP 工具（process_search_results）的 tool_response 同样是 `{ content: [{type:'text', text}], isError? }`。
 * string 兜底应对 SDK 版本差异。任何无法识别的形态返回 null（调用方据此跳过，不影响正常流程）。
 */
function extractTextFromToolResponse(response: unknown): string | null {
  if (typeof response === 'string') return response
  if (!response || typeof response !== 'object') return null
  const content = (response as { content?: unknown }).content
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
 * 从 scenario 回复文本里抽出 SEARCH PLAN 对象。
 *
 * 不能裸取首个 ```json fence —— scenario 回复可能含其他 fence。这里扫描全部 fence，
 * 逐个尝试解析，返回第一个「顶层对象且含 string 类型 intent 字段」的——比锚定标题更鲁棒
 * （PLAN 协议本身就以 intent 字段为识别特征）。
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

/**
 * Task tool_response → 解析后的 PLAN 关键字段，失败返回 null。导出供单测直接断言。
 */
export function extractSearchPlanFromTaskResponse(response: unknown): ParsedSearchPlan | null {
  const text = extractTextFromToolResponse(response)
  if (!text) return null
  const obj = extractSearchPlanObject(text)
  if (!obj) return null

  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

  return {
    intent: obj.intent as string,
    hasTerminalSkill:
      obj.terminal_skill != null &&
      typeof obj.terminal_skill === 'object' &&
      !Array.isArray(obj.terminal_skill),
    planSummary: {
      keywords: asStringArray(obj.keywords),
      sources: asStringArray(obj.sources),
      method_terms: asStringArray(obj.method_terms),
      object_terms: asStringArray(obj.object_terms),
    },
  }
}

/** 从 process_search_results tool_response 解析 display_count，非数字 / 解析失败返回 null */
function extractDisplayCount(response: unknown): number | null {
  const text = extractTextFromToolResponse(response)
  if (!text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const dc = (parsed as { display_count?: unknown }).display_count
  return typeof dc === 'number' ? dc : null
}

/** 确定性构造补标用的 terminal_skill 字段（outputLanguage 留主 Agent 按 Output Language directive 填） */
function buildTerminalSkillField(summary: ParsedSearchPlan['planSummary']): Record<string, unknown> {
  return {
    name: REPORT_SKILL_NAME,
    input: {
      plan_summary: {
        keywords: summary.keywords,
        sources: summary.sources,
        method_terms: summary.method_terms,
        object_terms: summary.object_terms,
      },
    },
    condition: `process_search_results.display_count >= ${AUTO_REPORT_MIN_RESULTS}`,
  }
}

/** 主防线注入的 additionalContext 文案（措辞对齐 PLAN dispatch protocol 第 5 步） */
function buildInjectionContext(terminalSkill: Record<string, unknown>): string {
  return [
    'Orchestration guard (deterministic): the SEARCH PLAN above is a `general-query` plan but omitted its `terminal_skill` field.',
    'Per the PLAN dispatch protocol (terminal-skill step), treat the PLAN as if it carried this `terminal_skill`:',
    '```json',
    JSON.stringify(terminalSkill, null, 2),
    '```',
    `After all steps complete, evaluate the condition against the ACTUAL process_search_results tool_results and invoke Skill(${REPORT_SKILL_NAME}) only when it holds (display_count >= ${AUTO_REPORT_MIN_RESULTS}); inject "outputLanguage" with the resolved reply language when you call it.`,
  ].join('\n')
}

/** 保险网强制补调的 block reason */
function buildForceReason(): string {
  return [
    `Orchestration guard: this general-query search produced >= ${AUTO_REPORT_MIN_RESULTS} display results but the terminal search report was never generated.`,
    `Invoke Skill(${REPORT_SKILL_NAME}) now to produce the report (inject "outputLanguage" with the reply language), then write your one-line summary.`,
  ].join(' ')
}

export function createPlanTerminalSkillGuard(
  sessionId: string,
  resolver: LitSearchScenarioResolver,
  /** 测试钩子：默认 console.warn；可注入以验证日志 */
  logger: (msg: string) => void = (m) => console.warn(m),
): PlanTerminalSkillGuardHooks & { readState: () => PlanTerminalSkillGuardState } {
  const state: PlanTerminalSkillGuardState = {
    planIntent: null,
    injected: false,
    displayCountSum: 0,
    reportSkillInvoked: false,
    forced: false,
  }

  // 主防线：scenario Agent 的 PLAN（Task tool_result）漏写 terminal_skill 时注入
  const onSubagentPost = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'PostToolUse') return {}
    if (!isSubagentToolUse({ name: input.tool_name })) return {}
    const subagentType = (input.tool_input as { subagent_type?: unknown } | undefined)?.subagent_type
    if (typeof subagentType !== 'string') return {}

    let isScenario = false
    try {
      isScenario = resolver(subagentType)
    } catch (error) {
      console.error('[plan-terminal-skill-guard] resolver 抛错（已 swallow）:', error)
      return {}
    }
    if (!isScenario) return {}

    const plan = extractSearchPlanFromTaskResponse(input.tool_response)
    if (!plan) {
      logger(
        `[plan-terminal-skill-guard session=${sessionId}] scenario(${subagentType}) 返回未解析出 SEARCH PLAN，跳过补标（不影响正常流程）`,
      )
      return {}
    }

    // 登记 intent（无论是否注入）—— last-PLAN-wins；保险网只看 intent，故只需记这一项
    if (state.planIntent !== null && state.planIntent !== plan.intent) {
      logger(
        `[plan-terminal-skill-guard session=${sessionId}] 同 query 出现多个 PLAN，intent 覆盖 ${state.planIntent} → ${plan.intent}`,
      )
    }
    state.planIntent = plan.intent

    // 注入判定：仅 general-query 且漏写时补标
    if (plan.intent !== 'general-query' || plan.hasTerminalSkill) return {}

    state.injected = true
    const terminalSkill = buildTerminalSkillField(plan.planSummary)
    logger(
      `[plan-terminal-skill-guard session=${sessionId}] general-query PLAN 漏写 terminal_skill，已注入补标（additionalContext）`,
    )
    return {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse' as const,
        additionalContext: buildInjectionContext(terminalSkill),
      },
    }
  }

  // 状态追踪：累计各轮 display_count（retrieve 主路径 + process_search_results 逃生路径；
  // 不按 agent 过滤——display_count 是服务端去重后的本轮新增展示数。逃生路径下 retrieve 返回 error 无
  // display_count → 不计，由 process_search_results 补上，不会双计）
  const onResultCountPost = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'PostToolUse') return {}
    if (!DISPLAY_COUNT_TOOLS.has(input.tool_name ?? '')) return {}
    const count = extractDisplayCount(input.tool_response)
    if (count != null) state.displayCountSum += count
    return {}
  }

  // 状态追踪：标记 lit-search-report 是否已被调用（被调用即视为已交付，不论 skill 成功失败，避免循环补调）
  const onSkillPost = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'PostToolUse') return {}
    if (input.tool_name !== 'Skill') return {}
    const skill = (input.tool_input as { skill?: unknown } | undefined)?.skill
    if (skill === REPORT_SKILL_NAME) state.reportSkillInvoked = true
    return {}
  }

  // 保险网：query 收尾时条件全真才强制补调
  const onStop = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'Stop') return {}
    if (input.stop_hook_active) return {} // SDK 已因上一次 block 重入 → 放行，防循环
    if (state.forced) return {} // 本 guard 已强制过 → 放行，防循环
    if (state.reportSkillInvoked) return {} // 报告已交付（理想路径）→ 放行
    if (state.planIntent !== 'general-query') return {} // 仅 general-query 兜底
    if (state.displayCountSum < AUTO_REPORT_MIN_RESULTS) return {} // 未达阈值不触发

    state.forced = true
    logger(
      `[plan-terminal-skill-guard session=${sessionId}] 保险网触发：general-query 累计 display_count=${state.displayCountSum} >= ${AUTO_REPORT_MIN_RESULTS} 但 ${REPORT_SKILL_NAME} 未被调用（本 query 主防线注入=${state.injected}）→ 强制补调`,
    )
    return { decision: 'block' as const, reason: buildForceReason() }
  }

  return {
    PostToolUse: [
      { matcher: SUBAGENT_TOOL_MATCHER, hooks: [onSubagentPost] },
      { matcher: RETRIEVE_TOOL, hooks: [onResultCountPost] },
      { matcher: PROCESS_SEARCH_RESULTS_TOOL, hooks: [onResultCountPost] },
      { matcher: 'Skill', hooks: [onSkillPost] },
    ],
    Stop: [{ matcher: '*', hooks: [onStop] }],
    readState: () => ({ ...state }),
  }
}
