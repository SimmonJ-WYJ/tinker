import { expect, test } from 'bun:test'
import { cn } from './utils.ts'

test('cn: text-badge 是字号类，应与 text-success 颜色类共存', () => {
  const className = cn('text-badge text-success')

  expect(className).toContain('text-badge')
  expect(className).toContain('text-success')
})

test('cn: 普通字号冲突仍由后者覆盖', () => {
  const className = cn('text-xs text-sm')

  expect(className).not.toContain('text-xs')
  expect(className).toContain('text-sm')
})
