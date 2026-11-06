/**
 * session-papers-watcher 测试
 *
 * 覆盖：
 * - {sessionId}.live.json 变化 → 推送 kind='live' 事件，sessionId 解析正确
 * - {sessionId}.jsonl 变化 → 推送 kind='canonical' 事件
 * - .tmp 中间文件不触发事件（原子写的临时产物）
 * - 同一 (sessionId, kind) 的高频连续写在 debounce 窗口内合并为一次事件（双写者场景）
 * - stop 后不再推送
 *
 * 真实 chokidar + 临时目录；时间断言用宽松 sleep，避免 CI 抖动。
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface SentEvent {
  channel: string
  payload: { sessionId: string; kind: 'live' | 'canonical' }
}

const sent: SentEvent[] = []

// stub electron —— bun runtime 无 Electron context。
// 注意：mock.module('electron') 是进程级替换，必须提供超集（app/safeStorage/
// BrowserWindow），否则同进程其他测试文件从 electron 取 safeStorage 等命名导出
// 会炸（与 agent-orchestrator.pdf-guard.test.ts 的形状保持一致）。
mock.module('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getName: () => 'ASCI',
    isPackaged: false,
    on: () => {},
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString('utf-8'),
  },
  shell: { openExternal: async () => {} },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: SentEvent['payload']) => {
            sent.push({ channel, payload })
          },
        },
      },
    ],
  },
}))

let tmpHome: string
let originalHome: string | undefined
let originalDev: string | undefined
let papersDir: string

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/** awaitWriteFinish(120ms) + debounce(150/250ms) 之后的宽松等待窗口 */
const SETTLE_MS = 800

// 用动态 import 而非顶层 import，避免 mock.module 在 import 之前未生效
const { startSessionPapersWatcher, stopSessionPapersWatcher } = await import(
  './session-papers-watcher.ts'
)

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-papers-watch-'))
  originalHome = process.env.ASCI_CONFIG_HOME
  originalDev = process.env.ASCI_DEV
  process.env.ASCI_CONFIG_HOME = tmpHome
  // 强制走 .asci 而非 .asci-dev
  process.env.ASCI_DEV = ''
  papersDir = join(tmpHome, '.asci', 'agent-sessions-papers')
  mkdirSync(papersDir, { recursive: true })
  sent.length = 0
})

afterEach(() => {
  stopSessionPapersWatcher()
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  if (originalDev === undefined) delete process.env.ASCI_DEV
  else process.env.ASCI_DEV = originalDev
  rmSync(tmpHome, { recursive: true, force: true })
})

afterAll(() => {
  mock.restore()
})

describe('session-papers-watcher', () => {
  test('live.json 写入 → kind=live；jsonl 写入 → kind=canonical；sessionId 解析正确', async () => {
    startSessionPapersWatcher()
    await sleep(300) // 等 chokidar 就绪

    writeFileSync(join(papersDir, 'sess-a.live.json'), JSON.stringify({ phase: 'searching' }))
    writeFileSync(join(papersDir, 'sess-b.jsonl'), '{"title":"t"}\n')
    await sleep(SETTLE_MS)

    const kinds = sent.map((e) => `${e.payload.sessionId}:${e.payload.kind}`).sort()
    expect(kinds).toEqual(['sess-a:live', 'sess-b:canonical'])
    expect(sent.every((e) => e.channel === 'agent:session-papers-changed')).toBe(true)
  })

  test('.tmp 中间文件不触发事件', async () => {
    startSessionPapersWatcher()
    await sleep(300)

    writeFileSync(join(papersDir, 'sess-c.live.json.12345.tmp'), '{}')
    await sleep(SETTLE_MS)

    expect(sent).toHaveLength(0)
  })

  test('同一 (sessionId, kind) 高频连续写合并为一次事件（双写者去抖）', async () => {
    startSessionPapersWatcher()
    await sleep(300)

    const p = join(papersDir, 'sess-d.jsonl')
    writeFileSync(p, '{"a":1}\n')
    await sleep(50)
    writeFileSync(p, '{"a":1}\n{"a":2}\n')
    await sleep(50)
    writeFileSync(p, '{"a":1}\n{"a":2}\n{"a":3}\n')
    await sleep(SETTLE_MS)

    const canonical = sent.filter((e) => e.payload.kind === 'canonical')
    expect(canonical).toHaveLength(1)
    expect(canonical[0]!.payload.sessionId).toBe('sess-d')
  })

  test('stop 后不再推送', async () => {
    startSessionPapersWatcher()
    await sleep(300)
    stopSessionPapersWatcher()

    writeFileSync(join(papersDir, 'sess-e.jsonl'), '{"a":1}\n')
    await sleep(SETTLE_MS)

    expect(sent).toHaveLength(0)
  })
})
