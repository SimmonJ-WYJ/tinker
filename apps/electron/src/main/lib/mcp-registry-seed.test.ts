import { describe, expect, it } from 'bun:test'
import { createInMemorySubagentRegistry } from './subagent-registry.ts'
import { seedMcpServersToRegistry } from './mcp-registry-seed.ts'
import type { ComposedMcpServerEntry } from './mcp/global-config.ts'

const mkMcp = (overrides: Partial<ComposedMcpServerEntry> = {}): ComposedMcpServerEntry => ({
  type: 'stdio',
  enabled: true,
  isBuiltin: false,
  ...overrides,
})

describe('seedMcpServersToRegistry', () => {
  it('把 composeMcpServers 输出 reseed 到 Registry as kind: mcp', () => {
    const r = createInMemorySubagentRegistry()
    seedMcpServersToRegistry(r, {
      'zotero': mkMcp({ isBuiltin: true }),
      'custom': mkMcp({ isBuiltin: false }),
    })
    expect(r.list({ kind: 'mcp' })).toHaveLength(2)
  })

  it('isBuiltin=true 标记 source: builtin；否则 source: user-config', () => {
    const r = createInMemorySubagentRegistry()
    seedMcpServersToRegistry(r, {
      'zotero': mkMcp({ isBuiltin: true }),
      'custom': mkMcp({ isBuiltin: false }),
    })
    expect(r.get('zotero', { kind: 'mcp' })?.source).toBe('builtin')
    expect(r.get('custom', { kind: 'mcp' })?.source).toBe('user-config')
  })

  it('enabled=false 的 MCP 不进 Registry', () => {
    const r = createInMemorySubagentRegistry()
    seedMcpServersToRegistry(r, { 'disabled': mkMcp({ enabled: false }) })
    expect(r.list({ kind: 'mcp' })).toHaveLength(0)
  })

  it('reseed 模式：先清空现有 mcp kind，再注册新一批', () => {
    const r = createInMemorySubagentRegistry()
    seedMcpServersToRegistry(r, { 'a': mkMcp() })
    seedMcpServersToRegistry(r, { 'b': mkMcp() })
    expect(r.list({ kind: 'mcp' }).map((e) => e.name)).toEqual(['b'])
  })

  it('McpRegistryEntry 保留 type 与 isBuiltin 字段', () => {
    const r = createInMemorySubagentRegistry()
    seedMcpServersToRegistry(r, { 'x': mkMcp({ type: 'stdio', isBuiltin: true }) })
    const entry = r.get('x', { kind: 'mcp' })
    if (entry?.kind === 'mcp') {
      expect(entry.type).toBe('stdio')
      expect(entry.isBuiltin).toBe(true)
    }
  })

  it('reseed 不影响 subagent / skill 类 entry', () => {
    const r = createInMemorySubagentRegistry()
    r.register({ kind: 'subagent', name: 'searcher', source: 'builtin', def: { description: 'd', prompt: 'p' } })
    r.register({ kind: 'skill', name: 'pdf', source: 'user-config', slug: 'pdf' })
    seedMcpServersToRegistry(r, { 'zotero': mkMcp({ isBuiltin: true }) })
    expect(r.list({ kind: 'subagent' })).toHaveLength(1)
    expect(r.list({ kind: 'skill' })).toHaveLength(1)
    expect(r.list({ kind: 'mcp' })).toHaveLength(1)
  })
})
