/**
 * runOrchestratorQuery —— Agent SDK query 调用的唯一 entrypoint（A0 ①）。
 *
 * Phase 1 承担：
 *   1. 用 SubagentRegistry.snapshot() 注入 options.agents
 *   2. 通过 SpanSink 把 SubagentStart/Stop hook 装配进 options.hooks（A0a，Task 12）
 *
 * 业务逻辑（watchdog / retry / 持久化 / canUseTool）保留在 agent-orchestrator.ts 内不动。
 *
 * Phase 2 之后会扩到 master/scenario prompt 装配（A4）+ 会话粘滞动态注入（A4）。
 */
import type { ClaudeAgentQueryOptions } from './adapters/claude-agent-adapter.ts'
import { createPackTaskCompletedHook } from './pack-task-completed-hook.ts'
import { createPaperMetaCapHook } from './paper-meta-cap-hook.ts'
import { createPlanTerminalSkillGuard, LIT_SEARCH_PACK_ID } from './plan-terminal-skill-guard.ts'
import { createSearchTelemetryHook } from './search-telemetry-hook.ts'
import { createPlanConfirmGateGuard } from './plan-confirm-gate-guard.ts'
import { createLitReviewFactcheckGuard } from './lit-review-factcheck-guard.ts'
import { createLitReviewStructureLintGuard } from './lit-review-structure-lint-guard.ts'
import { createLitReviewTerminalSkillGuard } from './lit-review-terminal-skill-guard.ts'
import type { SubagentRegistry } from './subagent-registry.ts'
import type { SDKMessage, AgentProviderAdapter } from '@asci/shared'
import { createSubagentSpanHooks, type SpanSink } from './subagent-spans-hook.ts'
import { updateAgentSessionMeta } from './agent-session-manager.ts'

export interface AssembleQueryOptionsInput {
  sessionId: string
  registry: SubagentRegistry
  /** 子 Agent span 落地的 sink（生产环境写 session meta；测试环境收集到数组） */
  sink: SpanSink
  /** agent-orchestrator.ts 已经构造好的 queryOptions（除 agents 字段外其余字段就绪） */
  baseOptions: Omit<ClaudeAgentQueryOptions, 'agents'>
}

/**
 * 把 registry.snapshot().agents 合并进 baseOptions，同时把 SubagentStart/Stop span hook
 * 合并进 options.hooks，输出可直接喂给 adapter.query() 的 options。
 * 不会修改 baseOptions（不可变）。
 *
 * **agents 完全覆盖语义**：registry.snapshot() 的结果**完全替换** baseOptions.agents（如果存在），
 * 不做字段级 merge。调用方应通过 Registry 注册子 Agent，不应自行构造 agents 字段。
 * （Omit<..., 'agents'> 也在编译期阻止误传。）
 *
 * **hooks 合并语义**：SubagentStart / SubagentStop 会拼接在 baseOptions.hooks 原有条目之后；
 * 其他 hook 类型（PreToolUse / PostToolUse 等）原样保留，不被覆盖。
 */
export function assembleQueryOptions(input: AssembleQueryOptionsInput): ClaudeAgentQueryOptions {
  const snapshot = input.registry.snapshot()
  const spanHooks = createSubagentSpanHooks(input.sessionId, input.sink)
  // Lean general/coding turns must not inherit research completion/approval gates.
  // Caller hooks include the host's permission checks and are preserved verbatim.
  if (input.baseOptions.tools !== undefined) {
    const hooks = input.baseOptions.hooks ?? {}
    return { ...input.baseOptions, agents: {}, hooks: {
      ...hooks,
      SubagentStart: [...(hooks.SubagentStart ?? []), ...spanHooks.SubagentStart],
      SubagentStop: [...(hooks.SubagentStop ?? []), ...spanHooks.SubagentStop],
    } } as ClaudeAgentQueryOptions
  }
  // pack.taskCompleted hook（spec §3.1 #9）：SubagentStop 命中 capability-pack scenario Agent 时 emit
  // + 写 D2 sticky（A4 phase4）。worker subAgent（role !== 'scenario'）的 Stop 不触发，避免
  // PLAN 派活中 worker 中途完成时被误当成场景收口（既会让 sticky 抖动，也会污染 pack.taskCompleted 语义）。
  const packHooks = createPackTaskCompletedHook(
    input.sessionId,
    (subagentType) => {
      const entry = input.registry.get(subagentType, { kind: 'subagent' })
      if (!entry || entry.kind !== 'subagent') return null
      if (entry.source !== 'capability-pack' || !entry.packId) return null
      if (entry.role !== 'scenario') return null
      return { packId: entry.packId, scenarioAgentName: entry.name }
    },
    {
      // D2 粘滞：场景 Agent 成功收口 → 写 sessionMeta.stickyCapabilityPackId。
      // 失败由 hook 内部按 success 标志早退；session 不存在 / 文件 I/O 异常时 swallow + console.error。
      markSticky: (packId) => {
        try {
          updateAgentSessionMeta(input.sessionId, { stickyCapabilityPackId: packId })
        } catch (err) {
          console.error('[pack-task-completed-hook] sticky write failed:', err)
        }
      },
    },
  )
  // paper-meta cap hook（spec §5.6）：lit-review → lit-search 跨包补漏 cap=3 / fail≥2 早停
  const paperMetaCapHooks = createPaperMetaCapHook(input.sessionId)
  // lit-search scenario Agent 判定（capability-pack scenario + packId===lit-search）——
  // plan-terminal-skill-guard（#575）与 plan-confirm-gate-guard（#774）共用同一 resolver。
  const isLitSearchScenario = (subagentType: string): boolean => {
    const entry = input.registry.get(subagentType, { kind: 'subagent' })
    if (!entry || entry.kind !== 'subagent') return false
    if (entry.source !== 'capability-pack' || entry.packId !== LIT_SEARCH_PACK_ID) return false
    return entry.role === 'scenario'
  }
  // plan-terminal-skill guard（issue #575）：lit-search general-query PLAN 漏写 terminal_skill 时，
  // PostToolUse 主防线补标 + Stop 保险网强制补调 lit-search-report。
  const planTerminalSkillGuard = createPlanTerminalSkillGuard(input.sessionId, isLitSearchScenario)
  // plan-confirm-gate guard（issue #774，#517 路线 b 续）：lit-search PLAN 含 confirm 字段时，
  // PreToolUse 拦截「未经 present_search_plan 确认门」的 searcher / citation-explorer 派发并回注补调指令。
  // arm 复用同款 lit-search scenario 判定；happy path（pro 不跳门）零触发。
  const planConfirmGateGuard = createPlanConfirmGateGuard(input.sessionId, isLitSearchScenario)
  // lit-review fact-checker 后置核查保险网（issue #517）：terminal_skill `literature-review-result`
  // 写出综述后，若 fact-checker（post_terminal_step）未派发，Stop 时强制补派。触发器是 lit-review 专属
  // terminal skill 名，天然 pack-scoped，无需 resolver。
  const litReviewFactcheckGuard = createLitReviewFactcheckGuard(input.sessionId)
  // lit-review 综述引用结构校验闸（spec：lit-review-finalize-fast-path P0）：terminal_skill 写出
  // reviews/*.html 时，对写入内容确定性校验裸 [N] 残留 / 缺 <q> 的 <cite>，命中即 block + 精确清单，
  // 替代主 Agent 肉眼扫全文 + 手工 Edit 返修。pack-scoped（路径特征触发），无需 resolver。
  const litReviewStructureLintGuard = createLitReviewStructureLintGuard(input.sessionId)
  // lit-review 终结 skill 缺失保险网（P0）：与 plan-terminal-skill-guard（lit-search）对称——补齐 lit-review
  // 侧唯一一个纯 prompt 驱动、无确定性兜底的环节。reader/triager/skimmer 被派发即 arm（跨 query，进程内 store
  // 承载，因 reader 后台 fan-out 跨多个 query 完成）；literature-review-result 调用即 disarm；Stop 时若 armed
  // 且本 query 既未调终结 skill 也未派子 Agent（非中途回合）→ block 强制补调。pack-scoped（worker 子 Agent 名
  // + terminal skill 名触发），无需 resolver。
  const litReviewTerminalSkillGuard = createLitReviewTerminalSkillGuard(input.sessionId)
  // search_executed 行为埋点（issue #717）：PostToolUse 监听 retrieve / process_search_results
  // 两个"检索完成"工具，对子 Agent 调用同样生效、不受能力包门控——任何包里的检索都能上报。
  const searchTelemetryHook = createSearchTelemetryHook(input.sessionId)
  // baseOptions.hooks 的类型在不同 SDK 版本下可能不含 SubagentStart/SubagentStop 字段，
  // 用 Record<string, unknown> 处理类型差异；运行期行为由 SDK 决定。
  const baseHooks = (input.baseOptions.hooks ?? {}) as Record<string, unknown>

  return {
    ...input.baseOptions,
    agents: input.baseOptions.tools !== undefined ? {} : snapshot.agents,
    hooks: {
      ...baseHooks,
      PreToolUse: [
        ...((baseHooks.PreToolUse as unknown[]) ?? []),
        ...paperMetaCapHooks.PreToolUse,
        ...planConfirmGateGuard.PreToolUse,
      ],
      PostToolUse: [
        ...((baseHooks.PostToolUse as unknown[]) ?? []),
        ...paperMetaCapHooks.PostToolUse,
        ...planTerminalSkillGuard.PostToolUse,
        ...planConfirmGateGuard.PostToolUse,
        ...litReviewFactcheckGuard.PostToolUse,
        ...litReviewStructureLintGuard.PostToolUse,
        ...litReviewTerminalSkillGuard.PostToolUse,
        ...searchTelemetryHook.PostToolUse,
      ],
      SubagentStart: [
        ...((baseHooks.SubagentStart as unknown[]) ?? []),
        ...spanHooks.SubagentStart,
      ],
      SubagentStop: [
        ...((baseHooks.SubagentStop as unknown[]) ?? []),
        ...spanHooks.SubagentStop,
        ...packHooks.SubagentStop,
      ],
      Stop: [
        ...((baseHooks.Stop as unknown[]) ?? []),
        ...planTerminalSkillGuard.Stop,
        ...litReviewFactcheckGuard.Stop,
        ...litReviewTerminalSkillGuard.Stop,
      ],
    },
  } as ClaudeAgentQueryOptions
}

export interface RunOrchestratorQueryInput extends AssembleQueryOptionsInput {
  /**
   * SDK adapter，只需要 query() 方法 —— 通过 Provider 抽象解耦具体 adapter 实现（A1 配套）。
   */
  adapter: Pick<AgentProviderAdapter, 'query'>
}

/**
 * 启动 query 并返回 SDK 消息流。这是 main 进程 import { query } 的**唯一**间接入口。
 * agent-orchestrator.ts 内 `runAgent` 主流程与 auto-resume 流程全部走本函数（Task 7 落地）。
 */
export function runOrchestratorQuery(
  input: RunOrchestratorQueryInput,
): AsyncIterable<SDKMessage> {
  const options = assembleQueryOptions(input)
  return input.adapter.query(options as Parameters<AgentProviderAdapter['query']>[0])
}
