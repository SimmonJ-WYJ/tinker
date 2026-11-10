import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectRuntimePolicy, buildLeanSystemPrompt } from '@asci/shared'
import { buildSystemPrompt } from './agent-prompt-builder.ts'
import { resolveBuiltinMcpServers } from './mcp/builtin-mcp-resolver.ts'
import { createInMemorySubagentRegistry } from './subagent-registry.ts'
import { assembleQueryOptions } from './run-orchestrator-query.ts'
import { loadCapabilityPacks } from './capability-pack-loader.ts'

test('scientific wording, references and saved research intent never activate a scientific runtime', () => {
  for (const message of ['hello', 'continue', '分析这篇论文', 'write a literature review', 'find scientific papers']) {
    for (const mode of ['search', 'coding'] as const) {
      const policy = selectRuntimePolicy({ message, mode, hasHistory: true, previousProfile: 'research', hasScientificReferences: true, hasStickyWorkflow: true })
      expect(policy.profile).toBe(mode === 'coding' ? 'coding' : 'general')
      expect(policy.tools).toContain('Agent')
      expect(policy.includeSubagents).toBe(true)
    }
  }
  expect(buildLeanSystemPrompt('general', 'en')).not.toContain('Load scientific workflows')
})

test('full prompt preserves general capabilities without scientific routing or sticky pack', () => {
  const prompt = buildSystemPrompt({ sessionId: 'synthetic', workspaceSlug: 'synthetic', workspaceName: 'Test', permissionMode: 'plan', language: 'zh', pdfDocumentBlockSupported: false,
    stickyCapabilityPack: { packId: 'lit-search', scenarioAgentName: 'lit-search', scenarioAgentDescription: 'retired' },
    registeredScenarioAgents: [{ name: 'custom-reviewer', description: 'Review source code', source: 'user-config' }],
  })
  for (const forbidden of ['papers-rg', 'mcp__paper-search', 'MUST-ROUTE', 'lit-search', 'lit-review', 'session_paper_index', 'present_directions']) expect(prompt).not.toContain(forbidden)
  for (const required of ['custom-reviewer', 'Chinese', 'PDF Compatibility', 'mcp__pdf_parser__pdf_parse_batch', '.context/plan/', 'Tinker']) expect(prompt).toContain(required)
})

test('OCR and ASR flags are independent of the retired Zotero flag', () => {
  for (const zoteroEnabled of [false, true]) for (const zoteroOcrEnabled of [false, true]) for (const zoteroAsrEnabled of [false, true]) {
    const input = { zoteroEnabled, zoteroOcrEnabled, zoteroAsrEnabled, uvBin: '/synthetic/uv', devEnv: {}, paperSearchEnv: {}, paths: { zoteroServerCjs: '', ocrServerCjs: '/ocr', asrServerCjs: '/asr', paperSearchPackageDir: '', asrModelDir: '/weights', asrCacheRoot: '/cache', pyCachePrefixDir: '' } }
    const servers = resolveBuiltinMcpServers(input)
    expect(Object.keys(servers).sort()).toEqual(['asr', 'ocr'])
    expect(servers.ocr!.enabled).toBe(zoteroOcrEnabled)
    expect(servers.asr!.enabled).toBe(zoteroAsrEnabled)
  }
})

test('explicit tool lists retain custom agents and host hooks without scientific hooks', () => {
  const registry = createInMemorySubagentRegistry()
  registry.register({ kind: 'subagent', name: 'custom', source: 'user-config', def: { description: 'Custom reviewer', prompt: 'Review code.' } })
  for (const tools of [undefined, ['Read', 'Agent', 'Skill']]) {
    const hooks = { PreToolUse: [], PostToolUse: [], Stop: [] }
    const options = assembleQueryOptions({ registry, sessionId: 'synthetic', sink: { append() {}, update() {} }, baseOptions: { tools, hooks } as never })
    expect(options.agents?.custom?.prompt).toBe('Review code.')
    expect(options.hooks?.PreToolUse).toEqual([])
    expect(options.hooks?.PostToolUse).toEqual([])
    expect(options.hooks?.Stop).toEqual([])
  }
})

test('retired installed packs are skipped without altering bytes; arbitrary custom packs still load', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tinker-retirement-'))
  try {
    const contents = new Map<string, string>()
    for (const packId of ['lit-search', 'lit-review', 'research-gap', 'custom-workflow']) {
      const dir = join(root, packId)
      mkdirSync(dir)
      const manifest = JSON.stringify({ packId, version: '1.0.0', scenarioAgent: { name: packId, description: 'User scenario', promptPath: 'prompt.md', tools: ['Read'] }, skillRefs: [], mcpRefs: [], uiFramework: 'conversation-and-artifact' })
      writeFileSync(join(dir, 'manifest.json'), manifest)
      writeFileSync(join(dir, 'prompt.md'), 'Complete the requested task.')
      contents.set(join(dir, 'manifest.json'), manifest)
    }
    const registry = createInMemorySubagentRegistry()
    await loadCapabilityPacks(registry, { packsDir: root, language: 'en' })
    expect(Object.keys(registry.snapshot().agents)).toEqual(['custom-workflow'])
    for (const [path, content] of contents) expect(readFileSync(path, 'utf8')).toBe(content)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('startup and request assembly do not invoke retired workers or persistent trust/config emitters', () => {
  const startup = readFileSync(join(import.meta.dir, '../index.ts'), 'utf8')
  for (const name of ['startSessionPapersWatcher', 'startZoteroPdfParserWorker', 'startZoteroArticleGeneratorWorker', 'startZoteroEmbeddingIndexWorker', 'startZoteroPdfAutoTrigger', 'triggerZoteroPdfDiff', 'pruneRetiredDefaultSkills', 'seedDefaultCapabilityPacks']) expect(startup).not.toMatch(new RegExp(`\\b${name}\\s*\\(`))
  const assembly = readFileSync(join(import.meta.dir, 'agent-orchestrator.ts'), 'utf8')
  for (const name of ['emitFilesystemAgents', 'emitMcpConfigFile', 'markClaudeProjectTrusted', 'loadPaperSearchEnv']) expect(assembly).not.toMatch(new RegExp(`\\b${name}\\s*\\(`))
})
