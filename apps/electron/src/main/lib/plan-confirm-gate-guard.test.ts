/**
 * createPlanConfirmGateGuard 单元测试（issue #774）
 *
 * 验证：把「用户必须先确认检索方案才开检索」从 prompt 自律升级为 harness 保证。
 * 核心断言族对齐 issue AC：
 *   - 确认门不可跳过：PLAN 含 confirm 且 present_search_plan 未通过时，PreToolUse 拦截 searcher 派发
 *   - 同样拦截 citation-explorer（citation-tracing 的检索步）
 *   - 不碰 scorer（#745 范围）
 *   - confirm → 放行；adjust / cancel → 仍拦（取消即停的兜底）
 *   - exact-lookup（无 confirm 字段）不 arm，零拦截、零回归
 *   - pro happy path：confirm 后派 searcher 零拦截
 */
import { test, expect, describe } from 'bun:test'
import {
  createPlanConfirmGateGuard,
  PRESENT_SEARCH_PLAN_TOOL,
  RETRIEVAL_SUBAGENTS,
  DENY_ESCALATION_THRESHOLD,
} from './plan-confirm-gate-guard.ts'

/** 构造 scenario Agent 返回的 Task tool_response（含 SEARCH PLAN fence） */
function planResponse(plan: Record<string, unknown>): { content: { type: 'text'; text: string }[] } {
  const text = ['Here is the plan.', '## SEARCH PLAN', '```json', JSON.stringify(plan), '```', 'Plan above — awaiting confirmation.'].join('\n')
  return { content: [{ type: 'text', text }] }
}

/** general-query PLAN（含 confirm 字段） */
const PLAN_WITH_CONFIRM = {
  intent: 'general-query',
  keywords: ['k1'],
  sources: ['openalex'],
  steps: [{ subagent_type: 'searcher', input: '...' }],
  confirm: { tool: PRESENT_SEARCH_PLAN_TOOL, input: { researchQuestion: 'q', keywords: ['k1'], sources: ['openalex'] } },
}

/** exact-lookup PLAN（无 confirm 字段） */
const PLAN_EXACT_LOOKUP = {
  intent: 'exact-lookup',
  direct_lookup: { identifier: '10.1/x', source: 'doi' },
  steps: [],
}

/** present_search_plan 的 tool_response（choice 序列化为顶层 JSON 文本） */
function confirmResponse(choice: 'confirm' | 'adjust' | 'cancel'): { content: { type: 'text'; text: string }[] } {
  const body = choice === 'adjust' ? { choice, adjustment: 'only arxiv' } : { choice }
  return { content: [{ type: 'text', text: JSON.stringify(body) }] }
}

/** 默认 resolver：把任意名都当 lit-search scenario（测试聚焦 guard 逻辑，不测 registry） */
const scenarioYes = () => true

/** 触发一次 scenario PLAN PostToolUse（arm 用） */
function feedPlan(guard: ReturnType<typeof createPlanConfirmGateGuard>, response: unknown, subagentType = 'lit-search'): void {
  const hook = guard.PostToolUse.find((e) => e.matcher.includes('Task'))!.hooks[0]!
  hook({ hook_event_name: 'PostToolUse', tool_name: 'Task', tool_input: { subagent_type: subagentType }, tool_response: response })
}

/** 触发一次 present_search_plan PostToolUse */
function feedConfirm(guard: ReturnType<typeof createPlanConfirmGateGuard>, response: unknown): void {
  const hook = guard.PostToolUse.find((e) => e.matcher === PRESENT_SEARCH_PLAN_TOOL)!.hooks[0]!
  hook({ hook_event_name: 'PostToolUse', tool_name: PRESENT_SEARCH_PLAN_TOOL, tool_response: response })
}

/** 跑一次 PreToolUse 派发判定，返回 hook 输出 */
function tryDispatch(guard: ReturnType<typeof createPlanConfirmGateGuard>, subagentType: string): { denied: boolean; reason?: string } {
  const hook = guard.PreToolUse[0]!.hooks[0]!
  const out = hook({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: { subagent_type: subagentType } }) as {
    hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
  }
  const decision = out?.hookSpecificOutput?.permissionDecision
  return { denied: decision === 'deny', reason: out?.hookSpecificOutput?.permissionDecisionReason }
}

describe('createPlanConfirmGateGuard — 确认门 harness 保证', () => {
  test('确认门不可跳过：PLAN 含 confirm 且未确认时，拦截 searcher 派发', () => {
    const guard = createPlanConfirmGateGuard('s1', scenarioYes, () => {})
    feedPlan(guard, planResponse(PLAN_WITH_CONFIRM))
    const r = tryDispatch(guard, 'searcher')
    expect(r.denied).toBe(true)
    expect(r.reason).toContain(PRESENT_SEARCH_PLAN_TOOL)
    expect(guard.readState().planHasConfirm).toBe(true)
    expect(guard.readState().confirmGatePassed).toBe(false)
    expect(guard.readState().denials).toBe(1)
  })

  test('同样拦截 citation-explorer（citation-tracing 的检索步）', () => {
    const guard = createPlanConfirmGateGuard('s1', scenarioYes, () => {})
    feedPlan(guard, planResponse({ ...PLAN_WITH_CONFIRM, intent: 'citation-tracing' }))
    expect(tryDispatch(guard, 'citation-explorer').denied).toBe(true)
  })

  test('不碰 scorer：即使未确认，scorer 派发放行（#745 范围）', () => {
    const guard = createPlanConfirmGateGuard('s1', scenarioYes, () => {})
    feedPlan(guard, planResponse(PLAN_WITH_CONFIRM))
    expect(tryDispatch(guard, 'scorer').denied).toBe(false)
  })

  test('confirm → 放行 searcher', () => {
    const guard = createPlanConfirmGateGuard('s1', scenarioYes, () => {})
    feedPlan(guard, planResponse(PLAN_WITH_CONFIRM))
    feedConfirm(guard, confirmResponse('confirm'))
    expect(guard.readState().confirmGatePassed).toBe(true)
    expect(tryDispatch(guard, 'searcher').denied).toBe(false)
  })

  test('adjust → 仍拦（确认门未通过，等待重规划后再确认）', () => {
    const guard = createPlanConfirmGateGuard('s1', scenarioYes, () => {})
    feedPlan(guard, planResponse(PLAN_WITH_CONFIRM))
    feedConfirm(guard, confirmResponse('adjust'))
    expect(guard.readState().confirmGatePassed).toBe(false)
    expect(tryDispatch(guard, 'searcher').denied).toBe(true)
  })

  test('cancel → 仍拦（取消即停的兜底，绝不开检索）', () => {
    const guard = createPlanConfirmGateGuard('s1', scenarioYes, () => {})
    feedPlan(guard, planResponse(PLAN_WITH_CONFIRM))
    feedConfirm(guard, confirmResponse('cancel'))
    expect(guard.readState().confirmGatePassed).toBe(false)
    expect(tryDispatch(guard, 'searcher').denied).toBe(true)
  })

  // 对抗审查（#774）定位的高危项：adjust 回环里 revised PLAN 漏写 confirm 字段（弱模型漏字段，
  // 恰是本 guard 要防的场景）若能把 arm 降级清零，就会绕过确认门。arm 必须单调（只升不降）。
  test('单调 arm：已 arm 后，漏写 confirm 的 revised PLAN 不解除武装（防降级绕过）', () => {
    const guard = createPlanConfirmGateGuard('s1', scenarioYes, () => {})
    feedPlan(guard, planResponse(PLAN_WITH_CONFIRM)) // arm
    expect(guard.readState().planHasConfirm).toBe(true)
    // 重派 scenario，revised PLAN 漏写了 confirm 字段（general-query 但无 confirm）
    feedPlan(guard, planResponse({ intent: 'general-query', keywords: ['k1'], sources: ['openalex'], steps: [] }))
    expect(guard.readState().planHasConfirm).toBe(true) // 仍 armed，未被降级
    expect(tryDispatch(guard, 'searcher').denied).toBe(true) // 确认门仍拦
  })

  // 对抗审查（#774）：deny 无上限会让失控重试空烧 turn。连续 deny 到阈值后文案升级为终止指令
  // （门仍关闭、绝不放行），止住空转。
  test('deny 到阈值后升级为终止指令（门仍关，不放行）', () => {
    const guard = createPlanConfirmGateGuard('s1', scenarioYes, () => {})
    feedPlan(guard, planResponse(PLAN_WITH_CONFIRM))
    let last = tryDispatch(guard, 'searcher')
    for (let i = 2; i <= DENY_ESCALATION_THRESHOLD; i++) last = tryDispatch(guard, 'searcher')
    expect(last.denied).toBe(true) // 仍 deny，门不翻成放行
    expect(last.reason).toContain('STOP retrying') // 升级为终止指令
    expect(guard.readState().denials).toBe(DENY_ESCALATION_THRESHOLD)
  })

  test('exact-lookup（无 confirm 字段）不 arm，searcher 直接放行、零拦截', () => {
    const guard = createPlanConfirmGateGuard('s1', scenarioYes, () => {})
    feedPlan(guard, planResponse(PLAN_EXACT_LOOKUP))
    expect(guard.readState().planHasConfirm).toBe(false)
    expect(tryDispatch(guard, 'searcher').denied).toBe(false)
    expect(guard.readState().denials).toBe(0)
  })

  test('未见过 PLAN（guard 未 arm）→ searcher 放行（不无差别拦截）', () => {
    const guard = createPlanConfirmGateGuard('s1', scenarioYes, () => {})
    expect(tryDispatch(guard, 'searcher').denied).toBe(false)
  })

  test('非 lit-search scenario（resolver false）→ 不解析 PLAN、不 arm', () => {
    const guard = createPlanConfirmGateGuard('s1', () => false, () => {})
    feedPlan(guard, planResponse(PLAN_WITH_CONFIRM), 'other-scenario')
    expect(guard.readState().planHasConfirm).toBe(false)
    expect(tryDispatch(guard, 'searcher').denied).toBe(false)
  })

  test('pro happy path：PLAN → confirm → searcher 全程零拦截', () => {
    const guard = createPlanConfirmGateGuard('s1', scenarioYes, () => {})
    feedPlan(guard, planResponse(PLAN_WITH_CONFIRM))
    feedConfirm(guard, confirmResponse('confirm'))
    expect(tryDispatch(guard, 'searcher').denied).toBe(false)
    expect(guard.readState().denials).toBe(0)
  })

  test('RETRIEVAL_SUBAGENTS 仅含 searcher / citation-explorer，不含 scorer', () => {
    expect(RETRIEVAL_SUBAGENTS.has('searcher')).toBe(true)
    expect(RETRIEVAL_SUBAGENTS.has('citation-explorer')).toBe(true)
    expect(RETRIEVAL_SUBAGENTS.has('scorer')).toBe(false)
  })

  // 回归（#774 真机定位）：in-process SDK MCP 工具的 tool_response 顶层直接是 content 数组
  // `[{type:'text',text}]`，不包 `.content`。早期实现只认 `.content` 形态 → 解析失败 →
  // confirmGatePassed 永置不上 → 用户确认后 searcher 仍被误杀（happy path 死循环）。
  test('确认门通过——tool_response 为顶层数组形态（in-process MCP 真机形态）也能识别', () => {
    const guard = createPlanConfirmGateGuard('s1', scenarioYes, () => {})
    feedPlan(guard, planResponse(PLAN_WITH_CONFIRM))
    // 顶层数组，而非 { content: [...] }
    feedConfirm(guard, [{ type: 'text', text: JSON.stringify({ choice: 'confirm' }) }])
    expect(guard.readState().confirmGatePassed).toBe(true)
    expect(tryDispatch(guard, 'searcher').denied).toBe(false)
  })
})
