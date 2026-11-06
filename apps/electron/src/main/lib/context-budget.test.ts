/**
 * context-budget 单元测试：阈值触发、去重、SubAgent 隔离、compact 重置。
 */
import { describe, expect, it } from 'bun:test'
import { createContextBudgetTracker, DEFAULT_CONTEXT_WINDOW_TOKENS } from './context-budget.ts'

function assistantMsg(tokens: number, parentToolUseId: string | null = null): unknown {
  return {
    type: 'assistant',
    parent_tool_use_id: parentToolUseId,
    message: { usage: { input_tokens: tokens, output_tokens: 0 } },
  }
}

describe('createContextBudgetTracker', () => {
  it('低于 60% 不产生提醒', () => {
    const t = createContextBudgetTracker()
    t.observe(assistantMsg(0.5 * DEFAULT_CONTEXT_WINDOW_TOKENS))
    expect(t.consumeReminder()).toBeNull()
  })

  it('跨过 60% 提醒一次且不重复；继续跨过 80% 再提醒一次', () => {
    const t = createContextBudgetTracker()
    t.observe(assistantMsg(0.65 * DEFAULT_CONTEXT_WINDOW_TOKENS))
    const first = t.consumeReminder()
    expect(first).toContain('65%')
    expect(first).toContain('Prefer retrieval')
    expect(t.consumeReminder()).toBeNull()

    t.observe(assistantMsg(0.85 * DEFAULT_CONTEXT_WINDOW_TOKENS))
    const second = t.consumeReminder()
    expect(second).toContain('conserve aggressively')
    expect(t.consumeReminder()).toBeNull()
  })

  it('直接跨过 80% 只发高档提醒，连带标记 60% 不再补发', () => {
    const t = createContextBudgetTracker()
    t.observe(assistantMsg(0.9 * DEFAULT_CONTEXT_WINDOW_TOKENS))
    expect(t.consumeReminder()).toContain('conserve aggressively')
    expect(t.consumeReminder()).toBeNull()
  })

  it('SubAgent 消息（parent_tool_use_id 非空）不计入占用', () => {
    const t = createContextBudgetTracker()
    t.observe(assistantMsg(0.95 * DEFAULT_CONTEXT_WINDOW_TOKENS, 'toolu_123'))
    expect(t.consumeReminder()).toBeNull()
  })

  it('noteContextWindow 改变分母：1M 窗口下 60 万 token 恰好触发 60%', () => {
    const t = createContextBudgetTracker()
    t.noteContextWindow(1_000_000)
    t.observe(assistantMsg(600_000))
    expect(t.consumeReminder()).toContain('60%')
  })

  it('种子窗口（initialContextWindow）校准分母：1M 模型下 127k token 不误触发 60%（修非 Anthropic 渠道按 200k 算的 bug）', () => {
    // 缺省 200k 下 127k = 63% 会误触发；种子成 1M 后只占 12.7%，不应提醒
    const seeded = createContextBudgetTracker(1_000_000)
    expect(seeded.getContextWindow()).toBe(1_000_000)
    seeded.observe(assistantMsg(127_000))
    expect(seeded.consumeReminder()).toBeNull()

    const def = createContextBudgetTracker()
    def.observe(assistantMsg(127_000))
    expect(def.consumeReminder()).toContain('64%') // 127k/200k=63.5%→round 64（与截图一致）
  })

  it('SDK 真实 contextWindow 覆盖种子窗口（noteContextWindow 优先于 initial）', () => {
    const t = createContextBudgetTracker(1_000_000)
    t.noteContextWindow(200_000)
    expect(t.getContextWindow()).toBe(200_000)
  })

  it('非法 / 缺省 initialContextWindow 回退兜底窗口', () => {
    expect(createContextBudgetTracker().getContextWindow()).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS)
    expect(createContextBudgetTracker(0).getContextWindow()).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS)
    expect(createContextBudgetTracker(-5).getContextWindow()).toBe(DEFAULT_CONTEXT_WINDOW_TOKENS)
  })

  it('compact_boundary 重置占用与已触发阈值，可再次提醒', () => {
    const t = createContextBudgetTracker()
    t.observe(assistantMsg(0.7 * DEFAULT_CONTEXT_WINDOW_TOKENS))
    expect(t.consumeReminder()).not.toBeNull()

    t.observe({ type: 'system', subtype: 'compact_boundary' })
    expect(t.consumeReminder()).toBeNull()

    t.observe(assistantMsg(0.7 * DEFAULT_CONTEXT_WINDOW_TOKENS))
    expect(t.consumeReminder()).toContain('Prefer retrieval')
  })

  it('usage 缺失 / cache 字段累加正确', () => {
    const t = createContextBudgetTracker()
    t.observe({ type: 'assistant', parent_tool_use_id: null, message: {} })
    expect(t.consumeReminder()).toBeNull()

    t.observe({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        usage: {
          input_tokens: 10_000,
          cache_read_input_tokens: 100_000,
          cache_creation_input_tokens: 15_000,
          output_tokens: 1_000,
        },
      },
    })
    // 合计 126k / 200k = 63% → 触发 60 档
    expect(t.consumeReminder()).toContain('63%')
  })
})
