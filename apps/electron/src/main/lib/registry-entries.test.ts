import { beforeEach, describe, expect, it } from 'bun:test'
import { createInMemorySubagentRegistry } from './subagent-registry.ts'
import type { SubagentRegistry } from './subagent-registry.ts'

describe('Registry kind 扩展（Phase 2 A2）', () => {
  let r: SubagentRegistry
  beforeEach(() => { r = createInMemorySubagentRegistry() })

  it('SkillRegistryEntry 可以注册', () => {
    r.register({
      kind: 'skill',
      name: 'pdf-extract',
      source: 'user-config',
      slug: 'pdf-extract',
      category: 'document',
    })
    expect(r.list({ kind: 'skill' })).toHaveLength(1)
  })

  it('McpRegistryEntry 可以注册', () => {
    r.register({
      kind: 'mcp',
      name: 'zotero',
      source: 'builtin',
      type: 'stdio',
      isBuiltin: true,
    })
    expect(r.list({ kind: 'mcp' })).toHaveLength(1)
  })

  it('跨 kind 同名不冲突：subagent.reader 与 skill.reader 共存', () => {
    r.register({ kind: 'subagent', name: 'reader', source: 'builtin', def: { description: 'd', prompt: 'p' } })
    r.register({ kind: 'skill', name: 'reader', source: 'user-config', slug: 'reader', category: 'utility' })
    expect(r.list({ kind: 'subagent' })).toHaveLength(1)
    expect(r.list({ kind: 'skill' })).toHaveLength(1)
  })

  it('list({ kind }) 不传 kind 时返回所有 kind', () => {
    r.register({ kind: 'subagent', name: 'a', source: 'builtin', def: { description: 'd', prompt: 'p' } })
    r.register({ kind: 'skill', name: 'b', source: 'user-config', slug: 'b' })
    r.register({ kind: 'mcp', name: 'c', source: 'builtin', type: 'stdio' })
    expect(r.list()).toHaveLength(3)
  })

  it('list({ source }) 在不同 kind 内同时过滤', () => {
    r.register({ kind: 'subagent', name: 'a', source: 'builtin', def: { description: 'd', prompt: 'p' } })
    r.register({ kind: 'skill', name: 'b', source: 'user-config', slug: 'b' })
    r.register({ kind: 'mcp', name: 'c', source: 'builtin', type: 'stdio' })
    expect(r.list({ source: 'builtin' })).toHaveLength(2)  // a + c
    expect(r.list({ source: 'user-config' })).toHaveLength(1)  // b
  })

  it('同 kind 内同名冲突 — 按 source 优先级保留 builtin', () => {
    r.register({ kind: 'skill', name: 'pdf', source: 'builtin', slug: 'pdf' })
    r.register({ kind: 'skill', name: 'pdf', source: 'user-config', slug: 'pdf' })
    expect(r.get('pdf', { kind: 'skill' })?.source).toBe('builtin')
  })

  it('get(name) 不传 kind 时跨 kind 同名 — 抛错', () => {
    r.register({ kind: 'subagent', name: 'reader', source: 'builtin', def: { description: 'd', prompt: 'p' } })
    r.register({ kind: 'skill', name: 'reader', source: 'user-config', slug: 'reader' })
    expect(() => r.get('reader')).toThrow(/kind/i)
  })

  it('get(name) 不传 kind 时单 kind 命中 — 返回该 entry（向后兼容 Phase 1）', () => {
    r.register({ kind: 'subagent', name: 'reader', source: 'builtin', def: { description: 'd', prompt: 'p' } })
    expect(r.get('reader')?.kind).toBe('subagent')
  })

  it('get(name, { kind }) 按 kind 精确定位', () => {
    r.register({ kind: 'subagent', name: 'reader', source: 'builtin', def: { description: 'd', prompt: 'p' } })
    r.register({ kind: 'skill', name: 'reader', source: 'user-config', slug: 'reader' })
    expect(r.get('reader', { kind: 'subagent' })?.kind).toBe('subagent')
    expect(r.get('reader', { kind: 'skill' })?.kind).toBe('skill')
  })

  it('snapshot() 只包含 subagent kind（Skill/MCP 不进 SDK options.agents）', () => {
    r.register({ kind: 'subagent', name: 'a', source: 'builtin', def: { description: 'd', prompt: 'p' } })
    r.register({ kind: 'skill', name: 'b', source: 'user-config', slug: 'b' })
    r.register({ kind: 'mcp', name: 'c', source: 'builtin', type: 'stdio' })
    expect(Object.keys(r.snapshot().agents)).toEqual(['a'])
  })

  it('unregister(predicate) 跨 kind 工作', () => {
    r.register({ kind: 'subagent', name: 'a', source: 'builtin', def: { description: 'd', prompt: 'p' } })
    r.register({ kind: 'skill', name: 'a', source: 'user-config', slug: 'a' })
    r.unregister((e) => e.name === 'a' && e.kind === 'skill')
    expect(r.list()).toHaveLength(1)
    expect(r.list()[0].kind).toBe('subagent')
  })

  it('C1 红线（subagent tools 不含 Task/Agent）只对 subagent kind 生效', () => {
    expect(() => r.register({
      kind: 'subagent',
      name: 'bad',
      source: 'builtin',
      def: { description: 'd', prompt: 'p', tools: ['Task'] },
    })).toThrow(/C1/i)
    // Skill / MCP 没有 tools 字段，无 C1 风险，正常注册
    expect(() => r.register({
      kind: 'skill',
      name: 'safe',
      source: 'user-config',
      slug: 'safe',
    })).not.toThrow()
  })
})
