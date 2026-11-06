import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getPythonSkillsDir,
  getPythonSkillVenvDir,
  getPythonSkillDepsLock,
  pythonInterpreterRelativePath,
  pythonVenvBinRelativeDir,
} from './paths.ts'

let originalHome: string | undefined
let tmpHome: string

beforeEach(() => {
  originalHome = process.env.ASCI_CONFIG_HOME
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-python-paths-'))
  process.env.ASCI_CONFIG_HOME = tmpHome
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  try { rmSync(tmpHome, { recursive: true, force: true }) } catch {}
})

test('getPythonSkillsDir 落在 ~/.asci(-dev)/python/skills/', () => {
  const dir = getPythonSkillsDir()
  expect(dir.startsWith(tmpHome)).toBe(true)
  expect(dir.endsWith('/python/skills')).toBe(true)
})

test('getPythonSkillVenvDir 拼出 skills/<name>/venv', () => {
  expect(getPythonSkillVenvDir('scanpy').endsWith('/python/skills/scanpy/venv')).toBe(true)
})

test('getPythonSkillDepsLock 是 skills/<name>/.deps.lock', () => {
  expect(getPythonSkillDepsLock('scanpy').endsWith('/python/skills/scanpy/.deps.lock')).toBe(true)
})

test('pythonInterpreterRelativePath 区分 mac/linux 与 win', () => {
  expect(pythonInterpreterRelativePath('darwin')).toBe('bin/python3.12')
  expect(pythonInterpreterRelativePath('linux')).toBe('bin/python3.12')
  expect(pythonInterpreterRelativePath('win32')).toBe('python.exe')
})

test('pythonVenvBinRelativeDir 区分 mac/linux 与 win', () => {
  expect(pythonVenvBinRelativeDir('darwin')).toBe('bin')
  expect(pythonVenvBinRelativeDir('linux')).toBe('bin')
  expect(pythonVenvBinRelativeDir('win32')).toBe('Scripts')
})
