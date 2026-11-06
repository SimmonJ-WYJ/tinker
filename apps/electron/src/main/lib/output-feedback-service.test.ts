/**
 * 输出反馈服务单测（issue #477）
 *
 * 覆盖 spec §10：写入后能读到、折叠取最后一条、'none' 删除、多消息独立、
 * session 不存在返回空、按 session 隔离。
 * 用 ASCI_CONFIG_HOME 把 ~/.asci 重定向到临时目录，避免污染用户真实数据。
 */
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendOutputFeedback,
  discardFeedbackForRemovedMessages,
  getSessionFeedbackMap,
} from './output-feedback-service.ts'

let tmpHome: string
let originalHome: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-feedback-'))
  originalHome = process.env.ASCI_CONFIG_HOME
  process.env.ASCI_CONFIG_HOME = tmpHome
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  rmSync(tmpHome, { recursive: true, force: true })
})

test('写入后 getSessionFeedbackMap 能读到', () => {
  const r = appendOutputFeedback({ sessionId: 's1', messageUuid: 'm1', value: 'up' })
  expect(r.value).toBe('up')
  expect(getSessionFeedbackMap('s1')).toEqual({ m1: 'up' })
})

test('折叠取最后一条：切换 up → down', () => {
  appendOutputFeedback({ sessionId: 's1', messageUuid: 'm1', value: 'up' })
  appendOutputFeedback({ sessionId: 's1', messageUuid: 'm1', value: 'down' })
  expect(getSessionFeedbackMap('s1')).toEqual({ m1: 'down' })
})

test("'none' 取消表态 → 从 map 删除，返回 null", () => {
  appendOutputFeedback({ sessionId: 's1', messageUuid: 'm1', value: 'up' })
  const r = appendOutputFeedback({ sessionId: 's1', messageUuid: 'm1', value: 'none' })
  expect(r.value).toBeNull()
  expect(getSessionFeedbackMap('s1')).toEqual({})
})

test('多条消息独立记录', () => {
  appendOutputFeedback({ sessionId: 's1', messageUuid: 'm1', value: 'up' })
  appendOutputFeedback({ sessionId: 's1', messageUuid: 'm2', value: 'down' })
  expect(getSessionFeedbackMap('s1')).toEqual({ m1: 'up', m2: 'down' })
})

test('session 不存在 → 返回空 map', () => {
  expect(getSessionFeedbackMap('does-not-exist')).toEqual({})
})

test('按 session 隔离', () => {
  appendOutputFeedback({ sessionId: 's1', messageUuid: 'm1', value: 'up' })
  appendOutputFeedback({ sessionId: 's2', messageUuid: 'm1', value: 'down' })
  expect(getSessionFeedbackMap('s1')).toEqual({ m1: 'up' })
  expect(getSessionFeedbackMap('s2')).toEqual({ m1: 'down' })
})

test('回退废弃：保留 kept 内的反馈，其余抹掉', () => {
  appendOutputFeedback({ sessionId: 's1', messageUuid: 'm1', value: 'up' })
  appendOutputFeedback({ sessionId: 's1', messageUuid: 'm2', value: 'down' })
  appendOutputFeedback({ sessionId: 's1', messageUuid: 'm3', value: 'up' })
  // 回退到 m1（inclusive）→ kept 只含 m1，m2/m3 被截断
  const discarded = discardFeedbackForRemovedMessages('s1', new Set(['m1']))
  expect(discarded).toBe(2)
  expect(getSessionFeedbackMap('s1')).toEqual({ m1: 'up' })
})

test('回退废弃：kept 含全部时不动任何反馈', () => {
  appendOutputFeedback({ sessionId: 's1', messageUuid: 'm1', value: 'up' })
  appendOutputFeedback({ sessionId: 's1', messageUuid: 'm2', value: 'down' })
  const discarded = discardFeedbackForRemovedMessages('s1', new Set(['m1', 'm2', 'm3']))
  expect(discarded).toBe(0)
  expect(getSessionFeedbackMap('s1')).toEqual({ m1: 'up', m2: 'down' })
})

test('回退废弃：无反馈时返回 0', () => {
  expect(discardFeedbackForRemovedMessages('s1', new Set(['m1']))).toBe(0)
})
