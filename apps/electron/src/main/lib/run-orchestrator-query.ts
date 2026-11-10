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
  const hooks = input.baseOptions.hooks ?? {}
  return {
    ...input.baseOptions,
    agents: snapshot.agents,
    hooks: {
      ...hooks,
      SubagentStart: [...(hooks.SubagentStart ?? []), ...spanHooks.SubagentStart],
      SubagentStop: [...(hooks.SubagentStop ?? []), ...spanHooks.SubagentStop, ...packHooks.SubagentStop],
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
