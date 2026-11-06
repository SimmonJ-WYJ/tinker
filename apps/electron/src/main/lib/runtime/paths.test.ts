import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getRuntimesRoot,
  getRuntimeStampPath,
  getNodeBinPath,
  getGitBinPath,
  getUvBinPath,
  getPythonInterpreterPath,
} from './paths.ts'

let tmpHome = ''
let originalHome: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-runtime-paths-'))
  originalHome = process.env.ASCI_RUNTIMES_HOME
  process.env.ASCI_RUNTIMES_HOME = tmpHome
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_RUNTIMES_HOME
  else process.env.ASCI_RUNTIMES_HOME = originalHome
  rmSync(tmpHome, { recursive: true, force: true })
})

test('getRuntimesRoot 走 ASCI_RUNTIMES_HOME 环境变量（测试隔离）', () => {
  expect(getRuntimesRoot()).toBe(join(tmpHome, 'runtimes'))
})

test('getRuntimeStampPath = runtimes/.version', () => {
  expect(getRuntimeStampPath()).toBe(join(tmpHome, 'runtimes', '.version'))
})

test('getNodeBinPath: macOS / Linux 是 runtimes/node/bin/node', () => {
  expect(getNodeBinPath('darwin')).toBe(join(tmpHome, 'runtimes', 'node', 'bin', 'node'))
  expect(getNodeBinPath('linux')).toBe(join(tmpHome, 'runtimes', 'node', 'bin', 'node'))
})

test('getNodeBinPath: Windows 是 runtimes\\node\\node.exe', () => {
  expect(getNodeBinPath('win32')).toBe(join(tmpHome, 'runtimes', 'node', 'node.exe'))
})

test('getGitBinPath: 三平台均在 git/bin/git(.exe)', () => {
  expect(getGitBinPath('darwin')).toBe(join(tmpHome, 'runtimes', 'git', 'bin', 'git'))
  expect(getGitBinPath('win32')).toBe(join(tmpHome, 'runtimes', 'git', 'bin', 'git.exe'))
})

test('getUvBinPath: 顶层 uv / uv.exe', () => {
  expect(getUvBinPath('darwin')).toBe(join(tmpHome, 'runtimes', 'uv'))
  expect(getUvBinPath('win32')).toBe(join(tmpHome, 'runtimes', 'uv.exe'))
})

test('getPythonInterpreterPath: 与 spec § 3.1 目录布局一致', () => {
  expect(getPythonInterpreterPath('darwin')).toBe(
    join(tmpHome, 'runtimes', 'python', 'runtime', 'bin', 'python3.12'),
  )
  expect(getPythonInterpreterPath('win32')).toBe(
    join(tmpHome, 'runtimes', 'python', 'runtime', 'python.exe'),
  )
})
