import { test, expect } from 'bun:test'
import { buildReferencedDirectoriesBlock } from './referenced-directory-block.ts'

test('空数组返回空串', () => {
  expect(buildReferencedDirectoriesBlock([])).toBe('')
})

test('单个目录列出文件清单', () => {
  const out = buildReferencedDirectoriesBlock([
    { path: 'searches', files: ['searches/a.html', 'searches/b.md'], total: 2 },
  ])
  expect(out).toContain('<referenced_directory path="searches">')
  expect(out).toContain('- searches/a.html')
  expect(out).toContain('- searches/b.md')
  expect(out).toContain('</referenced_directory>')
})

test('空目录给出 empty 标注', () => {
  const out = buildReferencedDirectoriesBlock([{ path: 'empty', files: [], total: 0 }])
  expect(out).toContain('<referenced_directory path="empty">')
  expect(out.toLowerCase()).toContain('empty')
})

test('文件数超 total 时标注省略数', () => {
  const files = Array.from({ length: 50 }, (_, i) => `d/f${i}.txt`)
  const out = buildReferencedDirectoriesBlock([{ path: 'd', files, total: 73 }])
  expect(out).toContain('d/f0.txt')
  expect(out).toContain('d/f49.txt')
  // 73 - 50 = 23 条未列出
  expect(out).toMatch(/23 more/)
})

test('多个目录各自成块', () => {
  const out = buildReferencedDirectoriesBlock([
    { path: 'a', files: ['a/x'], total: 1 },
    { path: 'b', files: ['b/y'], total: 1 },
  ])
  expect(out.match(/<referenced_directory /g)?.length).toBe(2)
  expect(out).toContain('path="a"')
  expect(out).toContain('path="b"')
})
