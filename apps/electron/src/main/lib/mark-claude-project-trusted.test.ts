import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { markClaudeProjectTrusted, resolveTrustPatchTargets } from './mark-claude-project-trusted.ts'

describe('markClaudeProjectTrusted', () => {
  let tmpRoot: string
  let claudeJsonPath: string
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'asci-trust-test-'))
    claudeJsonPath = join(tmpRoot, '.claude.json')
  })
  afterEach(() => { rmSync(tmpRoot, { recursive: true, force: true }) })

  it('文件不存在 → 创建并写入 projects[cwd] entry', () => {
    markClaudeProjectTrusted({
      cwd: '/some/session/cwd',
      mcpServerNames: ['paper-search', 'asci-zotero'],
      claudeJsonPath,
    })
    expect(existsSync(claudeJsonPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
    expect(parsed.projects['/some/session/cwd']).toEqual({
      hasTrustDialogAccepted: true,
      enabledMcpjsonServers: ['paper-search', 'asci-zotero'],
    })
  })

  it('文件已存在 → 保留其他 projects + 仅新增 / 覆盖目标 entry', () => {
    writeFileSync(claudeJsonPath, JSON.stringify({
      projects: {
        '/other/project': {
          hasTrustDialogAccepted: false,
          lastSessionId: 'session-x',
          customField: 'keep me',
        },
      },
      topLevelField: 'preserved',
    }), 'utf-8')

    markClaudeProjectTrusted({
      cwd: '/asci/session',
      mcpServerNames: ['paper-search'],
      claudeJsonPath,
    })

    const parsed = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
    expect(parsed.topLevelField).toBe('preserved')
    expect(parsed.projects['/other/project']).toEqual({
      hasTrustDialogAccepted: false,
      lastSessionId: 'session-x',
      customField: 'keep me',
    })
    expect(parsed.projects['/asci/session']).toEqual({
      hasTrustDialogAccepted: true,
      enabledMcpjsonServers: ['paper-search'],
    })
  })

  it('目标 entry 已存在 → 保留原字段，只覆盖 hasTrustDialogAccepted + enabledMcpjsonServers', () => {
    writeFileSync(claudeJsonPath, JSON.stringify({
      projects: {
        '/asci/session': {
          hasTrustDialogAccepted: false,
          enabledMcpjsonServers: ['old-mcp'],
          lastSessionId: 'session-x',
          mcpServers: { 'something': 'else' },
        },
      },
    }), 'utf-8')

    markClaudeProjectTrusted({
      cwd: '/asci/session',
      mcpServerNames: ['paper-search', 'asci-zotero'],
      claudeJsonPath,
    })

    const parsed = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
    expect(parsed.projects['/asci/session']).toEqual({
      hasTrustDialogAccepted: true,
      enabledMcpjsonServers: ['paper-search', 'asci-zotero'],
      lastSessionId: 'session-x',
      mcpServers: { 'something': 'else' },
    })
  })

  it('空 mcpServerNames 数组也照写（清旧）', () => {
    markClaudeProjectTrusted({
      cwd: '/asci/session',
      mcpServerNames: [],
      claudeJsonPath,
    })
    const parsed = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
    expect(parsed.projects['/asci/session'].enabledMcpjsonServers).toEqual([])
    expect(parsed.projects['/asci/session'].hasTrustDialogAccepted).toBe(true)
  })

  it('损坏 JSON → 跳过，不破坏现有配置', () => {
    writeFileSync(claudeJsonPath, '{ broken json', 'utf-8')
    markClaudeProjectTrusted({
      cwd: '/asci/session',
      mcpServerNames: ['paper-search'],
      claudeJsonPath,
    })
    // 损坏文件保持原样
    expect(readFileSync(claudeJsonPath, 'utf-8')).toBe('{ broken json')
  })

  it('双写（issue #587）：claudeJsonPaths 的每个目标都被 patch，互不干扰', () => {
    const homePath = join(tmpRoot, 'home.claude.json')
    const sdkConfigPath = join(tmpRoot, 'sdk-config.claude.json')
    // sdk-config 侧预置 binary 自己写的字段，patch 后必须保留
    writeFileSync(sdkConfigPath, JSON.stringify({ userID: 'u-1' }), 'utf-8')

    markClaudeProjectTrusted({
      cwd: '/asci/session',
      mcpServerNames: ['paper-search'],
      claudeJsonPaths: [homePath, sdkConfigPath],
    })

    for (const p of [homePath, sdkConfigPath]) {
      const parsed = JSON.parse(readFileSync(p, 'utf-8'))
      expect(parsed.projects['/asci/session']).toEqual({
        hasTrustDialogAccepted: true,
        enabledMcpjsonServers: ['paper-search'],
      })
    }
    expect(JSON.parse(readFileSync(sdkConfigPath, 'utf-8')).userID).toBe('u-1')
  })

  it('双写：其中一个目标 JSON 损坏 → 跳过该目标，另一个仍被 patch', () => {
    const okPath = join(tmpRoot, 'ok.claude.json')
    const brokenPath = join(tmpRoot, 'broken.claude.json')
    writeFileSync(brokenPath, '{ broken json', 'utf-8')

    markClaudeProjectTrusted({
      cwd: '/asci/session',
      mcpServerNames: ['paper-search'],
      claudeJsonPaths: [brokenPath, okPath],
    })

    expect(readFileSync(brokenPath, 'utf-8')).toBe('{ broken json')
    const parsed = JSON.parse(readFileSync(okPath, 'utf-8'))
    expect(parsed.projects['/asci/session'].hasTrustDialogAccepted).toBe(true)
  })

  it('resolveTrustPatchTargets：默认目标 = homedir + $CLAUDE_CONFIG_DIR(sdk-config) 两份 .claude.json', () => {
    const originalConfigHome = process.env.ASCI_CONFIG_HOME
    const originalDev = process.env.ASCI_DEV
    process.env.ASCI_CONFIG_HOME = tmpRoot
    process.env.ASCI_DEV = ''
    try {
      const targets = resolveTrustPatchTargets()
      expect(targets).toHaveLength(2)
      expect(targets[0]).toBe(join(homedir(), '.claude.json'))
      expect(targets[1]).toBe(join(tmpRoot, '.asci', 'sdk-config', '.claude.json'))
    } finally {
      if (originalConfigHome === undefined) delete process.env.ASCI_CONFIG_HOME
      else process.env.ASCI_CONFIG_HOME = originalConfigHome
      if (originalDev === undefined) delete process.env.ASCI_DEV
      else process.env.ASCI_DEV = originalDev
    }
  })
})
