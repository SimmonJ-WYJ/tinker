/**
 * createSubagentSpanHooks — 给 SDK options.hooks 提供 SubagentStart / SubagentStop 配对（A0a）。
 *
 * 设计：每次 SubagentStart 写一条 span 到 sink；每次 SubagentStop 找最近一条同名未结束 span
 * 回填 finishedAt / success / durationMs。FIFO 配对——多次派发同一 subagent_type 时按顺序对齐。
 *
 * 0.2 阶段 sink 写到 session meta（updateAgentSessionMeta(sessionId, { subagentSpans })，Task 12 接入）；
 * 0.3 §三-A telemetry consumer 直接订阅 sink 输出即可。
 */
import type { SubagentSpan } from '@asci/shared'
import { nowMs } from '@asci/shared'

export interface SpanSink {
  append(sessionId: string, span: SubagentSpan): void
  update(sessionId: string, predicate: (s: SubagentSpan) => boolean, patch: Partial<SubagentSpan>): void
}

interface HookCallbackInput {
  hook_event_name: 'SubagentStart' | 'SubagentStop'
  /**
   * 子 Agent 类型名。SDK 0.2.119 的 SubagentStart/StopHookInput 字段是 `agent_type`
   * （历史上曾叫 `subagent_type`，升级后改名导致本 hook 静默读到 undefined）。
   * 保留 `subagent_type` 作为兜底，防 SDK 字段再漂移。注意：Task **工具入参**仍叫 subagent_type，
   * 那是另一回事（见 message-stream-converter）。
   */
  agent_type?: string
  /** @deprecated SDK 旧字段名，仅作兜底 */
  subagent_type?: string
  success?: boolean
  // SDK 实际 shape 由 SDK 决定；本接口只列必要字段
}

/** 从 hook input 取子 Agent 类型名：优先 SDK 现行字段 agent_type，兜底旧字段 subagent_type。 */
function resolveAgentType(input: HookCallbackInput): string | undefined {
  return input.agent_type ?? input.subagent_type
}

interface HookEntry {
  matcher: string
  // 必须返回对象（哪怕空 `{}`）：CLI（claude binary）的控制协议用 Zod 校验每个 hook 回调的响应，
  // 返回 undefined / void 会触发 "expected object, received undefined" ZodError，每次 subagent 启停
  // 都报一次，累积可拖垮子进程（exited with code 1）。纯副作用 hook 也要 `return {}`。
  hooks: ((input: HookCallbackInput) => Record<string, never>)[]
}

export interface SubagentSpanHooks {
  SubagentStart: HookEntry[]
  SubagentStop: HookEntry[]
}

export function createSubagentSpanHooks(sessionId: string, sink: SpanSink): SubagentSpanHooks {
  // 同名 subagent 多次派发的 startedAt 队列（FIFO）— 每次 stop 取最早的 start
  const pending = new Map<string, number[]>()

  const onStart = (input: HookCallbackInput): Record<string, never> => {
    const agentType = resolveAgentType(input)
    if (agentType === undefined) return {}
    const startedAt = nowMs()
    const queue = pending.get(agentType) ?? []
    queue.push(startedAt)
    pending.set(agentType, queue)
    sink.append(sessionId, { scenarioAgentName: agentType, startedAt })
    return {}
  }

  const onStop = (input: HookCallbackInput): Record<string, never> => {
    const agentType = resolveAgentType(input)
    if (agentType === undefined) return {}
    const finishedAt = nowMs()
    const queue = pending.get(agentType) ?? []
    const startedAt = queue.shift()
    if (startedAt === undefined) {
      console.warn(`[SubagentSpanHooks] SubagentStop without matching Start: ${agentType}`)
      return {}
    }
    pending.set(agentType, queue)
    sink.update(
      sessionId,
      (s) => s.scenarioAgentName === agentType && s.startedAt === startedAt && s.finishedAt === undefined,
      {
        finishedAt,
        success: input.success ?? true,
        durationMs: finishedAt - startedAt,
      },
    )
    return {}
  }

  return {
    SubagentStart: [{ matcher: '*', hooks: [onStart] }],
    SubagentStop: [{ matcher: '*', hooks: [onStop] }],
  }
}
