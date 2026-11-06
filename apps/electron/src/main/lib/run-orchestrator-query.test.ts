import { afterEach, describe, expect, it } from 'bun:test'
import type { WorkspaceEvent } from '@asci/shared'
import { createInMemorySubagentRegistry } from './subagent-registry.ts'
import { seedBuiltinSubagents } from './subagent-registry-seed.ts'
import { assembleQueryOptions } from './run-orchestrator-query.ts'
import type { SpanSink } from './subagent-spans-hook.ts'
import { workspaceEventBus } from './workspace-event-bus.ts'

const mockSink: SpanSink = { append: () => {}, update: () => {} }

describe('assembleQueryOptions（runOrchestratorQuery 的 options 装配）', () => {
  // 测试中 baseOptions 用 `as never` cast —— ClaudeAgentQueryOptions 有 10+ 必填字段，
  // 本组测试只验证 options 装配（agents 注入 / 字段透传），不触发 adapter.query() 实际调用路径，
  // 故 cast 安全。如未来 assembleQueryOptions 开始读取这些字段，需补全 fixture。

  it('options.agents 由 registry.snapshot() 提供（snapshot 机制验证 — 数据来源由 caller 注入）', () => {
    // 0.2 后 worker SubAgent 从 builtin seed 搬到能力包加载（lit-search / lit-review）；
    // 本测只验证"snapshot 机制本身一致"，故手工 register 两条 capability-pack 条目代表数据来源。
    // 真实 builtin / pack 路径的覆盖见 capability-pack-loader.test.ts 与 a3-acceptance 测试。
    const registry = createInMemorySubagentRegistry()
    registry.register({
      kind: 'subagent', name: 'searcher', source: 'capability-pack', packId: 'lit-search',
      def: { description: 'Search strategist', prompt: 'You are searcher.' },
    })
    registry.register({
      kind: 'subagent', name: 'synthesizer', source: 'capability-pack', packId: 'lit-review',
      def: { description: 'Synthesizer', prompt: 'You are synthesizer.' },
    })

    const result = assembleQueryOptions({
      sessionId: 'sess-1',
      registry,
      sink: mockSink,
      baseOptions: { sessionId: 'sess-1', prompt: 'test' } as never,
    })

    expect(Object.keys(result.agents ?? {}).sort()).toEqual(['searcher', 'synthesizer'])
  })

  it('A0 锚点：新增 mock 子 Agent 后 snapshot 自动包含', () => {
    const registry = createInMemorySubagentRegistry()
    seedBuiltinSubagents(registry, { claudeAvailable: true, language: 'en' })
    registry.register({
      kind: 'subagent',
      name: 'mock-x',
      source: 'user-config',
      def: { description: 'mock', prompt: 'You are mock-x.' },
    })

    const result = assembleQueryOptions({
      sessionId: 'sess-1',
      registry,
      sink: mockSink,
      baseOptions: { sessionId: 'sess-1', prompt: 'test' } as never,
    })

    expect(result.agents?.['mock-x']).toBeDefined()
  })

  it('baseOptions 中其他字段（prompt / cwd / model / env）透传不动', () => {
    const registry = createInMemorySubagentRegistry()
    const baseOptions = {
      sessionId: 'sess-1',
      prompt: 'hello',
      cwd: '/tmp/foo',
      model: 'sonnet',
      env: { FOO: 'bar' },
    } as never

    const result = assembleQueryOptions({
      sessionId: 'sess-1',
      registry,
      sink: mockSink,
      baseOptions,
    })
    expect(result.prompt).toBe('hello')
    expect(result.cwd).toBe('/tmp/foo')
    expect(result.model).toBe('sonnet')
    expect(result.env).toEqual({ FOO: 'bar' })
  })
})

describe('assembleQueryOptions hooks 合并（A0a）', () => {
  it('options.hooks.SubagentStart / SubagentStop 出现且非空', () => {
    const registry = createInMemorySubagentRegistry()
    const sinkSpans: unknown[] = []
    const sink = {
      append: (_sid: string, span: unknown) => sinkSpans.push(span),
      update: () => {},
    }
    const result = assembleQueryOptions({
      sessionId: 'sess-1',
      registry,
      sink,
      baseOptions: { sessionId: 'sess-1', prompt: 'test', hooks: {} } as never,
    })
    expect((result.hooks as Record<string, unknown>)?.SubagentStart).toBeDefined()
    expect((result.hooks as Record<string, unknown>)?.SubagentStop).toBeDefined()
  })

  it('保留 baseOptions.hooks 中已有的 PreToolUse / PostToolUse', () => {
    const registry = createInMemorySubagentRegistry()
    const myPreHook = () => {}
    const result = assembleQueryOptions({
      sessionId: 'sess-1',
      registry,
      sink: mockSink,
      baseOptions: {
        sessionId: 'sess-1',
        prompt: 'test',
        hooks: { PreToolUse: [{ matcher: '*', hooks: [myPreHook] }] },
      } as never,
    })
    const hooks = result.hooks as Record<string, { matcher: string; hooks: (() => void)[] }[]>
    expect(hooks?.PreToolUse?.[0]?.hooks?.[0]).toBe(myPreHook)
    expect(hooks?.SubagentStart).toBeDefined()
  })

  it('baseOptions.hooks.SubagentStart 已含 entry 时，合并后是 concat 而非 overwrite', () => {
    const registry = createInMemorySubagentRegistry()
    const existingStartHook = () => {}
    const result = assembleQueryOptions({
      sessionId: 'sess-1',
      registry,
      sink: mockSink,
      baseOptions: {
        sessionId: 'sess-1',
        prompt: 'test',
        hooks: {
          SubagentStart: [{ matcher: 'pre', hooks: [existingStartHook] }],
        },
      } as never,
    })
    // 合并后应该至少 2 项：现有 1 项 + span hooks 1 项
    expect(result.hooks?.SubagentStart?.length ?? 0).toBeGreaterThanOrEqual(2)
    // 现有的 hook entry 保留在数组里
    expect(result.hooks?.SubagentStart?.[0]?.hooks?.[0]).toBe(existingStartHook)
  })
})

describe('assembleQueryOptions pack.taskCompleted 接入（spec §3.1 #9）', () => {
  afterEach(() => {
    workspaceEventBus.dispose()
  })

  it('SubagentStop 命中 capability-pack scenario Agent → emit pack.taskCompleted', () => {
    const registry = createInMemorySubagentRegistry()
    registry.register({
      kind: 'subagent',
      name: 'lit-search',
      source: 'capability-pack',
      packId: 'lit-search',
      role: 'scenario',
      def: { description: 'mock scenario', prompt: 'You are scenario.' },
    })
    const events: WorkspaceEvent[] = []
    workspaceEventBus.on('pack.taskCompleted', (e) => events.push(e))

    const result = assembleQueryOptions({
      sessionId: 'sess-42',
      registry,
      sink: mockSink,
      baseOptions: { sessionId: 'sess-42', prompt: 'test', hooks: {} } as never,
    })

    const stopHooks = (result.hooks as Record<string, Array<{ matcher: string; hooks: ((input: unknown) => void)[] }>>)
      ?.SubagentStop ?? []
    // 期待至少 2 项：span hook + pack hook
    expect(stopHooks.length).toBeGreaterThanOrEqual(2)
    // 触发所有 SubagentStop hook 回调，模拟 SDK 上报
    for (const entry of stopHooks) {
      for (const hook of entry.hooks) {
        hook({ hook_event_name: 'SubagentStop', subagent_type: 'lit-search', success: true })
      }
    }
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'pack.taskCompleted',
      packId: 'lit-search',
      scenarioAgentName: 'lit-search',
      sessionId: 'sess-42',
      success: true,
    })
  })

  it('SubagentStop 命中 capability-pack worker subAgent（role !== scenario）→ 不 emit', () => {
    // 防止 PLAN 派活流程中 worker（searcher / reader）中途完成被误当成场景收口，
    // 既会让 D2 sticky 抖到 worker 所在包，也会污染 pack.taskCompleted 语义。
    const registry = createInMemorySubagentRegistry()
    registry.register({
      kind: 'subagent',
      name: 'searcher',
      source: 'capability-pack',
      packId: 'lit-search',
      role: 'worker',
      def: { description: 'worker', prompt: 'You are worker.' },
    })
    const events: WorkspaceEvent[] = []
    workspaceEventBus.on('pack.taskCompleted', (e) => events.push(e))

    const result = assembleQueryOptions({
      sessionId: 'sess-99',
      registry,
      sink: mockSink,
      baseOptions: { sessionId: 'sess-99', prompt: 'test', hooks: {} } as never,
    })

    const stopHooks = (result.hooks as Record<string, Array<{ matcher: string; hooks: ((input: unknown) => void)[] }>>)
      ?.SubagentStop ?? []
    for (const entry of stopHooks) {
      for (const hook of entry.hooks) {
        hook({ hook_event_name: 'SubagentStop', subagent_type: 'searcher', success: true })
      }
    }
    expect(events).toHaveLength(0)
  })

  it('SubagentStop 命中 builtin（如 searcher）→ 不 emit', () => {
    const registry = createInMemorySubagentRegistry()
    seedBuiltinSubagents(registry, { claudeAvailable: true, language: 'en' })
    const events: WorkspaceEvent[] = []
    workspaceEventBus.on('pack.taskCompleted', (e) => events.push(e))

    const result = assembleQueryOptions({
      sessionId: 'sess-1',
      registry,
      sink: mockSink,
      baseOptions: { sessionId: 'sess-1', prompt: 'test', hooks: {} } as never,
    })

    const stopHooks = (result.hooks as Record<string, Array<{ matcher: string; hooks: ((input: unknown) => void)[] }>>)
      ?.SubagentStop ?? []
    for (const entry of stopHooks) {
      for (const hook of entry.hooks) {
        hook({ hook_event_name: 'SubagentStop', subagent_type: 'searcher', success: true })
      }
    }
    expect(events).toHaveLength(0)
  })
})

describe('assembleQueryOptions paper-meta-cap 接入（spec §5.6）', () => {
  // 验证 PreToolUse / PostToolUse 链上正确串入 cap=3 / fail≥2 早停的 hook，
  // 不重复 paper-meta-cap-hook 内部行为的细节断言（那些在 paper-meta-cap-hook.test.ts 里）。

  it('PreToolUse / PostToolUse 链含 mcp__paper-search__get_paper_meta matcher 的 entry', () => {
    const registry = createInMemorySubagentRegistry()
    const result = assembleQueryOptions({
      sessionId: 'sess-1',
      registry,
      sink: mockSink,
      baseOptions: { sessionId: 'sess-1', prompt: 'test', hooks: {} } as never,
    })
    const preHooks = (result.hooks as Record<string, Array<{ matcher: string }>>)?.PreToolUse ?? []
    const postHooks = (result.hooks as Record<string, Array<{ matcher: string }>>)?.PostToolUse ?? []
    expect(preHooks.some((e) => e.matcher === 'mcp__paper-search__get_paper_meta')).toBe(true)
    expect(postHooks.some((e) => e.matcher === 'mcp__paper-search__get_paper_meta')).toBe(true)
  })

  it('baseOptions.hooks.PreToolUse 已有 entry 时合并而非覆盖', () => {
    const registry = createInMemorySubagentRegistry()
    const existingPre = () => ({})
    const result = assembleQueryOptions({
      sessionId: 'sess-1',
      registry,
      sink: mockSink,
      baseOptions: {
        sessionId: 'sess-1',
        prompt: 'test',
        hooks: { PreToolUse: [{ matcher: '*', hooks: [existingPre] }] },
      } as never,
    })
    const preHooks = (result.hooks as Record<string, Array<{ matcher: string; hooks: (() => unknown)[] }>>)
      ?.PreToolUse ?? []
    expect(preHooks.length).toBeGreaterThanOrEqual(2)
    expect(preHooks[0]!.hooks[0]).toBe(existingPre)
  })

  it('端到端：4 次 get_paper_meta，第 4 次被 deny（cap=3）', () => {
    const registry = createInMemorySubagentRegistry()
    const result = assembleQueryOptions({
      sessionId: 'sess-1',
      registry,
      sink: mockSink,
      baseOptions: { sessionId: 'sess-1', prompt: 'test', hooks: {} } as never,
    })

    const preEntry = (
      result.hooks as Record<string, Array<{ matcher: string; hooks: ((input: unknown) => unknown)[] }>>
    )?.PreToolUse?.find((e) => e.matcher === 'mcp__paper-search__get_paper_meta')!
    const postEntry = (
      result.hooks as Record<string, Array<{ matcher: string; hooks: ((input: unknown) => unknown)[] }>>
    )?.PostToolUse?.find((e) => e.matcher === 'mcp__paper-search__get_paper_meta')!

    const pre = preEntry.hooks[0]!
    const post = postEntry.hooks[0]!
    const fakeSuccess = { content: [{ type: 'text', text: 'ok' }] }
    const callOnce = (): unknown => {
      const decision = pre({ hook_event_name: 'PreToolUse', tool_name: 'mcp__paper-search__get_paper_meta' })
      // 模拟 SDK：未 deny 时调用 tool 并触发 PostToolUse
      if (!decision || typeof decision !== 'object' ||
          !('hookSpecificOutput' in decision) ||
          (decision as { hookSpecificOutput?: { permissionDecision?: string } })
            .hookSpecificOutput?.permissionDecision !== 'deny') {
        post({
          hook_event_name: 'PostToolUse',
          tool_name: 'mcp__paper-search__get_paper_meta',
          tool_response: fakeSuccess,
        })
      }
      return decision
    }

    expect(callOnce()).toEqual({})
    expect(callOnce()).toEqual({})
    expect(callOnce()).toEqual({})
    const fourth = callOnce() as { hookSpecificOutput: { permissionDecision: string } }
    expect(fourth.hookSpecificOutput.permissionDecision).toBe('deny')
  })
})

describe('assembleQueryOptions plan-terminal-skill guard 接入（issue #575）', () => {
  // 验证 PostToolUse / Stop 链上正确串入 guard hook；不重复 guard 内部行为细节断言
  // （那些在 plan-terminal-skill-guard.test.ts 里）。

  it('PostToolUse 链含 Task|Agent / retrieve / process_search_results / Skill matcher 的 entry', () => {
    const registry = createInMemorySubagentRegistry()
    const result = assembleQueryOptions({
      sessionId: 'sess-1',
      registry,
      sink: mockSink,
      baseOptions: { sessionId: 'sess-1', prompt: 'test', hooks: {} } as never,
    })
    const postHooks = (result.hooks as Record<string, Array<{ matcher: string }>>)?.PostToolUse ?? []
    expect(postHooks.some((e) => e.matcher === 'Task|Agent')).toBe(true)
    expect(postHooks.some((e) => e.matcher === 'mcp__paper-search__retrieve')).toBe(true)
    expect(postHooks.some((e) => e.matcher === 'mcp__paper-search__process_search_results')).toBe(true)
    expect(postHooks.some((e) => e.matcher === 'Skill')).toBe(true)
  })

  it('Stop 键出现且非空', () => {
    const registry = createInMemorySubagentRegistry()
    const result = assembleQueryOptions({
      sessionId: 'sess-1',
      registry,
      sink: mockSink,
      baseOptions: { sessionId: 'sess-1', prompt: 'test', hooks: {} } as never,
    })
    const stopHooks = (result.hooks as Record<string, unknown[]>)?.Stop ?? []
    expect(stopHooks.length).toBeGreaterThanOrEqual(1)
  })

  it('baseOptions.hooks.Stop 已含 entry 时合并而非覆盖', () => {
    const registry = createInMemorySubagentRegistry()
    const existingStop = () => ({})
    const result = assembleQueryOptions({
      sessionId: 'sess-1',
      registry,
      sink: mockSink,
      baseOptions: {
        sessionId: 'sess-1',
        prompt: 'test',
        hooks: { Stop: [{ matcher: '*', hooks: [existingStop] }] },
      } as never,
    })
    const stopHooks = (result.hooks as Record<string, Array<{ matcher: string; hooks: (() => unknown)[] }>>)?.Stop ?? []
    expect(stopHooks.length).toBeGreaterThanOrEqual(2)
    expect(stopHooks[0]!.hooks[0]).toBe(existingStop)
  })

  it('端到端：lit-search scenario 漏写 terminal_skill 的 general-query PLAN → 注入；sum>=20 未调报告 → Stop block', () => {
    const registry = createInMemorySubagentRegistry()
    registry.register({
      kind: 'subagent',
      name: 'lit-search',
      source: 'capability-pack',
      packId: 'lit-search',
      role: 'scenario',
      def: { description: 'scenario', prompt: 'You are scenario.' },
    })
    const result = assembleQueryOptions({
      sessionId: 'sess-575',
      registry,
      sink: mockSink,
      baseOptions: { sessionId: 'sess-575', prompt: 'test', hooks: {} } as never,
    })
    const post = (result.hooks as Record<string, Array<{ matcher: string; hooks: ((i: unknown) => unknown)[] }>>)
      ?.PostToolUse ?? []
    const stop = (result.hooks as Record<string, Array<{ matcher: string; hooks: ((i: unknown) => unknown)[] }>>)
      ?.Stop ?? []
    const taskCb = post.find((e) => e.matcher === 'Task|Agent')!.hooks[0]!
    // 现行主路径：searcher 调 retrieve（非 process_search_results）—— 计数必须从 retrieve 取 display_count
    const retrieveCb = post.find((e) => e.matcher === 'mcp__paper-search__retrieve')!.hooks[0]!
    const stopCb = stop[0]!.hooks[0]!

    const planText = [
      '## SEARCH PLAN',
      '```json',
      JSON.stringify({ intent: 'general-query', keywords: ['x'], sources: ['openalex'], steps: [] }),
      '```',
    ].join('\n')
    const injected = taskCb({
      hook_event_name: 'PostToolUse',
      tool_name: 'Task',
      tool_input: { subagent_type: 'lit-search' },
      tool_response: { status: 'completed', agentId: 'a', content: [{ type: 'text', text: planText }] },
    }) as { hookSpecificOutput?: { additionalContext?: string } }
    expect(injected.hookSpecificOutput?.additionalContext).toContain('lit-search-report')

    retrieveCb({
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__paper-search__retrieve',
      tool_response: { content: [{ type: 'text', text: JSON.stringify({ display_count: 25, sources: ['openalex'] }) }] },
    })
    const stopOut = stopCb({ hook_event_name: 'Stop', stop_hook_active: false }) as { decision?: string }
    expect(stopOut.decision).toBe('block')
  })

  it('非 lit-search 包的 scenario（如 lit-review）→ 不注入 lit-search-report', () => {
    const registry = createInMemorySubagentRegistry()
    registry.register({
      kind: 'subagent',
      name: 'lit-review',
      source: 'capability-pack',
      packId: 'lit-review',
      role: 'scenario',
      def: { description: 'scenario', prompt: 'You are scenario.' },
    })
    const result = assembleQueryOptions({
      sessionId: 'sess-lr',
      registry,
      sink: mockSink,
      baseOptions: { sessionId: 'sess-lr', prompt: 'test', hooks: {} } as never,
    })
    const post = (result.hooks as Record<string, Array<{ matcher: string; hooks: ((i: unknown) => unknown)[] }>>)
      ?.PostToolUse ?? []
    const taskCb = post.find((e) => e.matcher === 'Task|Agent')!.hooks[0]!
    const planText = ['## SEARCH PLAN', '```json', JSON.stringify({ intent: 'general-query', steps: [] }), '```'].join('\n')
    const out = taskCb({
      hook_event_name: 'PostToolUse',
      tool_name: 'Task',
      tool_input: { subagent_type: 'lit-review' },
      tool_response: { status: 'completed', agentId: 'a', content: [{ type: 'text', text: planText }] },
    })
    expect(out).toEqual({})
  })
})

describe('assembleQueryOptions plan-confirm-gate guard 接入（issue #774）', () => {
  // 用真 SubagentRegistry（注册真实 lit-search scenario 名）+ 真 assembleQueryOptions 装配链，
  // 确定性构造「跳门」：scenario 给出含 confirm 的 PLAN 后，主 Agent 不调 present_search_plan
  // 直接派 searcher → 断言被 PreToolUse deny。这是 issue 硬 AC「必须用构造的跳门验证拦截生效」的
  // 确定性证据（脱离单测 stub，走真 registry resolver + 真 hook 装配；不依赖弱模型概率性跳门）。

  // 注册真实 lit-search scenario，装配并取出 confirm-gate guard 在真链路上的 hook 三件套。
  const assembleWithLitSearchScenario = (sessionId: string) => {
    const registry = createInMemorySubagentRegistry()
    registry.register({
      kind: 'subagent', name: 'lit-search', source: 'capability-pack', packId: 'lit-search',
      role: 'scenario', def: { description: 'scenario', prompt: 'You are scenario.' },
    })
    const result = assembleQueryOptions({
      sessionId, registry, sink: mockSink,
      baseOptions: { sessionId, prompt: 'test', hooks: {} } as never,
    })
    const hooks = result.hooks as Record<string, Array<{ matcher: string; hooks: ((i: unknown) => unknown)[] }>>
    // arm：把含 confirm 的 PLAN 喂给所有 Task|Agent PostToolUse hook（含 #575 与 #774 两个 guard）
    const armWithConfirmPlan = (): void => {
      const planText = [
        '## SEARCH PLAN', '```json',
        JSON.stringify({
          intent: 'general-query', keywords: ['x'], sources: ['openalex'],
          steps: [{ subagent_type: 'searcher', input: '...' }],
          confirm: { tool: 'mcp__searchplan__present_search_plan', input: { researchQuestion: 'q', keywords: ['x'], sources: ['openalex'] } },
        }),
        '```',
      ].join('\n')
      for (const entry of hooks.PostToolUse.filter((e) => e.matcher === 'Task|Agent')) {
        for (const cb of entry.hooks) {
          cb({
            hook_event_name: 'PostToolUse', tool_name: 'Task',
            tool_input: { subagent_type: 'lit-search' },
            tool_response: { status: 'completed', agentId: 'a', content: [{ type: 'text', text: planText }] },
          })
        }
      }
    }
    // 模拟用户在确认卡上点 confirm
    const feedConfirm = (): void => {
      for (const entry of hooks.PostToolUse.filter((e) => e.matcher === 'mcp__searchplan__present_search_plan')) {
        for (const cb of entry.hooks) {
          cb({
            hook_event_name: 'PostToolUse', tool_name: 'mcp__searchplan__present_search_plan',
            tool_response: { content: [{ type: 'text', text: JSON.stringify({ choice: 'confirm' }) }] },
          })
        }
      }
    }
    // 主 Agent 试图派 searcher：跑所有 Task|Agent PreToolUse hook，返回是否被 deny
    const tryDispatchSearcher = (): boolean => {
      let denied = false
      for (const entry of hooks.PreToolUse.filter((e) => e.matcher === 'Task|Agent')) {
        for (const cb of entry.hooks) {
          const out = cb({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: { subagent_type: 'searcher' } }) as
            { hookSpecificOutput?: { permissionDecision?: string } }
          if (out?.hookSpecificOutput?.permissionDecision === 'deny') denied = true
        }
      }
      return denied
    }
    return { armWithConfirmPlan, feedConfirm, tryDispatchSearcher }
  }

  it('PreToolUse 链含 Task|Agent matcher 的 entry（guard 已挂载）', () => {
    const registry = createInMemorySubagentRegistry()
    const result = assembleQueryOptions({
      sessionId: 'sess-1', registry, sink: mockSink,
      baseOptions: { sessionId: 'sess-1', prompt: 'test', hooks: {} } as never,
    })
    const preHooks = (result.hooks as Record<string, Array<{ matcher: string }>>)?.PreToolUse ?? []
    expect(preHooks.some((e) => e.matcher === 'Task|Agent')).toBe(true)
  })

  it('构造的跳门：含 confirm 的 PLAN 后未调 present_search_plan 直接派 searcher → PreToolUse deny', () => {
    const h = assembleWithLitSearchScenario('sess-774-skip')
    h.armWithConfirmPlan()
    expect(h.tryDispatchSearcher()).toBe(true) // 确认门未过 → 拦下
  })

  it('确认后派 searcher → 放行（happy path 不回归）', () => {
    const h = assembleWithLitSearchScenario('sess-774-confirm')
    h.armWithConfirmPlan()
    h.feedConfirm()
    expect(h.tryDispatchSearcher()).toBe(false)
  })
})

for (const profile of ['conversation', 'general', 'coding'] as const) {
  it(`精简 ${profile} 请求不被 registry 重新注入科研 Agent，保留权限回调`, () => {
    const registry = createInMemorySubagentRegistry()
    registry.register({ kind: 'subagent', name: 'researcher', source: 'user-config', def: { description: 'Research', prompt: 'Research instructions' } })
    const permission = async () => ({ behavior: 'deny' as const, message: 'host denied' })
    const result = assembleQueryOptions({
      sessionId: 'lean-profile', registry, sink: mockSink,
      baseOptions: { sessionId: 'lean-profile', prompt: 'hello', runtimeProfile: profile, tools: [], settingSources: [], canUseTool: permission } as never,
    })
    expect(result.agents).toEqual({})
    expect(result.tools).toEqual([])
    expect(result.settingSources).toEqual([])
    expect(result.canUseTool).toBe(permission)
    expect(result.hooks?.Stop).toBeUndefined()
  })
}
