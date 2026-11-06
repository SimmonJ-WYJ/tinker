/**
 * A2 验收锚点测试（north-star §三-3）：
 *
 * "工具/Skill/MCP 注册走统一接口，注册项可被 Agent 在运行时枚举"
 * "调用注册中心 API 可返回当前所有已注册项的元数据（名称、来源、能力声明）"
 *
 * 本测试模拟一次完整的 session 启动：seed builtin subagents + skills + mcp servers，
 * 然后验证 list() 能返回三类 entry 的完整元数据。
 */
import { describe, expect, it } from 'bun:test'
import { createInMemorySubagentRegistry } from '../subagent-registry.ts'
import { seedSkillsToRegistry } from '../skill-registry-seed.ts'
import { seedMcpServersToRegistry } from '../mcp-registry-seed.ts'
import type { SkillMeta } from '@asci/shared'

describe('A2 验收：Registry 多 kind 统一接口枚举', () => {
  // 0.2 后所有 worker SubAgent 由能力包加载（spec §4.2），不再走 builtin seed。本测试为脱离
  // 文件 fixture 的纯单元测，用 registry.register 手工注入 3 条 capability-pack 条目代表数据来源，
  // 与之前依赖 seedBuiltinSubagents 注入 7 条的口径等价（A2 关心的是"多 kind 统一枚举"机制本身）。
  const registerCapPackSubagents = (registry: ReturnType<typeof createInMemorySubagentRegistry>): void => {
    for (const name of ['searcher', 'synthesizer', 'fact-checker'] as const) {
      registry.register({
        kind: 'subagent', name, source: 'capability-pack', packId: 'mock',
        def: { description: `${name} desc`, prompt: `You are ${name}.` },
      })
    }
  }

  it('一次 session 启动后，list() 可枚举三类 entry', () => {
    const registry = createInMemorySubagentRegistry()

    // session 启动注入三类
    registerCapPackSubagents(registry)
    seedSkillsToRegistry(registry, [
      { slug: 'pdf-extract', name: 'PDF Extract', enabled: true, category: 'document' } as SkillMeta,
      { slug: 'web-search', name: 'Web Search', enabled: true, category: 'utility' } as SkillMeta,
    ])
    seedMcpServersToRegistry(registry, {
      'zotero': { type: 'stdio', enabled: true, isBuiltin: true },
      'paper-search': { type: 'stdio', enabled: true, isBuiltin: true },
    })

    // A2 验收点 1：list() 全集返回三类
    const all = registry.list()
    const byKind = new Map<string, number>()
    for (const e of all) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1)
    expect(byKind.get('subagent')).toBe(3)
    expect(byKind.get('skill')).toBe(2)
    expect(byKind.get('mcp')).toBe(2)

    // A2 验收点 2：按 kind filter
    expect(registry.list({ kind: 'subagent' })).toHaveLength(3)
    expect(registry.list({ kind: 'skill' })).toHaveLength(2)
    expect(registry.list({ kind: 'mcp' })).toHaveLength(2)

    // A2 验收点 3：按 source filter
    expect(registry.list({ source: 'capability-pack' })).toHaveLength(3)
    expect(registry.list({ source: 'builtin' })).toHaveLength(2) // 2 builtin mcp
    expect(registry.list({ source: 'user-config' })).toHaveLength(2) // 2 skill

    // A2 验收点 4：每条 entry 含完整元数据（name / source / kind）
    for (const entry of all) {
      expect(entry.name).toBeTruthy()
      expect(entry.source).toBeTruthy()
      expect(entry.kind).toBeTruthy()
    }
  })

  it('snapshot() 仅产出 subagent kind — Skill / MCP 不进 SDK options.agents', () => {
    const registry = createInMemorySubagentRegistry()
    registerCapPackSubagents(registry)
    seedSkillsToRegistry(registry, [{ slug: 's', name: 'S', enabled: true } as SkillMeta])
    seedMcpServersToRegistry(registry, { 'm': { type: 'stdio', enabled: true, isBuiltin: true } })

    const snap = registry.snapshot()
    expect(Object.keys(snap.agents).sort()).toEqual(['fact-checker', 'searcher', 'synthesizer'])
    // 验证 Skill / MCP 名不在 snapshot.agents 里
    expect(snap.agents['s']).toBeUndefined()
    expect(snap.agents['m']).toBeUndefined()
  })

  it('reseed 模式：第二次 seed 替换上一批 — 不重复堆积', () => {
    const registry = createInMemorySubagentRegistry()
    seedSkillsToRegistry(registry, [{ slug: 'old', name: 'Old', enabled: true } as SkillMeta])
    seedSkillsToRegistry(registry, [{ slug: 'new', name: 'New', enabled: true } as SkillMeta])
    expect(registry.list({ kind: 'skill' }).map((e) => e.name)).toEqual(['new'])
  })
})
