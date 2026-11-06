#!/usr/bin/env bun
/**
 * rebuild-better-sqlite3.ts —— 把 better-sqlite3 的原生 binding 落成 Electron ABI。
 *
 * 背景：better-sqlite3 用 V8/NAN 旧式绑定，绑死 NODE_MODULE_VERSION（ABI）。Electron 与 Node
 * 的 ABI 不同（Electron 39 = ABI 140，Node 20 = ABI 115），针对 Node 编出来的 .node 在 Electron
 * 主进程里 require 会抛 "compiled against a different Node.js version"。`bun install` 默认按当前
 * Node 编/取，得到的是 Node ABI 的产物，对 Electron app 是错的——必须重建到 Electron ABI。
 *
 * 三层取数策略：
 *   1. 快路径：下 better-sqlite3 官方发布的 electron-v<ABI> 预编译（秒级，零编译）。
 *   2. 兜底：预编译不可用（上游滞后 / 网络）时，用 @electron/rebuild 针对 Electron 头文件源码编译
 *      （慢但 ABI 正确）。
 *   两者都显式针对 Electron，产物 ABI 由命令保证；调用方（release.yml）再加一道 dlopen 校验门兜底。
 *
 * 用法：
 *   bun run rebuild                 # 当前进程 arch（本机开发）
 *   bun run rebuild -- --arch x64   # 交叉构建时显式指定目标 arch（如 arm64 runner 出 mac x64 包）
 *
 * 仅作用于 better-sqlite3；sharp / onnxruntime-node 等走 N-API（ABI 跨 runtime 稳定），不受影响，
 * 不要在这里碰它们。
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)

const args = process.argv.slice(2)
const archFlag = args.indexOf('--arch')
const arch = archFlag >= 0 && args[archFlag + 1] ? args[archFlag + 1] : process.arch

const electronVersion = require('electron/package.json').version as string
const bs3Dir = dirname(require.resolve('better-sqlite3/package.json'))

console.log(`[rebuild] better-sqlite3 → Electron ${electronVersion} (${arch})`)
console.log(`[rebuild] target dir: ${bs3Dir}`)

function run(cmd: string, cmdArgs: string[], cwd: string): void {
  execFileSync(cmd, cmdArgs, { cwd, stdio: 'inherit' })
}

try {
  // 快路径：下 electron 预编译
  run(
    'npx',
    ['prebuild-install', '--runtime', 'electron', '--target', electronVersion, '--arch', arch, '--tag-prefix', 'v'],
    bs3Dir,
  )
  console.log('[rebuild] ✅ 命中 electron 预编译')
} catch {
  console.warn('[rebuild] ⚠ 预编译不可用，回退 @electron/rebuild 源码编译（针对 Electron ABI）')
  // 兜底：electron-rebuild 针对 Electron 头文件编译。从 apps/electron（调用方 cwd）跑，
  // 与历史上手动 `electron-rebuild -f -w better-sqlite3` 一致，依赖解析能定位到 better-sqlite3。
  run(
    'npx',
    ['electron-rebuild', '--force', '--version', electronVersion, '--arch', arch, '--which-module', 'better-sqlite3'],
    process.cwd(),
  )
  console.log('[rebuild] ✅ 源码编译完成（Electron ABI）')
}
