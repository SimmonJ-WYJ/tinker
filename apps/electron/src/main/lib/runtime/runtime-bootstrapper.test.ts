import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuntimeBootstrapper } from './runtime-bootstrapper.ts'

let tmpHome = ''
let tmpResources = ''
let originalHome: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-rb-home-'))
  tmpResources = mkdtempSync(join(tmpdir(), 'asci-rb-res-'))
  originalHome = process.env.ASCI_RUNTIMES_HOME
  process.env.ASCI_RUNTIMES_HOME = tmpHome
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_RUNTIMES_HOME
  else process.env.ASCI_RUNTIMES_HOME = originalHome
  rmSync(tmpHome, { recursive: true, force: true })
  rmSync(tmpResources, { recursive: true, force: true })
})

/** 在 tmpResources/runtimes 下造 4 binary 占位，模拟 .app/Contents/Resources/runtimes */
function stageResourceRuntimes(): void {
  const root = join(tmpResources, 'runtimes')
  mkdirSync(join(root, 'node', 'bin'), { recursive: true })
  mkdirSync(join(root, 'git', 'bin'), { recursive: true })
  mkdirSync(join(root, 'python', 'runtime', 'bin'), { recursive: true })
  const fakeBin = '#!/bin/sh\necho v0\n'
  for (const p of [
    join(root, 'node', 'bin', 'node'),
    join(root, 'git', 'bin', 'git'),
    join(root, 'uv'),
    join(root, 'python', 'runtime', 'bin', 'python3.12'),
  ]) {
    writeFileSync(p, fakeBin)
    chmodSync(p, 0o755)
  }
}

test('bootstrap: payload 嵌入 + 用户目录空 → 拷贝完整 + 写 .version + ready', async () => {
  stageResourceRuntimes()
  const rb = new RuntimeBootstrapper({ resourcesPath: tmpResources, asciVersion: '1.0.0' })
  const status = await rb.bootstrap()
  expect(status.phase).toBe('ready')

  // 用户目录就位
  expect(existsSync(join(tmpHome, 'runtimes', 'node', 'bin', 'node'))).toBe(true)
  expect(existsSync(join(tmpHome, 'runtimes', 'uv'))).toBe(true)
  expect(existsSync(join(tmpHome, 'runtimes', 'python', 'runtime', 'bin', 'python3.12'))).toBe(true)

  // .version 写对
  const stamp = readFileSync(join(tmpHome, 'runtimes', '.version'), 'utf-8').trim()
  expect(stamp).toBe('1.0.0')
})

test('bootstrap: 已就位 + 版本匹配 → no-op（不重复拷贝）', async () => {
  stageResourceRuntimes()
  const rb1 = new RuntimeBootstrapper({ resourcesPath: tmpResources, asciVersion: '1.0.0' })
  await rb1.bootstrap()

  // 第二次实例：源 runtimes 改了内容，不该被拷贝
  writeFileSync(join(tmpResources, 'runtimes', 'uv'), 'CHANGED')
  const rb2 = new RuntimeBootstrapper({ resourcesPath: tmpResources, asciVersion: '1.0.0' })
  const status = await rb2.bootstrap()
  expect(status.phase).toBe('ready')

  // 用户目录的 uv 内容仍是首次拷贝时的（不是 'CHANGED'）
  const userUv = readFileSync(join(tmpHome, 'runtimes', 'uv'), 'utf-8')
  expect(userUv).not.toContain('CHANGED')
})

test('bootstrap: 版本升级（stamp 不匹配）→ 重拷', async () => {
  stageResourceRuntimes()
  const rb1 = new RuntimeBootstrapper({ resourcesPath: tmpResources, asciVersion: '1.0.0' })
  await rb1.bootstrap()

  // 升级 ASCI 版本 + 改 source runtime 内容
  writeFileSync(join(tmpResources, 'runtimes', 'uv'), 'UPGRADED')
  const rb2 = new RuntimeBootstrapper({ resourcesPath: tmpResources, asciVersion: '1.1.0' })
  const status = await rb2.bootstrap()
  expect(status.phase).toBe('ready')

  // 用户目录被覆盖
  expect(readFileSync(join(tmpHome, 'runtimes', 'uv'), 'utf-8')).toBe('UPGRADED')
  expect(readFileSync(join(tmpHome, 'runtimes', '.version'), 'utf-8').trim()).toBe('1.1.0')
})

test('bootstrap: 源 runtimes 不存在 → error RESOURCES_MISSING', async () => {
  // 不调 stageResourceRuntimes
  const rb = new RuntimeBootstrapper({ resourcesPath: tmpResources, asciVersion: '1.0.0' })
  const status = await rb.bootstrap()
  expect(status.phase).toBe('error')
  expect(status.code).toBe('RESOURCES_MISSING')
})

test('bootstrap: 重入安全（多次调用返回一致状态）', async () => {
  stageResourceRuntimes()
  const rb = new RuntimeBootstrapper({ resourcesPath: tmpResources, asciVersion: '1.0.0' })
  const [s1, s2] = await Promise.all([rb.bootstrap(), rb.bootstrap()])
  expect(s1.phase).toBe('ready')
  expect(s2.phase).toBe('ready')
})

test('upgrade to optional Python preserves an existing interpreter and uv for old virtualenv links', async () => {
 stageResourceRuntimes()
 await new RuntimeBootstrapper({resourcesPath:tmpResources,asciVersion:'1'}).bootstrap()
 const oldPython=join(tmpHome,'runtimes/python/runtime/bin/python3.12')
 writeFileSync(oldPython,'existing interpreter');writeFileSync(join(tmpHome,'runtimes/uv'),'existing uv')
 writeFileSync(join(tmpResources,'runtimes/.optional-python'),'1')
 writeFileSync(join(tmpResources,'runtimes/python/runtime/bin/python3.12'),'new launcher')
 const status=await new RuntimeBootstrapper({resourcesPath:tmpResources,asciVersion:'2'}).bootstrap()
 expect(status.phase).toBe('ready')
 expect(readFileSync(oldPython,'utf8')).toBe('existing interpreter')
 expect(readFileSync(join(tmpHome,'runtimes/uv'),'utf8')).toBe('existing uv')
 expect(readFileSync(join(tmpHome,'runtimes/.version'),'utf8')).toBe('2')
})

test('same app version still migrates a full cached runtime to the optional-runtime contract', async () => {
 stageResourceRuntimes()
 await new RuntimeBootstrapper({resourcesPath:tmpResources,asciVersion:'1'}).bootstrap()
 const old=join(tmpHome,'runtimes/python/runtime/bin/python3.12');writeFileSync(old,'keep old interpreter')
 writeFileSync(join(tmpResources,'runtimes/.optional-python'),'1')
 await new RuntimeBootstrapper({resourcesPath:tmpResources,asciVersion:'1'}).bootstrap()
 expect(existsSync(join(tmpHome,'runtimes/.optional-python'))).toBe(true)
 expect(readFileSync(old,'utf8')).toBe('keep old interpreter')
})
