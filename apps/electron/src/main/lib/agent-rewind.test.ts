/**
 * agent-rewind / agent-session-manager 端到端测试
 *
 * 用 tmpHome 隔离的 ASCI / SDK JSONL fixture 验证 issue #83 三类场景：
 * fresh / fork-pre-fork / post-recovery。
 */

import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeRewind } from './agent-rewind.ts'
import {
  createAgentSession,
  updateAgentSessionMeta,
  appendSDKMessages,
  getAgentSessionMeta,
  getAgentSessionSDKMessages,
} from './agent-session-manager.ts'
import type { SDKMessage } from '@asci/shared'

let tmpHome: string
let originalHome: string | undefined
let originalClaudeConfigDir: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-rewind-'))
  originalHome = process.env.ASCI_CONFIG_HOME
  originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.ASCI_CONFIG_HOME = tmpHome
  // 让 agent-session-manager 顶层副作用在下次动态 import 时重新拾取 tmpHome
  delete process.env.CLAUDE_CONFIG_DIR
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
  rmSync(tmpHome, { recursive: true, force: true })
})

test('assistantUuidExistsInSdkJsonl 在 SDK JSONL 中找到/找不到 uuid', async () => {
  const sdkSessionId = 'sdk-aaa'
  const projectsDir = join(tmpHome, '.asci', 'sdk-config', 'projects', 'tmp-project')
  mkdirSync(projectsDir, { recursive: true })
  const jsonlPath = join(projectsDir, `${sdkSessionId}.jsonl`)
  const lines = [
    JSON.stringify({ type: 'user', uuid: 'u-1', message: { content: [{ type: 'text', text: 'q1' }] } }),
    JSON.stringify({ type: 'assistant', uuid: 'a-1', message: { content: [{ type: 'text', text: 'r1' }] } }),
  ]
  writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf-8')

  const mgr = await import(`./agent-session-manager.ts?cb=${Date.now()}`)
  expect(mgr.assistantUuidExistsInSdkJsonl(sdkSessionId, 'a-1')).toBe(true)
  expect(mgr.assistantUuidExistsInSdkJsonl(sdkSessionId, 'a-missing')).toBe(false)
  expect(mgr.assistantUuidExistsInSdkJsonl('sdk-not-exist', 'a-1')).toBe(false)
})

test('assistantUuidExistsInSdkJsonl 仅匹配 type=assistant 的 uuid', async () => {
  const sdkSessionId = 'sdk-bbb'
  const projectsDir = join(tmpHome, '.asci', 'sdk-config', 'projects', 'tmp-project-2')
  mkdirSync(projectsDir, { recursive: true })
  const jsonlPath = join(projectsDir, `${sdkSessionId}.jsonl`)
  const lines = [
    JSON.stringify({ type: 'user', uuid: 'shared-uuid', message: { content: [{ type: 'text', text: 'q1' }] } }),
    JSON.stringify({ type: 'assistant', uuid: 'a-only', message: { content: [{ type: 'text', text: 'r1' }] } }),
  ]
  writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf-8')

  const mgr = await import(`./agent-session-manager.ts?cb=${Date.now()}-typecheck`)
  // shared-uuid 出现在 user 消息上 — 不应被认为是 assistant uuid
  expect(mgr.assistantUuidExistsInSdkJsonl(sdkSessionId, 'shared-uuid')).toBe(false)
  // a-only 出现在 assistant 消息上 — 应匹配
  expect(mgr.assistantUuidExistsInSdkJsonl(sdkSessionId, 'a-only')).toBe(true)
})

// ===== executeRewind 端到端测试 =====

function setupSession(opts: {
  sdkSessionId: string
  forkSourceSdkSessionId?: string
  asciMessages: Array<Record<string, unknown>>
  sdkJsonlLines: Array<Record<string, unknown>>
  forkSourceJsonlLines?: Array<Record<string, unknown>>
}): { asciSessionId: string } {
  const meta = createAgentSession('rewind-test', 'anthropic-default')

  updateAgentSessionMeta(meta.id, {
    sdkSessionId: opts.sdkSessionId,
    ...(opts.forkSourceSdkSessionId && { forkSourceSdkSessionId: opts.forkSourceSdkSessionId }),
  })

  appendSDKMessages(meta.id, opts.asciMessages as unknown as SDKMessage[])

  const projectsDir = join(tmpHome, '.asci', 'sdk-config', 'projects', 'fixture-project')
  mkdirSync(projectsDir, { recursive: true })
  writeFileSync(
    join(projectsDir, `${opts.sdkSessionId}.jsonl`),
    opts.sdkJsonlLines.map((m) => JSON.stringify(m)).join('\n') + '\n',
    'utf-8',
  )
  if (opts.forkSourceSdkSessionId && opts.forkSourceJsonlLines) {
    writeFileSync(
      join(projectsDir, `${opts.forkSourceSdkSessionId}.jsonl`),
      opts.forkSourceJsonlLines.map((m) => JSON.stringify(m)).join('\n') + '\n',
      'utf-8',
    )
  }

  return { asciSessionId: meta.id }
}

test('executeRewind happy path：目标在当前 SDK JSONL → 截断 + 写 resumeAt', async () => {
  const { asciSessionId } = setupSession({
    sdkSessionId: 'sdk-fresh',
    asciMessages: [
      { type: 'user', _createdAt: 1, message: { content: [{ type: 'text', text: 'q1' }] } },
      { type: 'assistant', uuid: 'A1', _createdAt: 2, message: { content: [{ type: 'text', text: 'r1' }] } },
      { type: 'user', uuid: 'U2', _createdAt: 3, message: { content: [{ type: 'text', text: 'q2' }] } },
      { type: 'assistant', uuid: 'A2', _createdAt: 4, message: { content: [{ type: 'text', text: 'r2' }] } },
    ],
    sdkJsonlLines: [
      { type: 'user', uuid: 'U1', message: { content: [{ type: 'text', text: 'q1' }] } },
      { type: 'assistant', uuid: 'A1', message: { content: [{ type: 'text', text: 'r1' }] } },
      { type: 'user', uuid: 'U2', message: { content: [{ type: 'text', text: 'q2' }] } },
      { type: 'assistant', uuid: 'A2', message: { content: [{ type: 'text', text: 'r2' }] } },
    ],
  })

  const result = await executeRewind(asciSessionId, 'A1')

  expect(result.blocked).toBeUndefined()
  expect(result.remainingMessages).toBe(2)
  expect(getAgentSessionMeta(asciSessionId)?.resumeAtMessageUuid).toBe('A1')
})

test('executeRewind fork-pre-fork：目标只在源 SDK JSONL → 软阻断不改 meta', async () => {
  const { asciSessionId } = setupSession({
    sdkSessionId: 'sdk-fork',
    forkSourceSdkSessionId: 'sdk-source',
    asciMessages: [
      { type: 'assistant', uuid: 'OLD-A1', _createdAt: 1, message: { content: [{ type: 'text', text: 'r1' }] } },
      { type: 'assistant', uuid: 'NEW-A2', _createdAt: 2, message: { content: [{ type: 'text', text: 'r2' }] } },
    ],
    sdkJsonlLines: [
      { type: 'assistant', uuid: 'NEW-A2', message: { content: [{ type: 'text', text: 'r2' }] } },
    ],
    forkSourceJsonlLines: [
      { type: 'assistant', uuid: 'OLD-A1', message: { content: [{ type: 'text', text: 'r1' }] } },
    ],
  })

  const result = await executeRewind(asciSessionId, 'OLD-A1')

  expect(result.blocked?.reason).toBe('fork-pre-fork')
  expect(result.remainingMessages).toBe(0)
  expect(getAgentSessionMeta(asciSessionId)?.resumeAtMessageUuid).toBeUndefined()
  expect(getAgentSessionSDKMessages(asciSessionId).length).toBe(2)
})

test('executeRewind post-recovery：目标既不在当前也不在源 → 软阻断', async () => {
  const { asciSessionId } = setupSession({
    sdkSessionId: 'sdk-post-recovery',
    asciMessages: [
      { type: 'assistant', uuid: 'OLD-A1', _createdAt: 1, message: { content: [{ type: 'text', text: 'r1' }] } },
      { type: 'assistant', uuid: 'NEW-A2', _createdAt: 2, message: { content: [{ type: 'text', text: 'r2' }] } },
    ],
    sdkJsonlLines: [
      { type: 'assistant', uuid: 'NEW-A2', message: { content: [{ type: 'text', text: 'r2' }] } },
    ],
  })

  const result = await executeRewind(asciSessionId, 'OLD-A1')

  expect(result.blocked?.reason).toBe('post-recovery')
  expect(getAgentSessionMeta(asciSessionId)?.resumeAtMessageUuid).toBeUndefined()
  expect(getAgentSessionSDKMessages(asciSessionId).length).toBe(2)
})
