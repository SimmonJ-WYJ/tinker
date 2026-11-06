/**
 * lit-review fact-checker 后置核查保险网（issue #517 / #668）
 *
 * 背景：lit-review 综述由终产物环节写出 `reviews/*.html` 后，`fact-checker` 应作为 PLAN 的
 *   `post_terminal_step` 审计该综述。但 post_terminal_steps 的派发仍是 prompt 驱动——在上下文压力下
 *   模型仍可能跳过它（issue #517 实测 0/55、#668 复测 0/45 session 派发）。本 guard 提供**运行时硬保证**：
 *
 *   - PostToolUse 追踪：① 综述终产物是否已产出；② `fact-checker` 子 Agent 是否被 Task 派发。
 *   - Stop 收尾时若「综述已产出 且 fact-checker 未派发」→ `decision: 'block'` + 注入 reason，
 *     强制主 Agent 立即按 post_terminal_step 契约补派 fact-checker，并落一条可定位日志。
 *
 * 「综述已产出」武装信号（issue #668）：#679 把综述正文从主层 `terminal_skill` 搬进了 `body-writer`
 *   子 Agent（在其隔离上下文里调 `literature-review-result` Skill 写 HTML）。为不依赖内层 Skill 调用
 *   是否冒泡到主 query hook，本 guard 以 **body-writer 子 Agent 派发**（主层 Task，必然可见）为首要武装
 *   信号；同时保留对内层 `literature-review-result` Skill 调用的观察作为冗余信号（SDK 对子 Agent 内部
 *   工具调用同样触发主 query PostToolUse 并带 agent_id，本 guard 不按 agent_id 过滤）。两信号任一命中即武装。
 *
 * 与 `plan-terminal-skill-guard`（#575，lit-search 专用）同构：同样的 hook 形态、同样的防循环
 * （`forced` + `stop_hook_active`）。两个武装信号（body-writer 子 Agent 名 + lit-review 专属 terminal skill 名）
 * 都天然 pack-scoped，无需 scenario resolver。
 */

import { SUBAGENT_TOOL_NAMES, isSubagentToolUse } from '@asci/shared'

/** lit-review 终产物 Skill —— 它被调用即代表综述 HTML 已写出（#679 后在 body-writer 子 Agent 内调用，作冗余武装信号） */
export const REVIEW_TERMINAL_SKILL = 'literature-review-result'
/** 后置核查子 Agent 名（PLAN 的 post_terminal_steps[].subagent_type） */
export const FACT_CHECKER_SUBAGENT = 'fact-checker'
/** 综述正文终产物子 Agent 名（PLAN 的 terminal_subagent.name，#679 引入）—— 其派发是「综述已产出」的主层可靠信号 */
export const BODY_WRITER_SUBAGENT = 'body-writer'

/** 子 Agent 派发工具的 matcher（CLI matcher 是正则）—— 收敛 SDK 前后版本的 Task / Agent 双名 */
const SUBAGENT_TOOL_MATCHER = SUBAGENT_TOOL_NAMES.join('|')

interface HookCallbackInput {
  hook_event_name: 'PostToolUse' | 'Stop'
  tool_name?: string
  tool_input?: unknown
  /** 仅子 Agent 内部工具调用时出现（SDK 用它标记来源）；本 guard 不按它过滤，仅说明内层 Skill 信号同样可见 */
  agent_id?: string
  /** Stop hook：SDK 因上一次 block 重入时为 true，用于防循环 */
  stop_hook_active?: boolean
}

interface HookEntry {
  matcher: string
  hooks: ((input: HookCallbackInput) => unknown)[]
}

export interface LitReviewFactcheckGuardHooks {
  PostToolUse: HookEntry[]
  Stop: HookEntry[]
}

/** 测试 / 监控用：读当前闭包状态快照。生产路径不应依赖（状态是闭包内部） */
export interface LitReviewFactcheckGuardState {
  /** body-writer 终产物子 Agent 是否被派发（#679 后「综述已产出」的主层可靠武装信号） */
  bodyWriterDispatched: boolean
  /** `literature-review-result` Skill 是否被调用（冗余武装信号；#679 后在 body-writer 子 Agent 内触发） */
  reviewSkillInvoked: boolean
  /** fact-checker 子 Agent 是否被 Task 派发 */
  factCheckerDispatched: boolean
  /** 保险网是否已强制补派过（防 Stop 循环 block） */
  forced: boolean
}

/** 保险网强制补派的 block reason（措辞对齐 PLAN dispatch protocol 的 post_terminal_steps 步 + fact-checker.md §4.5） */
function buildForceReason(): string {
  return [
    `Orchestration guard (deterministic): the lit-review terminal producer (${BODY_WRITER_SUBAGENT} via the ${REVIEW_TERMINAL_SKILL} skill) wrote the review, but the ${FACT_CHECKER_SUBAGENT} post_terminal_step never ran — the review is unverified.`,
    `Dispatch Task(subagent_type=${FACT_CHECKER_SUBAGENT}) NOW to audit the written reviews/*.html:`,
    `the dispatch MUST carry an EXPLICIT per-section claim-level signal ("Run a per-section claim-level check and EMIT the claims[] JSON"), the review HTML path, and a note that evidence rows live in .context/*.evidence.json.`,
    `Then write your one-line summary with the REAL fact-check figures from its claims[] JSON (never a "<…>" placeholder).`,
  ].join(' ')
}

/**
 * 为指定 agent session 创建一个 lit-review fact-checker 后置核查保险网。
 *
 * @param sessionId 当前 agent session ID（仅用于日志可定位性）
 * @param logger 测试钩子：默认 console.warn；可注入以验证日志
 */
export function createLitReviewFactcheckGuard(
  sessionId: string,
  logger: (msg: string) => void = (m) => console.warn(m),
): LitReviewFactcheckGuardHooks & { readState: () => LitReviewFactcheckGuardState } {
  const state: LitReviewFactcheckGuardState = {
    bodyWriterDispatched: false,
    reviewSkillInvoked: false,
    factCheckerDispatched: false,
    forced: false,
  }

  // 「综述已产出」= body-writer 已派发 或 literature-review-result Skill 已调用（两信号任一命中即武装）
  const reviewProduced = (): boolean => state.bodyWriterDispatched || state.reviewSkillInvoked

  // 追踪（冗余信号）：`literature-review-result` Skill 被调用 → 综述已产出。
  // #679 后该调用发生在 body-writer 子 Agent 内；SDK 仍会触发主 query 的 PostToolUse（带 agent_id），本 guard 不按 agent_id 过滤。
  const onSkillPost = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'PostToolUse') return {}
    if (input.tool_name !== 'Skill') return {}
    const skill = (input.tool_input as { skill?: unknown } | undefined)?.skill
    if (skill === REVIEW_TERMINAL_SKILL) state.reviewSkillInvoked = true
    return {}
  }

  // 追踪：① body-writer 终产物子 Agent 派发 → 综述已产出（主层可靠武装信号）；
  //       ② fact-checker 子 Agent 派发（不论成功失败，派了即视为已履约，避免循环补派）。
  const onSubagentPost = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'PostToolUse') return {}
    if (!isSubagentToolUse({ name: input.tool_name })) return {}
    const subagentType = (input.tool_input as { subagent_type?: unknown } | undefined)?.subagent_type
    if (subagentType === BODY_WRITER_SUBAGENT) state.bodyWriterDispatched = true
    if (subagentType === FACT_CHECKER_SUBAGENT) state.factCheckerDispatched = true
    return {}
  }

  // 保险网：query 收尾时「综述已产出 且 fact-checker 未派发」→ 强制补派
  const onStop = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'Stop') return {}
    if (input.stop_hook_active) return {} // SDK 已因上一次 block 重入 → 放行，防循环
    if (state.forced) return {} // 本 guard 已强制过 → 放行，防循环
    if (!reviewProduced()) return {} // 综述未产出（非 lit-review 写作 turn / body-writer 未派发）→ 不触发
    if (state.factCheckerDispatched) return {} // fact-checker 已派发（理想路径）→ 放行

    state.forced = true
    const armedBy = state.bodyWriterDispatched ? BODY_WRITER_SUBAGENT : REVIEW_TERMINAL_SKILL
    logger(
      `[lit-review-factcheck-guard session=${sessionId}] 保险网触发：综述已产出（${armedBy}）但 ${FACT_CHECKER_SUBAGENT} 未派发 → 强制补派`,
    )
    return { decision: 'block' as const, reason: buildForceReason() }
  }

  return {
    PostToolUse: [
      { matcher: 'Skill', hooks: [onSkillPost] },
      { matcher: SUBAGENT_TOOL_MATCHER, hooks: [onSubagentPost] },
    ],
    Stop: [{ matcher: '*', hooks: [onStop] }],
    readState: () => ({ ...state }),
  }
}
