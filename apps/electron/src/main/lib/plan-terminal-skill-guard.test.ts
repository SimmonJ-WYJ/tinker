/**
 * plan-terminal-skill-guard 行为单测（issue #575）
 *
 * 覆盖 AC 全部分支：
 *   - 主防线：缺标 general-query → 注入 additionalContext（验 terminal_skill 形状 + plan_summary 取值）
 *   - planner 已写 terminal_skill → 不重复注入
 *   - exact-lookup / citation-tracing → 不注入
 *   - 非 scenario / 非 PLAN / async_launched 变体 / 解析失败 → 不注入、不抛
 *   - display_count 多轮累加；< 阈值不触发保险网
 *   - Skill 标记 lit-search-report
 *   - 保险网 Stop 真值表：失效场景 → block + 日志；stop_hook_active / forced / 已交付 → 放行
 *   - extractSearchPlanFromTaskResponse 纯函数边界
 */

import { describe, expect, test } from 'bun:test'

import {
  AUTO_REPORT_MIN_RESULTS,
  LIT_SEARCH_PACK_ID,
  REPORT_SKILL_NAME,
  RETRIEVE_TOOL,
  PROCESS_SEARCH_RESULTS_TOOL,
  createPlanTerminalSkillGuard,
  extractSearchPlanFromTaskResponse,
} from './plan-terminal-skill-guard.ts'

type Guard = ReturnType<typeof createPlanTerminalSkillGuard>

// ─── helpers ────────────────────────────────────────────────────────────────

/** 始终命中 lit-search scenario 的 resolver */
const alwaysScenario = (): boolean => true

/** 把 PLAN 对象包成 scenario Task 的 AgentOutput 返回体 */
function taskResponse(planObj: unknown, opening = 'Searching now.'): unknown {
  const planText =
    typeof planObj === 'string'
      ? planObj
      : ['## SEARCH PLAN', '```json', JSON.stringify(planObj, null, 2), '```', 'Plan above — awaiting confirmation.'].join(
          '\n',
        )
  return {
    agentId: 'a-1',
    status: 'completed',
    content: [{ type: 'text', text: `${opening}\n\n${planText}` }],
  }
}

/** retrieve / process_search_results 的 MCP 返回体（content[].text 是顶层 JSON，两者同形） */
function resultCountResponse(displayCount: number): unknown {
  return { content: [{ type: 'text', text: JSON.stringify({ display_count: displayCount, sources: ['openalex'] }) }] }
}

/** 按 matcher 取 PostToolUse 回调，避免硬编码索引随 hook 顺序漂移 */
function postCbByMatcher(guard: Guard, matcher: string): (input: unknown) => unknown {
  const entry = guard.PostToolUse.find((e) => e.matcher === matcher)!
  return entry.hooks[0]! as (input: unknown) => unknown
}

function runSubagentPost(guard: Guard, toolInput: unknown, toolResponse: unknown, toolName = 'Task'): unknown {
  const cb = postCbByMatcher(guard, 'Task|Agent')
  return cb({ hook_event_name: 'PostToolUse', tool_name: toolName, tool_input: toolInput, tool_response: toolResponse })
}
/** 默认走 retrieve（现行主路径）；toolName 可切到 process_search_results（逃生路径） */
function runResultCountPost(guard: Guard, response: unknown, toolName: string = RETRIEVE_TOOL): void {
  const cb = postCbByMatcher(guard, toolName)
  cb({ hook_event_name: 'PostToolUse', tool_name: toolName, tool_response: response })
}
function runSkillPost(guard: Guard, skill: string): void {
  const cb = postCbByMatcher(guard, 'Skill')
  cb({ hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill } })
}
function runStop(guard: Guard, stopHookActive = false): unknown {
  const cb = guard.Stop[0]!.hooks[0]!
  return cb({ hook_event_name: 'Stop', stop_hook_active: stopHookActive })
}

function injectedContext(out: unknown): string | null {
  if (!out || typeof out !== 'object') return null
  const o = out as { hookSpecificOutput?: { additionalContext?: string } }
  return o.hookSpecificOutput?.additionalContext ?? null
}
function isBlock(out: unknown): boolean {
  return !!out && typeof out === 'object' && (out as { decision?: string }).decision === 'block'
}

const GENERAL_QUERY_NO_TERMINAL = {
  intent: 'general-query',
  keywords: ['long context', 'position encoding'],
  sources: ['openalex', 'crossref'],
  method_terms: ['RoPE', 'YaRN'],
  object_terms: ['large language model'],
  steps: [{ subagent_type: 'searcher', input: '...' }],
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────

describe('常量', () => {
  test('AUTO_REPORT_MIN_RESULTS = 20，与 scenario prompt / renderer 三处同值', () => {
    expect(AUTO_REPORT_MIN_RESULTS).toBe(20)
  })
  test('包 / Skill / 工具名常量', () => {
    expect(LIT_SEARCH_PACK_ID).toBe('lit-search')
    expect(REPORT_SKILL_NAME).toBe('lit-search-report')
    expect(PROCESS_SEARCH_RESULTS_TOOL).toBe('mcp__paper-search__process_search_results')
  })
})

// ─── 主防线注入矩阵 ────────────────────────────────────────────────────────────

describe('主防线（PostToolUse on Task|Agent）', () => {
  test('AC1：缺标 general-query → 注入 additionalContext + 登记状态（注入内容形状见下条结构化断言）', () => {
    const guard = createPlanTerminalSkillGuard('s-1', alwaysScenario, () => {})
    const out = runSubagentPost(guard, { subagent_type: 'lit-search' }, taskResponse(GENERAL_QUERY_NO_TERMINAL))
    expect(injectedContext(out)).not.toBeNull()
    expect(guard.readState().injected).toBe(true)
    expect(guard.readState().planIntent).toBe('general-query')
  })

  test('注入的 terminal_skill 是合法 JSON，形状与协议一致', () => {
    const guard = createPlanTerminalSkillGuard('s-1b', alwaysScenario, () => {})
    const ctx = injectedContext(
      runSubagentPost(guard, { subagent_type: 'lit-search' }, taskResponse(GENERAL_QUERY_NO_TERMINAL)),
    )!
    const fence = ctx.match(/```json\n([\s\S]*?)```/)
    expect(fence).not.toBeNull()
    const parsed = JSON.parse(fence![1]!) as {
      name: string
      condition: string
      input: { plan_summary: { keywords: string[]; sources: string[]; method_terms: string[]; object_terms: string[] } }
    }
    expect(parsed.name).toBe(REPORT_SKILL_NAME)
    expect(parsed.condition).toBe(`process_search_results.display_count >= ${AUTO_REPORT_MIN_RESULTS}`)
    expect(parsed.input.plan_summary.keywords).toEqual(['long context', 'position encoding'])
    expect(parsed.input.plan_summary.method_terms).toEqual(['RoPE', 'YaRN'])
    // outputLanguage 不由 guard 填，留主 Agent
    expect((parsed.input as Record<string, unknown>).outputLanguage).toBeUndefined()
  })

  test('planner 已写 terminal_skill → 不重复注入', () => {
    const guard = createPlanTerminalSkillGuard('s-2', alwaysScenario, () => {})
    const withTerminal = {
      ...GENERAL_QUERY_NO_TERMINAL,
      terminal_skill: { name: REPORT_SKILL_NAME, condition: 'process_search_results.display_count >= 20' },
    }
    const out = runSubagentPost(guard, { subagent_type: 'lit-search' }, taskResponse(withTerminal))
    expect(injectedContext(out)).toBeNull()
    expect(guard.readState().injected).toBe(false)
    expect(guard.readState().planIntent).toBe('general-query')
  })

  test('AC2：exact-lookup → 不注入（但仍登记 intent）', () => {
    const guard = createPlanTerminalSkillGuard('s-3', alwaysScenario, () => {})
    const out = runSubagentPost(
      guard,
      { subagent_type: 'lit-search' },
      taskResponse({ intent: 'exact-lookup', keywords: ['x'], steps: [] }),
    )
    expect(injectedContext(out)).toBeNull()
    expect(guard.readState().planIntent).toBe('exact-lookup')
  })

  test('AC2：citation-tracing → 不注入', () => {
    const guard = createPlanTerminalSkillGuard('s-4', alwaysScenario, () => {})
    const out = runSubagentPost(
      guard,
      { subagent_type: 'lit-search' },
      taskResponse({ intent: 'citation-tracing', keywords: ['x'], steps: [] }),
    )
    expect(injectedContext(out)).toBeNull()
    expect(guard.readState().planIntent).toBe('citation-tracing')
  })

  test('非 scenario（resolver=false）→ 不注入、不登记', () => {
    const guard = createPlanTerminalSkillGuard('s-5', () => false, () => {})
    const out = runSubagentPost(guard, { subagent_type: 'searcher' }, taskResponse(GENERAL_QUERY_NO_TERMINAL))
    expect(injectedContext(out)).toBeNull()
    expect(guard.readState().planIntent).toBeNull()
  })

  test('Agent 双名同样被 isSubagentToolUse 命中', () => {
    const guard = createPlanTerminalSkillGuard('s-5b', alwaysScenario, () => {})
    const out = runSubagentPost(
      guard,
      { subagent_type: 'lit-search' },
      taskResponse(GENERAL_QUERY_NO_TERMINAL),
      'Agent',
    )
    expect(injectedContext(out)).not.toBeNull()
  })

  test('非派发工具名（Read 等）→ 跳过', () => {
    const guard = createPlanTerminalSkillGuard('s-5c', alwaysScenario, () => {})
    const out = runSubagentPost(guard, { subagent_type: 'lit-search' }, taskResponse(GENERAL_QUERY_NO_TERMINAL), 'Read')
    expect(out).toEqual({})
    expect(guard.readState().planIntent).toBeNull()
  })

  test('async_launched 变体（无 content）→ 不注入、不抛', () => {
    const guard = createPlanTerminalSkillGuard('s-6', alwaysScenario, () => {})
    const out = runSubagentPost(guard, { subagent_type: 'lit-search' }, {
      status: 'async_launched',
      agentId: 'x',
      description: 'd',
      prompt: 'p',
      outputFile: '/tmp/x',
    })
    expect(injectedContext(out)).toBeNull()
    expect(guard.readState().planIntent).toBeNull()
  })

  test('解析失败（无 PLAN fence）→ 不注入、不抛，落日志', () => {
    const logs: string[] = []
    const guard = createPlanTerminalSkillGuard('s-7', alwaysScenario, (m) => logs.push(m))
    const out = runSubagentPost(guard, { subagent_type: 'lit-search' }, {
      status: 'completed',
      agentId: 'x',
      content: [{ type: 'text', text: 'no plan here, just prose' }],
    })
    expect(injectedContext(out)).toBeNull()
    expect(logs.some((l) => l.includes('未解析出 SEARCH PLAN'))).toBe(true)
  })

  test('resolver 抛错被 swallow，不影响流程', () => {
    const guard = createPlanTerminalSkillGuard('s-7b', () => {
      throw new Error('registry boom')
    }, () => {})
    const out = runSubagentPost(guard, { subagent_type: 'lit-search' }, taskResponse(GENERAL_QUERY_NO_TERMINAL))
    expect(out).toEqual({})
  })

  test('matcher：派发双名 / retrieve / process_search_results / Skill 都在链上', () => {
    const guard = createPlanTerminalSkillGuard('s-8', alwaysScenario, () => {})
    const matchers = guard.PostToolUse.map((e) => e.matcher)
    expect(matchers).toContain('Task|Agent')
    expect(matchers).toContain(RETRIEVE_TOOL)
    expect(matchers).toContain(PROCESS_SEARCH_RESULTS_TOOL)
    expect(matchers).toContain('Skill')
    expect(guard.Stop[0]!.matcher).toBe('*')
  })
})

// ─── display_count 累计 ────────────────────────────────────────────────────────

describe('display_count 累计 + Skill 标记', () => {
  test('多轮 display_count 求和（retrieve 主路径）', () => {
    const guard = createPlanTerminalSkillGuard('s-9', alwaysScenario, () => {})
    runResultCountPost(guard, resultCountResponse(12))
    runResultCountPost(guard, resultCountResponse(15))
    expect(guard.readState().displayCountSum).toBe(27)
  })

  test('retrieve（现行主路径，searcher 唯一一次调用）的 display_count 被计入', () => {
    const guard = createPlanTerminalSkillGuard('s-9-retrieve', alwaysScenario, () => {})
    runResultCountPost(guard, resultCountResponse(22), RETRIEVE_TOOL)
    expect(guard.readState().displayCountSum).toBe(22)
  })

  test('process_search_results（逃生路径）的 display_count 也被计入', () => {
    const guard = createPlanTerminalSkillGuard('s-9-escape', alwaysScenario, () => {})
    runResultCountPost(guard, resultCountResponse(21), PROCESS_SEARCH_RESULTS_TOOL)
    expect(guard.readState().displayCountSum).toBe(21)
  })

  test('display_count 非数字 / 解析失败 → 不累加', () => {
    const guard = createPlanTerminalSkillGuard('s-9b', alwaysScenario, () => {})
    runResultCountPost(guard, { content: [{ type: 'text', text: '{not json' }] })
    runResultCountPost(guard, { content: [{ type: 'text', text: JSON.stringify({ sources: [] }) }] })
    expect(guard.readState().displayCountSum).toBe(0)
  })

  test('Skill(lit-search-report) → 标记已调用；其他 skill 不标记', () => {
    const guard = createPlanTerminalSkillGuard('s-10', alwaysScenario, () => {})
    runSkillPost(guard, 'some-other-skill')
    expect(guard.readState().reportSkillInvoked).toBe(false)
    runSkillPost(guard, REPORT_SKILL_NAME)
    expect(guard.readState().reportSkillInvoked).toBe(true)
  })
})

// ─── 保险网 Stop 真值表 ─────────────────────────────────────────────────────────

describe('保险网（Stop hook）', () => {
  test('AC3：主防线失效（general-query 无 terminal_skill 未调报告）+ sum>=20 → block + 日志', () => {
    const logs: string[] = []
    const guard = createPlanTerminalSkillGuard('s-11', alwaysScenario, (m) => logs.push(m))
    runSubagentPost(guard, { subagent_type: 'lit-search' }, taskResponse(GENERAL_QUERY_NO_TERMINAL))
    runResultCountPost(guard, resultCountResponse(25))
    const out = runStop(guard)
    expect(isBlock(out)).toBe(true)
    expect((out as { reason: string }).reason).toContain(REPORT_SKILL_NAME)
    expect(logs.some((l) => l.includes('保险网触发') && l.includes('s-11') && l.includes('25'))).toBe(true)
    expect(guard.readState().forced).toBe(true)
  })

  // 文档测试：保险网只看 planIntent，不看 PLAN 是否自带 terminal_skill。故「planner 写对了但
  // 主 Agent 漏执行」与 s-11 走同一 Stop 分支——本例钉住这层设计意图（dispatch protocol 执行端漏洞也被兜住）。
  test('planner 写对了但主 Agent 漏执行（PLAN 自带 terminal_skill 仍未调报告）→ 同样兜底 block', () => {
    const guard = createPlanTerminalSkillGuard('s-11b', alwaysScenario, () => {})
    const withTerminal = {
      ...GENERAL_QUERY_NO_TERMINAL,
      terminal_skill: { name: REPORT_SKILL_NAME, condition: 'process_search_results.display_count >= 20' },
    }
    runSubagentPost(guard, { subagent_type: 'lit-search' }, taskResponse(withTerminal))
    runResultCountPost(guard, resultCountResponse(30))
    expect(isBlock(runStop(guard))).toBe(true)
  })

  test('AC4：display_count < 20 → 不触发', () => {
    const guard = createPlanTerminalSkillGuard('s-12', alwaysScenario, () => {})
    runSubagentPost(guard, { subagent_type: 'lit-search' }, taskResponse(GENERAL_QUERY_NO_TERMINAL))
    runResultCountPost(guard, resultCountResponse(19))
    expect(runStop(guard)).toEqual({})
  })

  test('报告已被主 Agent 调用 → 放行（理想路径）', () => {
    const guard = createPlanTerminalSkillGuard('s-13', alwaysScenario, () => {})
    runSubagentPost(guard, { subagent_type: 'lit-search' }, taskResponse(GENERAL_QUERY_NO_TERMINAL))
    runResultCountPost(guard, resultCountResponse(25))
    runSkillPost(guard, REPORT_SKILL_NAME)
    expect(runStop(guard)).toEqual({})
  })

  test('非 general-query（exact-lookup）即使 sum>=20 → 不触发', () => {
    const guard = createPlanTerminalSkillGuard('s-14', alwaysScenario, () => {})
    runSubagentPost(
      guard,
      { subagent_type: 'lit-search' },
      taskResponse({ intent: 'exact-lookup', keywords: ['x'], steps: [] }),
    )
    runResultCountPost(guard, resultCountResponse(40))
    expect(runStop(guard)).toEqual({})
  })

  test('从未见过 PLAN（planIntent=null）→ 不触发', () => {
    const guard = createPlanTerminalSkillGuard('s-14b', alwaysScenario, () => {})
    runResultCountPost(guard, resultCountResponse(40))
    expect(runStop(guard)).toEqual({})
  })

  test('防循环：stop_hook_active=true → 放行', () => {
    const guard = createPlanTerminalSkillGuard('s-15', alwaysScenario, () => {})
    runSubagentPost(guard, { subagent_type: 'lit-search' }, taskResponse(GENERAL_QUERY_NO_TERMINAL))
    runResultCountPost(guard, resultCountResponse(25))
    expect(runStop(guard, /* stopHookActive */ true)).toEqual({})
    expect(guard.readState().forced).toBe(false)
  })

  test('防循环：第二次 Stop 经 forced 放行', () => {
    const guard = createPlanTerminalSkillGuard('s-16', alwaysScenario, () => {})
    runSubagentPost(guard, { subagent_type: 'lit-search' }, taskResponse(GENERAL_QUERY_NO_TERMINAL))
    runResultCountPost(guard, resultCountResponse(25))
    expect(isBlock(runStop(guard))).toBe(true)
    expect(runStop(guard)).toEqual({}) // forced=true → 放行
  })
})

// ─── 纯函数边界 ────────────────────────────────────────────────────────────────

describe('extractSearchPlanFromTaskResponse', () => {
  test('completed 变体 content[].text 拼接 → 解析 PLAN', () => {
    const plan = extractSearchPlanFromTaskResponse(taskResponse(GENERAL_QUERY_NO_TERMINAL))
    expect(plan?.intent).toBe('general-query')
    expect(plan?.hasTerminalSkill).toBe(false)
    expect(plan?.planSummary.keywords).toEqual(['long context', 'position encoding'])
  })

  test('string 兜底', () => {
    const text = ['## SEARCH PLAN', '```json', JSON.stringify(GENERAL_QUERY_NO_TERMINAL), '```'].join('\n')
    expect(extractSearchPlanFromTaskResponse(text)?.intent).toBe('general-query')
  })

  test('多 fence：跳过无 intent 的 fence，取 PLAN fence', () => {
    const text = [
      '```json',
      '{ "note": "not a plan" }',
      '```',
      '## SEARCH PLAN',
      '```json',
      JSON.stringify(GENERAL_QUERY_NO_TERMINAL),
      '```',
    ].join('\n')
    expect(extractSearchPlanFromTaskResponse(text)?.intent).toBe('general-query')
  })

  test('hasTerminalSkill：planner 已写 → true', () => {
    const withTerminal = { ...GENERAL_QUERY_NO_TERMINAL, terminal_skill: { name: REPORT_SKILL_NAME } }
    expect(extractSearchPlanFromTaskResponse(taskResponse(withTerminal))?.hasTerminalSkill).toBe(true)
  })

  test('缺字段 → planSummary 各项回落空数组', () => {
    const plan = extractSearchPlanFromTaskResponse(taskResponse({ intent: 'general-query', steps: [] }))
    expect(plan?.planSummary).toEqual({ keywords: [], sources: [], method_terms: [], object_terms: [] })
  })

  test('无 content / 非对象 / 无 fence → null', () => {
    expect(extractSearchPlanFromTaskResponse(null)).toBeNull()
    expect(extractSearchPlanFromTaskResponse(42)).toBeNull()
    expect(extractSearchPlanFromTaskResponse({ status: 'async_launched', agentId: 'x' })).toBeNull()
    expect(extractSearchPlanFromTaskResponse({ content: [{ type: 'text', text: 'prose only' }] })).toBeNull()
  })
})
