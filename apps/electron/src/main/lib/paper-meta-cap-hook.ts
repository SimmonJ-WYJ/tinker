/**
 * createPaperMetaCapHook —— lit-review → lit-search 跨包精确补漏的运行时上限（spec §5.6）。
 *
 * 场景：lit-review 综述包的 synthesizer 在单 turn 写正文时，对缺 metadata 的论文调
 * `mcp__paper-search__get_paper_meta(pmid|doi)` 补一条精确元数据。spec §5.6 给出两条硬约束：
 *   - **cap=3**：单 turn 内累计调用 ≤ 3 次（防止失控放大延迟 / cost）
 *   - **fail ≥ 2 早停**：累计 ≥ 2 次失败后，剩余 budget 不再使用（即使尚未达 3 次）
 *
 * SubAgent prompt 已经"软声明"了这条规则，但 LLM 不保证遵守；本 hook 用 PreToolUse 硬拦截
 * 作为护栏。配合 PostToolUse 计数实际执行结果（attempts / failures）。
 *
 * 设计：
 *   - **counter 在 PostToolUse 增**：只算"真的跑了"的尝试，不被其他权限 deny / 取消干扰
 *   - **PreToolUse 仅读 counter**：触限直接 `permissionDecision: 'deny'` + 中文说明
 *   - **session 级隔离**：counter 闭包绑 sessionId；新 session 重置；lit-review 一次综述 = 一个 session
 *   - **失败判定**：MCP 标准 `tool_response.isError === true`；缺失或异常形态保守视为成功
 *
 * 与 spec §5.6 的对齐：cap=3 / fail≥2 两个常量直接 export 供测试锁定。
 */
import type { Timestamp } from '@asci/shared'
import { nowIso } from '@asci/shared'

/** 受限的工具名 —— paper-search MCP server 的 get_paper_meta */
export const GET_PAPER_META_TOOL = 'mcp__paper-search__get_paper_meta'

/** spec §5.6 硬常量：单 turn 累计调用上限 */
export const GET_PAPER_META_CAP = 3

/** spec §5.6 硬常量：累计失败到此值后早停 */
export const GET_PAPER_META_FAIL_EARLY_STOP = 2

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

export interface PaperMetaCapHooks {
  PreToolUse: HookEntry[]
  PostToolUse: HookEntry[]
}

/**
 * 测试 / 监控用：读当前 counter 快照。
 * 生产路径不应依赖此函数（counter 是闭包内部状态）。
 */
export interface PaperMetaCapState {
  attempts: number
  failures: number
}

/**
 * 判定 PostToolUse 拿到的 tool_response 是否为失败。
 *
 * MCP 标准：成功响应是 `{ content: [...], isError?: false }`；失败时 `isError: true`。
 * 边界情况保守处理：response 为 null/undefined 视为失败（工具本身崩了）；
 * 形态不符（非 object）视为成功（避免把奇形怪状的 string 响应误判）。
 */
export function isPaperMetaToolResponseError(response: unknown): boolean {
  if (response === null || response === undefined) return true
  if (typeof response !== 'object') return false
  const r = response as { isError?: unknown }
  return r.isError === true
}

export function createPaperMetaCapHook(
  sessionId: string,
  /** 测试钩子：默认 console.warn；可注入以验证日志 */
  logger: (msg: string) => void = (m) => console.warn(m),
): PaperMetaCapHooks & { readState: () => PaperMetaCapState } {
  const state: PaperMetaCapState = { attempts: 0, failures: 0 }

  const buildDenyOutput = (reason: string) => ({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      permissionDecision: 'deny' as const,
      permissionDecisionReason: reason,
    },
  })

  const onPre = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'PreToolUse') return {}
    if (input.tool_name !== GET_PAPER_META_TOOL) return {}

    if (state.attempts >= GET_PAPER_META_CAP) {
      const reason = `[paper-meta-cap] 本轮综述已调用 get_paper_meta ${state.attempts} 次（上限 ${GET_PAPER_META_CAP}）；跨包补漏到此为止，剩余缺漏论文请按段内 \`[待补充]\` 占位处理（spec §5.6）`
      logger(`[paper-meta-cap session=${sessionId}] cap 触发；attempts=${state.attempts}`)
      return buildDenyOutput(reason)
    }
    if (state.failures >= GET_PAPER_META_FAIL_EARLY_STOP) {
      const reason = `[paper-meta-cap] 本轮综述 get_paper_meta 已连续失败 ${state.failures} 次（早停阈值 ${GET_PAPER_META_FAIL_EARLY_STOP}）；跨包补漏停用，请按段内 \`[待补充]\` 占位处理（spec §5.6）`
      logger(`[paper-meta-cap session=${sessionId}] fail 早停触发；failures=${state.failures}`)
      return buildDenyOutput(reason)
    }
    return {}
  }

  const onPost = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'PostToolUse') return {}
    if (input.tool_name !== GET_PAPER_META_TOOL) return {}
    state.attempts += 1
    if (isPaperMetaToolResponseError(input.tool_response)) {
      state.failures += 1
    }
    return {}
  }

  return {
    PreToolUse: [{ matcher: GET_PAPER_META_TOOL, hooks: [onPre] }],
    PostToolUse: [{ matcher: GET_PAPER_META_TOOL, hooks: [onPost] }],
    readState: () => ({ ...state }),
  }
}

/** 当前 ISO 时间（与 spec 时间戳约定一致；预留给后续 telemetry hook） */
export function nowTimestamp(): Timestamp {
  return nowIso() as Timestamp
}
