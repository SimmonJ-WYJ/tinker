import { test, expect } from 'bun:test'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAgentWorkspace, getWorkspaceSkills } from './agent-workspace-manager.ts'
import { getDefaultSkillsDir, getWorkspaceSkillsDir } from './config-paths.ts'

test('default copy skips retired workflows while preserving custom modifications', () => {
 const original = process.env.ASCI_CONFIG_HOME
 const root = mkdtempSync(join(tmpdir(), 'retired-skills-'))
 process.env.ASCI_CONFIG_HOME = root
 try {
  const defaults = getDefaultSkillsDir()
  const retired = join(defaults, 'litreview')
  mkdirSync(retired)
  writeFileSync(join(retired, 'SKILL.md'), '---\nname: litreview\ncategory: default\n---\nOld workflow')
  const ws = createAgentWorkspace('synthetic')
  expect(getWorkspaceSkills(ws.slug).map(s => s.slug)).not.toContain('litreview')
  const custom = join(getWorkspaceSkillsDir(ws.slug), 'litreview')
  cpSync(retired, custom, { recursive: true })
  writeFileSync(join(custom, 'SKILL.md'), '---\nname: litreview\ncategory: default\n---\nUser modified workflow')
  expect(getWorkspaceSkills(ws.slug).map(s => s.slug)).toContain('litreview')
  expect(readFileSync(join(retired, 'SKILL.md'), 'utf8')).toContain('Old workflow')
 } finally {
  if (original === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = original
  rmSync(root, { recursive: true, force: true })
 }
})

test('runtime projection retains files until the SDK stream and background tasks release them', async () => {
 const { createRuntimeSkillProjection } = await import('./runtime-skill-projection.ts')
 const { existsSync } = await import('node:fs')
 const original = process.env.ASCI_CONFIG_HOME
 const root = mkdtempSync(join(tmpdir(), 'skill-lease-'))
 process.env.ASCI_CONFIG_HOME = root
 try {
  const ws = createAgentWorkspace('lease')
  const projection = createRuntimeSkillProjection(ws.slug, 'session-lease')
  const release = projection.retain()
  projection.observe({ type: 'system', subtype: 'task_started', task_type: 'local_agent', task_id: 'background' })
  projection.dispose()
  expect(existsSync(projection.path)).toBe(true)
  release()
  expect(existsSync(projection.path)).toBe(true)
  projection.observe({ type: 'system', subtype: 'task_notification', status: 'completed', task_id: 'background' })
  expect(existsSync(projection.path)).toBe(false)
  projection.dispose()
  release()
  expect(existsSync(getWorkspaceSkillsDir(ws.slug))).toBe(true)
 } finally {
  if (original === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = original
  rmSync(root, { recursive: true, force: true })
 }
})

test('runtime plugin keeps the workspace namespace used by host skill mentions', async () => {
 const { createRuntimeSkillProjection } = await import('./runtime-skill-projection.ts')
 const projection = createRuntimeSkillProjection('namespace-check')
 try {
  const manifest = JSON.parse(readFileSync(join(projection.path, '.claude-plugin/plugin.json'), 'utf8')) as { name: string }
  expect(manifest.name).toBe('asci-workspace-namespace-check')
  const { buildToolMentionContext } = await import('./agent-tool-mentions.ts')
  const prompt = buildToolMentionContext('Create a spreadsheet', 'namespace-check', ['my-xlsx'], ['custom-server'])
  expect(prompt).toContain(`- Skill: ${manifest.name}:my-xlsx`)
  expect(prompt).toContain('- MCP server: custom-server')
  expect(prompt).toContain('Create a spreadsheet')
 } finally { projection.dispose() }
})
