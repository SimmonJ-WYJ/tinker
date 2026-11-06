/**
 * lit-review-terminal-skill-guard 行为单测（P0：lit-review 终结 skill 缺失保险网）
 *
 * 核心是**跨 query**真值表 —— reader 后台 fan-out 跨多个 query 完成，派 reader 的 query 与「该收口却没写
 * 综述」的 resume query 是不同 hook 闭包、共享同一个进程内 store。用注入的独立 Map 模拟这一点。
 *
 * 覆盖：
 *   - 派 reader 的同一 query Stop → 放行（worker 在途，本 query 派过子 Agent）
 *   - 跨 query：query A 派 reader（arm）→ query B 无派发无 skill → Stop block（核心卡死捕获）
 *   - 跨 query happy path：query B 调 literature-review-result → disarm → 该 query 及后续 query 放行
 *   - resume query 内「调 skill 后再派 fact-checker」→ 放行（综述已写出）
 *   - 非生成 worker（review-proposer）不武装；非 literature-review-result Skill 不 disarm
 *   - stop_hook_active / forced → 放行（防循环）
 *   - Agent 工具名（SDK 新版）也能武装
 */

import { describe, expect, test } from 'bun:test'

import {
  REVIEW_TERMINAL_SKILL,
  createLitReviewTerminalSkillGuard,
} from './lit-review-terminal-skill-guard.ts'

type Guard = ReturnType<typeof createLitReviewTerminalSkillGuard>

/** 新建一个「query」的 guard 实例，共享传入 store（模拟 assembleQueryOptions 每 query 重建闭包） */
function newQuery(sessionId: string, store: Map<string, boolean>, logs?: string[]): Guard {
  return createLitReviewTerminalSkillGuard(sessionId, {
    store,
    logger: logs ? (m) => logs.push(m) : () => {},
  })
}

function postCbByMatcher(guard: Guard, matcher: string): (input: unknown) => unknown {
  const entry = guard.PostToolUse.find((e) => e.matcher === matcher)!
  return entry.hooks[0]! as (input: unknown) => unknown
}
function runSubagentPost(guard: Guard, subagentType: string, toolName = 'Task'): void {
  postCbByMatcher(guard, 'Task|Agent')({
    hook_event_name: 'PostToolUse',
    tool_name: toolName,
    tool_input: { subagent_type: subagentType },
  })
}
function runSkillPost(guard: Guard, skill: string): void {
  postCbByMatcher(guard, 'Skill')({
    hook_event_name: 'PostToolUse',
    tool_name: 'Skill',
    tool_input: { skill },
  })
}
function runStop(guard: Guard, stopHookActive = false): { decision?: string; reason?: string } {
  return guard.Stop[0]!.hooks[0]!({
    hook_event_name: 'Stop',
    stop_hook_active: stopHookActive,
  }) as { decision?: string; reason?: string }
}

describe('lit-review-terminal-skill-guard', () => {
  test('派 reader 的同一 query Stop → 放行（worker 在途）', () => {
    const store = new Map<string, boolean>()
    const q = newQuery('s1', store)
    runSubagentPost(q, 'reader')
    expect(runStop(q)).toEqual({}) // 本 query 派过子 Agent → 不强制
    expect(q.readState().pending).toBe(true) // 但已 arm（跨 query 存活）
  })

  test('跨 query：A 派 reader（arm）→ B 无派发无 skill → Stop block（核心卡死捕获）', () => {
    const store = new Map<string, boolean>()
    const logs: string[] = []

    const qA = newQuery('s2', store, logs)
    runSubagentPost(qA, 'reader')
    expect(runStop(qA)).toEqual({}) // A 收尾：worker 在途，放行

    // resume query：主 Agent 本该调 terminal skill 却什么都没干就结束
    const qB = newQuery('s2', store, logs)
    const out = runStop(qB)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain(REVIEW_TERMINAL_SKILL)
    expect(qB.readState().forced).toBe(true)
    expect(logs.length).toBe(1)
  })

  test('跨 query happy path：B 调 literature-review-result → 该 query 与后续 query 均放行', () => {
    const store = new Map<string, boolean>()
    const qA = newQuery('s3', store)
    runSubagentPost(qA, 'evidence-triager') // arm

    const qB = newQuery('s3', store)
    runSkillPost(qB, REVIEW_TERMINAL_SKILL) // 写出综述 → disarm
    expect(runStop(qB)).toEqual({})
    expect(qB.readState().pending).toBe(false)

    // 再开一个 query 也不应再触发（已 disarm）
    const qC = newQuery('s3', store)
    expect(runStop(qC)).toEqual({})
  })

  test('resume query 内「调 skill 后再派 fact-checker」→ 放行（综述已写出）', () => {
    const store = new Map<string, boolean>()
    const qA = newQuery('s4', store)
    runSubagentPost(qA, 'reader') // arm

    const qB = newQuery('s4', store)
    runSkillPost(qB, REVIEW_TERMINAL_SKILL) // disarm + 本 query reviewSkillInvoked
    runSubagentPost(qB, 'fact-checker') // 后置派发（不在 worker 集合，不重新 arm）
    expect(runStop(qB)).toEqual({})
    expect(store.get('s4')).toBe(false)
  })

  test('非生成 worker（review-proposer）不武装 → 后续 query 放行', () => {
    const store = new Map<string, boolean>()
    const qA = newQuery('s5', store)
    runSubagentPost(qA, 'review-proposer') // Turn-1 方向提案，不 arm

    const qB = newQuery('s5', store)
    expect(runStop(qB)).toEqual({})
    expect(qB.readState().pending).toBe(false)
  })

  test('非 literature-review-result Skill 不 disarm', () => {
    const store = new Map<string, boolean>()
    const qA = newQuery('s6', store)
    runSubagentPost(qA, 'reader') // arm

    const qB = newQuery('s6', store)
    runSkillPost(qB, 'lit-search-report') // 无关 skill，不 disarm
    const out = runStop(qB)
    expect(out.decision).toBe('block') // 仍因 armed 且未调终结 skill 而触发
  })

  test('stop_hook_active → 放行（防循环）', () => {
    const store = new Map<string, boolean>([['s7', true]])
    const q = newQuery('s7', store)
    expect(runStop(q, true)).toEqual({})
  })

  test('forced 后同 query 二次 Stop → 放行（防循环 block）', () => {
    const store = new Map<string, boolean>([['s8', true]])
    const q = newQuery('s8', store)
    expect(runStop(q).decision).toBe('block')
    expect(runStop(q)).toEqual({}) // 第二次放行
  })

  test('Agent 工具名（SDK 新版）也能武装', () => {
    const store = new Map<string, boolean>()
    const qA = newQuery('s9', store)
    runSubagentPost(qA, 'reader', 'Agent') // 新版工具名
    expect(qA.readState().pending).toBe(true)

    const qB = newQuery('s9', store)
    expect(runStop(qB).decision).toBe('block')
  })
})
