/**
 * Smoke test：把仓库里 `apps/electron/default-capability-packs/` 真实包通过 loader 加载一遍，
 * 校验：
 *  - 每包 scenarioAgent + manifest 声明的全部 worker subAgent 都注册成功
 *  - worker prompt 经模板展开后含有占位符替换出的实际 helper 输出（evidenceSchema / redLines / auditChecklist）
 *  - 展开后 prompt 不再含 `{{...}}` 字面占位符
 *
 * 这是 spec §4.2 / §6.1 物理目录形态 + capability-pack-loader 模板展开链路的端到端守门，
 * 任何错拼占位符（如 {{redlines:R1}} 大小写错）或缺失 .md 文件都会在这里立刻失败。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInMemorySubagentRegistry } from '../subagent-registry.ts'
import { loadCapabilityPacks } from '../capability-pack-loader.ts'
import { RED_LINES } from '../agent-prompt-builder.ts'

const DEFAULT_PACKS_DIR = join(__dirname, '..', '..', '..', '..', 'default-capability-packs')

let tmpHome: string
let originalHome: string | undefined
let originalDev: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-default-packs-'))
  originalHome = process.env.ASCI_CONFIG_HOME
  originalDev = process.env.ASCI_DEV
  process.env.ASCI_CONFIG_HOME = tmpHome
  process.env.ASCI_DEV = ''
})
afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  if (originalDev === undefined) delete process.env.ASCI_DEV
  else process.env.ASCI_DEV = originalDev
  rmSync(tmpHome, { recursive: true, force: true })
})

describe('default-capability-packs 真实加载', () => {
  it('lit-search 注册 scenario + 2 worker（searcher / citation-explorer；scorer 已下沉为 score_window 工具 #745，v1 legacy relevance-scorer 早删 #747）', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: DEFAULT_PACKS_DIR, language: 'en' })
    const fromPack = r.list({ packId: 'lit-search', kind: 'subagent' }).map((e) => e.name).sort()
    expect(fromPack).toEqual(['citation-explorer', 'lit-search', 'searcher'])
  })

  it('lit-review 注册 scenario + 7 worker（review-proposer / evidence-triager / evidence-skimmer / reader / body-writer / fact-checker / evidence-broadener；body 由 body-writer subagent 在隔离上下文跑 literature-review-result skill 生产）', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: DEFAULT_PACKS_DIR, language: 'en' })
    const fromPack = r.list({ packId: 'lit-review', kind: 'subagent' }).map((e) => e.name).sort()
    expect(fromPack).toEqual(['body-writer', 'evidence-broadener', 'evidence-skimmer', 'evidence-triager', 'fact-checker', 'lit-review', 'reader', 'review-proposer'])
  })

  it('lit-search 注册 lit-search-report skillRef（按需/大检索自动产检索报告的 terminal_skill 依赖）', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: DEFAULT_PACKS_DIR, language: 'en' })
    const skills = r.list({ packId: 'lit-search', kind: 'skill' }).map((e) => e.name)
    expect(skills).toEqual(['lit-search-report'])
  })

  it('lit-review 注册 literature-review-result skillRef（PLAN terminal_skill 的真实依赖，manifest 已回填）', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: DEFAULT_PACKS_DIR, language: 'en' })
    const skills = r.list({ packId: 'lit-review', kind: 'skill' }).map((e) => e.name)
    expect(skills).toEqual(['literature-review-result'])
  })

  it('scenario entry 的 subAgentRefs 从 manifest.subAgents 名字派生（master prompt 注入用）', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: DEFAULT_PACKS_DIR, language: 'en' })
    const litSearch = r.get('lit-search', { kind: 'subagent' })
    if (litSearch?.kind !== 'subagent') throw new Error('expected lit-search subagent entry')
    expect(litSearch.subAgentRefs?.slice().sort()).toEqual(['citation-explorer', 'searcher'])
  })

  it('worker prompt 模板展开生效（searcher 红线 {{redLines:R1,R3}} + 不再有 {{...}} 字面占位符）', async () => {
    // Stage 3 收敛后 searcher 是 retrieve shim，不再 emit evidence 行，故不含
    // evidenceSchema；evidenceSchema 的展开覆盖移到 citation-explorer（见下条）。
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: DEFAULT_PACKS_DIR, language: 'en' })
    const searcher = r.get('searcher', { kind: 'subagent' })
    if (searcher?.kind !== 'subagent') throw new Error('expected searcher subagent entry')
    const p = searcher.def.prompt
    // {{redLines:R1,R3}} 展开后含 R1 / R3 实际文案（用 RED_LINES 常量避免绑死）
    expect(p).toContain(RED_LINES.R1)
    expect(p).toContain(RED_LINES.R3)
    // 不再有字面占位符
    expect(p).not.toMatch(/\{\{[a-zA-Z]/)
  })

  it('worker prompt 模板展开生效（citation-explorer 含 evidence schema + 不再有 {{...}} 字面占位符）', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: DEFAULT_PACKS_DIR, language: 'en' })
    const ce = r.get('citation-explorer', { kind: 'subagent' })
    if (ce?.kind !== 'subagent') throw new Error('expected citation-explorer subagent entry')
    const p = ce.def.prompt
    // {{evidenceSchema:candidate}} 展开后含 schema 头
    expect(p).toContain('Evidence Table schema')
    expect(p).toContain('required_for_candidate')
    expect(p).toContain(RED_LINES.R1)
    expect(p).not.toMatch(/\{\{[a-zA-Z]/)
  })

  it('fact-checker prompt 含 auditChecklist 展开（A–F 审计维度）', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir: DEFAULT_PACKS_DIR, language: 'en' })
    const fc = r.get('fact-checker', { kind: 'subagent' })
    if (fc?.kind !== 'subagent') throw new Error('expected fact-checker subagent entry')
    const p = fc.def.prompt
    expect(p).toContain('Audit checklist')
    expect(p).toContain('A. Citation integrity')
    expect(p).toContain('F. Methodology judgment')
    expect(p).not.toMatch(/\{\{[a-zA-Z]/)
  })
})
