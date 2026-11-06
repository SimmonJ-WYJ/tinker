import { describe, expect, it } from 'bun:test'
import { createInMemorySubagentRegistry } from './subagent-registry.ts'
import { seedBuiltinSubagents } from './subagent-registry-seed.ts'

/**
 * 0.2 起 worker SubAgent 全部搬到能力包 sub-agents/ 目录（spec §4.2 物理目录形态）。
 * seedBuiltinSubagents 保留为扩展点（buildBuiltinAgents 当前返回空字典），用例只验证
 * "调用不抛错 + 不污染 registry"；具体 worker 注册覆盖见 capability-pack-loader.test.ts
 * 与 capability-pack-a3-acceptance.test.ts。
 */
describe('seedBuiltinSubagents（0.2 后 worker 已搬到能力包）', () => {
  it('调用不抛错；当前无 builtin worker → registry 中 source="builtin" 为空', () => {
    const r = createInMemorySubagentRegistry()
    seedBuiltinSubagents(r, { claudeAvailable: true, language: 'en' })
    expect(r.list({ source: 'builtin' })).toEqual([])
  })

  it('reseed 不影响 capability-pack / user-config 来源条目', () => {
    const r = createInMemorySubagentRegistry()
    r.register({ kind: 'subagent', name: 'pack-agent', source: 'capability-pack', packId: 'p', def: { description: 'd', prompt: 'p' } })
    r.register({ kind: 'skill', name: 'user-skill', source: 'user-config', slug: 'user-skill' })
    seedBuiltinSubagents(r, { claudeAvailable: false, language: 'en' })
    expect(r.list({ source: 'capability-pack' })).toHaveLength(1)
    expect(r.list({ source: 'user-config' })).toHaveLength(1)
  })
})
