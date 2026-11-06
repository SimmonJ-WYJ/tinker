import { describe, expect, it } from 'bun:test'
import {
  formatTurnUserSafeSummary,
  formatTurnRedactedDiagnostic,
  type TurnDebugBlock,
} from './format-turn-debug-content.ts'
import type { SDKMessage } from '@asci/shared'

// #710 脱敏测试 fixture：故意构造的假凭证（非真钥），验证脱敏出口不泄漏。
// 用变量 + 模板插值而非 secret 形状字面串，避免 gitleaks 误判（curl-auth-header 按 curl 形态命中）。
const CANARY_SECRET = 'ASCI_CANARY_SECRET_TOKEN_710'

const textBlock = (text: string): TurnDebugBlock => ({
  block: { type: 'text', text } as never,
  speaker: 'master',
})

const thinkingBlock = (thinking: string): TurnDebugBlock => ({
  block: { type: 'thinking', thinking, signature: '' } as never,
  speaker: 'master',
})

const toolUseBlock = (id: string, name: string, input: unknown, speakerName?: string): TurnDebugBlock => ({
  block: { type: 'tool_use', id, name, input } as never,
  speaker: speakerName ? { kind: 'scenario', name: speakerName } : 'master',
})

const toolResultMsg = (toolUseId: string, content: string): SDKMessage => ({
  type: 'user',
  message: {
    content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
  },
} as never)

describe('formatTurnUserSafeSummary（#710 默认/生产 · user-safe）', () => {
  it('text 块原文保留（L0）', () => {
    const out = formatTurnUserSafeSummary([textBlock('hello world')], [])
    expect(out).toContain('## [1] text · speaker=master')
    expect(out).toContain('hello world')
  })

  it('thinking → [[REDACTED:thinking]]，不含原文', () => {
    const out = formatTurnUserSafeSummary([thinkingBlock('SECRET_REASONING')], [])
    expect(out).toContain('[[REDACTED:thinking]]')
    expect(out).not.toContain('SECRET_REASONING')
  })

  it('tool_use 只出动作摘要，不含 input/result', () => {
    const tu = toolUseBlock('tu_abc', 'Bash', { command: `curl -H "Authorization: Bearer ${CANARY_SECRET}"` })
    const out = formatTurnUserSafeSummary([tu], [toolResultMsg('tu_abc', 'RAW_RESULT_LEAK')])
    expect(out).toContain('Tool call: Bash')
    expect(out).not.toContain('Authorization')
    expect(out).not.toContain(CANARY_SECRET)
    expect(out).not.toContain('RAW_RESULT_LEAK')
    expect(out).not.toContain('command')
  })

  it('未知块只留标题，不出原始 JSON', () => {
    const weird: TurnDebugBlock = { block: { type: 'image', source: { url: 'http://x/secretval' } } as never, speaker: 'master' }
    const out = formatTurnUserSafeSummary([weird], [])
    expect(out).toContain('## [1] image · speaker=master')
    expect(out).not.toContain('secretval')
  })

  it('canary：thinking / raw tool I/O / secret 全 0 命中', () => {
    const tu = toolUseBlock('t', 'mcp__x__y', { api_key: 'ASCI_CANARY_SECRET_TOKEN_710' })
    const out = formatTurnUserSafeSummary(
      [textBlock('answer'), thinkingBlock('ASCI_CANARY_THINKING_710'), tu],
      [toolResultMsg('t', 'ASCI_CANARY_RAW_TOOL_INPUT_710')],
    )
    expect(out).not.toContain('ASCI_CANARY_THINKING_710')
    expect(out).not.toContain('ASCI_CANARY_SECRET_TOKEN_710')
    expect(out).not.toContain('ASCI_CANARY_RAW_TOOL_INPUT_710')
  })

  it('scenario speaker 在标题里标出 + 顺序保持', () => {
    const out = formatTurnUserSafeSummary(
      [textBlock('intro'), toolUseBlock('tu_x', 'WebSearch', {}, 'paper-scenario')],
      [],
    )
    expect(out).toContain('speaker=scenario:paper-scenario')
    expect(out.indexOf('intro')).toBeLessThan(out.indexOf('WebSearch'))
  })
})

describe('formatTurnRedactedDiagnostic（#710 dev-gated · redacted）', () => {
  it('text 保留；thinking 占位；tool input/result 路径脱敏', () => {
    const tu = toolUseBlock('tu_x', 'Bash', { command: 'echo /Users/opensci_claw/x' })
    const out = formatTurnRedactedDiagnostic(
      [textBlock('intro'), thinkingBlock('THINK_SECRET'), tu],
      [toolResultMsg('tu_x', 'home /Users/opensci_claw/out')],
    )
    expect(out).toContain('intro')
    expect(out).toContain('[[REDACTED:thinking]]')
    expect(out).not.toContain('THINK_SECRET')
    expect(out).toContain('<USER>')
    expect(out).not.toContain('opensci_claw')
  })

  it('tool input 凭证脱敏', () => {
    const tu = toolUseBlock('tu_y', 'mcp__x__y', { api_key: CANARY_SECRET })
    const out = formatTurnRedactedDiagnostic([tu], [])
    expect(out).toContain('[[REDACTED:credential]]')
    expect(out).not.toContain(CANARY_SECRET)
  })
})
