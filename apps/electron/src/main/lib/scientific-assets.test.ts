import { test, expect } from 'bun:test'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

test('54 bounded synthetic retired layouts and 45 retained skills preserve distribution and user ownership', () => {
 const home = mkdtempSync(join(tmpdir(), 'scientific-assets-home-'))
 try {
  // Electron/SDK mock 仅存在于子进程，退役布局使用合成正文，保留技能来自仓库；无需 Git 历史。
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, '__tests__/fixtures/scientific-assets.fixture.ts')], {
   env: { ...process.env, ASCI_CONFIG_HOME: home, ASCI_RUNTIMES_HOME: join(home, 'runtime') },
   stdout: 'pipe', stderr: 'pipe',
  })
  expect({ code: result.exitCode, output: result.stdout.toString() + result.stderr.toString() }).toEqual({
   code: 0, output: expect.stringContaining('scientific assets: 54 layouts, 45 retained skills, protected user copies and mock SDK plugin passed'),
  })
 } finally { rmSync(home, { recursive: true, force: true }) }
}, 30000)
