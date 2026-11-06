import { test, expect } from 'bun:test'
import {
  buildPythonAssetUrl,
  buildUvAssetUrl,
  computeSha256,
  resolveTargetForPlatform,
  RUNTIME_SPEC,
} from './download-python-runtime.ts'

test('resolveTargetForPlatform 完整覆盖 4 个支持目标', () => {
  expect(resolveTargetForPlatform('darwin', 'arm64')).toBe('darwin-arm64')
  expect(resolveTargetForPlatform('darwin', 'x64')).toBe('darwin-x64')
  expect(resolveTargetForPlatform('win32', 'x64')).toBe('win32-x64')
  expect(resolveTargetForPlatform('linux', 'x64')).toBe('linux-x64')
})

test('resolveTargetForPlatform 不支持的目标抛错', () => {
  expect(() => resolveTargetForPlatform('linux', 'arm64')).toThrow(/unsupported target/)
  expect(() => resolveTargetForPlatform('darwin', 'ia32' as NodeJS.Architecture)).toThrow(/unsupported target/)
})

test('buildPythonAssetUrl 按目标拼出 PBS Release URL（mac/win 走 install_only）', () => {
  const url = buildPythonAssetUrl('darwin-arm64', RUNTIME_SPEC.pythonBuildStandaloneTag, RUNTIME_SPEC.pythonVersion)
  expect(url).toContain('https://github.com/astral-sh/python-build-standalone/releases/download/')
  expect(url).toContain(RUNTIME_SPEC.pythonBuildStandaloneTag)
  expect(url).toContain(RUNTIME_SPEC.pythonVersion)
  expect(url).toContain('aarch64-apple-darwin')
  expect(url.endsWith('install_only.tar.gz')).toBe(true)
})

test('buildPythonAssetUrl linux 走 install_only_stripped 变体', () => {
  const url = buildPythonAssetUrl('linux-x64', RUNTIME_SPEC.pythonBuildStandaloneTag, RUNTIME_SPEC.pythonVersion)
  expect(url).toContain('x86_64-unknown-linux-gnu')
  expect(url.endsWith('install_only_stripped.tar.gz')).toBe(true)
})

test('buildUvAssetUrl 按目标拼出 uv Release URL', () => {
  const url = buildUvAssetUrl('win32-x64', RUNTIME_SPEC.uvVersion)
  expect(url).toContain('https://github.com/astral-sh/uv/releases/download/')
  expect(url).toContain(RUNTIME_SPEC.uvVersion)
  expect(url).toMatch(/x86_64-pc-windows-msvc\.zip$/)
})

test('buildUvAssetUrl mac/linux 走 tar.gz', () => {
  expect(buildUvAssetUrl('darwin-arm64', RUNTIME_SPEC.uvVersion)).toMatch(/aarch64-apple-darwin\.tar\.gz$/)
  expect(buildUvAssetUrl('linux-x64', RUNTIME_SPEC.uvVersion)).toMatch(/x86_64-unknown-linux-gnu\.tar\.gz$/)
})

test('computeSha256 对已知输入返回已知摘要', () => {
  // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
  const buf = Buffer.from('hello')
  expect(computeSha256(buf)).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
})

test('RUNTIME_SPEC 锁定的版本字段都到位', () => {
  expect(RUNTIME_SPEC.pythonBuildStandaloneTag).toMatch(/^\d{8}$/)
  expect(RUNTIME_SPEC.pythonVersion).toMatch(/^\d+\.\d+\.\d+$/)
  expect(RUNTIME_SPEC.uvVersion).toMatch(/^\d+\.\d+\.\d+$/)
})
