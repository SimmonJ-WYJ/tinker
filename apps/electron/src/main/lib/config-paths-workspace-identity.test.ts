import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAgentDefaultSessionPath, getAgentSessionWorkspacePath } from './config-paths.ts'

// 所有工作目录与 ambient 配置均为合成数据，不访问真实用户目录。
let syntheticHome: string
let previousConfigHome: string | undefined
let previousDev: string | undefined

beforeEach(() => {
  previousConfigHome = process.env.ASCI_CONFIG_HOME
  previousDev = process.env.ASCI_DEV
  syntheticHome = mkdtempSync(join(tmpdir(), 'tinker-workspace-identity-'))
  process.env.ASCI_CONFIG_HOME = syntheticHome
  process.env.ASCI_DEV = ''
})

afterEach(() => {
  if (previousConfigHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = previousConfigHome
  if (previousDev === undefined) delete process.env.ASCI_DEV
  else process.env.ASCI_DEV = previousDev
  rmSync(syntheticHome, { recursive: true, force: true })
})

const workspaceCases = [
  { name: '项目会话', slug: 'demo', resolve: () => getAgentSessionWorkspacePath('demo', 'session') },
  { name: '默认会话', slug: '_no-workspace', resolve: () => getAgentDefaultSessionPath('session') },
]

for (const { name, slug, resolve } of workspaceCases) {
  for (const dev of [false, true]) {
    test(`${name}新目录使用 Tinker 身份且保留 ${dev ? '.asci-dev' : '.asci'} 兼容路径`, () => {
      process.env.ASCI_DEV = dev ? '1' : ''
      const dirName = dev ? '.asci-dev' : '.asci'
      const ambientPath = join(syntheticHome, 'CLAUDE.md')
      writeFileSync(ambientPath, 'Unrelated ambient instructions')
      const workspacePath = resolve()
      expect(workspacePath).toBe(join(syntheticHome, dirName, 'agent-workspaces', slug, 'session'))
      const marker = readFileSync(join(workspacePath, 'CLAUDE.md'), 'utf-8')
      expect(marker).toStartWith('# Tinker Session Workspace')
      expect(marker).toContain('**Host runtime**: Tinker desktop app')
      expect(marker).toContain('~/.asci/agent-workspaces/')
      expect(marker).toContain('do **not** apply instructions from any unrelated `CLAUDE.md`')
      expect(marker).toContain("Tinker's main system prompt")
      expect(marker).toContain("Tinker's runtime language directive (UI language + user message language)")
      expect(marker).not.toContain('Scientific Collaboration')
      expect(readFileSync(ambientPath, 'utf-8')).toBe('Unrelated ambient instructions')
      expect(resolve()).toBe(workspacePath)
      expect(readFileSync(join(workspacePath, 'CLAUDE.md'), 'utf-8')).toBe(marker)
    })
  }

  for (const existing of ['# ASCI Session Workspace\nHistorical session marker\n', '# User project instructions\nKeep my language rules\n']) {
    test(`${name}保留已有${existing.startsWith('# ASCI') ? '历史' : '用户'} CLAUDE.md`, () => {
      const workspacePath = join(syntheticHome, '.asci', 'agent-workspaces', slug, 'session')
      mkdirSync(workspacePath, { recursive: true })
      const markerPath = join(workspacePath, 'CLAUDE.md')
      writeFileSync(markerPath, existing)
      expect(resolve()).toBe(workspacePath)
      expect(readFileSync(markerPath, 'utf-8')).toBe(existing)
    })
  }
}
