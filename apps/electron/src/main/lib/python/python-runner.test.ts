import { test, expect } from 'bun:test'
import { runInVenv, buildVenvEnv } from './python-runner.ts'

test('buildVenvEnv 在 mac/linux 把 venv/bin 前置到 PATH', () => {
  const env = buildVenvEnv('/tmp/myvenv', 'darwin', { PATH: '/usr/bin:/bin', FOO: 'bar' })
  expect(env.VIRTUAL_ENV).toBe('/tmp/myvenv')
  expect(env.PATH?.startsWith('/tmp/myvenv/bin:')).toBe(true)
  expect(env.FOO).toBe('bar')
})

test('buildVenvEnv 在 win32 把 venv/Scripts 前置到 PATH', () => {
  const env = buildVenvEnv('C:\\v', 'win32', { PATH: 'C:\\Windows' })
  expect(env.VIRTUAL_ENV).toBe('C:\\v')
  expect(env.PATH?.startsWith('C:\\v\\Scripts;')).toBe(true)
})

test('buildVenvEnv 在 PATH 缺失时也能工作', () => {
  const env = buildVenvEnv('/v', 'linux', {})
  expect(env.PATH).toBe('/v/bin')
})

test('runInVenv 跑 echo 拿到 stdout 与 exit=0', async () => {
  const cmd = process.platform === 'win32' ? 'cmd' : 'sh'
  const args = process.platform === 'win32' ? ['/c', 'echo hello'] : ['-c', 'echo hello']
  const chunks: string[] = []
  const result = await runInVenv({
    venvDir: '/tmp/fake-venv',
    command: cmd,
    args,
    onStdout: (c) => chunks.push(c),
  })
  expect(result.exitCode).toBe(0)
  expect(chunks.join('')).toContain('hello')
})

test('runInVenv 非零 exit 也正常返回', async () => {
  const cmd = process.platform === 'win32' ? 'cmd' : 'sh'
  const args = process.platform === 'win32' ? ['/c', 'exit 7'] : ['-c', 'exit 7']
  const result = await runInVenv({ venvDir: '/tmp/fake', command: cmd, args })
  expect(result.exitCode).toBe(7)
})
