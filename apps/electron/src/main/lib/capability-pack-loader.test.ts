import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInMemorySubagentRegistry } from './subagent-registry.ts'
import { loadCapabilityPacks, buildPaperSourceAvailabilityBlock } from './capability-pack-loader.ts'
import type { ModelNoticeInfo } from './capability-pack-loader.ts'
import type { CapabilityPackManifestInput, Channel } from '@asci/shared'

const DEFAULT_PROMPT = 'You are a mock researcher.'

const validManifest: CapabilityPackManifestInput = {
  packId: 'mock-pack-1',
  version: '0.1.0',
  scenarioAgent: {
    name: 'mock-researcher',
    description: 'Mock researcher for tests',
    promptPath: 'scenario/system-prompt.md',
    tools: ['Read', 'Glob'],
  },
  skillRefs: ['pdf-extract'],
  mcpRefs: ['paper-search'],
  uiFramework: 'conversation-and-artifact',
}

/**
 * 写一个能力包测试夹具：manifest.json + 可选的 prompt .md 文件。
 *
 * 默认按 manifest.scenarioAgent.promptPath 同步写一份英文 prompt；传 `promptContent: null`
 * 可以跳过 .md 文件创建（用于测 "prompt file 缺失" 场景）；传 `promptContent: '...'` 可
 * 覆盖默认内容（用于测 CJK / 空内容场景）。
 */
const writePackFixture = (
  root: string,
  packId: string,
  manifest: object,
  opts?: { promptContent?: string | null },
): void => {
  const dir = join(root, packId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))

  const promptPath = (manifest as { scenarioAgent?: { promptPath?: string } }).scenarioAgent?.promptPath
  if (promptPath && opts?.promptContent !== null) {
    const absPromptPath = join(dir, promptPath)
    mkdirSync(dirname(absPromptPath), { recursive: true })
    writeFileSync(absPromptPath, opts?.promptContent ?? DEFAULT_PROMPT)
  }
}

describe('loadCapabilityPacks', () => {
  let tmpRoot: string
  beforeEach(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'asci-pack-test-')) })
  afterEach(() => { rmSync(tmpRoot, { recursive: true, force: true }) })

  it('从 packsDir 加载合规 pack — 注册 scenario subagent', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', validManifest)
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })
    const entries = r.list({ kind: 'subagent', source: 'capability-pack' })
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('mock-researcher')
    expect(entries[0].packId).toBe('mock-pack-1')
  })

  it('skillRefs 中每个 ref 注册一条 SkillRegistryEntry', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', { ...validManifest, skillRefs: ['s1', 's2'] })
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })
    const skills = r.list({ kind: 'skill', source: 'capability-pack' })
    expect(skills.map((e) => e.name).sort()).toEqual(['s1', 's2'])
  })

  it('mcpRefs 中每个 ref 注册一条 McpRegistryEntry', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', { ...validManifest, mcpRefs: ['m1', 'm2'] })
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })
    const mcps = r.list({ kind: 'mcp', source: 'capability-pack' })
    expect(mcps.map((e) => e.name).sort()).toEqual(['m1', 'm2'])
  })

  it('mcpRefs 展开为完整 dict 形式注入 def.mcpServers（从 globalMcpServers lookup 配置）', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', { ...validManifest, mcpRefs: ['paper-search', 'asci-zotero'] })
    const r = createInMemorySubagentRegistry()
    const globalMcpServers = {
      'paper-search': { command: '/usr/local/bin/node', args: ['paper-search.cjs'], env: { ASCI_SESSION_ID: 'sid-1' } },
      'asci-zotero': { command: '/usr/local/bin/node', args: ['zotero.cjs'] },
      'unrelated-mcp': { command: 'other' },
    }
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en', globalMcpServers })
    const entry = r.get('mock-researcher', { kind: 'subagent' })
    if (entry?.kind !== 'subagent') throw new Error('expected subagent entry')
    expect(entry.def.mcpServers).toEqual([
      { 'paper-search': { command: '/usr/local/bin/node', args: ['paper-search.cjs'], env: { ASCI_SESSION_ID: 'sid-1' } } },
      { 'asci-zotero': { command: '/usr/local/bin/node', args: ['zotero.cjs'] } },
    ])
  })

  it('mcpRefs 为空 → scenarioAgent.def 不注入 mcpServers 字段', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', { ...validManifest, mcpRefs: [] })
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })
    const entry = r.get('mock-researcher', { kind: 'subagent' })
    if (entry?.kind !== 'subagent') throw new Error('expected subagent entry')
    expect(entry.def.mcpServers).toBeUndefined()
  })

  it('mcpRef 在 globalMcpServers 缺失 → 跳过该条；其他 ref 正常展开', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', { ...validManifest, mcpRefs: ['paper-search', 'missing-mcp'] })
    const r = createInMemorySubagentRegistry()
    const globalMcpServers = {
      'paper-search': { command: 'node', args: ['paper.cjs'] },
    }
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en', globalMcpServers })
    const entry = r.get('mock-researcher', { kind: 'subagent' })
    if (entry?.kind !== 'subagent') throw new Error('expected subagent entry')
    expect(entry.def.mcpServers).toEqual([
      { 'paper-search': { command: 'node', args: ['paper.cjs'] } },
    ])
  })

  it('mcpRefs 非空但未传 globalMcpServers → 不注入 mcpServers（向后兼容；之前调用方未传也不崩）', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', { ...validManifest, mcpRefs: ['paper-search'] })
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })
    const entry = r.get('mock-researcher', { kind: 'subagent' })
    if (entry?.kind !== 'subagent') throw new Error('expected subagent entry')
    expect(entry.def.mcpServers).toBeUndefined()
  })

  it('scenarioAgent 不写 tools 字段 → def.tools 不传给 SDK（SDK 解读为继承父级；避免 `[]` 被误解为零工具）', async () => {
    // 故意构造一个 manifest，scenarioAgent 不带 tools 字段
    const manifestNoTools = {
      ...validManifest,
      scenarioAgent: {
        name: 'no-tools-scenario',
        description: 'Scenario without explicit tools',
        promptPath: 'scenario/system-prompt.md',
        model: 'sonnet' as const,
      },
    }
    writePackFixture(tmpRoot, 'mock-pack-no-tools', manifestNoTools)
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })
    const entry = r.get('no-tools-scenario', { kind: 'subagent' })
    if (entry?.kind !== 'subagent') throw new Error('expected subagent entry')
    // 关键断言：def 里没有 tools 键（SDK 见 undefined → inherit all）
    expect('tools' in entry.def).toBe(false)
  })

  it('scenarioAgent 显式写 tools=[] → def.tools=[] 透传给 SDK（用户主动要求零工具）', async () => {
    const manifestEmptyTools = {
      ...validManifest,
      scenarioAgent: {
        name: 'empty-tools-scenario',
        description: 'Scenario with explicit empty tools',
        promptPath: 'scenario/system-prompt.md',
        tools: [],
        model: 'sonnet' as const,
      },
    }
    writePackFixture(tmpRoot, 'mock-pack-empty-tools', manifestEmptyTools)
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })
    const entry = r.get('empty-tools-scenario', { kind: 'subagent' })
    if (entry?.kind !== 'subagent') throw new Error('expected subagent entry')
    expect(entry.def.tools).toEqual([])
  })

  it('scenarioAgent prompt 文件解析后追加 Output Language section', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', validManifest)
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'zh' })
    const entry = r.get('mock-researcher', { kind: 'subagent' })
    if (entry?.kind === 'subagent') {
      // buildSubAgentOutputLanguageSection 注入应让 prompt 显著变长
      expect(entry.def.prompt.length).toBeGreaterThan(DEFAULT_PROMPT.length)
      // 同时含 .md 文件里的原始 prompt 内容
      expect(entry.def.prompt).toContain('mock researcher')
    } else {
      throw new Error('expected subagent entry')
    }
  })

  it('packsDir 不存在 → loader 不抛错，registry 不变', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: join(tmpRoot, 'nonexistent'), language: 'en' })
    expect(r.list({ source: 'capability-pack' })).toHaveLength(0)
  })

  it('单个 pack 红线触发 → log warn 跳过；其他 pack 正常加载', async () => {
    writePackFixture(tmpRoot, 'good-pack', { ...validManifest, packId: 'good-pack' })
    writePackFixture(tmpRoot, 'bad-pack', {
      ...validManifest,
      packId: 'bad-pack',
      scenarioAgent: { ...validManifest.scenarioAgent, name: 'general-purpose' },  // 红线 2
    })
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })
    const packs = r.list({ source: 'capability-pack' })
    expect(packs.every((e) => e.packId === 'good-pack')).toBe(true)
  })

  it('两个 pack 注册 scenario 同名 → 第二个 pack-pack 冲突抛错被 loader 捕获 + log；第一个保留', async () => {
    writePackFixture(tmpRoot, 'pack-a', { ...validManifest, packId: 'pack-a', scenarioAgent: { ...validManifest.scenarioAgent, name: 'shared-name' } })
    writePackFixture(tmpRoot, 'pack-b', { ...validManifest, packId: 'pack-b', scenarioAgent: { ...validManifest.scenarioAgent, name: 'shared-name' } })
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })
    const entries = r.list({ kind: 'subagent', source: 'capability-pack' })
    expect(entries).toHaveLength(1)
  })

  it('manifest.json 文件缺失 / JSON 解析错 → log warn 跳过该 pack', async () => {
    const dir = join(tmpRoot, 'broken-pack')
    mkdirSync(dir, { recursive: true })
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })
    expect(r.list({ source: 'capability-pack' })).toHaveLength(0)
  })

  it('manifest 通过但 promptPath 指向的 .md 缺失 → log warn 跳过该 pack（红线 3 路径前置）', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', validManifest, { promptContent: null })
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })
    expect(r.list({ source: 'capability-pack' })).toHaveLength(0)
  })

  it('promptPath 文件含 CJK 字符 → log warn 跳过该 pack（红线 3：scenario prompt 必须英文）', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', validManifest, {
      promptContent: 'You are a mock researcher。专注于检索增强生成。',
    })
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })
    expect(r.list({ source: 'capability-pack' })).toHaveLength(0)
  })

  it('promptPath 文件为空白 → log warn 跳过该 pack', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', validManifest, { promptContent: '   \n  \n' })
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })
    expect(r.list({ source: 'capability-pack' })).toHaveLength(0)
  })

  it('reseed 模式：unregister 现有 source=capability-pack 的所有 entry，再重新加载', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', validManifest)
    const r = createInMemorySubagentRegistry()

    r.register({ kind: 'subagent', name: 'stale-pack-agent', source: 'capability-pack', packId: 'stale-pack', def: { description: 'stale', prompt: 'stale' } })
    expect(r.list({ source: 'capability-pack' })).toHaveLength(1)

    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })

    const after = r.list({ source: 'capability-pack' })
    expect(after.some((e) => e.packId === 'stale-pack')).toBe(false)
    expect(after.some((e) => e.packId === 'mock-pack-1')).toBe(true)
  })

  it('scenarioAgent 注册 role="scenario"；subAgents 内每个 worker 注册 role="worker"', async () => {
    // 构造一个含 worker 的 manifest（同 lit-search 形态），让 loader 走完两条 register 路径
    const manifestWithWorkers = {
      ...validManifest,
      packId: 'mock-pack-with-workers',
      scenarioAgent: { ...validManifest.scenarioAgent, name: 'mock-scenario' },
      subAgents: [
        {
          name: 'mock-worker-a',
          description: 'Worker A',
          promptPath: 'sub-agents/mock-worker-a.md',
          tools: ['Read'],
        },
        {
          name: 'mock-worker-b',
          description: 'Worker B',
          promptPath: 'sub-agents/mock-worker-b.md',
        },
      ],
    }
    writePackFixture(tmpRoot, 'mock-pack-with-workers', manifestWithWorkers)
    // 额外写两个 worker 的 prompt 文件（writePackFixture 只写 scenario 那份）
    const packDir = join(tmpRoot, 'mock-pack-with-workers')
    mkdirSync(join(packDir, 'sub-agents'), { recursive: true })
    writeFileSync(join(packDir, 'sub-agents', 'mock-worker-a.md'), 'You are worker A.')
    writeFileSync(join(packDir, 'sub-agents', 'mock-worker-b.md'), 'You are worker B.')

    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })

    const scenario = r.get('mock-scenario', { kind: 'subagent' })
    const workerA = r.get('mock-worker-a', { kind: 'subagent' })
    const workerB = r.get('mock-worker-b', { kind: 'subagent' })
    if (scenario?.kind !== 'subagent' || workerA?.kind !== 'subagent' || workerB?.kind !== 'subagent') {
      throw new Error('expected three subagent entries')
    }
    expect(scenario.role).toBe('scenario')
    expect(workerA.role).toBe('worker')
    expect(workerB.role).toBe('worker')
  })

  it('worker subAgent 写 skills → 透传进 def.skills（隔离上下文加载 Skill）；不写则 def 无 skills 键', async () => {
    // body-writer 形态：worker 声明 skills 在自己隔离上下文跑 Skill（如综述 body-writer 跑 literature-review-result）
    const manifestWithSkills = {
      ...validManifest,
      packId: 'mock-pack-skills',
      scenarioAgent: { ...validManifest.scenarioAgent, name: 'mock-scenario-skills' },
      subAgents: [
        {
          name: 'mock-body-writer',
          description: 'Worker that runs a skill in its own context',
          promptPath: 'sub-agents/mock-body-writer.md',
          tools: ['Skill', 'Write'],
          skills: ['literature-review-result'],
        },
        {
          name: 'mock-plain-worker',
          description: 'Worker without skills',
          promptPath: 'sub-agents/mock-plain-worker.md',
        },
      ],
    }
    writePackFixture(tmpRoot, 'mock-pack-skills', manifestWithSkills)
    const packDir = join(tmpRoot, 'mock-pack-skills')
    mkdirSync(join(packDir, 'sub-agents'), { recursive: true })
    writeFileSync(join(packDir, 'sub-agents', 'mock-body-writer.md'), 'You are the body-writer.')
    writeFileSync(join(packDir, 'sub-agents', 'mock-plain-worker.md'), 'You are a plain worker.')

    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })

    const bodyWriter = r.get('mock-body-writer', { kind: 'subagent' })
    const plain = r.get('mock-plain-worker', { kind: 'subagent' })
    if (bodyWriter?.kind !== 'subagent' || plain?.kind !== 'subagent') {
      throw new Error('expected two subagent entries')
    }
    // 关键断言：声明的 skills 原样透传给 SDK AgentDefinition.skills
    expect(bodyWriter.def.skills).toEqual(['literature-review-result'])
    // 未声明 skills 的 worker：def 里没有 skills 键（SDK 默认子 Agent 不带任何 Skill）
    expect('skills' in plain.def).toBe(false)
  })

  // manifest 同时含 scenario.model 与 worker.model（同 lit-search/lit-review 形态）的夹具
  const writeModelPackFixture = (root: string): void => {
    const manifestWithModels = {
      ...validManifest,
      packId: 'mock-pack-models',
      scenarioAgent: { ...validManifest.scenarioAgent, name: 'mock-scenario-model', model: 'sonnet' as const },
      subAgents: [
        { name: 'mock-worker-model', description: 'Worker', promptPath: 'sub-agents/mock-worker-model.md', model: 'haiku' as const },
      ],
    }
    writePackFixture(root, 'mock-pack-models', manifestWithModels)
    const packDir = join(root, 'mock-pack-models')
    mkdirSync(join(packDir, 'sub-agents'), { recursive: true })
    writeFileSync(join(packDir, 'sub-agents', 'mock-worker-model.md'), 'You are the model worker.')
  }

  it('Claude lead（claudeAvailable=true）→ scenario / worker 的 Claude model 别名透传', async () => {
    writeModelPackFixture(tmpRoot)
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en', claudeAvailable: true })

    const scenario = r.get('mock-scenario-model', { kind: 'subagent' })
    const worker = r.get('mock-worker-model', { kind: 'subagent' })
    if (scenario?.kind !== 'subagent' || worker?.kind !== 'subagent') throw new Error('expected two subagent entries')
    expect(scenario.def.model).toBe('sonnet')
    expect(worker.def.model).toBe('haiku')
  })

  it('非 Claude lead（claudeAvailable=false）→ 丢弃 scenario / worker 的 Claude model 别名（继承 lead）', async () => {
    // 复现 retrieve({}) 根因：deepseek/kimi lead 下若把 haiku/sonnet 透传给非 Claude 子进程 → 空参数 tool call
    writeModelPackFixture(tmpRoot)
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en', claudeAvailable: false })

    const scenario = r.get('mock-scenario-model', { kind: 'subagent' })
    const worker = r.get('mock-worker-model', { kind: 'subagent' })
    if (scenario?.kind !== 'subagent' || worker?.kind !== 'subagent') throw new Error('expected two subagent entries')
    expect(scenario.def.model).toBeUndefined()
    expect(worker.def.model).toBeUndefined()
  })

  it('claudeAvailable 缺省 → 视为 Claude lead（向后兼容，透传 model 别名）', async () => {
    writeModelPackFixture(tmpRoot)
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })

    const scenario = r.get('mock-scenario-model', { kind: 'subagent' })
    if (scenario?.kind !== 'subagent') throw new Error('expected scenario subagent entry')
    expect(scenario.def.model).toBe('sonnet')
  })

  // ── 别名家族"激活"校验（Claude lead + channel） ──
  const makeAnthropicChannel = (models: Array<{ id: string; name: string; enabled: boolean }>): Channel => ({
    id: 'ch-1', name: 'Anthropic', provider: 'anthropic', baseUrl: 'x', apiKey: 'x',
    models, enabled: true, createdAt: 0, updatedAt: 0,
  })

  it('Claude lead + 别名家族已激活 → 透传原别名', async () => {
    writeModelPackFixture(tmpRoot) // scenario=sonnet, worker=haiku
    const r = createInMemorySubagentRegistry()
    const channel = makeAnthropicChannel([
      { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet', enabled: true },
      { id: 'claude-haiku-4-5-20251001', name: 'Haiku', enabled: true },
    ])
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en', claudeAvailable: true, channel, leadModelId: 'claude-sonnet-4-5-20250929' })

    const scenario = r.get('mock-scenario-model', { kind: 'subagent' })
    const worker = r.get('mock-worker-model', { kind: 'subagent' })
    if (scenario?.kind !== 'subagent' || worker?.kind !== 'subagent') throw new Error('expected two subagent entries')
    expect(scenario.def.model).toBe('sonnet')
    expect(worker.def.model).toBe('haiku')
  })

  it('Claude lead + 别名家族未激活但有其它 Claude → 回退到 leadModelId + onModelNotice(family-fallback)', async () => {
    writeModelPackFixture(tmpRoot) // worker 需要 haiku
    const r = createInMemorySubagentRegistry()
    const channel = makeAnthropicChannel([
      { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet', enabled: true }, // 无 haiku 启用
    ])
    const notices: ModelNoticeInfo[] = []
    await loadCapabilityPacks(r, {
      packsDir: tmpRoot, language: 'en', claudeAvailable: true, channel,
      leadModelId: 'claude-sonnet-4-5-20250929',
      onModelNotice: (info) => notices.push(info),
    })

    const worker = r.get('mock-worker-model', { kind: 'subagent' })
    const scenario = r.get('mock-scenario-model', { kind: 'subagent' })
    if (worker?.kind !== 'subagent' || scenario?.kind !== 'subagent') throw new Error('expected two subagent entries')
    expect(scenario.def.model).toBe('sonnet')                       // 家族已激活,原样
    expect(worker.def.model).toBe('claude-sonnet-4-5-20250929')     // haiku 未激活,回退 lead 具体 id
    expect(notices).toEqual([{ agentName: 'mock-worker-model', alias: 'haiku', fallbackModelId: 'claude-sonnet-4-5-20250929', reason: 'family-fallback' }])
  })

  it('Claude lead + channel 零激活 Claude 模型 → onModelNotice(no-claude-activated)', async () => {
    writeModelPackFixture(tmpRoot)
    const r = createInMemorySubagentRegistry()
    const channel = makeAnthropicChannel([
      { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet', enabled: false }, // 全 disabled
    ])
    const notices: ModelNoticeInfo[] = []
    await loadCapabilityPacks(r, {
      packsDir: tmpRoot, language: 'en', claudeAvailable: true, channel,
      leadModelId: 'deepseek-v4', // lead 非 Claude id 也可作回退目标
      onModelNotice: (info) => notices.push(info),
    })

    const scenario = r.get('mock-scenario-model', { kind: 'subagent' })
    if (scenario?.kind !== 'subagent') throw new Error('expected scenario subagent entry')
    expect(scenario.def.model).toBe('deepseek-v4')
    expect(notices).toContainEqual({ agentName: 'mock-scenario-model', alias: 'sonnet', fallbackModelId: 'deepseek-v4', reason: 'no-claude-activated' })
  })

  it('同一 (agentName, alias) 每次 load 只回调一次（去重）', async () => {
    writeModelPackFixture(tmpRoot)
    const r = createInMemorySubagentRegistry()
    const channel = makeAnthropicChannel([{ id: 'claude-opus-4-1', name: 'Opus', enabled: true }]) // sonnet/haiku 都未激活
    const notices: ModelNoticeInfo[] = []
    await loadCapabilityPacks(r, {
      packsDir: tmpRoot, language: 'en', claudeAvailable: true, channel,
      leadModelId: 'claude-opus-4-1',
      onModelNotice: (info) => notices.push(info),
    })
    // scenario(sonnet) + worker(haiku) 各回退一次,无重复
    expect(notices.map((f) => f.agentName).sort()).toEqual(['mock-scenario-model', 'mock-worker-model'])
  })

  it('Claude lead 但未传 channel → 透传原别名（向后兼容，不做激活校验）', async () => {
    writeModelPackFixture(tmpRoot)
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en', claudeAvailable: true })

    const scenario = r.get('mock-scenario-model', { kind: 'subagent' })
    if (scenario?.kind !== 'subagent') throw new Error('expected scenario subagent entry')
    expect(scenario.def.model).toBe('sonnet')
  })

  it('reseed 不影响 builtin / user-config 来源的 entry', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', validManifest)
    const r = createInMemorySubagentRegistry()

    r.register({ kind: 'subagent', name: 'builtin-agent', source: 'builtin', def: { description: 'd', prompt: 'p' } })
    r.register({ kind: 'skill', name: 'user-skill', source: 'user-config', slug: 'user-skill' })

    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })

    expect(r.list({ source: 'builtin' })).toHaveLength(1)
    expect(r.list({ source: 'user-config' })).toHaveLength(1)
  })

  // ===== 运行时数据源可用性块注入（semantic key 状态喂给检索类 planner）=====

  it('paperSearchEnv 配了 semantic key + pack 引用 paper-search → scenario prompt 注入 CONFIGURED 块', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', validManifest)  // validManifest.mcpRefs = ['paper-search']
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, {
      packsDir: tmpRoot,
      language: 'en',
      paperSearchEnv: { semantic_scholar_api_key: 's2k-test' },
    })
    const entry = r.get('mock-researcher', { kind: 'subagent' })
    if (entry?.kind !== 'subagent') throw new Error('expected subagent entry')
    expect(entry.def.prompt).toContain('Optional paper-source availability')
    expect(entry.def.prompt).toContain('CONFIGURED')
  })

  it('paperSearchEnv 无 semantic key + pack 引用 paper-search → 注入 "not configured" 块', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', validManifest)
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, {
      packsDir: tmpRoot,
      language: 'en',
      paperSearchEnv: {},
    })
    const entry = r.get('mock-researcher', { kind: 'subagent' })
    if (entry?.kind !== 'subagent') throw new Error('expected subagent entry')
    expect(entry.def.prompt).toContain('Optional paper-source availability')
    expect(entry.def.prompt).toContain('not configured')
    expect(entry.def.prompt).not.toContain('CONFIGURED')
  })

  it('pack 不引用 paper-search → 即使配了 key 也不注入可用性块（门控）', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', { ...validManifest, mcpRefs: ['asci-zotero'] })
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, {
      packsDir: tmpRoot,
      language: 'en',
      paperSearchEnv: { semantic_scholar_api_key: 's2k-test' },
    })
    const entry = r.get('mock-researcher', { kind: 'subagent' })
    if (entry?.kind !== 'subagent') throw new Error('expected subagent entry')
    expect(entry.def.prompt).not.toContain('Optional paper-source availability')
  })

  it('paperSearchEnv 缺省（undefined）→ 不注入可用性块，prompt 形态与改动前一致', async () => {
    writePackFixture(tmpRoot, 'mock-pack-1', validManifest)
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: tmpRoot, language: 'en' })
    const entry = r.get('mock-researcher', { kind: 'subagent' })
    if (entry?.kind !== 'subagent') throw new Error('expected subagent entry')
    expect(entry.def.prompt).not.toContain('Optional paper-source availability')
  })
})

describe('buildPaperSourceAvailabilityBlock', () => {
  it('配了 semantic key → CONFIGURED + 提示纳入 sources', () => {
    const block = buildPaperSourceAvailabilityBlock({ semantic_scholar_api_key: 's2k-x' })
    expect(block).toContain('Semantic Scholar (`semantic`): CONFIGURED')
    expect(block).toContain('add it to `sources`')
  })

  it('无 semantic key → not configured + 提示移出 sources', () => {
    const block = buildPaperSourceAvailabilityBlock({})
    expect(block).toContain('not configured')
    expect(block).toContain('leave `semantic` out of `sources`')
    expect(block).not.toContain('CONFIGURED')
  })

  it('空字符串 key 视为未配置（与 loadPaperSearchEnv 的 undefined 归一一致）', () => {
    const block = buildPaperSourceAvailabilityBlock({ semantic_scholar_api_key: '' })
    expect(block).toContain('not configured')
  })
})
