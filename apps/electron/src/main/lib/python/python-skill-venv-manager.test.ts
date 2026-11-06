import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PythonSkillVenvManager, type UvInvoker } from './python-skill-venv-manager.ts'
import { getPythonSkillVenvDir, getPythonSkillDepsLock } from './paths.ts'
import { hashDependencies } from './python-dependency-resolver.ts'

let originalHome: string | undefined
let tmpHome: string
let skillsRoot: string

beforeEach(() => {
  originalHome = process.env.ASCI_CONFIG_HOME
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-venv-mgr-'))
  process.env.ASCI_CONFIG_HOME = tmpHome
  skillsRoot = join(tmpHome, 'default-skills')
  mkdirSync(join(skillsRoot, 'demo'), { recursive: true })
  writeFileSync(join(skillsRoot, 'demo', 'requirements.txt'), 'numpy\nrequests\n')
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  try { rmSync(tmpHome, { recursive: true, force: true }) } catch {}
})

/** 假的 uv：venv 命令 = 建空目录写 pyvenv.cfg；install = 写 marker 文件 */
function makeFakeUv(): { invoker: UvInvoker; calls: Array<{ kind: string; args: unknown[] }> } {
  const calls: Array<{ kind: string; args: unknown[] }> = []
  const invoker: UvInvoker = {
    async createVenv(opts) {
      calls.push({ kind: 'createVenv', args: [opts] })
      mkdirSync(opts.venvDir, { recursive: true })
      writeFileSync(join(opts.venvDir, 'pyvenv.cfg'), 'fake')
    },
    async pipInstall(opts) {
      calls.push({ kind: 'pipInstall', args: [opts] })
      writeFileSync(join(opts.venvDir, '.installed'), opts.packages.join(','))
    },
  }
  return { invoker, calls }
}

test('ensure 首次调用：建 venv + 装依赖 + 写 lock', async () => {
  const { invoker, calls } = makeFakeUv()
  const mgr = new PythonSkillVenvManager({
    skillsRootDir: skillsRoot,
    interpreterPath: '/fake/python3.12',
    uv: invoker,
  })
  const venvDir = await mgr.ensure('demo')
  expect(venvDir).toBe(getPythonSkillVenvDir('demo'))
  expect(existsSync(join(venvDir, 'pyvenv.cfg'))).toBe(true)
  expect(existsSync(join(venvDir, '.installed'))).toBe(true)
  expect(readFileSync(getPythonSkillDepsLock('demo'), 'utf-8'))
    .toBe(hashDependencies(['numpy', 'requests']))
  expect(calls.map((c) => c.kind)).toEqual(['createVenv', 'pipInstall'])
})

test('ensure 第二次调用：lock 命中 → 不重建', async () => {
  const { invoker, calls } = makeFakeUv()
  const mgr = new PythonSkillVenvManager({ skillsRootDir: skillsRoot, interpreterPath: '/fake/python3.12', uv: invoker })
  await mgr.ensure('demo')
  calls.length = 0
  await mgr.ensure('demo')
  expect(calls.length).toBe(0)
})

test('ensure 依赖列表变化 → 触发 upgrade install（不重建 venv）', async () => {
  const { invoker, calls } = makeFakeUv()
  const mgr = new PythonSkillVenvManager({ skillsRootDir: skillsRoot, interpreterPath: '/fake/python3.12', uv: invoker })
  await mgr.ensure('demo')
  writeFileSync(join(skillsRoot, 'demo', 'requirements.txt'), 'numpy\nrequests\nscipy\n')
  calls.length = 0
  await mgr.ensure('demo')
  expect(calls.map((c) => c.kind)).toEqual(['pipInstall'])
  expect(readFileSync(getPythonSkillDepsLock('demo'), 'utf-8'))
    .toBe(hashDependencies(['numpy', 'requests', 'scipy']))
})

test('ensure 并发同 skill：复用同一 promise（uv 只调用一次）', async () => {
  const { invoker, calls } = makeFakeUv()
  const slowInvoker: UvInvoker = {
    createVenv: async (opts) => {
      await new Promise((r) => setTimeout(r, 30))
      return invoker.createVenv(opts)
    },
    pipInstall: invoker.pipInstall,
  }
  const mgr = new PythonSkillVenvManager({ skillsRootDir: skillsRoot, interpreterPath: '/fake/python3.12', uv: slowInvoker })
  const [a, b, c] = await Promise.all([mgr.ensure('demo'), mgr.ensure('demo'), mgr.ensure('demo')])
  expect(a).toBe(b)
  expect(b).toBe(c)
  const kinds = calls.map((x) => x.kind)
  expect(kinds.filter((k) => k === 'createVenv').length).toBe(1)
  expect(kinds.filter((k) => k === 'pipInstall').length).toBe(1)
})

test('ensure 在 createVenv 抛错时清理半成品并透传错误', async () => {
  const failingInvoker: UvInvoker = {
    createVenv: async (opts) => {
      mkdirSync(opts.venvDir, { recursive: true })
      writeFileSync(join(opts.venvDir, 'partial'), 'half')
      throw new Error('uv venv 失败')
    },
    pipInstall: async () => {},
  }
  const mgr = new PythonSkillVenvManager({ skillsRootDir: skillsRoot, interpreterPath: '/fake/python3.12', uv: failingInvoker })
  await expect(mgr.ensure('demo')).rejects.toThrow('uv venv 失败')
  expect(existsSync(getPythonSkillVenvDir('demo'))).toBe(false)
})

test('ensure 在依赖为空（none）时建空 venv 但不写 lock', async () => {
  rmSync(join(skillsRoot, 'demo'), { recursive: true, force: true })
  mkdirSync(join(skillsRoot, 'demo'), { recursive: true })
  writeFileSync(join(skillsRoot, 'demo', 'SKILL.md'), '# nothing')

  const { invoker, calls } = makeFakeUv()
  const mgr = new PythonSkillVenvManager({ skillsRootDir: skillsRoot, interpreterPath: '/fake/python3.12', uv: invoker })
  await mgr.ensure('demo')
  expect(calls.map((c) => c.kind)).toEqual(['createVenv'])
  expect(existsSync(getPythonSkillDepsLock('demo'))).toBe(false)
})

test('ensure createVenv 失败后再次 ensure 成功（inflight 已释放，可重试）', async () => {
  let attempt = 0
  const flaky: UvInvoker = {
    createVenv: async (opts) => {
      attempt++
      if (attempt === 1) throw new Error('暂时失败')
      mkdirSync(opts.venvDir, { recursive: true })
      writeFileSync(join(opts.venvDir, 'pyvenv.cfg'), 'fake')
    },
    pipInstall: async (opts) => {
      writeFileSync(join(opts.venvDir, '.installed'), opts.packages.join(','))
    },
  }
  const mgr = new PythonSkillVenvManager({ skillsRootDir: skillsRoot, interpreterPath: '/fake', uv: flaky })
  await expect(mgr.ensure('demo')).rejects.toThrow('暂时失败')
  // 第二次应成功（inflight Map 已清空、半成品 venv 已被清理）
  const venvDir = await mgr.ensure('demo')
  expect(attempt).toBe(2)
  expect(existsSync(join(venvDir, 'pyvenv.cfg'))).toBe(true)
  expect(existsSync(join(venvDir, '.installed'))).toBe(true)
})

test('ensure 在 lock 缺失但 venv 存在时仅重装依赖（不重建 venv）', async () => {
  const { invoker, calls } = makeFakeUv()
  const mgr = new PythonSkillVenvManager({ skillsRootDir: skillsRoot, interpreterPath: '/fake', uv: invoker })
  await mgr.ensure('demo')
  // 模拟用户/上一次失败：手删 lock 但保留 venv
  rmSync(getPythonSkillDepsLock('demo'), { force: true })
  expect(existsSync(getPythonSkillVenvDir('demo'))).toBe(true)
  calls.length = 0
  // 再次 ensure 应只调用 pipInstall（不调 createVenv）
  await mgr.ensure('demo')
  expect(calls.map((c) => c.kind)).toEqual(['pipInstall'])
  // upgrade 应为 false（旧 hash 不存在）
  const installCall = calls[0]!.args[0] as { upgrade: boolean }
  expect(installCall.upgrade).toBe(false)
  // lock 重新写入
  expect(existsSync(getPythonSkillDepsLock('demo'))).toBe(true)
})
