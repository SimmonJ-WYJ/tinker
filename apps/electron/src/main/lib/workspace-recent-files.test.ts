import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listRecentWorkspaceFilesInDir } from './workspace-recent-files.ts'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'asci-recent-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

/** 构建一个文件并设置 mtime（秒级时间戳） */
function makeFile(relPath: string, mtimeSec: number, content = 'x'): void {
  const full = join(tmpDir, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
  utimesSync(full, mtimeSec, mtimeSec)
}

test('按 mtime 倒序取前 N 个', async () => {
  makeFile('a.txt', 1000)
  makeFile('b.txt', 3000)
  makeFile('c.txt', 2000)
  makeFile('d.txt', 500)
  const result = await listRecentWorkspaceFilesInDir(tmpDir, 2)
  expect(result.files.map((f) => f.name)).toEqual(['b.txt', 'c.txt'])
  expect(result.totalCount).toBe(4)
  expect(result.capped).toBe(false)
})

test('MAX_SCAN_FILES 兜底 → capped=true 并提前返回', async () => {
  for (let i = 0; i < 2001; i++) {
    makeFile(`f${i}.txt`, 1000 + i)
  }
  const result = await listRecentWorkspaceFilesInDir(tmpDir, 3)
  expect(result.capped).toBe(true)
  expect(result.totalCount).toBe(2000)
  expect(result.files.length).toBe(3)
}, 10_000)

test('跳过 .DS_Store / .git/ / 隐藏目录', async () => {
  makeFile('normal.txt', 1000)
  makeFile('.DS_Store', 2000)
  makeFile('.git/HEAD', 2000)
  makeFile('.hidden-dir/inside.txt', 2000)
  makeFile('sub/keep.txt', 3000)
  const result = await listRecentWorkspaceFilesInDir(tmpDir, 10)
  const names = result.files.map((f) => f.relPath).sort()
  expect(names).toEqual(['normal.txt', 'sub/keep.txt'])
  expect(result.totalCount).toBe(2)
})

test('目录不存在 → 空结果（不抛错）', async () => {
  const result = await listRecentWorkspaceFilesInDir(join(tmpDir, 'nonexistent'), 3)
  expect(result.files).toEqual([])
  expect(result.totalCount).toBe(0)
  expect(result.capped).toBe(false)
})

test('符号链接不追（lstat 行为）', async () => {
  makeFile('real.txt', 1000)
  symlinkSync('/nonexistent-path', join(tmpDir, 'broken-link'))
  const result = await listRecentWorkspaceFilesInDir(tmpDir, 10)
  expect(result.files.map((f) => f.name)).toEqual(['real.txt'])
  expect(result.totalCount).toBe(1)
})
