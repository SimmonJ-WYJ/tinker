#!/usr/bin/env bun
/**
 * 构建期下载脚本：拉取 python-build-standalone 与 uv 二进制到
 * apps/electron/resources/python/<platform>-<arch>/
 *
 * 触发方式：
 *   bun run scripts/download-python-runtime.ts                    # 当前平台
 *   bun run scripts/download-python-runtime.ts --target=darwin-arm64  # 指定单平台
 *   bun run scripts/download-python-runtime.ts --target=all       # 4 平台全下（CI 缓存预热用）
 *
 * 设计：
 *   - 幂等：目标目录已有 .download-stamp 与当前版本组合一致时跳过
 *   - 校验：每个 asset 都对照官方 SHA256SUMS / <asset>.sha256 校验
 *   - 重试：3 次指数退避 2/4/8s
 *   - 失败：throw 中断，不留半成品
 *
 * 平台/变体策略：
 *   - mac arm64/x64  → install_only（含 debug，约 74/78 MB）
 *   - win32 x64      → install_only（约 167 MB）
 *   - linux x64      → install_only_stripped（避免 libpython.so 单文件超 GitHub 100 MB 上限）
 *
 * uv 区分：mac/linux 用 tar.gz，windows 用 zip
 */

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import * as tar from 'tar'

/** 锁定的版本（升级时改这里 + 同步更新 paths.ts 的 PYTHON_MAJOR_MINOR） */
export const RUNTIME_SPEC = {
  pythonBuildStandaloneTag: '20241016',
  pythonVersion: '3.12.7',
  uvVersion: '0.4.30',
} as const

/** 与 electron-builder.yml 矩阵对齐的支持目标 */
export type SupportedTarget = 'darwin-arm64' | 'darwin-x64' | 'win32-x64' | 'linux-x64'

const ALL_TARGETS: readonly SupportedTarget[] = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']

/** 平台/架构 → 受支持的目标标识 */
export function resolveTargetForPlatform(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): SupportedTarget {
  const key = `${platform}-${arch}`
  switch (key) {
    case 'darwin-arm64': return 'darwin-arm64'
    case 'darwin-x64':   return 'darwin-x64'
    case 'win32-x64':    return 'win32-x64'
    case 'linux-x64':    return 'linux-x64'
    default: throw new Error(`unsupported target: ${key}`)
  }
}

/** PBS 平台三元组与 install variant；linux 用 stripped 避免 GitHub 100MB 单文件上限 */
const PBS_TRIPLE: Record<SupportedTarget, { triple: string; variant: 'install_only' | 'install_only_stripped' }> = {
  'darwin-arm64': { triple: 'aarch64-apple-darwin',           variant: 'install_only' },
  'darwin-x64':   { triple: 'x86_64-apple-darwin',            variant: 'install_only' },
  'win32-x64':    { triple: 'x86_64-pc-windows-msvc-shared',  variant: 'install_only' },
  'linux-x64':    { triple: 'x86_64-unknown-linux-gnu',       variant: 'install_only_stripped' },
}

/** Python tarball 文件名形如 cpython-3.12.7+20241016-<triple>-<variant>.tar.gz */
export function buildPythonAssetUrl(target: SupportedTarget, tag: string, pyVer: string): string {
  const { triple, variant } = PBS_TRIPLE[target]
  const file = `cpython-${pyVer}+${tag}-${triple}-${variant}.tar.gz`
  return `https://github.com/astral-sh/python-build-standalone/releases/download/${tag}/${file}`
}

const UV_TRIPLE: Record<SupportedTarget, { archive: string; ext: 'tar.gz' | 'zip' }> = {
  'darwin-arm64': { archive: 'aarch64-apple-darwin',     ext: 'tar.gz' },
  'darwin-x64':   { archive: 'x86_64-apple-darwin',      ext: 'tar.gz' },
  'win32-x64':    { archive: 'x86_64-pc-windows-msvc',   ext: 'zip' },
  'linux-x64':    { archive: 'x86_64-unknown-linux-gnu', ext: 'tar.gz' },
}

export function buildUvAssetUrl(target: SupportedTarget, ver: string): string {
  const { archive, ext } = UV_TRIPLE[target]
  const file = `uv-${archive}.${ext}`
  return `https://github.com/astral-sh/uv/releases/download/${ver}/${file}`
}

/** Buffer 的 SHA256 hex 摘要 */
export function computeSha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

interface DownloadOptions {
  /** 输出根目录，缺省 apps/electron/resources/python */
  outRoot?: string
  /** 指定 target；'all' = 4 平台全下；undefined = 当前平台 */
  target?: SupportedTarget | 'all'
}

/** 默认输出根 = 项目根/apps/electron/resources/python（不依赖当前工作目录） */
const DEFAULT_OUT_ROOT = join(import.meta.dir, '..', 'apps', 'electron', 'resources', 'python')

/** 主入口：构建期 CI / 本地 prebuild 调用 */
export async function downloadPythonRuntime(options: DownloadOptions = {}): Promise<void> {
  const outRoot = options.outRoot ?? DEFAULT_OUT_ROOT
  const targets: SupportedTarget[] = options.target === 'all'
    ? [...ALL_TARGETS]
    : [options.target ?? resolveTargetForPlatform(process.platform, process.arch)]

  for (const t of targets) {
    await downloadOneTarget(t, outRoot)
  }
}

async function downloadOneTarget(target: SupportedTarget, outRoot: string): Promise<void> {
  const targetDir = join(outRoot, target)
  const stampPath = join(targetDir, '.download-stamp')
  const expectedStamp = JSON.stringify({
    pyTag: RUNTIME_SPEC.pythonBuildStandaloneTag,
    pyVer: RUNTIME_SPEC.pythonVersion,
    pyVariant: PBS_TRIPLE[target].variant,
    uvVer: RUNTIME_SPEC.uvVersion,
  })
  if (existsSync(stampPath) && readFileSync(stampPath, 'utf-8') === expectedStamp) {
    console.log(`[python-runtime] ${target} 已是最新（stamp 命中），跳过`)
    return
  }

  // 清空旧目录避免半成品复用
  if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(targetDir, { recursive: true })

  // 1. Python tarball
  const pyUrl = buildPythonAssetUrl(target, RUNTIME_SPEC.pythonBuildStandaloneTag, RUNTIME_SPEC.pythonVersion)
  console.log(`[python-runtime] 下载 ${pyUrl}`)
  const pyBuf = await downloadWithRetry(pyUrl)
  await verifyChecksum(pyUrl, pyBuf)

  const tmpTarPath = join(targetDir, '.python.tar.gz')
  writeFileSync(tmpTarPath, pyBuf)
  await tar.x({ file: tmpTarPath, cwd: targetDir })
  // PBS 解压根叫 'python'，重命名为 'runtime' 以匹配 paths.ts 约定
  const extractedRoot = join(targetDir, 'python')
  if (existsSync(extractedRoot)) {
    renameSync(extractedRoot, join(targetDir, 'runtime'))
  }
  rmSync(tmpTarPath, { force: true })

  // 2. uv 二进制
  const uvUrl = buildUvAssetUrl(target, RUNTIME_SPEC.uvVersion)
  console.log(`[python-runtime] 下载 ${uvUrl}`)
  const uvBuf = await downloadWithRetry(uvUrl)
  await verifyChecksum(uvUrl, uvBuf)

  const uvExt = UV_TRIPLE[target].ext
  if (uvExt === 'zip') {
    // win32：zip 形态，用 PowerShell Expand-Archive 解压（Windows runner 内置）
    const tmpZip = join(targetDir, '.uv.zip')
    writeFileSync(tmpZip, uvBuf)
    await runCommand('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath "${tmpZip}" -DestinationPath "${targetDir}" -Force`])
    rmSync(tmpZip, { force: true })
  } else {
    const tmpTar = join(targetDir, '.uv.tar.gz')
    writeFileSync(tmpTar, uvBuf)
    await tar.x({ file: tmpTar, cwd: targetDir })
    rmSync(tmpTar, { force: true })
    // tar 解出 uv-<triple>/uv 二进制；移到 targetDir/uv
    const inner = readdirSync(targetDir).find((n) => n.startsWith('uv-'))
    if (inner) {
      renameSync(join(targetDir, inner, 'uv'), join(targetDir, 'uv'))
      rmSync(join(targetDir, inner), { recursive: true, force: true })
    }
  }

  writeFileSync(stampPath, expectedStamp, 'utf-8')
  console.log(`[python-runtime] ${target} 完成`)
}

/** 下载 + 指数退避重试（最多 3 次） */
async function downloadWithRetry(url: string): Promise<Buffer> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      lastErr = err
      const wait = 2000 * 2 ** attempt
      console.warn(`[python-runtime] ${url} 失败（第 ${attempt + 1} 次），${wait}ms 后重试：`, err)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw new Error(`下载失败超过 3 次：${url}：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

/**
 * 校验 SHA256：通过下载同 release 的 SHA256SUMS 文件并查找对应行
 *
 * - PBS：单一 SHA256SUMS 文件汇总所有 asset
 * - uv：每个 asset 单独 <basename>.sha256
 */
async function verifyChecksum(assetUrl: string, buf: Buffer): Promise<void> {
  const sha = computeSha256(buf)
  const sumsUrl = deriveSumsUrl(assetUrl)
  const sumsRes = await fetch(sumsUrl, { redirect: 'follow' })
  if (!sumsRes.ok) {
    throw new Error(`无法下载校验和文件 ${sumsUrl}（HTTP ${sumsRes.status}）`)
  }
  const sumsText = await sumsRes.text()
  const basename = assetUrl.split('/').pop()!
  const line = sumsText.split('\n').find((l) => l.includes(basename)) ?? sumsText.split('\n')[0]!
  const expected = line.trim().split(/\s+/)[0]!.toLowerCase()
  if (expected !== sha) {
    throw new Error(`SHA256 不匹配 ${assetUrl}\n  期望: ${expected}\n  实际: ${sha}`)
  }
}

/** PBS 走 SHA256SUMS 汇总文件；uv 每个 asset 单独 .sha256 */
function deriveSumsUrl(assetUrl: string): string {
  if (assetUrl.includes('astral-sh/python-build-standalone')) {
    return assetUrl.replace(/\/[^/]+$/, '/SHA256SUMS')
  }
  return `${assetUrl}.sha256`
}

/** spawn 一个命令，等待退出码 0；非零 throw */
function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: false })
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`)))
    child.on('error', reject)
  })
}

// ===== CLI 入口 =====
if (import.meta.main) {
  const argTarget = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] as
    | SupportedTarget
    | 'all'
    | undefined
  downloadPythonRuntime({ target: argTarget }).catch((err) => {
    console.error('[python-runtime] 致命错误：', err)
    process.exit(1)
  })
}
