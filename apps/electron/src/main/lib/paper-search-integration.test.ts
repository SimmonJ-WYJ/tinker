import { test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Mock python/paths.ts — 让 findUvBin 看到的 bundled uv 路径可控
let fakeUvBinPath = '/nope/uv'
mock.module('./python/paths.ts', () => ({
  getPythonUvBin: () => fakeUvBinPath,
}))

// 在所有 mock 注册之后再 import 被测模块
const { findUvBin } = await import('./paper-search-integration.ts')

let tmpDir = ''

beforeEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  tmpDir = mkdtempSync(join(tmpdir(), 'asci-paper-search-'))
  fakeUvBinPath = join(tmpDir, 'uv-not-present')
})

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  }
})

/** 在 tmpDir 下造一个假 uv 二进制（仅需文件存在） */
function makeFakeUv(name = 'uv'): string {
  const path = join(tmpDir, name)
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  return path
}

test('findUvBin: 内置 uv 存在 → 返回绝对路径', () => {
  fakeUvBinPath = makeFakeUv('bundled-uv')
  expect(findUvBin()).toBe(fakeUvBinPath)
})
