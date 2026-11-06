import { describe, expect, it } from 'bun:test'
import { CapabilityPackManifest, type CapabilityPackManifestInput } from './capability-pack.ts'

const minimalValidManifest: CapabilityPackManifestInput = {
  packId: 'rag-research-pack',
  version: '0.1.0',
  scenarioAgent: {
    name: 'rag-researcher',
    description: 'RAG literature reviewer. Use for RAG vs long-context comparison tasks.',
    promptPath: 'scenario/system-prompt.md',
    tools: ['Read', 'Glob', 'Grep', 'WebSearch'],
    model: 'sonnet',
  },
  skillRefs: ['pdf-extract'],
  mcpRefs: ['paper-search'],
  uiFramework: 'conversation-and-artifact',
}

describe('CapabilityPackManifest zod schema', () => {
  it('合规 manifest 解析通过', () => {
    expect(CapabilityPackManifest.safeParse(minimalValidManifest).success).toBe(true)
  })

  it('packId 必填 + 非空字符串', () => {
    expect(CapabilityPackManifest.safeParse({ ...minimalValidManifest, packId: '' }).success).toBe(false)
  })

  it('version 必填 + semver 形态', () => {
    expect(CapabilityPackManifest.safeParse({ ...minimalValidManifest, version: 'not-semver' }).success).toBe(false)
  })

  it('scenarioAgent.name 必填 + kebab-case', () => {
    const bad1 = { ...minimalValidManifest, scenarioAgent: { ...minimalValidManifest.scenarioAgent, name: 'RAGResearcher' } }
    const bad2 = { ...minimalValidManifest, scenarioAgent: { ...minimalValidManifest.scenarioAgent, name: 'rag_researcher' } }
    expect(CapabilityPackManifest.safeParse(bad1).success).toBe(false)
    expect(CapabilityPackManifest.safeParse(bad2).success).toBe(false)
  })

  // 红线 1: 禁止改 master prompt（strict 拒未知字段）
  it('manifest 含 masterPrompt 字段 → 解析失败（红线 1）', () => {
    const m = { ...minimalValidManifest, masterPrompt: 'You are master...' }
    expect(CapabilityPackManifest.safeParse(m).success).toBe(false)
  })

  // 红线 2: scenario name 不与 general-purpose 同名
  it('scenarioAgent.name === "general-purpose" → 解析失败（红线 2）', () => {
    const m = { ...minimalValidManifest, scenarioAgent: { ...minimalValidManifest.scenarioAgent, name: 'general-purpose' } }
    const result = CapabilityPackManifest.safeParse(m)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => /general-purpose/.test(i.message))).toBe(true)
    }
  })

  // 红线 3 已从 schema 搬到 loader（prompt 切到独立 .md 文件，schema 看不到字符串内容）；
  // CJK 内容检查由 capability-pack-loader.test.ts 覆盖。schema 层仅校验 promptPath 形态：
  it('scenarioAgent.promptPath 必填且非空（schema 层；内容由 loader 校验）', () => {
    const m = { ...minimalValidManifest, scenarioAgent: { ...minimalValidManifest.scenarioAgent, promptPath: '' } }
    expect(CapabilityPackManifest.safeParse(m).success).toBe(false)
  })

  it('scenarioAgent.promptPath 必须以 .md 结尾（spec §4.2 / §6.1 物理目录形态）', () => {
    const m = { ...minimalValidManifest, scenarioAgent: { ...minimalValidManifest.scenarioAgent, promptPath: 'scenario/system-prompt.txt' } }
    const result = CapabilityPackManifest.safeParse(m)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => /\.md/.test(i.message))).toBe(true)
    }
  })

  it('scenarioAgent 不允许保留旧的内联 prompt 字段（strict schema 拦未知字段）', () => {
    const m = {
      ...minimalValidManifest,
      scenarioAgent: { ...minimalValidManifest.scenarioAgent, prompt: 'legacy inline prompt' },
    } as never
    expect(CapabilityPackManifest.safeParse(m).success).toBe(false)
  })

  // 红线 4: scenario tools 不含 Task / Agent (C1)
  it('scenarioAgent.tools 含 "Task" → 解析失败（红线 4 / C1）', () => {
    const m = { ...minimalValidManifest, scenarioAgent: { ...minimalValidManifest.scenarioAgent, tools: ['Read', 'Task'] } }
    const result = CapabilityPackManifest.safeParse(m)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => /C1|Task|Agent/.test(i.message))).toBe(true)
    }
  })

  it('scenarioAgent.tools 含 "Agent" → 解析失败（红线 4 / C1）', () => {
    const m = { ...minimalValidManifest, scenarioAgent: { ...minimalValidManifest.scenarioAgent, tools: ['Agent'] } }
    expect(CapabilityPackManifest.safeParse(m).success).toBe(false)
  })

  // skillRefs / mcpRefs default + 校验
  it('skillRefs 默认空数组', () => {
    const m = { ...minimalValidManifest, skillRefs: undefined } as never
    const result = CapabilityPackManifest.safeParse(m)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.skillRefs).toEqual([])
  })

  it('mcpRefs 默认空数组', () => {
    const m = { ...minimalValidManifest, mcpRefs: undefined } as never
    const result = CapabilityPackManifest.safeParse(m)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.mcpRefs).toEqual([])
  })

  it('skillRefs / mcpRefs 元素必须非空字符串', () => {
    expect(CapabilityPackManifest.safeParse({ ...minimalValidManifest, skillRefs: [''] }).success).toBe(false)
  })

  // uiFramework 枚举
  it('uiFramework === "conversation-and-artifact"（Phase 3 唯一允许值）', () => {
    expect(CapabilityPackManifest.safeParse({ ...minimalValidManifest, uiFramework: 'conversation-and-artifact' }).success).toBe(true)
    expect(CapabilityPackManifest.safeParse({ ...minimalValidManifest, uiFramework: 'unknown-framework' }).success).toBe(false)
  })

  // proposals 占位
  it('proposals 字段可选；Phase 3 不实现产出但接受合法形态占位', () => {
    const m = { ...minimalValidManifest, proposals: [{ kind: 'citation-relation' as const, trigger: 'review-generated', reasoningTemplate: 'X cited Y because Z' }] }
    expect(CapabilityPackManifest.safeParse(m).success).toBe(true)
  })

  // subAgents 数组：worker SubAgent 与 scenarioAgent 共用 SubAgentDefinition schema（红线 2/4 同源）
  it('subAgents 默认空数组', () => {
    const m = { ...minimalValidManifest, subAgents: undefined } as never
    const result = CapabilityPackManifest.safeParse(m)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.subAgents).toEqual([])
  })

  it('subAgents 元素合规 manifest 解析通过', () => {
    const m = {
      ...minimalValidManifest,
      subAgents: [{
        name: 'searcher',
        description: 'Search strategist',
        promptPath: 'sub-agents/searcher.md',
        tools: ['Read', 'WebSearch'],
        model: 'haiku' as const,
      }],
    }
    expect(CapabilityPackManifest.safeParse(m).success).toBe(true)
  })

  it('subAgents 元素 name === "general-purpose" → 解析失败（红线 2 共用）', () => {
    const m = {
      ...minimalValidManifest,
      subAgents: [{
        name: 'general-purpose',
        description: 'x',
        promptPath: 'sub-agents/x.md',
      }],
    }
    expect(CapabilityPackManifest.safeParse(m).success).toBe(false)
  })

  it('subAgents 元素 tools 含 "Task" → 解析失败（红线 4 共用：worker 不能再生子 Agent）', () => {
    const m = {
      ...minimalValidManifest,
      subAgents: [{
        name: 'searcher',
        description: 'x',
        promptPath: 'sub-agents/x.md',
        tools: ['Read', 'Task'],
      }],
    }
    expect(CapabilityPackManifest.safeParse(m).success).toBe(false)
  })
})
