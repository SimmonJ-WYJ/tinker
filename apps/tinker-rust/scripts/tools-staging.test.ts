/** 真实文件系统回归：每次分配全新目录，不复用含链接的旧产物。 */
import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createToolsStaging } from './tools-staging.ts'
test('每次构建独占新目录，旧 bundle 的 symlink 不会成为新写入目标', () => {
  const parent = mkdtempSync(join(tmpdir(), 'tools-staging-test-'))
  try {
    const first = createToolsStaging(parent)
    const victim = join(parent, 'synthetic-old-app')
    mkdirSync(victim)
    writeFileSync(join(victim, 'protected'), 'old-owned-fixture')
    symlinkSync(victim, join(first, 'Tinker Tools Preview.app'))
    const next = createToolsStaging(parent)
    expect(next).not.toBe(first)
    expect(lstatSync(next).mode & 0o777).toBe(0o700)
    mkdirSync(join(next, 'Tinker Tools Preview.app'))
    expect(readFileSync(join(victim, 'protected'), 'utf8')).toBe('old-owned-fixture')
    expect(lstatSync(join(first, 'Tinker Tools Preview.app')).isSymbolicLink()).toBe(true)
  } finally { rmSync(parent, { recursive: true, force: true }) }
})
