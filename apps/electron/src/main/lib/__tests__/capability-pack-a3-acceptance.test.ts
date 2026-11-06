/**
 * A3 端到端验收锚点（north-star §三-3）：
 *
 * "接口契约以独立文档形式存在（schema/capabilities/）含四要素 schema + ... + 至少 1 个
 *  示范 mock 能力包通过该契约成功注册、被 Orchestrator 调用并在所选 UI 框架内渲染产物"
 *
 * Phase 3 范围：通过契约成功注册 + Registry 多 kind metadata 完整。
 * UI 框架内渲染产物 / Proposal 产出 → descope 到 Phase 3.5/4。
 */
import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { createInMemorySubagentRegistry } from '../subagent-registry.ts'
import { loadCapabilityPacks } from '../capability-pack-loader.ts'

const FIXTURES = join(__dirname, '..', '..', '..', '..', 'test-fixtures', 'capability-packs')
// 生产参考实现独立目录，避免与 mock fixture 的 mcpRefs/skillRefs 名字冲突
const PRODUCTION_FIXTURES = join(__dirname, '..', '..', '..', '..', 'test-fixtures', 'capability-packs-production')

describe('A3 端到端验收：Mock Pack 加载 → Registry 三类元数据', () => {
  it('加载 mock pack → registry.list({ source: "capability-pack" }) 非空', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: FIXTURES, language: 'en' })
    const packEntries = r.list({ source: 'capability-pack' })
    expect(packEntries.length).toBeGreaterThan(0)
  })

  it('合规 mock-pack-1 → scenario subagent / skill refs / mcp refs 三类 entry 都注册', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: FIXTURES, language: 'en' })

    const fromPack = r.list({ packId: 'mock-rag-pack' })

    const subs = fromPack.filter((e) => e.kind === 'subagent')
    const skills = fromPack.filter((e) => e.kind === 'skill')
    const mcps = fromPack.filter((e) => e.kind === 'mcp')

    expect(subs).toHaveLength(1)
    expect(subs[0].name).toBe('mock-rag-researcher')

    expect(skills.map((e) => e.name).sort()).toEqual(['pdf-extract', 'web-search'])
    expect(mcps.map((e) => e.name)).toEqual(['paper-search'])
  })

  it('红线 mock pack（scenario name == general-purpose）→ 拒绝加载，不污染 Registry', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: FIXTURES, language: 'en' })
    const broken = r.list({ packId: 'mock-broken-pack' })
    expect(broken).toHaveLength(0)
  })

  it('Output Language section 已追加到 scenario prompt（i18n 接入验证）', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: FIXTURES, language: 'zh' })
    const entry = r.get('mock-rag-researcher', { kind: 'subagent' })
    if (entry?.kind === 'subagent') {
      // mock-pack-1 原始 prompt ~150 字符；追加 Output Language section 应让总长度显著增加
      expect(entry.def.prompt.length).toBeGreaterThan(200)
    } else {
      throw new Error('expected subagent entry for mock-rag-researcher')
    }
  })

  it('A3 验收锚点：3 类 entry 来源元数据完整（source / packId 都对）', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: FIXTURES, language: 'en' })
    for (const entry of r.list({ source: 'capability-pack' })) {
      expect(entry.source).toBe('capability-pack')
      expect(entry.packId).toBeTruthy()
      expect(entry.name).toBeTruthy()
    }
  })
})

// ===== 生产参考实现：paper-retrieval-pack =====
// 第一个真实能力包（非 mock）。位于 test-fixtures/capability-packs/ 下作为
// 参考实现 + 集成测试 fixture；后续可拷贝到 ~/.asci/capability-packs/ 即用。
describe('生产 pack：paper-retrieval-pack 加载到 registry', () => {
  it('paper-retrieval-pack 通过 zod 四红线 + 注册成功', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: PRODUCTION_FIXTURES, language: 'en' })
    const fromPack = r.list({ packId: 'paper-retrieval-pack' })
    expect(fromPack.length).toBeGreaterThan(0)
  })

  it('scenarioAgent 注册：name=paper-retrieval-scenario, model=sonnet', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: PRODUCTION_FIXTURES, language: 'en' })
    const entry = r.get('paper-retrieval-scenario', { kind: 'subagent' })
    expect(entry).not.toBeNull()
    if (entry?.kind === 'subagent') {
      expect(entry.packId).toBe('paper-retrieval-pack')
      expect(entry.def.model).toBe('sonnet')
    }
  })

  it('mcpRefs 注册：paper-search + asci-zotero', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: PRODUCTION_FIXTURES, language: 'en' })
    const mcps = r.list({ kind: 'mcp', packId: 'paper-retrieval-pack' })
    expect(mcps.map((e) => e.name).sort()).toEqual(['asci-zotero', 'paper-search'])
  })

  it('description 表达"多源 + 持久化 + 引文链"路由意图（master 据此匹配）', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: PRODUCTION_FIXTURES, language: 'en' })
    const entry = r.get('paper-retrieval-scenario', { kind: 'subagent' })
    if (entry?.kind === 'subagent') {
      const d = entry.def.description ?? ''
      expect(d).toContain('paper retrieval')
      expect(d).toContain('multi-source')
      expect(d).toContain('citation trail')
      expect(d).toContain('process_search_results')
    }
  })

  it('tools 不含 Task/Agent（红线 4：子 Agent 不能再生子 Agent）', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: PRODUCTION_FIXTURES, language: 'en' })
    const entry = r.get('paper-retrieval-scenario', { kind: 'subagent' })
    if (entry?.kind === 'subagent') {
      const tools = entry.def.tools ?? []
      expect(tools).not.toContain('Task')
      expect(tools).not.toContain('Agent')
      // 但应保留检索必备工具
      expect(tools).toContain('WebSearch')
      expect(tools).toContain('WebFetch')
    }
  })

  it('prompt 含 SEARCH PLAN / persistence / S3 / S4 红线（场景定位完整）', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: PRODUCTION_FIXTURES, language: 'en' })
    const entry = r.get('paper-retrieval-scenario', { kind: 'subagent' })
    if (entry?.kind === 'subagent') {
      const p = entry.def.prompt
      expect(p).toContain('## SEARCH PLAN')
      expect(p).toContain('Persistence is mandatory')
      expect(p).toContain('mcp__paper-search__process_search_results')
      expect(p).toContain('S3')
      expect(p).toContain('S4')
      expect(p).toContain('Approximate match (non-exact)')
    }
  })
})
