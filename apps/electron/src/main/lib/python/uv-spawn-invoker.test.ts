import { test, expect } from 'bun:test'
import { buildUvVenvArgs, buildUvPipInstallArgs } from './uv-spawn-invoker.ts'

test('buildUvVenvArgs 拼出 venv <venvDir> --python <interpreter>', () => {
  const args = buildUvVenvArgs({ venvDir: '/u/v', interpreter: '/u/python3.12' })
  expect(args).toEqual(['venv', '/u/v', '--python', '/u/python3.12'])
})

test('buildUvPipInstallArgs 在 upgrade=true 时加 --upgrade', () => {
  const args = buildUvPipInstallArgs({
    venvDir: '/u/v',
    packages: ['scanpy', 'numpy>=2'],
    upgrade: true,
    platform: 'darwin',
  })
  expect(args[0]).toBe('pip')
  expect(args[1]).toBe('install')
  expect(args).toContain('--upgrade')
  expect(args).toContain('scanpy')
  expect(args).toContain('numpy>=2')
  const pyIdx = args.indexOf('--python')
  expect(args[pyIdx + 1]).toBe('/u/v/bin/python')
})

test('buildUvPipInstallArgs 在 win32 用 venv\\Scripts\\python.exe', () => {
  const args = buildUvPipInstallArgs({
    venvDir: 'C:\\u\\v',
    packages: ['x'],
    upgrade: false,
    platform: 'win32',
  })
  const pyIdx = args.indexOf('--python')
  expect(args[pyIdx + 1]).toBe('C:\\u\\v\\Scripts\\python.exe')
  expect(args).not.toContain('--upgrade')
})
