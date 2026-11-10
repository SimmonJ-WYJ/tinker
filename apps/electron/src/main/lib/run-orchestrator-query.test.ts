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
    // 0.2 后 worker SubAgent 从 builtin seed 搬到能力包加载（custom-search / custom-review）；
    // 本测只验证"snapshot 机制本身一致"，故手工 register 两条 capability-pack 条目代表数据来源。
    // 真实 builtin / pack 路径的覆盖见 capability-pack-loader.test.ts 与 a3-acceptance 测试。
    const registry = createInMemorySubagentRegistry()
    registry.register({
      kind: 'subagent', name: 'searcher', source: 'capability-pack', packId: 'custom-search',
      def: { description: 'Search strategist', prompt: 'You are searcher.' },
    })
    registry.register({
      kind: 'subagent', name: 'synthesizer', source: 'capability-pack', packId: 'custom-review',
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
      name: 'custom-search',
      source: 'capability-pack',
      packId: 'custom-search',
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
        hook({ hook_event_name: 'SubagentStop', subagent_type: 'custom-search', success: true })
      }
    }
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'pack.taskCompleted',
      packId: 'custom-search',
      scenarioAgentName: 'custom-search',
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
      packId: 'custom-search',
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
