import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 用临时目录隔离测试，避免污染真实 ~/.asci
// 参照 config-paths.test.ts：用 ASCI_CONFIG_HOME + cachebust 动态 import 清缓存
let tmpHome: string
let originalConfigHome: string | undefined
let originalDev: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-globalcfg-'))
  originalConfigHome = process.env.ASCI_CONFIG_HOME
  originalDev = process.env.ASCI_DEV
  process.env.ASCI_CONFIG_HOME = tmpHome
  // 强制走 .asci 命名（绕过 dev/packaged 检测）
  process.env.ASCI_DEV = ''
})

afterEach(() => {
  if (originalConfigHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalConfigHome
  if (originalDev === undefined) delete process.env.ASCI_DEV
  else process.env.ASCI_DEV = originalDev
  rmSync(tmpHome, { recursive: true, force: true })
})

test('getGlobalMcpConfig: 文件不存在时返回空 servers', async () => {
  const { getGlobalMcpConfig } = await import(`./global-config.ts?cachebust=${Date.now()}`)
  const cfg = getGlobalMcpConfig()
  expect(cfg).toEqual({ servers: {} })
})

test('getGlobalMcpConfig: 解析失败回退到空 servers', async () => {
  const pathsMod = await import(`../config-paths.ts?cachebust=${Date.now()}`)
  const p = pathsMod.getGlobalMcpPath()
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, 'not json {{{')
  const { getGlobalMcpConfig } = await import(`./global-config.ts?cachebust=${Date.now()}`)
  expect(getGlobalMcpConfig()).toEqual({ servers: {} })
})

test('saveGlobalMcpConfig: 写入并能被 getGlobalMcpConfig 读回', async () => {
  const cachebust = Date.now()
  const { getGlobalMcpConfig, saveGlobalMcpConfig } = await import(`./global-config.ts?cachebust=${cachebust}`)
  saveGlobalMcpConfig({
    servers: {
      'demo': { type: 'stdio', command: 'node', args: ['x.js'], enabled: true },
    },
  })
  const back = getGlobalMcpConfig()
  expect(back.servers['demo']?.command).toBe('node')
})
