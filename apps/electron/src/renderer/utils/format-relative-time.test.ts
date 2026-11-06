import { test, expect } from 'bun:test'
import { formatRelativeTime, getRelativeTimeParts } from './format-relative-time'

const now = new Date('2026-04-18T12:00:00Z').getTime()

test('小于 1 分钟显示"刚刚"', () => {
  expect(formatRelativeTime(now - 0, now)).toBe('刚刚')
  expect(formatRelativeTime(now - 59_000, now)).toBe('刚刚')
})

test('分钟级显示 "N 分"', () => {
  expect(formatRelativeTime(now - 60_000, now)).toBe('1 分')
  expect(formatRelativeTime(now - 59 * 60_000, now)).toBe('59 分')
})

test('小时级显示 "N 时"', () => {
  expect(formatRelativeTime(now - 60 * 60_000, now)).toBe('1 时')
  expect(formatRelativeTime(now - 23 * 60 * 60_000, now)).toBe('23 时')
})

test('天级显示 "N 天"', () => {
  expect(formatRelativeTime(now - 24 * 60 * 60_000, now)).toBe('1 天')
  expect(formatRelativeTime(now - 6 * 24 * 60 * 60_000, now)).toBe('6 天')
})

test('周级显示 "N 周"', () => {
  expect(formatRelativeTime(now - 7 * 24 * 60 * 60_000, now)).toBe('1 周')
  expect(formatRelativeTime(now - 29 * 24 * 60 * 60_000, now)).toBe('4 周')
})

test('月级显示 "N 月"', () => {
  expect(formatRelativeTime(now - 30 * 24 * 60 * 60_000, now)).toBe('1 月')
  expect(formatRelativeTime(now - 364 * 24 * 60 * 60_000, now)).toBe('12 月')
})

test('年级显示 "N 年"', () => {
  expect(formatRelativeTime(now - 365 * 24 * 60 * 60_000, now)).toBe('1 年')
  expect(formatRelativeTime(now - 3 * 365 * 24 * 60 * 60_000, now)).toBe('3 年')
})

test('未来时间按 0 处理（防御）', () => {
  expect(formatRelativeTime(now + 60_000, now)).toBe('刚刚')
})

test('getRelativeTimeParts 拆分到 {unit, value}', () => {
  expect(getRelativeTimeParts(now - 0, now)).toEqual({ unit: 'now', value: 0 })
  expect(getRelativeTimeParts(now - 60_000, now)).toEqual({ unit: 'minute', value: 1 })
  expect(getRelativeTimeParts(now - 60 * 60_000, now)).toEqual({ unit: 'hour', value: 1 })
  expect(getRelativeTimeParts(now - 24 * 60 * 60_000, now)).toEqual({ unit: 'day', value: 1 })
  expect(getRelativeTimeParts(now - 7 * 24 * 60 * 60_000, now)).toEqual({ unit: 'week', value: 1 })
  expect(getRelativeTimeParts(now - 30 * 24 * 60 * 60_000, now)).toEqual({ unit: 'month', value: 1 })
  expect(getRelativeTimeParts(now - 365 * 24 * 60 * 60_000, now)).toEqual({ unit: 'year', value: 1 })
})
