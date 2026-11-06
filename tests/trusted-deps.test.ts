/**
 * trusted-deps.test.ts — 守门：better-sqlite3 不得进 root package.json 的 trustedDependencies
 *
 * 背景：better-sqlite3 是 V8/NAN 旧式绑定，ABI 绑死 NODE_MODULE_VERSION。若列入
 * trustedDependencies，bun install 阶段会针对 Node 编译它（~2min 白编，且编出的是 Node ABI，
 * 对 Electron app 是错的）。正确的 Electron ABI 由 release.yml 的「重建 better-sqlite3」步骤
 * （apps/electron/scripts/rebuild-better-sqlite3.ts）下预编译保证，install 阶段不该再编一遍。
 *
 * 历史：#300 移除 → #326 合并时把旧 package.json 带回导致回归。此测试防止第三次再犯。
 */

import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '..')

test('better-sqlite3 不在 root package.json 的 trustedDependencies 中', () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    trustedDependencies?: string[]
  }
  const trusted = pkg.trustedDependencies ?? []
  expect(trusted).not.toContain('better-sqlite3')
})
