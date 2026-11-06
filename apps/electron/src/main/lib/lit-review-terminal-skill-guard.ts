/**
 * lit-review 终结 skill 缺失保险网（P0：补齐 lit-review 侧"强制补调 terminal_skill"的确定性兜底）
 *
 * 背景：lit-review 综述流水线的最后一步——调用 terminal_skill `literature-review-result` 写出
 *   `reviews/*.html`——是整条链路上**唯一一个纯靠 prompt 自觉、没有任何确定性代码兜底**的环节。
 *   对照 lit-search：`plan-terminal-skill-guard`（#575）在报告未生成时会 Stop 强制补调 `lit-search-report`；
 *   而 lit-review 一侧的两个 guard 全是「终结 skill 之后」才生效——`lit-review-factcheck-guard`（#517）
 *   只在综述已写出时补 fact-checker，`lit-review-structure-lint-guard` 只在写综述时校验引用结构。
 *   一旦主 Agent 在「证据已齐、该写综述」处结束回合却没调 `literature-review-result`，没有任何东西把它
 *   拽回来 → 综述永不生成、`reviews/` 目录都不存在，流程静默停住（实测卡死现象）。本 guard 补上对称的
 *   那一道闸。
 *
 * 与 lit-search 的关键差异 —— **跨 query 状态**：
 *   lit-search 的「PLAN → steps → Stop」全在同一 query 内完成，故 `plan-terminal-skill-guard` 用 per-query
 *   闭包即可。但 lit-review 的 reader 是**后台 fan-out、跨多个 query（auto-resume）完成**的：派发 reader 的
 *   query 与「该写综述却没写」的 resume query 不是同一个，而 `assembleQueryOptions` 每个 query 重建一套全新
 *   hook 闭包。所以本 guard 的「armed（综述待生成）」标志必须**跨 query 存活**——用一个按 sessionId 索引的
 *   进程内 store 承载（可注入，便于单测隔离）。这避免改 `packages/shared` 的 AgentSessionMeta 类型，把改动
 *   收敛在 apps/electron 一个包内；代价是不跨进程重启存活——被重启打断的 lit-review 流程主 Agent 会重新规划，
 *   可接受。
 *
 * 三段逻辑：
 *   - **Arm（跨 query，写 store）**：观察到 lit-review 生成阶段的 worker 子 Agent（reader / evidence-triager
 *     / evidence-skimmer）被派发 → 标记本 session「综述终结 skill 待调用」。这些 worker 只在生成阶段出现，
 *     比解析 PLAN JSON 更鲁棒；Turn-1 方向提案阶段不会派它们，故不会误武装。
 *   - **Disarm（写 store）**：`literature-review-result` 被调用 → 清除标志（综述已交付）。
 *   - **保险网（Stop）**：armed 且「本 query 没调终结 skill」且「本 query 没派任何子 Agent」→ `decision:'block'`
 *     强制主 Agent 立即补调。"本 query 没派子 Agent" 这道闸天然区分两种回合：派 reader 的回合（worker 在途，
 *     放行）vs 该收口的 resume 回合（强制）；同时 fact-checker 这类后置派发发生在终结 skill 之后（彼时已 disarm），
 *     也不会被误判。
 *
 * 防循环与 `lit-review-factcheck-guard` / `plan-terminal-skill-guard` 同构：`stop_hook_active`（SDK 因上次
 *   block 重入）+ 本 query `forced` 标志双保险。
 */

import { SUBAGENT_TOOL_NAMES, isSubagentToolUse } from '@asci/shared'
import { REVIEW_TERMINAL_SKILL } from './lit-review-factcheck-guard.ts'

export { REVIEW_TERMINAL_SKILL }

/**
 * lit-review 生成阶段的 worker 子 Agent —— 它们被派发即代表「正在为综述收集证据」，一旦出现就 arm 本 guard
 * （综述终结 skill 此后必须被调用）。这些只在生成阶段出现，Turn-1 方向提案（review-proposer）不在内，避免误武装。
 */
export const REVIEW_WORKER_SUBAGENTS: ReadonlySet<string> = new Set([
  'reader',
  'evidence-triager',
  'evidence-skimmer',
])

/** 子 Agent 派发工具的 matcher（CLI matcher 是正则）—— 收敛 SDK 前后版本的 Task / Agent 双名 */
const SUBAGENT_TOOL_MATCHER = SUBAGENT_TOOL_NAMES.join('|')

interface HookCallbackInput {
  hook_event_name: 'PostToolUse' | 'Stop'
  tool_name?: string
  tool_input?: unknown
  /** Stop hook：SDK 因上一次 block 重入时为 true，用于防循环 */
  stop_hook_active?: boolean
}

interface HookEntry {
  matcher: string
  hooks: ((input: HookCallbackInput) => unknown)[]
}

export interface LitReviewTerminalSkillGuardHooks {
  PostToolUse: HookEntry[]
  Stop: HookEntry[]
}

/** 测试 / 监控用：读当前闭包 + store 状态快照。生产路径不应依赖 */
export interface LitReviewTerminalSkillGuardState {
  /** 本 session 是否处于「综述终结 skill 待调用」（跨 query，来自 store） */
  pending: boolean
  /** 本 query 内是否已调用 literature-review-result（同 query disarm 的本地快路径） */
  reviewSkillInvokedThisQuery: boolean
  /** 本 query 内是否派发过任何子 Agent（中途回合判定，放行 force） */
  subagentDispatchedThisQuery: boolean
  /** 本 query 保险网是否已强制补调过（防 Stop 循环 block） */
  forced: boolean
}

/** 进程内、按 sessionId 索引的跨 query「armed」存储。生产默认单例；测试注入独立 Map 隔离。 */
const defaultPendingStore = new Map<string, boolean>()

/** 保险网强制补调的 block reason（英文——服务回写 Agent 的通知文案，CLAUDE.md §2） */
function buildForceReason(): string {
  return [
    `Orchestration guard (deterministic): a lit-review evidence-gathering flow ran (reader / evidence-triager / evidence-skimmer were dispatched) but the terminal skill (${REVIEW_TERMINAL_SKILL}) was never invoked — no review was written.`,
    `Invoke Skill(${REVIEW_TERMINAL_SKILL}) NOW to generate the review from the evidence cached in .context/*.evidence.json, following the chosen direction's title + outline; inject "outputLanguage" with the resolved reply language.`,
    `Do NOT hand-write the review body — only the skill may produce it. After it writes reviews/*.html, dispatch the fact-checker post_terminal_step.`,
  ].join(' ')
}

/**
 * 为指定 agent session 创建一个 lit-review 终结 skill 缺失保险网。
 *
 * @param sessionId 当前 agent session ID（store 索引键 + 日志可定位性）
 * @param options.store  跨 query「armed」存储；默认进程内单例，测试注入独立 Map 以隔离
 * @param options.logger 测试钩子：默认 console.warn；可注入以验证日志
 */
export function createLitReviewTerminalSkillGuard(
  sessionId: string,
  options: { store?: Map<string, boolean>; logger?: (msg: string) => void } = {},
): LitReviewTerminalSkillGuardHooks & { readState: () => LitReviewTerminalSkillGuardState } {
  const store = options.store ?? defaultPendingStore
  const logger = options.logger ?? ((m: string) => console.warn(m))

  // per-query 本地状态（每个 query 重建闭包即归零；跨 query 的 armed 状态在 store 里）
  const local = {
    reviewSkillInvokedThisQuery: false,
    subagentDispatchedThisQuery: false,
    forced: false,
  }

  // Arm / 中途回合标记：子 Agent 被派发
  const onSubagentPost = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'PostToolUse') return {}
    if (!isSubagentToolUse({ name: input.tool_name })) return {}
    // 本 query 派过子 Agent → 视为中途回合，Stop 不强制（worker 在途 / 刚派发）
    local.subagentDispatchedThisQuery = true
    const subagentType = (input.tool_input as { subagent_type?: unknown } | undefined)?.subagent_type
    if (typeof subagentType === 'string' && REVIEW_WORKER_SUBAGENTS.has(subagentType)) {
      store.set(sessionId, true) // arm（跨 query）
    }
    return {}
  }

  // Disarm：terminal_skill literature-review-result 被调用 → 综述已交付
  const onSkillPost = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'PostToolUse') return {}
    if (input.tool_name !== 'Skill') return {}
    const skill = (input.tool_input as { skill?: unknown } | undefined)?.skill
    if (skill === REVIEW_TERMINAL_SKILL) {
      store.set(sessionId, false) // disarm（跨 query）
      local.reviewSkillInvokedThisQuery = true // 同 query disarm 快路径（不依赖 store 写时序）
    }
    return {}
  }

  // 保险网：query 收尾时「armed 且 本 query 未调终结 skill 且 本 query 未派子 Agent」→ 强制补调
  const onStop = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'Stop') return {}
    if (input.stop_hook_active) return {} // SDK 已因上一次 block 重入 → 放行，防循环
    if (local.forced) return {} // 本 query 已强制过 → 放行，防循环
    if (!store.get(sessionId)) return {} // 未武装（非 lit-review 生成流程 / 已交付）→ 不触发
    if (local.reviewSkillInvokedThisQuery) return {} // 本 query 刚写出综述（disarm 路径）→ 放行
    if (local.subagentDispatchedThisQuery) return {} // 本 query 派过 worker（中途回合，worker 在途）→ 放行

    local.forced = true
    logger(
      `[lit-review-terminal-skill-guard session=${sessionId}] 保险网触发：综述生成流程已 arm 但 ${REVIEW_TERMINAL_SKILL} 未被调用、本 query 无子 Agent 在途 → 强制补调`,
    )
    return { decision: 'block' as const, reason: buildForceReason() }
  }

  return {
    PostToolUse: [
      { matcher: SUBAGENT_TOOL_MATCHER, hooks: [onSubagentPost] },
      { matcher: 'Skill', hooks: [onSkillPost] },
    ],
    Stop: [{ matcher: '*', hooks: [onStop] }],
    readState: (): LitReviewTerminalSkillGuardState => ({
      pending: store.get(sessionId) ?? false,
      reviewSkillInvokedThisQuery: local.reviewSkillInvokedThisQuery,
      subagentDispatchedThisQuery: local.subagentDispatchedThisQuery,
      forced: local.forced,
    }),
  }
}
