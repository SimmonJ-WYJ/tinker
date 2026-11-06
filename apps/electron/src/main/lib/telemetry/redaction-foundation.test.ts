import { describe, expect, test } from 'bun:test'
import { redactDeepWithMatches, formatPromptPlaceholder } from '@asci/shared'
import { computePromptFingerprint, sha256Hex, byteLengthOf } from './disclosure-fingerprint.ts'
import { CANARY, assertNoCanary, assertHasPlaceholder } from './redaction-canary.ts'

describe('#710 P0-0 foundation — 原语 + canary 联动（其余片的门禁基线）', () => {
  test('凭证 canary 在敏感键下 → redactDeepWithMatches 脱敏，原文 0 命中', () => {
    const payload = { config: { api_key: CANARY.secretToken, note: 'safe-keep' } }
    const r = redactDeepWithMatches(payload)
    assertNoCanary(r.value)
    assertHasPlaceholder(r.value, '[[REDACTED:credential]]')
    expect(r.value.config.note).toBe('safe-keep')
    expect(r.redactionMatches.some((m) => m.category === 'credential')).toBe(true)
  })

  test('私密路径 canary → 用户名段脱敏（原文全串 0 命中）+ home-path 命中', () => {
    const r = redactDeepWithMatches({ cwd: CANARY.privatePath })
    assertNoCanary(r.value) // opensci_claw → <USER>，原文全串不再出现
    expect(r.value.cwd).toContain('<USER>')
    expect(r.redactionMatches.some((m) => m.category === 'home-path')).toBe(true)
  })

  test('prompt body canary → fingerprint + 占位符，正文 0 命中', () => {
    const fp = computePromptFingerprint({ promptId: 'master', version: 7, body: CANARY.promptBody })
    const placeholder = formatPromptPlaceholder(fp)
    assertNoCanary(placeholder)
    assertHasPlaceholder(placeholder, '[[PROMPT:sha256:')
    expect(placeholder).toContain('@7')
    expect(fp.hash).toHaveLength(64)
  })

  test('hash/bytes 在 main 侧可算（sha256 标准向量）', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(byteLengthOf('héllo')).toBe(6)
  })
})
