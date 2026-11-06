/**
 * 遥测汇集服务测试（issues #426 #427）
 *
 * 覆盖：consent 闸门（采集入口全停）、地域默认分支（T-3）、两开关解耦（T-4）、
 * deviceId 注入、信号白名单丢弃、脱敏兜底。
 * 非 Electron 环境自动判为 dev → 不发真实网络，出口仅本地 JSONL。
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TELEMETRY_EVENTS } from '@asci/shared'
import { CANARY } from './redaction-canary.ts'

// mock settings-service：全量 bun test 下 onboarding-spotlight-service.test.ts
// 会 mock.module 同一模块且跨文件泄漏；这里自带 mock 保证读到的 settings 可控。
let memSettings: Record<string, unknown> = {}
mock.module('../settings-service.ts', () => ({
  getSettings: () => ({ ...memSettings }),
  updateSettings: (updates: Record<string, unknown>) => {
    memSettings = { ...memSettings, ...updates }
    return memSettings
  },
  isFreshInstall: () => false,
}))

import { telemetryService } from './telemetry-service.ts'
import { resetDeviceIdCacheForTest } from './device-id.ts'

let tempHome: string

function writeSettings(settings: Record<string, unknown>): void {
  memSettings = settings
}

function readJsonl(fileName: string): Array<Record<string, unknown>> {
  const path = join(tempHome, '.asci', 'telemetry', fileName)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

const readEvents = (): Array<Record<string, unknown>> => readJsonl('events.jsonl')
const readSignals = (): Array<Record<string, unknown>> => readJsonl('signals.jsonl')

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'asci-telemetry-svc-'))
  process.env.ASCI_CONFIG_HOME = tempHome
  // 钉住配置目录为 .asci（全量 bun test 下其他用例可能遗留 ASCI_DEV=1，导致读写目录分叉）
  process.env.ASCI_DEV = ''
  memSettings = {}
  resetDeviceIdCacheForTest()
  telemetryService.resetForTest()
})

afterEach(() => {
  delete process.env.ASCI_CONFIG_HOME
  rmSync(tempHome, { recursive: true, force: true })
  resetDeviceIdCacheForTest()
  telemetryService.resetForTest()
})

describe('consent 闸门（T-3 地域默认）', () => {
  test('GDPR 区时区 + 未显式同意 → track 完全不落地（采集入口全停）', () => {
    telemetryService.init({ timeZone: 'Europe/Berlin' })
    telemetryService.track({
      event: TELEMETRY_EVENTS.APP_LAUNCHED,
      props: { appVersion: '0.1.0', platform: 'darwin' },
    })
    expect(readEvents()).toEqual([])
  })

  test('非 GDPR 区时区 → 默认开启，事件落地且注入 deviceId', () => {
    telemetryService.init({ timeZone: 'America/New_York' })
    telemetryService.track({
      event: TELEMETRY_EVENTS.APP_LAUNCHED,
      props: { appVersion: '0.1.0', platform: 'darwin' },
    })
    const events = readEvents()
    expect(events.length).toBe(1)
    expect(events[0]?.event).toBe('app_launched')
    expect(events[0]?.distinct_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('无法判定时区 → 按 GDPR 区保守处理（不落地）', () => {
    telemetryService.init({ timeZone: 'Whatever' })
    telemetryService.track({
      event: TELEMETRY_EVENTS.APP_LAUNCHED,
      props: { appVersion: '0.1.0', platform: 'darwin' },
    })
    expect(readEvents()).toEqual([])
  })

  test('GDPR 区用户显式 opt-in 后事件落地', () => {
    writeSettings({ telemetryConsent: { posthogEnabled: true } })
    telemetryService.init({ timeZone: 'Europe/Berlin' })
    telemetryService.track({
      event: TELEMETRY_EVENTS.SEARCH_EXECUTED,
      props: { success: true, resultCount: 5 },
    })
    expect(readEvents().length).toBe(1)
  })

  test('#710 P0-5：track 出口按白名单过滤非法属性键 + 凭证/query canary 0 命中', () => {
    writeSettings({ telemetryConsent: { posthogEnabled: true } })
    telemetryService.init({ timeZone: 'America/New_York' })
    telemetryService.track({
      event: TELEMETRY_EVENTS.SEARCH_EXECUTED,
      // 模拟 renderer / 上游误塞自由文本 + 凭证（绕过编译期类型校验）
      props: { success: true, source: 'openalex', rawQuery: 'ASCI_CANARY_QUERY_710', apiKey: CANARY.secretToken } as never,
    })
    const events = readEvents()
    expect(events.length).toBe(1)
    const props = events[0]?.properties as Record<string, unknown>
    expect(props.success).toBe(true)
    expect(props.source).toBe('openalex')
    expect('rawQuery' in props).toBe(false) // 非白名单键被丢弃
    expect('apiKey' in props).toBe(false)
    const serialized = JSON.stringify(events[0])
    expect(serialized).not.toContain('ASCI_CANARY_QUERY_710')
    expect(serialized).not.toContain(CANARY.secretToken)
  })
})

describe('两开关解耦（T-4）', () => {
  test('关自进化不影响 PostHog；关 PostHog 不影响自进化', () => {
    writeSettings({ telemetryConsent: { posthogEnabled: true, agentEvolutionEnabled: false } })
    telemetryService.init({ timeZone: 'America/New_York' })

    telemetryService.track({
      event: TELEMETRY_EVENTS.APP_LAUNCHED,
      props: { appVersion: '0.1.0', platform: 'darwin' },
    })
    telemetryService.captureSignal({ kind: 'tool_usage', toolName: 'Read', success: true })

    expect(readEvents().length).toBe(1) // PostHog 路通
    expect(readSignals()).toEqual([]) // 自进化路停

    // 反转两开关
    writeSettings({ telemetryConsent: { posthogEnabled: false, agentEvolutionEnabled: true } })
    telemetryService.refreshConsent()

    telemetryService.track({
      event: TELEMETRY_EVENTS.APP_LAUNCHED,
      props: { appVersion: '0.1.0', platform: 'darwin' },
    })
    telemetryService.captureSignal({ kind: 'tool_usage', toolName: 'Bash', success: true })

    expect(readEvents().length).toBe(1) // 不再新增
    expect(readSignals().length).toBe(1) // 信号落地
  })
})

describe('信号白名单与脱敏', () => {
  test('未声明字段被丢弃，红线字段不落盘', () => {
    writeSettings({ telemetryConsent: { agentEvolutionEnabled: true } })
    telemetryService.init({ timeZone: 'Europe/Berlin' })
    telemetryService.captureSignal({
      kind: 'tool_usage',
      toolName: 'Read',
      promptText: '研究内容原文', // 红线字段 → strip
    })
    const signals = readSignals()
    expect(signals.length).toBe(1)
    expect(signals[0]).not.toHaveProperty('promptText')
    expect(signals[0]?.ts).toBeGreaterThan(0)
  })

  test('未知 kind 整体拒绝', () => {
    writeSettings({ telemetryConsent: { agentEvolutionEnabled: true } })
    telemetryService.init({ timeZone: 'America/New_York' })
    telemetryService.captureSignal({ kind: 'proposal_decision', value: 1 })
    expect(readSignals()).toEqual([])
  })

  test('error_event 的 message 自由文本被脱敏兜底', () => {
    writeSettings({ telemetryConsent: { agentEvolutionEnabled: true } })
    telemetryService.init({ timeZone: 'America/New_York' })
    telemetryService.captureSignal({
      kind: 'error_event',
      stage: 'agent_run',
      message: 'ENOENT /Users/alice/secret.pdf for bob@x.io',
    })
    const signals = readSignals()
    expect(signals.length).toBe(1)
    const message = signals[0]?.message as string
    expect(message).not.toContain('alice')
    expect(message).not.toContain('bob@x.io')
    expect(message).toContain('/Users/<USER>/')
  })
})

describe('getConsentState', () => {
  test('返回地域 + 默认值 + 生效开关', () => {
    telemetryService.init({ timeZone: 'Europe/Paris' })
    const state = telemetryService.getConsentState()
    expect(state.region).toBe('gdpr')
    expect(state.defaultEnabled).toBe(false)
    expect(state.posthogEnabled).toBe(false)
  })
})

describe('用户归属（#420 identifyUser / clearUser）', () => {
  test('identifyUser 后 track 的 distinct_id = uid；clearUser 后回落 deviceId', () => {
    telemetryService.init({ timeZone: 'America/New_York' }) // 非 GDPR，consent 默认开

    telemetryService.identifyUser('opensci-uid-123')
    telemetryService.track({
      event: TELEMETRY_EVENTS.APP_LAUNCHED,
      props: { appVersion: '0.1.0', platform: 'darwin' },
    })
    let events = readEvents()
    expect(events.at(-1)?.distinct_id).toBe('opensci-uid-123')

    telemetryService.clearUser()
    telemetryService.track({
      event: TELEMETRY_EVENTS.APP_LAUNCHED,
      props: { appVersion: '0.1.0', platform: 'darwin' },
    })
    events = readEvents()
    expect(events.at(-1)?.distinct_id).toMatch(/^[0-9a-f-]{36}$/) // 回落匿名 deviceId
  })

  test('$identify 载荷含 $anon_distinct_id + $set，且不含 PII', () => {
    process.env.ASCI_TELEMETRY_FORCE_SEND = '1' // 放行 $identify 落 JSONL（无 key 故不真发网络）
    try {
      telemetryService.init({ timeZone: 'America/New_York' })
      telemetryService.identifyUser('opensci-uid-9', {
        institution: 'MIT',
        discipline: 'biology',
        signupMethod: 'opensci',
      })
      const identify = readEvents().find((e) => e.event === '$identify')
      expect(identify).toBeDefined()
      expect(identify?.distinct_id).toBe('opensci-uid-9')
      const props = identify?.properties as Record<string, unknown>
      expect(props.$anon_distinct_id).toMatch(/^[0-9a-f-]{36}$/)
      expect(props.$set).toEqual({ institution: 'MIT', discipline: 'biology', signup_method: 'opensci' })
      // 红线：整条 payload 不含邮箱/姓名/头像键
      const raw = JSON.stringify(identify)
      expect(raw).not.toContain('email')
      expect(raw).not.toContain('nickname')
      expect(raw).not.toContain('avatar')
    } finally {
      delete process.env.ASCI_TELEMETRY_FORCE_SEND
    }
  })

  test('consent 关闭时 identifyUser 不发 $identify（仅记 userId）', () => {
    telemetryService.init({ timeZone: 'Europe/Berlin' }) // GDPR 默认关
    telemetryService.identifyUser('opensci-uid-x', { institution: 'X' })
    expect(readEvents().find((e) => e.event === '$identify')).toBeUndefined()
  })
})
