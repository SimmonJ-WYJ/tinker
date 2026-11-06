import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

// 用临时 HOME 隔离测试，避免污染真实 ~/.asci
let tmpHome: string
let originalHome: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-cfgpaths-'))
  originalHome = process.env.ASCI_CONFIG_HOME
  process.env.ASCI_CONFIG_HOME = tmpHome
  // 强制走 .asci 命名（绕过 dev/packaged 检测）
  process.env.ASCI_DEV = ''
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  rmSync(tmpHome, { recursive: true, force: true })
})

test('getWorkspacePapersPath 返回工作区下的 papers.jsonl', async () => {
  // 每个 test 重新 import，避免模块级 _configDirName 缓存
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  const p = mod.getWorkspacePapersPath('demo-slug')
  expect(p.endsWith('/agent-workspaces/demo-slug/papers.jsonl')).toBe(true)
})

test('getWorkspacePaperPdfsDir 返回 workspace-files/papers 并自动创建', async () => {
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  const dir = mod.getWorkspacePaperPdfsDir('demo-slug')
  expect(dir.endsWith('/workspace-files/papers')).toBe(true)
  expect(existsSync(dir)).toBe(true)
})

test('getWorkspacePaperNotesDir 返回 workspace-files/paper-notes 并自动创建', async () => {
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  const dir = mod.getWorkspacePaperNotesDir('demo-slug')
  expect(dir.endsWith('/workspace-files/paper-notes')).toBe(true)
  expect(existsSync(dir)).toBe(true)
})

test('getGlobalMcpPath 返回 ~/.asci/mcp.json（生产）或 ~/.asci-dev/mcp.json（dev）', async () => {
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  const path = mod.getGlobalMcpPath()
  const dirName = mod.getConfigDirName()
  expect(path).toBe(join(tmpHome, dirName, 'mcp.json'))
})

test('getCapabilityPacksDir 返回 {configDir}/capability-packs', async () => {
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  const dir = mod.getCapabilityPacksDir()
  const configDir = mod.getConfigDir()
  expect(dir).toBe(join(configDir, 'capability-packs'))
})

test('getCapabilityPacksDir 路径以 capability-packs 结尾', async () => {
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  const dir = mod.getCapabilityPacksDir()
  expect(dir.endsWith('capability-packs')).toBe(true)
})

test('parseCapabilityPackVersion 正常 manifest 返回 version 字段', async () => {
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  const packDir = mkdtempSync(join(tmpdir(), 'asci-pack-ver-'))
  try {
    writeFileSync(
      join(packDir, 'manifest.json'),
      JSON.stringify({ packId: 'demo', version: '0.2.7', scenarioAgent: {} }),
    )
    expect(mod.parseCapabilityPackVersion(packDir)).toBe('0.2.7')
  } finally {
    rmSync(packDir, { recursive: true, force: true })
  }
})

test('parseCapabilityPackVersion 缺 version 字段返回 0.0.0', async () => {
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  const packDir = mkdtempSync(join(tmpdir(), 'asci-pack-ver-'))
  try {
    writeFileSync(join(packDir, 'manifest.json'), JSON.stringify({ packId: 'demo' }))
    expect(mod.parseCapabilityPackVersion(packDir)).toBe('0.0.0')
  } finally {
    rmSync(packDir, { recursive: true, force: true })
  }
})

test('parseCapabilityPackVersion 无 manifest.json 返回 0.0.0', async () => {
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  const packDir = mkdtempSync(join(tmpdir(), 'asci-pack-ver-'))
  try {
    expect(mod.parseCapabilityPackVersion(packDir)).toBe('0.0.0')
  } finally {
    rmSync(packDir, { recursive: true, force: true })
  }
})

test('parseCapabilityPackVersion JSON 解析失败返回 0.0.0', async () => {
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  const packDir = mkdtempSync(join(tmpdir(), 'asci-pack-ver-'))
  try {
    writeFileSync(join(packDir, 'manifest.json'), 'not valid json {{{')
    expect(mod.parseCapabilityPackVersion(packDir)).toBe('0.0.0')
  } finally {
    rmSync(packDir, { recursive: true, force: true })
  }
})

// ---------------- issue: DB 改名 objects.db → asci.db ----------------

test('getObjectsDbPath 返回 asci.db', async () => {
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  expect(mod.getObjectsDbPath().endsWith('/asci.db')).toBe(true)
})

test('migrateLegacyObjectsDbName：老 objects.db(含 sidecar) 改名为 asci.db', async () => {
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  const dir = mod.getConfigDir()
  // 造一个历史库 + WAL/SHM sidecar
  writeFileSync(join(dir, 'objects.db'), 'DBDATA')
  writeFileSync(join(dir, 'objects.db-wal'), 'WAL')
  writeFileSync(join(dir, 'objects.db-shm'), 'SHM')

  mod.migrateLegacyObjectsDbName()

  expect(existsSync(join(dir, 'asci.db'))).toBe(true)
  expect(existsSync(join(dir, 'asci.db-wal'))).toBe(true)
  expect(existsSync(join(dir, 'asci.db-shm'))).toBe(true)
  expect(existsSync(join(dir, 'objects.db'))).toBe(false)
  // 数据原样保留
  const { readFileSync } = await import('node:fs')
  expect(readFileSync(join(dir, 'asci.db'), 'utf-8')).toBe('DBDATA')
})

test('migrateLegacyObjectsDbName：asci.db 已存在 → 不动老文件（noop）', async () => {
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  const dir = mod.getConfigDir()
  writeFileSync(join(dir, 'asci.db'), 'NEW')
  writeFileSync(join(dir, 'objects.db'), 'OLD')

  mod.migrateLegacyObjectsDbName()

  const { readFileSync } = await import('node:fs')
  expect(readFileSync(join(dir, 'asci.db'), 'utf-8')).toBe('NEW') // 未被覆盖
  expect(existsSync(join(dir, 'objects.db'))).toBe(true) // 老文件保留，不误删
})

test('migrateLegacyObjectsDbName：全新安装(无 objects.db) → noop 不报错', async () => {
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  const dir = mod.getConfigDir()
  expect(() => mod.migrateLegacyObjectsDbName()).not.toThrow()
  expect(existsSync(join(dir, 'asci.db'))).toBe(false)
})

test('getPyCacheDir 返回 {configDir}/cache/pycache（issue #587）', async () => {
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  expect(mod.getPyCacheDir()).toBe(join(mod.getConfigDir(), 'cache', 'pycache'))
})

test('getPyCacheDir dev/prod 隔离：ASCI_DEV=1 → ~/.asci-dev 下', async () => {
  process.env.ASCI_DEV = '1'
  try {
    const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
    expect(mod.getPyCacheDir()).toBe(join(tmpHome, '.asci-dev', 'cache', 'pycache'))
  } finally {
    process.env.ASCI_DEV = ''
  }
})

test('getSessionDiagnosticsPath / getSessionStderrLogPath 落在 agent-sessions-diagnostics 下（issue #587）', async () => {
  const mod = await import(`./config-paths.ts?cachebust=${Date.now()}`)
  const jsonl = mod.getSessionDiagnosticsPath('sess-1')
  const stderrLog = mod.getSessionStderrLogPath('sess-1')
  expect(jsonl).toBe(join(mod.getConfigDir(), 'agent-sessions-diagnostics', 'sess-1.jsonl'))
  expect(stderrLog).toBe(join(mod.getConfigDir(), 'agent-sessions-diagnostics', 'sess-1.stderr.log'))
  // 目录自动创建
  expect(existsSync(join(mod.getConfigDir(), 'agent-sessions-diagnostics'))).toBe(true)
})
