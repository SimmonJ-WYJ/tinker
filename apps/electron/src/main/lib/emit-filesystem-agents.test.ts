import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emitFilesystemAgents, renderAgentMarkdown } from './emit-filesystem-agents.ts'
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'

const stubAgent = (overrides: Partial<AgentDefinition> = {}): AgentDefinition => ({
  description: 'stub description',
  prompt: 'stub prompt',
  ...overrides,
})

describe('renderAgentMarkdown', () => {
  it('生成带 frontmatter 的 markdown', () => {
    const md = renderAgentMarkdown('paper-retrieval-scenario', stubAgent({
      description: 'Comprehensive paper retrieval',
      tools: ['Read', 'Bash', 'WebSearch'],
      model: 'sonnet',
      prompt: 'You are a paper retrieval Agent.',
    }))
    expect(md).toContain('---')
    expect(md).toContain('name: paper-retrieval-scenario')
    expect(md).toContain('description: Comprehensive paper retrieval')
    expect(md).toContain('tools: Read, Bash, WebSearch')
    expect(md).toContain('model: sonnet')
    expect(md).toContain('You are a paper retrieval Agent.')
  })

  it('description 含冒号或换行时用双引号包裹', () => {
    const md = renderAgentMarkdown('x', stubAgent({ description: 'has: colon and "quote"' }))
    expect(md).toContain('description: "has: colon and \\"quote\\""')
  })

  it('description 含换行时合并为单行（YAML frontmatter 不支持多行）', () => {
    const md = renderAgentMarkdown('x', stubAgent({ description: 'line1\nline2' }))
    expect(md).toContain('description: "line1 line2"')
  })

  it('tools / model / description 任一缺省时不输出对应行', () => {
    const md = renderAgentMarkdown('minimal', { prompt: 'p' } as AgentDefinition)
    expect(md).not.toContain('tools:')
    expect(md).not.toContain('model:')
    expect(md).not.toContain('description:')
    expect(md).toContain('name: minimal')
    expect(md).toContain('p')
  })
})

describe('emitFilesystemAgents', () => {
  let tmpRoot: string
  beforeEach(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'asci-emit-test-')) })
  afterEach(() => { rmSync(tmpRoot, { recursive: true, force: true }) })

  it('在 <cwd>/.claude/agents/ 下写每个 scenario .md', () => {
    emitFilesystemAgents([
      { name: 'paper-retrieval-scenario', def: stubAgent({ prompt: 'paper prompt' }) },
      { name: 'searcher', def: stubAgent({ prompt: 'searcher prompt' }) },
    ], tmpRoot)
    const agentsDir = join(tmpRoot, '.claude', 'agents')
    expect(existsSync(join(agentsDir, 'paper-retrieval-scenario.md'))).toBe(true)
    expect(existsSync(join(agentsDir, 'searcher.md'))).toBe(true)
    expect(readFileSync(join(agentsDir, 'paper-retrieval-scenario.md'), 'utf-8'))
      .toContain('paper prompt')
  })

  it('reseed 模式：先清旧 .md 再写新（被卸载的 pack 不留 stale）', () => {
    const agentsDir = join(tmpRoot, '.claude', 'agents')
    mkdirSync(agentsDir, { recursive: true })
    writeFileSync(join(agentsDir, 'stale-pack.md'), 'old content', 'utf-8')
    writeFileSync(join(agentsDir, 'keep-me.txt'), 'non-md file', 'utf-8')

    emitFilesystemAgents([{ name: 'new-scenario', def: stubAgent() }], tmpRoot)

    expect(existsSync(join(agentsDir, 'stale-pack.md'))).toBe(false)
    expect(existsSync(join(agentsDir, 'new-scenario.md'))).toBe(true)
    // 非 .md 文件保留（reseed 只清自己写的格式）
    expect(existsSync(join(agentsDir, 'keep-me.txt'))).toBe(true)
  })

  it('agentsDir 不存在 → 自动创建', () => {
    const agentsDir = join(tmpRoot, '.claude', 'agents')
    expect(existsSync(agentsDir)).toBe(false)
    emitFilesystemAgents([{ name: 'a', def: stubAgent() }], tmpRoot)
    expect(existsSync(agentsDir)).toBe(true)
    expect(existsSync(join(agentsDir, 'a.md'))).toBe(true)
  })

  it('空 scenarios → 只清旧文件，不写新', () => {
    const agentsDir = join(tmpRoot, '.claude', 'agents')
    mkdirSync(agentsDir, { recursive: true })
    writeFileSync(join(agentsDir, 'old.md'), 'stale', 'utf-8')

    emitFilesystemAgents([], tmpRoot)

    expect(readdirSync(agentsDir).filter((n) => n.endsWith('.md'))).toEqual([])
  })

  it('frontmatter 字段完整：name / description / tools / model + body', () => {
    emitFilesystemAgents([{
      name: 'full',
      def: stubAgent({
        description: 'desc',
        tools: ['Read', 'Grep'],
        model: 'haiku',
        prompt: 'agent body',
      }),
    }], tmpRoot)
    const content = readFileSync(join(tmpRoot, '.claude', 'agents', 'full.md'), 'utf-8')
    expect(content).toMatch(/^---\nname: full/)
    expect(content).toContain('description: desc')
    expect(content).toContain('tools: Read, Grep')
    expect(content).toContain('model: haiku')
    expect(content).toContain('agent body')
  })
})
