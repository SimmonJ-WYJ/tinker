/**
 * 上下文预算追踪器（Context Budget Tracker）
 *
 * 大模型感知不到自己的上下文余量——"窗口快满了"这个信号必须由 harness 注入。
 * 本模块从主循环 assistant 消息的 usage 估算当前上下文占用，跨过阈值（60% / 80%）
 * 时产出一段英文提醒，由 agent-orchestrator 的 PostToolUse hook 以 additionalContext
 * 注入到下一个 tool_result 之后（与语言锁同一注入点），引导模型从"精读论文"切换到
 * "检索 + 锚点片段"的省上下文模式。
 *
 * 设计要点：
 * - 只统计主循环（parent_tool_use_id == null）的 assistant 消息：SubAgent 有独立
 *   上下文，不计入主循环预算。
 * - 当前占用 ≈ usage.input + cache_creation + cache_read + output（API 口径：本次
 *   请求进入模型的全部 token + 新生成部分），取最近一条的值而非累加。
 * - contextWindow 优先用 SDK result 消息的 modelUsage（orchestrator 的 onContextWindow
 *   回调透传进来）；非 Anthropic 渠道（DeepSeek / Kimi 等）SDK 不返回 modelUsage，故创建时
 *   用 inferModelContextWindow(模型 ID) 推断的窗口作种子（与渲染层 ContextUsageBadge 同源），
 *   SDK 返回真实值时再覆盖。两者都缺时按 200k 兜底。否则 1M 窗口模型会被当成 200k，
 *   60%/80% 提醒在 ~120k 就误触发（实际还剩 880k 余量）。
 * - 每个阈值在一次 query 生命周期内只提醒一次；高阈值触发时连带标记低阈值
 *   （避免 80% 提醒后又补发 60% 的弱提醒）。
 * - 遇到 compact_boundary（SDK 自动压缩）说明上下文已腾空，重置占用与已触发记录。
 */

/** contextWindow 未知时的兜底值（Claude 系当前主流窗口） */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000

/** 阈值与提醒文案（内置 prompt 统一英文，CLAUDE.md §2） */
const THRESHOLDS: ReadonlyArray<{ ratio: number; build: (pct: number) => string }> = [
  {
    ratio: 0.6,
    build: (pct) =>
      `[Context budget] About ${pct}% of the context window is already consumed. ` +
      'Prefer retrieval over reading from now on: papers_semantic_search / papers_search_keywords first; ' +
      'deep-read only via anchored papers_read_context or a single papers_read_article_section. ' +
      'Do not read whole documents (zotero_read_attachment) unless strictly unavoidable.',
  },
  {
    ratio: 0.8,
    build: (pct) =>
      `[Context budget] About ${pct}% of the context window is consumed — conserve aggressively. ` +
      'Do NOT read any full documents or whole sections; rely on evidence already gathered and on ' +
      'search snippets only. Finish the remaining steps concisely and wrap up.',
  },
]

interface UsageLike {
  input_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  output_tokens?: number
}

export interface ContextBudgetTracker {
  /** 喂入 SDK 事件流的每条消息（内部自行窄化；非主循环 assistant / 无 usage 的消息忽略） */
  observe(msg: unknown): void
  /** result 消息携带的 contextWindow（orchestrator onContextWindow 回调透传） */
  noteContextWindow(contextWindow: number): void
  /** 当前 contextWindow（dev 观测用：压缩边界向渲染层透出 used/total 用量；未知时为兜底值） */
  getContextWindow(): number
  /** 取走待注入的提醒文本（无新跨阈值则 null）；返回即标记该阈值已触发 */
  consumeReminder(): string | null
}

export function createContextBudgetTracker(initialContextWindow?: number): ContextBudgetTracker {
  // 种子窗口（创建时按模型推断）；SDK onContextWindow 返回真实值时由 noteContextWindow 覆盖。
  let contextWindow =
    typeof initialContextWindow === 'number' && initialContextWindow > 0
      ? initialContextWindow
      : DEFAULT_CONTEXT_WINDOW_TOKENS
  let lastTokens = 0
  const fired = new Set<number>()

  return {
    observe(msg: unknown): void {
      const m = msg as {
        type?: string
        subtype?: string
        parent_tool_use_id?: unknown
        message?: { usage?: UsageLike }
      }
      // SDK 自动压缩：上下文已腾空，重置占用与已触发阈值（允许再次提醒）
      if (m.type === 'system' && m.subtype === 'compact_boundary') {
        lastTokens = 0
        fired.clear()
        return
      }
      if (m.type !== 'assistant' || m.parent_tool_use_id) return
      const u = m.message?.usage
      if (!u) return
      const total =
        (u.input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.output_tokens ?? 0)
      if (total > 0) lastTokens = total
    },

    noteContextWindow(cw: number): void {
      if (Number.isFinite(cw) && cw > 0) contextWindow = cw
    },

    getContextWindow(): number {
      return contextWindow
    },

    consumeReminder(): string | null {
      const ratio = lastTokens / contextWindow
      // 从高到低找第一个已跨过且未触发的阈值；触发时连带标记更低的阈值
      for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
        const t = THRESHOLDS[i]!
        if (ratio >= t.ratio && !fired.has(t.ratio)) {
          for (let j = 0; j <= i; j++) fired.add(THRESHOLDS[j]!.ratio)
          return t.build(Math.min(99, Math.round(ratio * 100)))
        }
      }
      return null
    },
  }
}
