import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAsciPythonToolHandler, appendCapped } from './asci-python-tool.ts'
import { PythonSkillVenvManager, type UvInvoker } from '../lib/python/python-skill-venv-manager.ts'

let originalHome: string | undefined
let tmpHome: string

function makeFakeUv(): UvInvoker {
  return {
    async createVenv(opts) {
      mkdirSync(opts.venvDir, { recursive: true })
      writeFileSync(join(opts.venvDir, 'pyvenv.cfg'), 'fake')
    },
    async pipInstall(opts) {
      writeFileSync(join(opts.venvDir, '.installed'), opts.packages.join(','))
    },
  }
}

beforeEach(() => {
  originalHome = process.env.ASCI_CONFIG_HOME
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-mcp-py-'))
  process.env.ASCI_CONFIG_HOME = tmpHome
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  try { rmSync(tmpHome, { recursive: true, force: true }) } catch {}
})

test('asci_python_run 处理函数：调 ensure(skill) 并 spawn 命令', async () => {
  const skillsRoot = join(tmpHome, 'default-skills')
  mkdirSync(join(skillsRoot, 'demo'), { recursive: true })
  writeFileSync(join(skillsRoot, 'demo', 'requirements.txt'), 'numpy\n')

  const venvMgr = new PythonSkillVenvManager({
    skillsRootDir: skillsRoot,
    interpreterPath: '/fake/python',
    uv: makeFakeUv(),
  })

  // stub runner：不真启动子进程
  const stubRunner = async (input: { venvDir: string; command: string; args: string[] }) => ({
    stdout: `ran ${input.command} in ${input.venvDir}`,
    stderr: '',
    exitCode: 0,
  })

  const handler = createAsciPythonToolHandler({ venvManager: venvMgr, runner: stubRunner })
  const result = await handler({ skill: 'demo', command: ['python', '-c', 'print(1)'] }, {})

  expect(result.content[0]).toMatchObject({ type: 'text' })
  const text = (result.content[0] as { text: string }).text
  expect(text).toContain('exitCode: 0')
  expect(text).toContain('ran python in')
})

test('asci_python_run 拒绝空 command 列表', async () => {
  const venvMgr = new PythonSkillVenvManager({
    skillsRootDir: '/nope',
    interpreterPath: '/fake',
    uv: makeFakeUv(),
  })
  const handler = createAsciPythonToolHandler({
    venvManager: venvMgr,
    runner: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  })
  const result = await handler({ skill: 'x', command: [] }, {})
  expect(result.isError).toBe(true)
  expect((result.content[0] as { text: string }).text).toContain('command 不能为空')
})

test('asci_python_run 在 ensure 抛错时返回 isError=true', async () => {
  const failingMgr = {
    ensure: async () => { throw new Error('venv 建立失败') },
  } as unknown as PythonSkillVenvManager

  const handler = createAsciPythonToolHandler({
    venvManager: failingMgr,
    runner: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  })
  const result = await handler({ skill: 'x', command: ['python'] }, {})
  expect(result.isError).toBe(true)
  expect((result.content[0] as { text: string }).text).toContain('venv 建立失败')
})

test('asci_python_run 非零 exitCode 也返回 isError=true', async () => {
  const skillsRoot = join(tmpHome, 'default-skills')
  mkdirSync(join(skillsRoot, 'demo'), { recursive: true })
  writeFileSync(join(skillsRoot, 'demo', 'requirements.txt'), 'numpy\n')

  const venvMgr = new PythonSkillVenvManager({
    skillsRootDir: skillsRoot,
    interpreterPath: '/fake/python',
    uv: makeFakeUv(),
  })

  const handler = createAsciPythonToolHandler({
    venvManager: venvMgr,
    runner: async () => ({ stdout: '', stderr: 'oops', exitCode: 1 }),
  })
  const result = await handler({ skill: 'demo', command: ['python'] }, {})
  expect(result.isError).toBe(true)
  expect((result.content[0] as { text: string }).text).toContain('exitCode: 1')
})

test('appendCapped 在缓冲未满时按原样追加', () => {
  expect(appendCapped('abc', 'def')).toBe('abcdef')
})

test('appendCapped 在跨过 1 MiB 边界时截断并附提示', () => {
  const oneMiB = 1 << 20
  const justBelow = 'a'.repeat(oneMiB - 10)
  const result = appendCapped(justBelow, 'b'.repeat(100))
  expect(result.length).toBe(oneMiB + '\n[... 输出已截断（超过 1 MiB）]\n'.length)
  expect(result.endsWith('[... 输出已截断（超过 1 MiB）]\n')).toBe(true)
})

test('appendCapped 在缓冲已满时停止累积', () => {
  const full = 'a'.repeat(1 << 20)
  expect(appendCapped(full, 'b').length).toBe(full.length)
})
