/**
 * 地域判定 + consent 合成测试（issue #426 T-3）
 *
 * 验收对照：GDPR 区时区默认关（opt-in）、非 GDPR 区默认开（opt-out）、
 * 无法判定按 GDPR 区保守处理；用户显式选择覆盖地域默认。
 */
import { describe, expect, test } from 'bun:test'
import {
  resolveConsentState,
  resolveDefaultEnabled,
  resolveRegionFromTimeZone,
} from './consent.ts'

describe('resolveRegionFromTimeZone', () => {
  test('EU 成员国时区 → gdpr', () => {
    expect(resolveRegionFromTimeZone('Europe/Berlin')).toBe('gdpr')
    expect(resolveRegionFromTimeZone('Europe/Paris')).toBe('gdpr')
    expect(resolveRegionFromTimeZone('Atlantic/Canary')).toBe('gdpr')
  })

  test('EEA / UK 保守纳入 → gdpr', () => {
    expect(resolveRegionFromTimeZone('Europe/Oslo')).toBe('gdpr')
    expect(resolveRegionFromTimeZone('Europe/London')).toBe('gdpr')
    expect(resolveRegionFromTimeZone('Atlantic/Reykjavik')).toBe('gdpr')
  })

  test('法国海外属地 → gdpr', () => {
    expect(resolveRegionFromTimeZone('Indian/Reunion')).toBe('gdpr')
    expect(resolveRegionFromTimeZone('Pacific/Tahiti')).toBe('gdpr')
  })

  test('非 GDPR 区时区 → non-gdpr', () => {
    expect(resolveRegionFromTimeZone('America/New_York')).toBe('non-gdpr')
    expect(resolveRegionFromTimeZone('Asia/Shanghai')).toBe('non-gdpr')
    expect(resolveRegionFromTimeZone('Europe/Zurich')).toBe('non-gdpr') // 瑞士非 EU/EEA
    expect(resolveRegionFromTimeZone('UTC')).toBe('non-gdpr')
  })

  test('空值 / 非法形态 → unknown', () => {
    expect(resolveRegionFromTimeZone(undefined)).toBe('unknown')
    expect(resolveRegionFromTimeZone(null)).toBe('unknown')
    expect(resolveRegionFromTimeZone('')).toBe('unknown')
    expect(resolveRegionFromTimeZone('NotATimezone')).toBe('unknown')
  })
})

describe('resolveDefaultEnabled', () => {
  test('gdpr / unknown → 默认关（opt-in）；non-gdpr → 默认开（opt-out）', () => {
    expect(resolveDefaultEnabled('gdpr')).toBe(false)
    expect(resolveDefaultEnabled('unknown')).toBe(false)
    expect(resolveDefaultEnabled('non-gdpr')).toBe(true)
  })
})

describe('resolveConsentState', () => {
  test('用户未显式选择 → 两开关跟随地域默认', () => {
    const eu = resolveConsentState('Europe/Berlin', undefined)
    expect(eu.posthogEnabled).toBe(false)
    expect(eu.agentEvolutionEnabled).toBe(false)
    expect(eu.defaultEnabled).toBe(false)

    const us = resolveConsentState('America/New_York', {})
    expect(us.posthogEnabled).toBe(true)
    expect(us.agentEvolutionEnabled).toBe(true)
  })

  test('用户显式选择覆盖地域默认，两开关互不影响（T-4 解耦）', () => {
    const state = resolveConsentState('Europe/Berlin', { posthogEnabled: true })
    expect(state.posthogEnabled).toBe(true) // 显式开启覆盖 EU 默认关
    expect(state.agentEvolutionEnabled).toBe(false) // 未选择的另一路仍跟随默认

    const state2 = resolveConsentState('America/New_York', { agentEvolutionEnabled: false })
    expect(state2.posthogEnabled).toBe(true)
    expect(state2.agentEvolutionEnabled).toBe(false)
  })
})
