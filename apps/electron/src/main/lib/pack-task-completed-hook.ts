/**
 * createPackTaskCompletedHook —— 把 SubagentStop 翻译成工作区事件 `pack.taskCompleted`
 * + D2 会话粘滞写入（spec §3.1 #9 + ADR-004 D-C）。
 *
 * 触发条件：SDK 上报 SubagentStop 且 `subagent_type` 命中 SubagentRegistry 中
 * `source === 'capability-pack'` 且 `role === 'scenario'` 的注册项（即场景 Agent 收口）。
 * worker subAgent（同 source 但 role === 'worker'）的 Stop 不触发——
 * spec §3.1 的 "pack.taskCompleted" 语义只涵盖场景 Agent 一层收口，
 * 同时避免 PLAN 派活中 worker 中途完成时把 D2 sticky 抖到错误的包。
 *
 * 事件 vs sticky 的失败语义差异：
 *   - pack.taskCompleted：emit 时透传 input.success（false 也发，供下游订阅审计 / 重试）
 *   - D2 sticky：仅 success !== false 时写入 — 失败的场景收口不应留下"下轮优先派回这个包"的偏好
 *
 * 设计取舍：
 *   - 与 createSubagentSpanHooks 并列，不混在 telemetry hook 内——两条独立 concern。
 *   - lookup / markSticky 都走运行时回调（而非闭包绑定 registry / sessionManager），保证 hook 注册
 *     时机早于 scenario Agent 注册的极端时序也能正确解析，并让本文件保持纯逻辑可测试。
 *   - 失败兜底：lookup 抛错时 swallow + console.error，不污染 SubagentStop 主链路。
 */
import { workspaceEventBus } from './workspace-event-bus.ts'
import type { Timestamp } from '@asci/shared'
import { nowIso } from '@asci/shared'

interface HookCallbackInput {
  hook_event_name: 'SubagentStart' | 'SubagentStop'
  /**
   * 子 Agent 类型名。SDK 0.2.119 的 SubagentStopHookInput 字段是 `agent_type`
   * （旧版叫 `subagent_type`，升级改名后本 hook 静默读到 undefined，markSticky 从不触发）。
   * 保留 `subagent_type` 兜底。注意 Task **工具入参** subagent_type 是另一回事。
   */
  agent_type?: string
  /** @deprecated SDK 旧字段名，仅作兜底 */
  subagent_type?: string
  success?: boolean
}

interface HookEntry {
  matcher: string
  // 必须返回对象（哪怕空 `{}`）：CLI 控制协议用 Zod 校验 hook 回调响应，返回 undefined / void 会触发
  // "expected object, received undefined" ZodError（每次 SubagentStop 报一次，累积可拖垮子进程）。
  hooks: ((input: HookCallbackInput) => Record<string, never>)[]
}

export interface PackTaskCompletedHooks {
  SubagentStop: HookEntry[]
}

/**
 * 已注册的能力包场景 Agent 解析器。
 *
 * @returns 命中时返回 `{ packId, scenarioAgentName }`；未命中（非能力包来源 / worker 子 Agent / 未注册）返回 null。
 */
export type ScenarioPackLookup = (
  subagentType: string,
) => { packId: string; scenarioAgentName: string } | null

export interface PackTaskCompletedOptions {
  /**
   * D2 会话粘滞写入回调（ADR-004 D-C）。仅 SubagentStop 命中场景 Agent 且 success !== false 时调用。
   * 缺省时跳过 sticky 写入（兼容只关心事件 emit 的旧 caller / 单测）。
   */
  markSticky?: (packId: string) => void
}

export function createPackTaskCompletedHook(
  sessionId: string,
  lookup: ScenarioPackLookup,
  options: PackTaskCompletedOptions = {},
): PackTaskCompletedHooks {
  const onStop = (input: HookCallbackInput): Record<string, never> => {
    const agentType = input.agent_type ?? input.subagent_type
    if (agentType === undefined) return {}
    let resolved: { packId: string; scenarioAgentName: string } | null = null
    try {
      resolved = lookup(agentType)
    } catch (error) {
      console.error('[pack-task-completed-hook] lookup 抛错（已 swallow）:', error)
      return {}
    }
    if (!resolved) return {}
    const success = input.success ?? true
    const at: Timestamp = nowIso() as Timestamp
    workspaceEventBus.emit({
      kind: 'pack.taskCompleted',
      packId: resolved.packId,
      scenarioAgentName: resolved.scenarioAgentName,
      sessionId,
      success,
      at,
    })
    // D2 sticky：仅成功收口时写入；失败不留下偏好。回调内部错误已由 caller 负责 swallow。
    if (success && options.markSticky) {
      options.markSticky(resolved.packId)
    }
    return {}
  }

  return {
    SubagentStop: [{ matcher: '*', hooks: [onStop] }],
  }
}
