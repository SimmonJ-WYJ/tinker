/**
 * A0 ④ 验收锚点测试：新增 mock 子 Agent 无需改 Orchestrator 代码。
 *
 * 设计意图：任何后续 PR 如果意外要求"改 Orchestrator / buildBuiltinAgents 才能加新子 Agent"，
 * 这个测试会失败 —— 即下方 register(...) + assembleQueryOptions(...) 之外的 import
 * 都不应被本测试 file 内部需要。
 *
 * 与 north-star §三-3 A0 ④ 锚点对齐：
 *   ④ 新增任一 mock 子 Agent 无需改 Orchestrator 代码 —— 只调
 *      `subagentRegistry.register(def)`，**全程不改** `runOrchestratorQuery` /
 *      `buildBuiltinAgents` / Orchestrator 任何一行代码
 */
import { describe, expect, it } from 'bun:test'
import { createInMemorySubagentRegistry } from '../subagent-registry.ts'
import { seedBuiltinSubagents } from '../subagent-registry-seed.ts'
import { assembleQueryOptions } from '../run-orchestrator-query.ts'

describe('A0 ④ 验收：新增 mock 子 Agent 零改 Orchestrator 代码', () => {
  it('注册 mock-x 后 snapshot 立即包含；不需要改 runOrchestratorQuery / buildBuiltinAgents', () => {
    const registry = createInMemorySubagentRegistry()
    seedBuiltinSubagents(registry, { claudeAvailable: true, language: 'en' })

    // —— 关键：以下三行是 PR / capability-pack 加 mock 子 Agent 的全部代码 ——
    registry.register({
      kind: 'subagent',
      name: 'mock-x',
      source: 'user-config',
      def: {
        description: 'Mock subagent for A0 ④ verification. Use when user asks "use mock-x".',
        prompt: 'You are mock-x. Reply "mock-x reachable" to any message.',
      },
    })
    // —— 不允许在这里 import { runOrchestratorQuery } 之外的任何 orchestrator 内部符号 ——

    const result = assembleQueryOptions({
      sessionId: 'verify-a0-4',
      registry,
      sink: { append: () => {}, update: () => {} },
      baseOptions: { sessionId: 'verify-a0-4', prompt: 'use mock-x' } as never,
    })

    expect(result.agents?.['mock-x']).toBeDefined()
    expect(result.agents?.['mock-x']?.prompt).toContain('mock-x reachable')
  })

  it('mock 子 Agent 注册路径与 builtin 共享 snapshot —— 顺序无关', () => {
    const r1 = createInMemorySubagentRegistry()
    r1.register({ kind: 'subagent', name: 'mock-x', source: 'user-config', def: { description: 'd', prompt: 'p' } })
    seedBuiltinSubagents(r1, { claudeAvailable: true, language: 'en' })

    const r2 = createInMemorySubagentRegistry()
    seedBuiltinSubagents(r2, { claudeAvailable: true, language: 'en' })
    r2.register({ kind: 'subagent', name: 'mock-x', source: 'user-config', def: { description: 'd', prompt: 'p' } })

    expect(Object.keys(r1.snapshot().agents).sort())
      .toEqual(Object.keys(r2.snapshot().agents).sort())
  })
})
