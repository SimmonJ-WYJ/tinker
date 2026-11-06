import { describe, expect, it } from 'bun:test'
import { createInMemorySubagentRegistry } from './subagent-registry.ts'
import { seedSkillsToRegistry } from './skill-registry-seed.ts'
import type { SkillMeta } from '@asci/shared'

const mkSkill = (overrides: Partial<SkillMeta> = {}): SkillMeta => ({
  slug: 'pdf-extract',
  name: 'PDF Extract',
  enabled: true,
  category: 'document',
  ...overrides,
})

describe('seedSkillsToRegistry', () => {
  it('把 SkillMeta[] 注册到 Registry as kind: skill / source: user-config', () => {
    const r = createInMemorySubagentRegistry()
    seedSkillsToRegistry(r, [mkSkill({ slug: 'a' }), mkSkill({ slug: 'b' })])
    expect(r.list({ kind: 'skill' })).toHaveLength(2)
    expect(r.list({ kind: 'skill' }).every((e) => e.source === 'user-config')).toBe(true)
  })

  it('SkillRegistryEntry.slug = SkillMeta.slug；name 也用 slug', () => {
    const r = createInMemorySubagentRegistry()
    seedSkillsToRegistry(r, [mkSkill({ slug: 'pdf-extract' })])
    const entry = r.get('pdf-extract', { kind: 'skill' })
    expect(entry?.kind).toBe('skill')
    if (entry?.kind === 'skill') {
      expect(entry.slug).toBe('pdf-extract')
      expect(entry.category).toBe('document')
    }
  })

  it('禁用的 Skill 不进 Registry（enabled: false）', () => {
    const r = createInMemorySubagentRegistry()
    seedSkillsToRegistry(r, [mkSkill({ slug: 'a', enabled: false })])
    expect(r.list({ kind: 'skill' })).toHaveLength(0)
  })

  it('reseed 模式：先 unregister 现有 skill kind，再注册新一批', () => {
    const r = createInMemorySubagentRegistry()
    seedSkillsToRegistry(r, [mkSkill({ slug: 'old' })])
    seedSkillsToRegistry(r, [mkSkill({ slug: 'new' })])
    expect(r.list({ kind: 'skill' }).map((e) => e.name).sort()).toEqual(['new'])
  })

  it('reseed 不影响 subagent / mcp 类 entry', () => {
    const r = createInMemorySubagentRegistry()
    r.register({ kind: 'subagent', name: 'searcher', source: 'builtin', def: { description: 'd', prompt: 'p' } })
    r.register({ kind: 'mcp', name: 'zotero', source: 'builtin', type: 'stdio' })
    seedSkillsToRegistry(r, [mkSkill({ slug: 'a' })])
    expect(r.list({ kind: 'subagent' })).toHaveLength(1)
    expect(r.list({ kind: 'mcp' })).toHaveLength(1)
    expect(r.list({ kind: 'skill' })).toHaveLength(1)
  })
})
