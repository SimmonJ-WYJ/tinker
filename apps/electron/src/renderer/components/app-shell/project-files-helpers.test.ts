import { test, expect } from 'bun:test'
import {
  formatProjectFilesCount,
  createVersionGuard,
} from './project-files-helpers.ts'

test('formatProjectFilesCount：null → "(—)"', () => {
  expect(formatProjectFilesCount(null, false)).toBe('(—)')
})

test('formatProjectFilesCount：0 → "(0)"', () => {
  expect(formatProjectFilesCount(0, false)).toBe('(0)')
})

test('formatProjectFilesCount：12 → "(12)"', () => {
  expect(formatProjectFilesCount(12, false)).toBe('(12)')
})

test('formatProjectFilesCount：capped → "(2000+)"', () => {
  expect(formatProjectFilesCount(2000, true)).toBe('(2000+)')
})

test('createVersionGuard：相同 id 返回 true', () => {
  const guard = createVersionGuard()
  const ticket = guard.issue('ws-1')
  expect(guard.check(ticket, 'ws-1')).toBe(true)
})

test('createVersionGuard：不同 workspace 返回 false', () => {
  const guard = createVersionGuard()
  const ticket = guard.issue('ws-1')
  expect(guard.check(ticket, 'ws-2')).toBe(false)
})

test('createVersionGuard：同 workspace 后续 issue 使旧 ticket 失效', () => {
  const guard = createVersionGuard()
  const t1 = guard.issue('ws-1')
  guard.issue('ws-1')
  expect(guard.check(t1, 'ws-1')).toBe(false)
})
