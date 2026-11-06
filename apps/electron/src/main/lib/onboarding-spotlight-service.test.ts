/**
 * onboarding-spotlight-service 单元测试（V2 多阶段）
 */
import { test, expect, beforeEach, afterAll, mock } from 'bun:test'

let memSettings: Record<string, unknown> = {}
let memFreshInstall = false
mock.module('./settings-service', () => ({
  getSettings: () => ({ ...memSettings }),
  updateSettings: (updates: Record<string, unknown>) => {
    memSettings = { ...memSettings, ...updates }
    return memSettings
  },
  isFreshInstall: () => memFreshInstall,
}))

import { onboardingSpotlightService } from './onboarding-spotlight-service'

beforeEach(() => {
  memSettings = {}
  memFreshInstall = false
  onboardingSpotlightService.__resetForTests()
})

afterAll(() => {
  mock.restore()
})

test('getState: 老用户字段缺失返回 null', () => {
  memSettings = { onboardingCompleted: true }
  expect(onboardingSpotlightService.getState()).toBeNull()
})

test('start: 从 idle → in-progress(configure-llm, 0)', () => {
  const s = onboardingSpotlightService.start()
  expect(s.status).toBe('in-progress')
  expect(s.currentStep).toBe('configure-llm')
  expect(s.currentSubStage).toBe(0)
})

test('start: idempotent — 已 in-progress 保留 currentStep / currentSubStage', () => {
  onboardingSpotlightService.start()
  onboardingSpotlightService.advance({ from: 'configure-llm', fromSubStage: 0 })
  // 此时 (configure-llm, 1)
  const s = onboardingSpotlightService.start()
  expect(s.currentStep).toBe('configure-llm')
  expect(s.currentSubStage).toBe(1)
})

test('advance: substage 内推进', () => {
  onboardingSpotlightService.start()
  const s1 = onboardingSpotlightService.advance({ from: 'configure-llm', fromSubStage: 0 })
  expect(s1.currentStep).toBe('configure-llm')
  expect(s1.currentSubStage).toBe(1)
  const s2 = onboardingSpotlightService.advance({ from: 'configure-llm', fromSubStage: 1 })
  expect(s2.currentSubStage).toBe(2)
})

test('advance: 跨 step（末 substage → 下一 step substage 0）', () => {
  onboardingSpotlightService.start()
  onboardingSpotlightService.advance({ from: 'configure-llm', fromSubStage: 0 })
  onboardingSpotlightService.advance({ from: 'configure-llm', fromSubStage: 1 })
  // (configure-llm, 2) — 末 substage
  const s = onboardingSpotlightService.advance({ from: 'configure-llm', fromSubStage: 2 })
  expect(s.currentStep).toBe('connect-zotero')
  expect(s.currentSubStage).toBe(0)
})

test('advance: 末步末 substage → status=completed', () => {
  onboardingSpotlightService.start()
  // 推进 6 次到 (new-task, 1)
  onboardingSpotlightService.advance({ from: 'configure-llm', fromSubStage: 0 })
  onboardingSpotlightService.advance({ from: 'configure-llm', fromSubStage: 1 })
  onboardingSpotlightService.advance({ from: 'configure-llm', fromSubStage: 2 })
  onboardingSpotlightService.advance({ from: 'connect-zotero', fromSubStage: 0 })
  onboardingSpotlightService.advance({ from: 'connect-zotero', fromSubStage: 1 })
  onboardingSpotlightService.advance({ from: 'new-task', fromSubStage: 0 })
  const s = onboardingSpotlightService.advance({ from: 'new-task', fromSubStage: 1 })
  expect(s.status).toBe('completed')
  expect(s.finishedAt).toBeGreaterThan(0)
})

test('advance: from 不匹配 → noop（双重守卫）', () => {
  onboardingSpotlightService.start()
  // step 不匹配
  const noop1 = onboardingSpotlightService.advance({ from: 'connect-zotero', fromSubStage: 0 })
  expect(noop1.currentStep).toBe('configure-llm')
  expect(noop1.currentSubStage).toBe(0)
  // subStage 不匹配
  const noop2 = onboardingSpotlightService.advance({ from: 'configure-llm', fromSubStage: 2 })
  expect(noop2.currentSubStage).toBe(0)
})

test('skipSubStage: 仅推进当前 substage（不终止 spotlight）', () => {
  onboardingSpotlightService.start()
  onboardingSpotlightService.advance({ from: 'configure-llm', fromSubStage: 0 })
  onboardingSpotlightService.advance({ from: 'configure-llm', fromSubStage: 1 })
  onboardingSpotlightService.advance({ from: 'configure-llm', fromSubStage: 2 })
  // (connect-zotero, 0)
  onboardingSpotlightService.advance({ from: 'connect-zotero', fromSubStage: 0 })
  // (connect-zotero, 1) — 这是没装 Zotero 时跳过的位置
  const s = onboardingSpotlightService.skipSubStage()
  expect(s.status).toBe('in-progress')
  expect(s.currentStep).toBe('new-task')
  expect(s.currentSubStage).toBe(0)
})

test('skip: 终止整个 spotlight', () => {
  onboardingSpotlightService.start()
  const broadcasts: unknown[] = []
  onboardingSpotlightService.subscribe((s) => broadcasts.push(s))
  const s = onboardingSpotlightService.skip()
  expect(s.status).toBe('skipped')
  expect(s.finishedAt).toBeGreaterThan(0)
  expect(broadcasts.length).toBe(1)
})

test('bootstrap: 真·首次安装（settings.json 不存在）→ 自动 start() 唤起引导', () => {
  memFreshInstall = true
  const s = onboardingSpotlightService.bootstrap()
  expect(s).not.toBeNull()
  expect(s!.status).toBe('in-progress')
  expect(s!.currentStep).toBe('configure-llm')
  expect(s!.currentSubStage).toBe(0)
})

test('bootstrap: 老用户升级（settings.json 存在但无 onboardingSpotlight）→ 保持 null，不强制重走', () => {
  memSettings = { onboardingCompleted: true }
  memFreshInstall = false
  const s = onboardingSpotlightService.bootstrap()
  expect(s).toBeNull()
})

test('bootstrap: 已有持久化状态（in-progress）→ 原样返回，不重置', () => {
  memSettings = {
    onboardingSpotlight: {
      status: 'in-progress',
      currentStep: 'connect-zotero',
      currentSubStage: 1,
    },
  }
  memFreshInstall = false
  const s = onboardingSpotlightService.bootstrap()
  expect(s).not.toBeNull()
  expect(s!.currentStep).toBe('connect-zotero')
  expect(s!.currentSubStage).toBe(1)
})

test('bootstrap: 已完成的用户 → 返回 completed 状态，不重启', () => {
  memSettings = {
    onboardingSpotlight: { status: 'completed', finishedAt: 1234567890 },
  }
  memFreshInstall = true  // 即便误判 fresh，也不应覆盖已完成状态
  const s = onboardingSpotlightService.bootstrap()
  expect(s).not.toBeNull()
  expect(s!.status).toBe('completed')
})

test('V1 兼容：currentStep="introduce-input" 读取时迁移为 "new-task"', () => {
  // 模拟 V1 schema 状态
  memSettings = {
    onboardingSpotlight: {
      status: 'in-progress',
      currentStep: 'introduce-input',  // V1 字段
      // V1 没有 currentSubStage 字段
    },
  }
  const s = onboardingSpotlightService.getState()
  expect(s).not.toBeNull()
  expect(s!.currentStep).toBe('new-task')  // 已迁移
  expect(s!.currentSubStage).toBe(0)        // 兜底默认值
})
