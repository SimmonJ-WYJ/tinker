import { describe, expect, test } from 'bun:test'

import { resolvePackSummary } from './capability-pack-utils.ts'
import type { CapabilityPackListItem } from '@asci/shared'

function pack(over: Partial<CapabilityPackListItem>): CapabilityPackListItem {
  return {
    packId: 'p',
    version: '1.0.0',
    scenarioAgentName: 'p',
    skillRefs: [],
    mcpRefs: [],
    manifestValid: true,
    ...over,
  }
}

describe('resolvePackSummary', () => {
  test('picks current language summary', () => {
    const p = pack({ summaryI18n: { zh: '中文摘要', en: 'EN summary' } })
    expect(resolvePackSummary(p, 'zh')).toBe('中文摘要')
    expect(resolvePackSummary(p, 'en')).toBe('EN summary')
  })

  test('falls back to other language when current missing', () => {
    const p = pack({ summaryI18n: { en: 'EN summary' } })
    expect(resolvePackSummary(p, 'zh')).toBe('EN summary')
  })

  // 安全边界 #710：缺 summary 不回退 routing prompt，返回空串（由组件出中性占位）
  test('returns empty string when summaryI18n absent (no routing-prompt fallback)', () => {
    expect(resolvePackSummary(pack({}), 'zh')).toBe('')
  })

  test('returns empty string when summary values are empty/blank', () => {
    const p = pack({ summaryI18n: { zh: '   ', en: '' } })
    expect(resolvePackSummary(p, 'zh')).toBe('')
  })
})
