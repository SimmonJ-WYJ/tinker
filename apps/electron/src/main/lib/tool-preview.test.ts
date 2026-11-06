import { describe, expect, test } from 'bun:test'
import { buildToolPreview } from './tool-preview.ts'
import { CANARY, assertNoCanary, assertHasPlaceholder } from './telemetry/redaction-canary.ts'

describe('#710 buildToolPreview — 已知工具结构化 + 出口脱敏', () => {
  test('Bash 命令含凭证 → command 预览脱敏（凭证 0 命中）', () => {
    const p = buildToolPreview('Bash', { command: `curl -H "Authorization: Bearer ${CANARY.secretToken}"` })
    expect(p.kind).toBe('command')
    assertHasPlaceholder(p, '[[REDACTED:credential]]')
    if (p.kind === 'command') expect(p.command).not.toContain(CANARY.secretToken)
  })

  test('Write 文件路径含用户名段 → 脱敏（不泄漏用户名）', () => {
    const p = buildToolPreview('Write', { file_path: '/Users/opensci_claw/secret/x.ts', content: '...' })
    expect(p.kind).toBe('file')
    if (p.kind === 'file') {
      expect(p.path).toContain('<USER>')
      expect(p.path).not.toContain('opensci_claw')
    }
  })
})

describe('#710 buildToolPreview — 未知/MCP 工具走 redacted（绝不下发 raw JSON）', () => {
  test('凭证 canary 在敏感键下 → redacted 预览原文 0 命中 + 占位符 + hash/bytes', () => {
    const p = buildToolPreview('mcp__x__do', { api_key: CANARY.secretToken, q: 'hello' })
    expect(p.kind).toBe('redacted')
    assertNoCanary(p)
    assertHasPlaceholder(p, '[[REDACTED:credential]]')
    if (p.kind === 'redacted') {
      expect(p.hash).toHaveLength(64)
      expect(p.bytes).toBeGreaterThan(0)
      expect(p.preview).toContain('"q": "hello"') // 非敏感参数仍可见（参数 redacted preview）
    }
  })

  test('家目录路径 canary → redacted 预览用户名段脱敏（原文全串 0 命中）', () => {
    const p = buildToolPreview('mcp__x__do', { path: CANARY.privatePath })
    assertNoCanary(p)
    if (p.kind === 'redacted') expect(p.preview).toContain('<USER>')
  })
})
