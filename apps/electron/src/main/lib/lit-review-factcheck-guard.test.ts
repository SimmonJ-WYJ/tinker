/**
 * lit-review-factcheck-guard 行为单测（issue #517）
 *
 * 覆盖保险网 Stop 真值表：
 *   - 综述已产出（literature-review-result 调用）+ fact-checker 未派发 → block + 日志
 *   - 综述已产出 + fact-checker 已派发 → 放行
 *   - 综述未产出（terminal_skill 未跑）→ 不触发（放行）
 *   - stop_hook_active / forced → 放行（防循环）
 *   - 非 fact-checker 子 Agent 派发不置位；非 literature-review-result Skill 不武装
 */

import { describe, expect, test } from 'bun:test'

import {
  REVIEW_TERMINAL_SKILL,
  FACT_CHECKER_SUBAGENT,
  BODY_WRITER_SUBAGENT,
  createLitReviewFactcheckGuard,
} from './lit-review-factcheck-guard.ts'

type Guard = ReturnType<typeof createLitReviewFactcheckGuard>

function postCbByMatcher(guard: Guard, matcher: string): (input: unknown) => unknown {
  const entry = guard.PostToolUse.find((e) => e.matcher === matcher)!
  return entry.hooks[0]! as (input: unknown) => unknown
}

/** @param agentId 模拟 #679 后 skill 在 body-writer 子 Agent 内调用时 SDK 带上的 agent_id */
function runSkillPost(guard: Guard, skill: string, agentId?: string): void {
  const cb = postCbByMatcher(guard, 'Skill')
  cb({ hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill }, agent_id: agentId })
}
function runSubagentPost(guard: Guard, subagentType: string, toolName = 'Task'): void {
  const cb = postCbByMatcher(guard, 'Task|Agent')
  cb({ hook_event_name: 'PostToolUse', tool_name: toolName, tool_input: { subagent_type: subagentType } })
}
function runStop(guard: Guard, stopHookActive = false): unknown {
  const cb = guard.Stop[0]!.hooks[0]!
  return cb({ hook_event_name: 'Stop', stop_hook_active: stopHookActive })
}

describe('lit-review-factcheck-guard', () => {
  test('综述已产出但 fact-checker 未派发 → Stop block + 日志', () => {
    const logs: string[] = []
    const guard = createLitReviewFactcheckGuard('s1', (m) => logs.push(m))
    runSkillPost(guard, REVIEW_TERMINAL_SKILL)

    const out = runStop(guard) as { decision?: string; reason?: string }
    expect(out.decision).toBe('block')
    expect(out.reason).toContain(FACT_CHECKER_SUBAGENT)
    expect(out.reason).toContain('claim-level')
    expect(logs.length).toBe(1)
    expect(guard.readState().forced).toBe(true)
  })

  test('综述已产出 + fact-checker 已派发 → Stop 放行', () => {
    const guard = createLitReviewFactcheckGuard('s2')
    runSkillPost(guard, REVIEW_TERMINAL_SKILL)
    runSubagentPost(guard, FACT_CHECKER_SUBAGENT)

    expect(runStop(guard)).toEqual({})
    expect(guard.readState().factCheckerDispatched).toBe(true)
  })

  test('综述未产出（terminal_skill 未跑）→ Stop 不触发', () => {
    const guard = createLitReviewFactcheckGuard('s3')
    // 只派了 reader，没调 literature-review-result，也没派 fact-checker
    runSubagentPost(guard, 'reader')
    expect(runStop(guard)).toEqual({})
    expect(guard.readState().reviewSkillInvoked).toBe(false)
  })

  test('stop_hook_active → 放行（防循环）', () => {
    const guard = createLitReviewFactcheckGuard('s4')
    runSkillPost(guard, REVIEW_TERMINAL_SKILL)
    expect(runStop(guard, true)).toEqual({})
  })

  test('forced 后二次 Stop → 放行（防循环 block）', () => {
    const guard = createLitReviewFactcheckGuard('s5')
    runSkillPost(guard, REVIEW_TERMINAL_SKILL)
    const first = runStop(guard) as { decision?: string }
    expect(first.decision).toBe('block')
    expect(runStop(guard)).toEqual({}) // 第二次放行
  })

  test('非 literature-review-result Skill 不武装 guard', () => {
    const guard = createLitReviewFactcheckGuard('s6')
    runSkillPost(guard, 'lit-search-report')
    expect(runStop(guard)).toEqual({})
    expect(guard.readState().reviewSkillInvoked).toBe(false)
  })

  test('非 fact-checker 子 Agent 派发不置位 factCheckerDispatched', () => {
    const guard = createLitReviewFactcheckGuard('s7')
    runSkillPost(guard, REVIEW_TERMINAL_SKILL)
    runSubagentPost(guard, 'evidence-skimmer')
    const out = runStop(guard) as { decision?: string }
    expect(out.decision).toBe('block') // 仍因 fact-checker 未派发而触发
    expect(guard.readState().factCheckerDispatched).toBe(false)
  })

  test('Agent 工具名（SDK 新版）也能识别 fact-checker 派发', () => {
    const guard = createLitReviewFactcheckGuard('s8')
    runSkillPost(guard, REVIEW_TERMINAL_SKILL)
    runSubagentPost(guard, FACT_CHECKER_SUBAGENT, 'Agent')
    expect(runStop(guard)).toEqual({})
  })

  // ---- #679 后回归：综述正文改由 body-writer 子 Agent 隔离生成（issue #668）----

  test('#679 回归：仅 body-writer 派发（未观察到 Skill）+ fact-checker 未派发 → Stop block', () => {
    // #679 把综述写作搬进 body-writer 子 Agent。即使 guard 没观察到内层 literature-review-result
    // Skill 调用，body-writer 的 Task 派发（主层可靠信号）也应武装 guard。
    const guard = createLitReviewFactcheckGuard('s9')
    runSubagentPost(guard, BODY_WRITER_SUBAGENT)
    const out = runStop(guard) as { decision?: string; reason?: string }
    expect(out.decision).toBe('block')
    expect(out.reason).toContain(FACT_CHECKER_SUBAGENT)
    expect(guard.readState().bodyWriterDispatched).toBe(true)
  })

  test('#679 回归：body-writer 派发 + fact-checker 已派发 → Stop 放行', () => {
    const guard = createLitReviewFactcheckGuard('s10')
    runSubagentPost(guard, BODY_WRITER_SUBAGENT)
    runSubagentPost(guard, FACT_CHECKER_SUBAGENT)
    expect(runStop(guard)).toEqual({})
  })

  test('#679 后 Skill 在 body-writer 内（带 agent_id）调用仍能武装 guard', () => {
    // SDK 对子 Agent 内部工具调用同样触发主 query 的 PostToolUse，并带 agent_id 标记来源。
    // guard 不按 agent_id 过滤，故内层 Skill 信号仍生效（与 body-writer 派发互为冗余信号）。
    const guard = createLitReviewFactcheckGuard('s11')
    runSkillPost(guard, REVIEW_TERMINAL_SKILL, 'body-writer-agent-id')
    const out = runStop(guard) as { decision?: string }
    expect(out.decision).toBe('block')
    expect(guard.readState().reviewSkillInvoked).toBe(true)
  })

  test('body-writer 之外的 worker 子 Agent 派发不武装 guard', () => {
    const guard = createLitReviewFactcheckGuard('s12')
    runSubagentPost(guard, 'reader')
    runSubagentPost(guard, 'evidence-triager')
    expect(runStop(guard)).toEqual({})
    expect(guard.readState().bodyWriterDispatched).toBe(false)
  })
})
