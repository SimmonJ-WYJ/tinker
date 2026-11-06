/**
 * concept-spotlight-service 单元测试
 */
import { test, expect, beforeEach, afterAll, mock } from 'bun:test'
import type { ConceptSpotlightState } from '../../types/concept-spotlight'

let memSettings: Record<string, unknown> = {}
mock.module('./settings-service', () => ({
  getSettings: () => ({ ...memSettings }),
  updateSettings: (updates: Record<string, unknown>) => {
    memSettings = { ...memSettings, ...updates }
    return memSettings
  },
}))

import { conceptSpotlightService } from './concept-spotlight-service'

beforeEach(() => {
  memSettings = {}
  conceptSpotlightService.__resetForTests()
})

afterAll(() => {
  mock.restore()
})

test('getState: 老用户字段缺失返回空对象', () => {
  memSettings = { onboardingCompleted: true }
  expect(conceptSpotlightService.getState()).toEqual({})
})

test('startTour: idle → in-progress(0)', () => {
  const s = conceptSpotlightService.startTour({ tour: 'evidenceSet' })
  expect(s.evidenceSet?.status).toBe('in-progress')
  expect(s.evidenceSet?.currentSubStage).toBe(0)
  expect(s.paperNotes).toBeUndefined()
})

test('startTour: idempotent — 已 in-progress 保留 currentSubStage', () => {
  conceptSpotlightService.startTour({ tour: 'evidenceSet' })
  conceptSpotlightService.advanceTour({ tour: 'evidenceSet', fromSubStage: 0 })
  // 当前在 substage 1
  const s = conceptSpotlightService.startTour({ tour: 'evidenceSet' })
  expect(s.evidenceSet?.currentSubStage).toBe(1)
})

test('advanceTour: substage 推进', () => {
  conceptSpotlightService.startTour({ tour: 'evidenceSet' })
  const s = conceptSpotlightService.advanceTour({ tour: 'evidenceSet', fromSubStage: 0 })
  expect(s.evidenceSet?.currentSubStage).toBe(1)
})

test('advanceTour: 守卫——fromSubStage 不匹配则不推进', () => {
  conceptSpotlightService.startTour({ tour: 'evidenceSet' })
  const s = conceptSpotlightService.advanceTour({ tour: 'evidenceSet', fromSubStage: 5 })
  expect(s.evidenceSet?.currentSubStage).toBe(0)  // 不变
})

test('advanceTour: 末 substage → completed + finishedAt', () => {
  conceptSpotlightService.startTour({ tour: 'paperNotes' })
  // paperNotes 有 2 substage（0, 1），advance from 0 → substage 1，再 advance from 1 → completed
  conceptSpotlightService.advanceTour({ tour: 'paperNotes', fromSubStage: 0 })
  const s = conceptSpotlightService.advanceTour({ tour: 'paperNotes', fromSubStage: 1 })
  expect(s.paperNotes?.status).toBe('completed')
  expect(s.paperNotes?.finishedAt).toBeGreaterThan(0)
  expect(s.paperNotes?.currentSubStage).toBeUndefined()
})

test('skipTour: 任意状态 → skipped + finishedAt', () => {
  conceptSpotlightService.startTour({ tour: 'evidenceSet' })
  const s = conceptSpotlightService.skipTour({ tour: 'evidenceSet' })
  expect(s.evidenceSet?.status).toBe('skipped')
  expect(s.evidenceSet?.finishedAt).toBeGreaterThan(0)
})

test('completeTour: 直接完成', () => {
  conceptSpotlightService.startTour({ tour: 'evidenceSet' })
  conceptSpotlightService.advanceTour({ tour: 'evidenceSet', fromSubStage: 0 })
  const s = conceptSpotlightService.completeTour({ tour: 'evidenceSet' })
  expect(s.evidenceSet?.status).toBe('completed')
})

test('restartTour: skipped → in-progress(0)', () => {
  conceptSpotlightService.skipTour({ tour: 'evidenceSet' })
  const s = conceptSpotlightService.restartTour({ tour: 'evidenceSet' })
  expect(s.evidenceSet?.status).toBe('in-progress')
  expect(s.evidenceSet?.currentSubStage).toBe(0)
})

test('独立性: 两个 tour 互不干扰', () => {
  conceptSpotlightService.startTour({ tour: 'evidenceSet' })
  conceptSpotlightService.startTour({ tour: 'paperNotes' })
  conceptSpotlightService.completeTour({ tour: 'evidenceSet' })
  const s = conceptSpotlightService.getState()
  expect(s.evidenceSet?.status).toBe('completed')
  expect(s.paperNotes?.status).toBe('in-progress')
})

test('subscribe: 任何 mutation 触发 listener', () => {
  let lastState: ConceptSpotlightState | null = null
  const unsub = conceptSpotlightService.subscribe((s) => { lastState = s })
  conceptSpotlightService.startTour({ tour: 'evidenceSet' })
  expect(lastState?.evidenceSet?.status).toBe('in-progress')
  unsub()
})

test('subscribe: unsubscribe 后不收到通知', () => {
  let calls = 0
  const unsub = conceptSpotlightService.subscribe(() => { calls += 1 })
  conceptSpotlightService.startTour({ tour: 'evidenceSet' })
  expect(calls).toBe(1)
  unsub()
  conceptSpotlightService.startTour({ tour: 'paperNotes' })
  expect(calls).toBe(1)
})
