import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpHome = ''
let originalHome: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-rp-'))
  originalHome = process.env.ASCI_RUNTIMES_HOME
  process.env.ASCI_RUNTIMES_HOME = tmpHome
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_RUNTIMES_HOME
  else process.env.ASCI_RUNTIMES_HOME = originalHome
  rmSync(tmpHome, { recursive: true, force: true })
})

/** 在 tmpHome/runtimes 下造完整 4 binary + .version */
function stageRuntimes(version: string): void {
  const root = join(tmpHome, 'runtimes')
  mkdirSync(join(root, 'node', 'bin'), { recursive: true })
  mkdirSync(join(root, 'git', 'bin'), { recursive: true })
  mkdirSync(join(root, 'python', 'runtime', 'bin'), { recursive: true })
  // 用 shell 脚本伪装 binary，确保 spawn --version 不会爆
  const fakeBin = '#!/bin/sh\necho "v0.0.1"\n'
  const paths = [
    join(root, 'node', 'bin', 'node'),
    join(root, 'git', 'bin', 'git'),
    join(root, 'uv'),
    join(root, 'python', 'runtime', 'bin', 'python3.12'),
  ]
  for (const p of paths) {
    writeFileSync(p, fakeBin)
    chmodSync(p, 0o755)
  }
  writeFileSync(join(root, '.version'), version)
}

test('verify: 完整 + 版本匹配 → ready', async () => {
  stageRuntimes('1.0.0')
  const { RuntimeProvisioner } = await import(`./runtime-provisioner.ts?t=${Date.now()}`)
  const rp = new RuntimeProvisioner({ asciVersion: '1.0.0' })
  const status = await rp.verify()
  expect(status.phase).toBe('ready')
  // verify 顺序探测四个 binary，每个最多 5s；此用例只验证 ready，不规定总启动性能。
}, 4 * 5000 + 5000)

test('verify: .version 缺失 → error STAMP_MISSING', async () => {
  // 不调用 stageRuntimes，runtimes/ 整个不存在
  const { RuntimeProvisioner } = await import(`./runtime-provisioner.ts?t=${Date.now()}`)
  const rp = new RuntimeProvisioner({ asciVersion: '1.0.0' })
  const status = await rp.verify()
  expect(status.phase).toBe('error')
  expect(status.code).toBe('STAMP_MISSING')
})

test('verify: 版本不匹配 → error STAMP_MISMATCH', async () => {
  stageRuntimes('0.9.0')
  const { RuntimeProvisioner } = await import(`./runtime-provisioner.ts?t=${Date.now()}`)
  const rp = new RuntimeProvisioner({ asciVersion: '1.0.0' })
  const status = await rp.verify()
  expect(status.phase).toBe('error')
  expect(status.code).toBe('STAMP_MISMATCH')
})

test('verify: 缺一个 binary → error BINARY_MISSING + missing 列出', async () => {
  stageRuntimes('1.0.0')
  // 删 uv
  rmSync(join(tmpHome, 'runtimes', 'uv'))
  const { RuntimeProvisioner } = await import(`./runtime-provisioner.ts?t=${Date.now()}`)
  const rp = new RuntimeProvisioner({ asciVersion: '1.0.0' })
  const status = await rp.verify()
  expect(status.phase).toBe('error')
  expect(status.code).toBe('BINARY_MISSING')
  expect(status.missing).toContain('uv')
})

test('verify: binary 没执行权限 → error BINARY_NOT_EXECUTABLE', async () => {
  if (process.platform === 'win32') return  // Windows 没 chmod 概念
  stageRuntimes('1.0.0')
  chmodSync(join(tmpHome, 'runtimes', 'uv'), 0o644)
  const { RuntimeProvisioner } = await import(`./runtime-provisioner.ts?t=${Date.now()}`)
  const rp = new RuntimeProvisioner({ asciVersion: '1.0.0' })
  const status = await rp.verify()
  expect(status.phase).toBe('error')
  expect(['BINARY_NOT_EXECUTABLE', 'BINARY_SPAWN_FAILED']).toContain(status.code)
})

test('getNodeBin / getGitBin / getUvBin / getPythonInterpreter 返回绝对路径', async () => {
  stageRuntimes('1.0.0')
  const { RuntimeProvisioner } = await import(`./runtime-provisioner.ts?t=${Date.now()}`)
  const rp = new RuntimeProvisioner({ asciVersion: '1.0.0' })
  expect(rp.getNodeBin()).toBe(join(tmpHome, 'runtimes', 'node', 'bin', 'node'))
  expect(rp.getGitBin()).toBe(join(tmpHome, 'runtimes', 'git', 'bin', 'git'))
  expect(rp.getUvBin()).toBe(join(tmpHome, 'runtimes', 'uv'))
  expect(rp.getPythonInterpreter()).toBe(
    join(tmpHome, 'runtimes', 'python', 'runtime', 'bin', 'python3.12'),
  )
})

test('slim marker skips optional Python/uv without executing their launchers', async () => {
 stageRuntimes('1.0.0')
 const root=join(tmpHome,'runtimes')
 rmSync(join(root,'uv'));rmSync(join(root,'python'),{recursive:true})
 writeFileSync(join(root,'.optional-python'),'1')
 const {RuntimeProvisioner}=await import(`./runtime-provisioner.ts?slim=${Date.now()}`)
 expect((await new RuntimeProvisioner({asciVersion:'1.0.0'}).verify()).phase).toBe('ready')
 rmSync(join(root,'node/bin/node'))
 const result=await new RuntimeProvisioner({asciVersion:'1.0.0'}).verify()
 expect(result.code).toBe('BINARY_MISSING');expect(result.missing).toContain('node')
})
