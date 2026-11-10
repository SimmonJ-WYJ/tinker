import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('旧科研写入 IPC 在任何存储、网络访问前 unavailable，通用笔记反馈与读取仍代理', () => {
 const root = mkdtempSync(join(tmpdir(), 'history-ipc-'))
 try {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, '__tests__/history-retirement.fixture.ts')], { env: { PATH: process.env.PATH, ASCI_CONFIG_HOME: root, ASCI_RUNTIMES_HOME: join(root, 'runtime') } })
  expect(result.stdout.toString() + result.stderr.toString()).toContain('history retirement IPC passed')
  expect(result.exitCode).toBe(0)
 } finally { rmSync(root, { recursive: true, force: true }) }
})
