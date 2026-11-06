import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emitMcpConfigFile } from './emit-mcp-config.ts'

describe('emitMcpConfigFile', () => {
  let tmpRoot: string
  beforeEach(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'asci-mcp-config-test-')) })
  afterEach(() => { rmSync(tmpRoot, { recursive: true, force: true }) })

  it('把 mcpServers 字典写到 <cwd>/.mcp.json （Claude Code 项目级约定）', () => {
    emitMcpConfigFile({
      'paper-search': { command: '/usr/local/bin/node', args: ['paper.cjs'], env: { ASCI_SESSION_ID: 'sid-1' } },
      'asci-zotero': { command: '/usr/local/bin/node', args: ['zotero.cjs'] },
    }, tmpRoot)

    const mcpPath = join(tmpRoot, '.mcp.json')
    expect(existsSync(mcpPath)).toBe(true)

    const parsed = JSON.parse(readFileSync(mcpPath, 'utf-8'))
    expect(parsed).toEqual({
      mcpServers: {
        'paper-search': { command: '/usr/local/bin/node', args: ['paper.cjs'], env: { ASCI_SESSION_ID: 'sid-1' } },
        'asci-zotero': { command: '/usr/local/bin/node', args: ['zotero.cjs'] },
      },
    })
  })

  it('空字典也照写（清掉前 turn 残留）', () => {
    emitMcpConfigFile({}, tmpRoot)
    const mcpPath = join(tmpRoot, '.mcp.json')
    expect(existsSync(mcpPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(mcpPath, 'utf-8'))
    expect(parsed).toEqual({ mcpServers: {} })
  })

  it('reseed 模式：覆盖旧 .mcp.json', () => {
    emitMcpConfigFile({ 'old-mcp': { command: 'old' } }, tmpRoot)
    emitMcpConfigFile({ 'new-mcp': { command: 'new' } }, tmpRoot)
    const parsed = JSON.parse(readFileSync(join(tmpRoot, '.mcp.json'), 'utf-8'))
    expect(parsed.mcpServers).toEqual({ 'new-mcp': { command: 'new' } })
    expect(parsed.mcpServers).not.toHaveProperty('old-mcp')
  })

  it('JSON 格式可读（2-space indent + newline 末尾）', () => {
    emitMcpConfigFile({ 'paper-search': { command: 'x' } }, tmpRoot)
    const text = readFileSync(join(tmpRoot, '.mcp.json'), 'utf-8')
    expect(text).toContain('  "mcpServers": {')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('含循环引用 / in-process SDK MCP 的 entry 跳过，其他正常 emit', () => {
    const circular: Record<string, unknown> = { type: 'sdk' }
    circular.self = circular  // 循环引用，模拟 in-process McpSdkServerConfig 的 native handle
    emitMcpConfigFile({
      'paper-search': { command: 'node', args: ['paper.cjs'] },
      'in-process-mcp': circular,
      'asci-zotero': { command: 'node', args: ['zotero.cjs'] },
    }, tmpRoot)
    const parsed = JSON.parse(readFileSync(join(tmpRoot, '.mcp.json'), 'utf-8'))
    expect(parsed.mcpServers).toEqual({
      'paper-search': { command: 'node', args: ['paper.cjs'] },
      'asci-zotero': { command: 'node', args: ['zotero.cjs'] },
    })
    expect(parsed.mcpServers).not.toHaveProperty('in-process-mcp')
  })
})
