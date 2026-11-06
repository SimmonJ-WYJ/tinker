#!/usr/bin/env bun
/**
 * setup-runtimes.ts —— 把 dist/runtimes 拷到用户目录 + 写 .version
 *
 * P1 本地版：仅支持 --from-local <dir>
 * P3 扩展：默认从 GitHub release URL 下载同源 tarball
 *
 * 用法：
 *   bun run setup:runtimes -- --from-local apps/electron/dist/runtimes/darwin-arm64
 *   bun run setup:runtimes -- --from-local <dir> --target /custom/path  # 多版本调试
 */

import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getRuntimesRoot, RUNTIME_STAMP_FILENAME } from '../src/main/lib/runtime/paths.ts'
import { parseKebabArgs } from './_argv.ts'

interface Args {
  fromLocal?: string
  target?: string
}

function readAsciVersion(): string {
  const pkgPath = resolve(import.meta.dir, '..', 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  return pkg.version
}

function main(): void {
  const args = parseKebabArgs<Args>(process.argv.slice(2))
  if (!args.fromLocal) {
    console.error('用法：bun run setup:runtimes -- --from-local <dir> [--target <path>]')
    process.exit(2)
  }
  const src = resolve(args.fromLocal)
  if (!existsSync(src)) {
    console.error(`--from-local 目录不存在: ${src}`)
    process.exit(1)
  }
  const target = args.target ? resolve(args.target) : getRuntimesRoot()
  const version = readAsciVersion()

  console.log(`📦 setup-runtimes`)
  console.log(`  from: ${src}`)
  console.log(`  to:   ${target}`)
  console.log(`  ver:  ${version}`)

  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true })
  }
  mkdirSync(target, { recursive: true })
  cpSync(src, target, { recursive: true })

  writeFileSync(join(target, RUNTIME_STAMP_FILENAME), version)

  console.log(`✅ runtimes 就绪：${target}`)
  console.log(`   接下来跑 \`bun run dev\` 即可`)
}

main()
