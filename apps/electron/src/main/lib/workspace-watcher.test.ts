/**
 * workspace-watcher 单元测试
 *
 * 验证：
 * - chokidar 监听 ~/.asci/agent-workspaces/ 写入 → WORKSPACE_FILES_CHANGED
 * - skills/ 路径 → CAPABILITIES_CHANGED
 * - 高频写入 debounce 合并为单次 IPC
 * - stopWorkspaceWatcher 清理监听
 * - broadcastWorkspaceFilesChanged 在 mainWin 未就绪时 no-op
 * - broadcastWorkspaceFilesChanged 多次调用 debounce 合并
 */

import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT_IPC_CHANNELS } from '@asci/shared'

let tmpHome: string
let originalHome: string | undefined
let originalDev: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-watcher-'))
  originalHome = process.env.ASCI_CONFIG_HOME
  originalDev = process.env.ASCI_DEV
  process.env.ASCI_CONFIG_HOME = tmpHome
  process.env.ASCI_DEV = ''
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  if (originalDev === undefined) delete process.env.ASCI_DEV
  else process.env.ASCI_DEV = originalDev
  rmSync(tmpHome, { recursive: true, force: true })
})

interface SendCall {
  channel: string
  args: unknown[]
}

interface FakeWindow {
  isDestroyed(): boolean
  webContents: { send: (channel: string, ...args: unknown[]) => void }
  __sendCalls: SendCall[]
  __destroyed: boolean
}

function createFakeWindow(): FakeWindow {
  const calls: SendCall[] = []
  const win: FakeWindow = {
    __destroyed: false,
    __sendCalls: calls,
    isDestroyed() { return this.__destroyed },
    webContents: {
      send(channel: string, ...args: unknown[]): void {
        calls.push({ channel, args })
      },
    },
  }
  return win
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function loadModule(): Promise<typeof import('./workspace-watcher.ts')> {
  return await import(`./workspace-watcher.ts?cachebust=${Date.now()}-${Math.random()}`)
}

/** 等待 chokidar 完成初始扫描（避免 ignoreInitial + awaitWriteFinish 时序竞争） */
async function awaitWatcherReady(): Promise<void> {
  await sleep(500)
}

test('startWorkspaceWatcher: 工作区写入文件触发 WORKSPACE_FILES_CHANGED', async () => {
  const mod = await loadModule()
  const win = createFakeWindow()

  // 预创建 agent-workspaces 目录（getAgentWorkspacesDir 会自建，此处显式确保）
  const watchDir = join(tmpHome, '.asci', 'agent-workspaces')
  mkdirSync(watchDir, { recursive: true })

  mod.startWorkspaceWatcher(win as unknown as Parameters<typeof mod.startWorkspaceWatcher>[0])
  await awaitWatcherReady()

  // 写入文件
  const slugDir = join(watchDir, 'demo-ws')
  mkdirSync(slugDir, { recursive: true })
  writeFileSync(join(slugDir, 'hello.txt'), 'hi', 'utf-8')

  // 等 awaitWriteFinish(200ms stability) + debounce(300ms) 完成
  await sleep(1500)

  const fileEvents = win.__sendCalls.filter((c) => c.channel === AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED)
  expect(fileEvents.length).toBeGreaterThanOrEqual(1)

  mod.stopWorkspaceWatcher()
})

test('startWorkspaceWatcher: skills/ 路径触发 CAPABILITIES_CHANGED 而非 WORKSPACE_FILES_CHANGED', async () => {
  const mod = await loadModule()
  const win = createFakeWindow()

  const watchDir = join(tmpHome, '.asci', 'agent-workspaces')
  // 预先创建工作区与 skills 目录，避免 addDir 事件让 WORKSPACE_FILES_CHANGED 误触发
  const skillsDir = join(watchDir, 'demo-ws', 'skills', 'foo')
  mkdirSync(skillsDir, { recursive: true })

  mod.startWorkspaceWatcher(win as unknown as Parameters<typeof mod.startWorkspaceWatcher>[0])
  await awaitWatcherReady()

  // 仅写入 skills/ 下文件
  writeFileSync(join(skillsDir, 'SKILL.md'), '---\nname: foo\n---\n', 'utf-8')

  await sleep(1500)

  const capEvents = win.__sendCalls.filter((c) => c.channel === AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED)
  const fileEvents = win.__sendCalls.filter((c) => c.channel === AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED)

  expect(capEvents.length).toBeGreaterThanOrEqual(1)
  // skills/ 路径不应触发 files 通道
  expect(fileEvents.length).toBe(0)

  mod.stopWorkspaceWatcher()
})

test('startWorkspaceWatcher: 高频写入 debounce 合并为单次 IPC', async () => {
  const mod = await loadModule()
  const win = createFakeWindow()

  const watchDir = join(tmpHome, '.asci', 'agent-workspaces')
  const slugDir = join(watchDir, 'demo-ws')
  mkdirSync(slugDir, { recursive: true })

  mod.startWorkspaceWatcher(win as unknown as Parameters<typeof mod.startWorkspaceWatcher>[0])
  await awaitWatcherReady()

  // 10 次连续写入
  for (let i = 0; i < 10; i++) {
    writeFileSync(join(slugDir, `f${i}.txt`), `${i}`, 'utf-8')
  }

  await sleep(1500)

  const fileEvents = win.__sendCalls.filter((c) => c.channel === AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED)
  // debounce(300ms) 内的写入合并；awaitWriteFinish 也会把同窗口写合并
  // 严格 1 次较脆弱（不同 OS 时序差异），允许 1~2 次但应远小于 10
  expect(fileEvents.length).toBeLessThanOrEqual(2)
  expect(fileEvents.length).toBeGreaterThanOrEqual(1)

  mod.stopWorkspaceWatcher()
})

test('stopWorkspaceWatcher: 停止后写入不再触发 IPC', async () => {
  const mod = await loadModule()
  const win = createFakeWindow()

  const watchDir = join(tmpHome, '.asci', 'agent-workspaces')
  const slugDir = join(watchDir, 'demo-ws')
  mkdirSync(slugDir, { recursive: true })

  mod.startWorkspaceWatcher(win as unknown as Parameters<typeof mod.startWorkspaceWatcher>[0])
  await awaitWatcherReady()
  // 等任何 warmup 阶段的 debounce timer 都已 flush
  await sleep(500)
  // 清空启动期捕获到的事件，使后续断言仅针对 stop 之后行为
  win.__sendCalls.length = 0

  mod.stopWorkspaceWatcher()

  writeFileSync(join(slugDir, 'after-stop.txt'), 'x', 'utf-8')
  await sleep(900)

  const fileEvents = win.__sendCalls.filter((c) => c.channel === AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED)
  expect(fileEvents.length).toBe(0)
})

test('broadcastWorkspaceFilesChanged: mainWin 未就绪时静默 no-op', async () => {
  const mod = await loadModule()
  // 未调用 startWorkspaceWatcher，mainWin = null
  mod.broadcastWorkspaceFilesChanged()
  await sleep(300)
  // 不抛错即视为通过；没有 win 可以观察 send 调用次数，
  // 通过下一个用例验证 mainWin 就绪时的正向行为
  expect(true).toBe(true)
})

test('broadcastWorkspaceFilesChanged: 多次调用 debounce 合并为 1 次 IPC', async () => {
  const mod = await loadModule()
  const win = createFakeWindow()

  const watchDir = join(tmpHome, '.asci', 'agent-workspaces')
  mkdirSync(watchDir, { recursive: true })

  mod.startWorkspaceWatcher(win as unknown as Parameters<typeof mod.startWorkspaceWatcher>[0])
  await awaitWatcherReady()

  // 清空 watcher 初始扫描可能的事件
  win.__sendCalls.length = 0

  // 连续 5 次调用
  for (let i = 0; i < 5; i++) {
    mod.broadcastWorkspaceFilesChanged()
  }

  // 等 broadcast debounce(200ms) 触发
  await sleep(400)

  const fileEvents = win.__sendCalls.filter((c) => c.channel === AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED)
  expect(fileEvents.length).toBe(1)

  mod.stopWorkspaceWatcher()
})
