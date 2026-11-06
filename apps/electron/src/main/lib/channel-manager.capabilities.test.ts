/**
 * channel-manager capabilities 持久化测试
 *
 * 覆盖 #74 修复路径：
 * - createChannel 默认按 provider 写入 capabilities
 * - createChannel 显式 capabilities 原样持久化
 * - updateChannel 单独更新 capabilities 时其他字段保留
 * - readConfig 兼容旧 channels.json（无 capabilities 字段时自动补默认）
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// stub electron.safeStorage —— bun runtime 无 Electron context，强制走"加密不可用 → 明文存储"分支
mock.module('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString('utf-8'),
  },
}))

let tmpHome: string
let originalHome: string | undefined
let originalDev: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-channel-cap-'))
  originalHome = process.env.ASCI_CONFIG_HOME
  originalDev = process.env.ASCI_DEV
  process.env.ASCI_CONFIG_HOME = tmpHome
  // 强制走 .asci 而非 .asci-dev
  process.env.ASCI_DEV = ''
  mkdirSync(join(tmpHome, '.asci'), { recursive: true })
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  if (originalDev === undefined) delete process.env.ASCI_DEV
  else process.env.ASCI_DEV = originalDev
  rmSync(tmpHome, { recursive: true, force: true })
})

afterAll(() => {
  mock.restore()
})

// 用动态 import 而非顶层 import，避免 mock.module 在 import 之前未生效
const { createChannel, listChannels, updateChannel } = await import('./channel-manager.ts')

describe('channel-manager capabilities', () => {
  test('createChannel 不传 capabilities 时 listChannels 透出 provider 默认 + 已持久化到磁盘', () => {
    createChannel({
      name: 'kimi-default',
      provider: 'moonshot',
      baseUrl: 'https://api.moonshot.cn/anthropic',
      apiKey: 'sk-test',
      models: [],
      enabled: true,
    })
    // listChannels 视图
    const channels = listChannels()
    expect(channels[0]?.capabilities).toEqual({
      supportsPdfDocumentBlock: false,
    })
    // 磁盘 raw — 防止 readConfig 的 backfill 掩盖未持久化的回归
    const raw = JSON.parse(
      readFileSync(join(tmpHome, '.asci', 'channels.json'), 'utf-8'),
    ) as { channels: Array<{ capabilities?: { supportsPdfDocumentBlock?: boolean } }> }
    expect(raw.channels[0]?.capabilities).toEqual({
      supportsPdfDocumentBlock: false,
    })
  })

  test('createChannel 显式 capabilities 持久化原样回读', () => {
    createChannel({
      name: 'moonshot-override',
      provider: 'moonshot',
      baseUrl: 'https://my-proxy/anthropic',
      apiKey: 'sk-test',
      models: [],
      enabled: true,
      capabilities: { supportsPdfDocumentBlock: true },
    })
    expect(listChannels()[0]?.capabilities).toEqual({
      supportsPdfDocumentBlock: true,
    })
  })

  test('updateChannel 可单独修改 capabilities 而保留其他字段', () => {
    const created = createChannel({
      name: 'c',
      provider: 'moonshot',
      baseUrl: 'https://api.moonshot.cn/anthropic',
      apiKey: 'sk-test',
      models: [],
      enabled: true,
    })
    const updated = updateChannel(created.id, {
      capabilities: { supportsPdfDocumentBlock: true },
    })
    expect(updated.capabilities).toEqual({ supportsPdfDocumentBlock: true })
    expect(updated.name).toBe('c')
    expect(updated.baseUrl).toBe('https://api.moonshot.cn/anthropic')
  })

  test('updateChannel: 切 provider 时重置 capabilities 为新 provider 默认', () => {
    const created = createChannel({
      name: 'moon-to-anth',
      provider: 'moonshot',
      baseUrl: 'https://api.moonshot.cn/anthropic',
      apiKey: 'sk-test',
      models: [],
      enabled: true,
    })
    // 默认 Moonshot capabilities = { supportsPdfDocumentBlock: false }
    expect(created.capabilities).toEqual({ supportsPdfDocumentBlock: false })

    // 切到 Anthropic（不显式传 capabilities）→ 应自动用 Anthropic 默认（true）
    const switched = updateChannel(created.id, {
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
    })
    expect(switched.provider).toBe('anthropic')
    expect(switched.capabilities).toEqual({ supportsPdfDocumentBlock: true })
  })

  test('updateChannel: 切 provider 时 input.capabilities 显式优先', () => {
    const created = createChannel({
      name: 'moon-to-anth-explicit',
      provider: 'moonshot',
      baseUrl: 'https://api.moonshot.cn/anthropic',
      apiKey: 'sk-test',
      models: [],
      enabled: true,
    })

    // 切到 Anthropic 且显式 false → 应保留 false（用户主张优先）
    const switched = updateChannel(created.id, {
      provider: 'anthropic',
      capabilities: { supportsPdfDocumentBlock: false },
    })
    expect(switched.capabilities).toEqual({ supportsPdfDocumentBlock: false })
  })

  test('updateChannel: 不切 provider + 不传 capabilities → 保留已有能力（用户手动设过 true 的 Moonshot 不被回退）', () => {
    const created = createChannel({
      name: 'moon-manual-true',
      provider: 'moonshot',
      baseUrl: 'https://my-proxy/anthropic',
      apiKey: 'sk-test',
      models: [],
      enabled: true,
      capabilities: { supportsPdfDocumentBlock: true },  // 用户自托管反代支持
    })
    expect(created.capabilities).toEqual({ supportsPdfDocumentBlock: true })

    // 只改名字 → capabilities 不变
    const renamed = updateChannel(created.id, { name: 'moon-renamed' })
    expect(renamed.capabilities).toEqual({ supportsPdfDocumentBlock: true })
  })

  test('readConfig 兼容旧 channels.json（无 capabilities 字段）→ listChannels 自动补默认', () => {
    writeFileSync(
      join(tmpHome, '.asci', 'channels.json'),
      JSON.stringify(
        {
          version: 1,
          channels: [
            {
              id: 'legacy',
              name: 'legacy-moonshot',
              provider: 'moonshot',
              baseUrl: 'https://api.moonshot.cn/anthropic',
              apiKey: 'enc',
              models: [],
              enabled: true,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
        null,
        2,
      ),
      'utf-8',
    )
    expect(listChannels()[0]?.capabilities).toEqual({
      supportsPdfDocumentBlock: false,
    })
  })
})
