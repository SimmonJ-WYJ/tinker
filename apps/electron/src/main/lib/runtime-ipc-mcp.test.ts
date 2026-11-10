import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('retired IPC settles unavailable; historical/media contracts and user-owned MCP remain', async () => {
 const root = mkdtempSync(join(tmpdir(), 'runtime-ipc-mcp-'))
 try {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, '__tests__/fixtures/runtime-retirement.fixture.ts')], { env: { PATH: process.env.PATH, ASCI_CONFIG_HOME: root, ASCI_RUNTIMES_HOME: join(root, 'runtimes'), ASCI_DEV: '' } })
  expect(result.stdout.toString() + result.stderr.toString()).toContain('runtime IPC + MCP assembly: passed')
  expect(result.stdout.toString()).toContain('host to adapter to mock SDK: custom agents/MCP/project settings passed')
  expect(result.stdout.toString() + result.stderr.toString()).toContain('70 abort/dispose runs and exceptional SDK iterator release all skill leases')
  expect(result.exitCode).toBe(0)
 } finally { rmSync(root, { recursive: true, force: true }) }
})
