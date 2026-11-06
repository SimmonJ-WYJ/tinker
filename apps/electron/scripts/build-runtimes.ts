#!/usr/bin/env bun
/**
 * build-runtimes.ts —— 把 4 个内置工具 binary stage 到 dist/runtimes/<platform-arch>/
 *
 * P1 本地版：从 --node / --git / --uv / --python 入参指定的本地路径拷贝。
 * P3 manifest 版：从 --from-manifest <manifest.json> 读取官方 URL + SHA256，下载验证后 stage。
 *
 * 用法（本地）：
 *   bun run build:runtimes -- \
 *     --node /opt/homebrew/bin/node \
 *     --git /Library/Developer/CommandLineTools/usr/bin/git \
 *     --uv ~/Library/Application\ Support/ASCI-dev/bundles/python/uv \
 *     --python ~/Library/Application\ Support/ASCI-dev/bundles/python/runtime/bin/python3.12
 *
 * 用法（manifest，适用于 CI）：
 *   bun run build:runtimes -- --from-manifest scripts/runtimes-manifest.json
 *
 *   产出：apps/electron/dist/runtimes/<platform-arch>/{node, git, uv, python}/
 *
 * 注意：--python 可以指向 runtime/bin/python3.12，脚本会自动向上找到
 *       runtime/ 根目录并整目录拷贝，以保留 @executable_path 相对 dylib 引用。
 */

import {
  mkdirSync,
  copyFileSync,
  chmodSync,
  existsSync,
  rmSync,
  readlinkSync,
  lstatSync,
  cpSync,
  readFileSync,
  readdirSync,
  createWriteStream,
  createReadStream,
} from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { PYTHON_MAJOR_MINOR } from '../src/main/lib/runtime/paths.ts'
import { getCurrentPlatformArch } from '@asci/shared'
import { parseKebabArgs } from './_argv.ts'

// ──────────────────────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────────────────────

interface Args {
  node?: string
  git?: string
  uv?: string
  python?: string
  outDir?: string
  /** --from-manifest <path>：manifest 模式（CI 可用） */
  fromManifest?: string
}

/** manifest.json 中单个工具的条目 */
interface ToolEntry {
  url: string
  sha256: string
  /**
   * - tar.gz / tar.xz：tar 解压（mac/linux 通用，Win 自带 bsdtar 也支持）
   * - zip：Win 走 .NET ZipFile，*nix 走 unzip
   * - exe-7z：7-Zip 自解压（PortableGit 用），仅 Win 上能跑
   */
  extract: 'tar.gz' | 'tar.xz' | 'zip' | 'exe-7z'
  /** 单 binary 工具（node/uv 或 mac 单文件 git）：提取树内 binary 相对路径 */
  binSubpath?: string
  /**
   * 整 runtime 树（python / Win PortableGit）：提取树内 runtime 根目录相对路径。
   * 空字符串 ('') 表示 extractDir 根本身就是 runtime 树（PortableGit 自解压情形）。
   */
  runtimeSubpath?: string
  /**
   * stage 后裁剪的相对路径列表（相对 stage 后的工具根目录）。
   * 用途：PortableGit 自带 vim / 文档 / 时区库等 git 用不上的内容（5000+ 文件），
   * 不裁剪会让 NSIS 装包阶段段错误（NSIS 3.0.4.1 处理 9000+ 小文件不稳定）。
   * 列表里某项不存在不算错，静默跳过。
   */
  prunePaths?: string[]
}

/** runtimes-manifest.json 顶层结构 */
interface RuntimesManifest {
  node: Record<string, ToolEntry | null>
  git: Record<string, ToolEntry | null>
  uv: Record<string, ToolEntry | null>
  python: Record<string, ToolEntry | null>
}

// ──────────────────────────────────────────────────────────────
// 通用工具函数
// ──────────────────────────────────────────────────────────────

// parseArgs 已抽到 scripts/_argv.ts 共用

// platformArch 直接复用 shared 的 getCurrentPlatformArch（同源真相）

function defaultOutDir(): string {
  // apps/electron/dist/runtimes/<platform-arch>/
  return resolve(import.meta.dir, '..', 'dist', 'runtimes', getCurrentPlatformArch())
}

/**
 * Windows 下给可执行文件名补 .exe；其它平台原样返回。
 * 与 src/main/lib/runtime/paths.ts 内部的 exeName 同语义；脚本在 monorepo 里独立运行
 * 不能跨包 import，这里保留一份（同语义、跟着 paths.ts 一起改）。
 */
function exeName(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name
}

/** 解 symlink（如果是的话），返回真实文件路径 */
function resolveRealPath(src: string): string {
  try {
    const lst = lstatSync(src)
    if (lst.isSymbolicLink()) {
      const target = readlinkSync(src)
      // readlink 可能返回相对路径，需 resolve 到绝对路径
      return resolve(dirname(src), target)
    }
  } catch {
    // 沿用原路径
  }
  return src
}

/** 拷贝单个 binary 到目标目录，并 chmod +x */
function copyBin(src: string, destDir: string, destName: string): void {
  if (!existsSync(src)) {
    throw new Error(`源文件不存在: ${src}`)
  }
  mkdirSync(destDir, { recursive: true })
  const destPath = join(destDir, destName)
  const realSrc = resolveRealPath(src)
  copyFileSync(realSrc, destPath)
  if (process.platform !== 'win32') chmodSync(destPath, 0o755)
}

/**
 * 找到 python binary 所在的 runtime 根目录。
 * 接受两种形式：
 *  1. 指向 runtime/bin/python3.12 binary（向上回溯两级到 runtime/）
 *  2. 直接指向 runtime 根目录（包含 bin/ 子目录）
 * 如果找不到合适的根目录则返回 undefined（退化为单文件拷贝）。
 */
function findPythonRuntimeRoot(pythonBin: string): string | undefined {
  const binDir = dirname(pythonBin)
  const binDirName = basename(binDir)
  // 形式 1：.../runtime/bin/python3.12 → binDir 是 .../runtime/bin
  if (binDirName === 'bin') {
    const runtimeRoot = dirname(binDir)
    if (existsSync(join(runtimeRoot, 'bin'))) return runtimeRoot
  }
  // 形式 2：pythonBin 本身就在 runtime/ 下（Windows python.exe）
  if (existsSync(join(binDir, 'bin'))) {
    return binDir
  }
  return undefined
}

/** 执行外部命令，失败时抛异常 */
function spawnOk(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.status !== 0) {
    throw new Error(`命令失败: ${cmd} ${args.join(' ')} (exit=${r.status})`)
  }
}

// ──────────────────────────────────────────────────────────────
// manifest 模式专用函数
// ──────────────────────────────────────────────────────────────

/** 计算文件 SHA256 */
async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/**
 * 下载 URL 到本地文件，并验证 SHA256。
 * 若 destFile 已存在且 SHA256 匹配，则跳过下载（cache hit）。
 */
async function downloadAndVerify(url: string, expectedSha: string, destFile: string): Promise<void> {
  // 缓存命中检查：文件已存在且 SHA 匹配 → 跳过
  if (existsSync(destFile)) {
    try {
      const cachedSha = await fileSha256(destFile)
      if (cachedSha === expectedSha) {
        console.log(`  ✓ 缓存命中，跳过下载: ${basename(destFile)}`)
        return
      }
      console.log(`  ⚠️  缓存 SHA 不匹配，重新下载`)
      rmSync(destFile, { force: true })
    } catch {
      rmSync(destFile, { force: true })
    }
  }

  console.log(`  ↓ ${url}`)
  const resp = await fetch(url)
  if (!resp.ok || !resp.body) throw new Error(`下载失败 HTTP ${resp.status}: ${url}`)
  // 将响应流写入文件
  await pipeline(resp.body as unknown as NodeJS.ReadableStream, createWriteStream(destFile))

  // 计算文件 SHA256 并与期望值对比
  const actualSha = await fileSha256(destFile)
  if (actualSha !== expectedSha) {
    throw new Error(`SHA256 不匹配\n  url: ${url}\n  expected: ${expectedSha}\n  actual:   ${actualSha}`)
  }
  console.log(`  ✓ SHA256 验证通过`)
}

/** 解压归档文件到目标目录 */
function extractArchive(archive: string, destDir: string, kind: ToolEntry['extract']): void {
  mkdirSync(destDir, { recursive: true })
  if (kind === 'tar.gz') {
    // tar 在 Win10 1803+ 自带（bsdtar）；macOS / Linux 自带 GNU tar
    spawnOk('tar', ['-xzf', archive, '-C', destDir])
  } else if (kind === 'tar.xz') {
    spawnOk('tar', ['-xJf', archive, '-C', destDir])
  } else if (kind === 'zip') {
    if (process.platform === 'win32') {
      // Win10 默认无 unzip，走自带 PowerShell。
      // 直接用 .NET 的 ZipFile.ExtractToDirectory，跳过 Expand-Archive 在
      // 非交互 / SSH 会话里 Write-Progress 触发 "Access is denied" 0x5 的坑。
      const escaped = (s: string) => s.replace(/'/g, "''")
      spawnOk('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        `$ProgressPreference='SilentlyContinue'; ` +
          `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
          `[System.IO.Compression.ZipFile]::ExtractToDirectory('${escaped(archive)}', '${escaped(destDir)}')`,
      ])
    } else {
      spawnOk('unzip', ['-q', archive, '-d', destDir])
    }
  } else if (kind === 'exe-7z') {
    if (process.platform !== 'win32') {
      throw new Error(`exe-7z 自解压（PortableGit）仅在 Windows 上能跑（当前: ${process.platform}）`)
    }
    // 7-Zip 自解压 .exe 约定：<archive>.exe -y -o<destDir>
    // 注意：-y 跳过所有 prompt；-o 后必须紧跟路径无空格、且路径不带引号。
    spawnOk(archive, ['-y', `-o${destDir}`])
  } else {
    throw new Error(`未知的 extract 类型: ${kind}`)
  }
}

/**
 * 判断某工具是否已 stage 完成。
 * 检查 stage 后的关键 binary 是否存在；存在即视为 cache hit，可跳过整个处理流程。
 */
function isToolStaged(tool: 'node' | 'git' | 'uv' | 'python', outDir: string): boolean {
  if (tool === 'node') {
    const bin = process.platform === 'win32'
      ? join(outDir, 'node', 'node.exe')
      : join(outDir, 'node', 'bin', 'node')
    return existsSync(bin)
  }
  if (tool === 'git') {
    return existsSync(join(outDir, 'git', 'bin', exeName('git')))
  }
  if (tool === 'uv') {
    return existsSync(join(outDir, exeName('uv')))
  }
  if (tool === 'python') {
    const bin = process.platform === 'win32'
      ? join(outDir, 'python', 'runtime', 'python.exe')
      : join(outDir, 'python', 'runtime', 'bin', `python${PYTHON_MAJOR_MINOR}`)
    return existsSync(bin)
  }
  return false
}

/**
 * manifest 模式主流程：
 * 读取 manifest.json → 按当前 platform-arch 查找条目 → 下载验证解压 → 按规定布局 stage。
 * 返回被跳过（null 条目或已 stage）的工具列表，供上层 smoke 测试使用。
 *
 * 缓存策略：
 *  - 归档缓存：sibling 目录 `<dist>/runtimes-archive-cache/`，按 SHA256 命名，跨构建复用。
 *  - Stage 缓存：若工具已 stage（关键 binary 存在），跳过整个处理流程（含下载 + 解压）。
 */
async function runFromManifest(manifestPath: string, outDir: string): Promise<Set<string>> {
  const manifestText = readFileSync(manifestPath, 'utf-8')
  const manifest = JSON.parse(manifestText) as RuntimesManifest
  const key = getCurrentPlatformArch() // e.g. 'darwin-arm64'

  // Fail-fast：node 是 orchestrator/getAgentExecutable 的硬依赖，
  // 任何目标平台 node 缺失都意味着包出来 Agent 不可用——这种情况绝不能产空目录然后静默成功。
  // 历史踩坑：v0.1.95 win32-x64 全部 null，build 出空 dist/runtimes/win32-x64/，
  // 装机后 RuntimeBootstrapper 报 RESOURCES_MISSING，UI 端表现为发消息无回复。
  if (manifest.node?.[key] === null || manifest.node?.[key] === undefined) {
    throw new Error(
      `runtimes-manifest.json 在 ${key} 上缺 node 条目（node 是 RuntimeProvisioner 的硬依赖）。\n` +
      `请补全条目或显式不构建该平台；不允许产出空 runtime 目录。`,
    )
  }

  // 不再无脑清空 outDir，保留已 stage 的工具以触发 cache hit。
  mkdirSync(outDir, { recursive: true })

  // 跨构建复用的归档缓存目录（按 SHA256 命名）
  const archiveCacheDir = resolve(outDir, '..', 'runtimes-archive-cache')
  mkdirSync(archiveCacheDir, { recursive: true })

  // 临时工作目录，仅用于解压（解压完即可清理）
  const stagingDir = join(tmpdir(), `asci-build-runtimes-${Date.now()}`)
  mkdirSync(stagingDir, { recursive: true })

  const skippedTools = new Set<string>()
  let stagedCount = 0

  try {
    for (const tool of ['node', 'git', 'uv', 'python'] as const) {
      const entry = manifest[tool]?.[key]
      if (!entry) {
        // null 条目 → 跳过（不 stage 也不 fallback）
        // 例如 macOS 不 bundle git，RuntimeProvisioner 会用系统 /usr/bin/git
        console.log(`⏭️  ${tool}@${key} 在 manifest 中为 null，跳过`)
        skippedTools.add(tool)
        continue
      }

      // Stage 缓存命中：整个工具已 stage，跳过下载 + 解压 + 摆放
      if (isToolStaged(tool, outDir)) {
        console.log(`✓ ${tool}@${key} 已 stage（缓存命中），跳过`)
        stagedCount++
        continue
      }

      console.log(`📦 处理 ${tool}@${key}`)
      // 清理可能残留的旧子树（前次构建失败导致的 partial stage），避免文件合并污染
      const toolSubdir =
        tool === 'uv' ? join(outDir, exeName('uv')) : join(outDir, tool)
      if (existsSync(toolSubdir)) rmSync(toolSubdir, { recursive: true, force: true })

      // 归档文件扩展名（exe-7z 的实文件就是 .exe 自解压器，扩展名必须是 .exe
      // 才能在 Win 上被 CreateProcess 识别为可执行；用 extract 直接当扩展名会
      // 造出 <sha>.exe-7z，spawn 立即失败、exit=undefined）
      const archiveExt =
        entry.extract === 'zip' ? 'zip' :
        entry.extract === 'exe-7z' ? 'exe' :
        entry.extract
      // 归档放进持久化缓存目录，按 SHA256 命名以便跨构建复用
      const archivePath = join(archiveCacheDir, `${entry.sha256}.${archiveExt}`)

      // 下载并校验（若缓存命中会自动跳过下载）
      await downloadAndVerify(entry.url, entry.sha256, archivePath)

      // 解压到独立子目录
      const extractDir = join(stagingDir, `${tool}-extracted`)
      console.log(`  📂 解压归档...`)
      extractArchive(archivePath, extractDir, entry.extract)

      // 按目标布局摆放（与 paths.ts 的 getNodeBinPath / runFromLocal 同源真相）
      if (tool === 'node') {
        // mac tarball: node-vX.Y.Z-darwin-arm64/bin/node → dist/runtimes/<>/node/bin/node
        // win zip:    node-vX.Y.Z-win-x64/node.exe       → dist/runtimes/<>/node/node.exe
        if (!entry.binSubpath) throw new Error('node 条目缺 binSubpath')
        const srcBin = join(extractDir, entry.binSubpath)
        if (process.platform === 'win32') {
          mkdirSync(join(outDir, 'node'), { recursive: true })
          copyFileSync(srcBin, join(outDir, 'node', 'node.exe'))
        } else {
          mkdirSync(join(outDir, 'node', 'bin'), { recursive: true })
          copyFileSync(srcBin, join(outDir, 'node', 'bin', 'node'))
          chmodSync(join(outDir, 'node', 'bin', 'node'), 0o755)
        }
      } else if (tool === 'git') {
        // 两种形态：
        //   A) 单 binary（mac 历史 / 自定义 hermetic git）：binSubpath 指向 git binary
        //   B) 整树（Win PortableGit）：runtimeSubpath 指向 git 根（''=extractDir 本身）；
        //      git.exe 不能脱离 mingw64/、libexec/、share/git-core/templates/ 等同级目录单独运行
        // 目标：dist/runtimes/<>/git/...，paths.ts:getGitBinPath() 从这里取 bin/git(.exe)
        if (entry.runtimeSubpath !== undefined) {
          const srcRuntime = entry.runtimeSubpath
            ? join(extractDir, entry.runtimeSubpath)
            : extractDir
          const destGit = join(outDir, 'git')
          if (existsSync(destGit)) rmSync(destGit, { recursive: true, force: true })
          mkdirSync(outDir, { recursive: true })
          cpSync(srcRuntime, destGit, { recursive: true })
        } else if (entry.binSubpath) {
          const srcBin = join(extractDir, entry.binSubpath)
          mkdirSync(join(outDir, 'git', 'bin'), { recursive: true })
          copyFileSync(srcBin, join(outDir, 'git', 'bin', exeName('git')))
          if (process.platform !== 'win32') chmodSync(join(outDir, 'git', 'bin', exeName('git')), 0o755)
        } else {
          throw new Error('git 条目需要 binSubpath（单 binary）或 runtimeSubpath（整树）二选一')
        }
      } else if (tool === 'uv') {
        // uv：单个 binary
        // 目标：dist/runtimes/<>/uv(.exe)
        if (!entry.binSubpath) throw new Error('uv 条目缺 binSubpath')
        const srcBin = join(extractDir, entry.binSubpath)
        copyFileSync(srcBin, join(outDir, exeName('uv')))
        if (process.platform !== 'win32') chmodSync(join(outDir, exeName('uv')), 0o755)
      } else if (tool === 'python') {
        // python-build-standalone tarball 内有完整 python/<bin,lib,include> 树
        // runtimeSubpath 指向那个 'python' 目录
        // 目标：dist/runtimes/<>/python/runtime/
        if (!entry.runtimeSubpath) throw new Error('python 条目缺 runtimeSubpath')
        const srcRuntime = join(extractDir, entry.runtimeSubpath)
        const destRuntime = join(outDir, 'python', 'runtime')
        mkdirSync(join(outDir, 'python'), { recursive: true })
        cpSync(srcRuntime, destRuntime, { recursive: true })
        if (process.platform !== 'win32') {
          spawnOk('chmod', ['-R', '755', join(destRuntime, 'bin')])
        }
      }

      // stage 后裁剪（PortableGit 自带 vim / docs / zoneinfo 等 git 用不上的部分，
      // 不裁会让 NSIS 装包段错误：9500+ 文件超出 NSIS 3.0.4.1 的稳定区间）
      if (entry.prunePaths && entry.prunePaths.length > 0) {
        // uv 的 stage 根是 outDir 本身（单 binary 直接放在 outDir/uv），其它工具的根是 outDir/<tool>
        const stageRoot = tool === 'uv' ? outDir : join(outDir, tool)
        let prunedCount = 0
        let prunedFiles = 0
        for (const rel of entry.prunePaths) {
          const target = join(stageRoot, rel)
          if (!existsSync(target)) continue
          // 统计被删的文件数（用于日志，看裁剪效果）
          try {
            const fileCount = readdirSync(target, { recursive: true }).length
            prunedFiles += fileCount
          } catch { /* ignore */ }
          rmSync(target, { recursive: true, force: true })
          prunedCount++
        }
        console.log(`  🪒 已裁剪 ${prunedCount}/${entry.prunePaths.length} 个路径，约 ${prunedFiles} 个 entry`)
      }

      stagedCount++
      console.log(`  ✅ ${tool} 已 stage`)
    }
  } finally {
    // 无论成功失败都清理临时文件
    rmSync(stagingDir, { recursive: true, force: true })
  }

  console.log(`\n✅ 已 stage ${stagedCount} 个工具到 ${outDir}`)
  return skippedTools
}

// ──────────────────────────────────────────────────────────────
// 本地模式流程（P1 原有逻辑，提取为独立函数）
// ──────────────────────────────────────────────────────────────

function runFromLocal(args: Required<Pick<Args, 'node' | 'git' | 'uv' | 'python'>>, outDir: string): void {
  // 清空旧产物
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  // Node：runtimes/node/bin/node 或 runtimes/node/node.exe
  if (process.platform === 'win32') {
    copyBin(args.node, join(outDir, 'node'), 'node.exe')
  } else {
    copyBin(args.node, join(outDir, 'node', 'bin'), 'node')
  }

  // Git：runtimes/git/bin/git(.exe)
  copyBin(args.git, join(outDir, 'git', 'bin'), exeName('git'))

  // uv：runtimes/uv(.exe)
  copyBin(args.uv, outDir, exeName('uv'))

  // Python：尝试拷贝整个 runtime 目录树（保留 dylib 相对路径）；
  // 如无法识别 runtime 根目录则退化为单文件拷贝。
  const pythonRuntimeRoot = findPythonRuntimeRoot(args.python)

  if (pythonRuntimeRoot) {
    const destRuntime = join(outDir, 'python', 'runtime')
    mkdirSync(join(outDir, 'python'), { recursive: true })
    cpSync(pythonRuntimeRoot, destRuntime, { recursive: true })
    if (process.platform !== 'win32') {
      execFileSync('chmod', ['-R', '755', join(destRuntime, 'bin')], { stdio: 'ignore' })
    }
  } else {
    if (process.platform === 'win32') {
      copyBin(args.python, join(outDir, 'python', 'runtime'), 'python.exe')
    } else {
      copyBin(args.python, join(outDir, 'python', 'runtime', 'bin'), `python${PYTHON_MAJOR_MINOR}`)
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 烟测
// ──────────────────────────────────────────────────────────────

/**
 * 对已 stage 的 binary 跑 --version 烟测。
 * skippedTools：manifest 模式中被跳过（null 条目）的工具名集合；
 *               本地模式传入空 Set（所有工具都必须存在）。
 */
function runSmokeTests(outDir: string, skippedTools: Set<string>): void {
  const stagedPythonBin =
    process.platform === 'win32'
      ? join(outDir, 'python', 'runtime', 'python.exe')
      : join(outDir, 'python', 'runtime', 'bin', `python${PYTHON_MAJOR_MINOR}`)

  const checks: Array<[string, string, string[]]> = [
    ['node', join(outDir, 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node'), ['--version']],
    ['git', join(outDir, 'git', 'bin', exeName('git')), ['--version']],
    ['uv', join(outDir, exeName('uv')), ['--version']],
    ['python', stagedPythonBin, ['--version']],
  ]

  // Windows runner 首次扫描刚解压的 .exe（Defender real-time scan）会让 spawn
  // 启动慢到几十秒；5s timeout 命中过 ETIMEDOUT。这里抬 timeout 并加 3 次重试。
  const SMOKE_TIMEOUT_MS = 30000
  const SMOKE_MAX_ATTEMPTS = 3
  const SMOKE_RETRY_DELAY_MS = 2000

  for (const [toolName, bin, vargs] of checks) {
    // 跳过 manifest 中为 null 的工具，或 binary 根本不存在的工具
    if (skippedTools.has(toolName)) {
      console.log(`⏭️  跳过烟测: ${toolName}（manifest 中为 null）`)
      continue
    }
    if (!existsSync(bin)) {
      console.log(`⏭️  跳过烟测: ${toolName}（binary 不存在: ${bin}）`)
      continue
    }

    let lastErr: unknown
    let passed = false
    for (let attempt = 1; attempt <= SMOKE_MAX_ATTEMPTS; attempt++) {
      try {
        execFileSync(bin, vargs, { stdio: 'ignore', timeout: SMOKE_TIMEOUT_MS })
        console.log(`  ✓ 烟测通过: ${toolName}${attempt > 1 ? ` (attempt ${attempt})` : ''}`)
        passed = true
        break
      } catch (err) {
        lastErr = err
        const msg = err instanceof Error ? err.message : String(err)
        if (attempt < SMOKE_MAX_ATTEMPTS) {
          console.warn(`  ⚠ 烟测失败 (attempt ${attempt}/${SMOKE_MAX_ATTEMPTS}): ${toolName} → ${msg}，${SMOKE_RETRY_DELAY_MS}ms 后重试`)
          // 同步阻塞 2s（runSmokeTests 是 sync 调用链，不引入 async 改造）
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SMOKE_RETRY_DELAY_MS)
        }
      }
    }
    if (!passed) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
      console.error(`烟测失败: ${bin} ${vargs.join(' ')} → ${msg}（${SMOKE_MAX_ATTEMPTS} 次重试后仍失败）`)
      process.exit(1)
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 入口
// ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseKebabArgs<Args>(process.argv.slice(2))
  const outDir = args.outDir ?? defaultOutDir()

  let skippedTools = new Set<string>()

  if (args.fromManifest) {
    // manifest 模式（CI 可用）：下载 → 校验 → 解压 → stage
    const manifestPath = resolve(args.fromManifest)
    if (!existsSync(manifestPath)) {
      console.error(`manifest 文件不存在: ${manifestPath}`)
      process.exit(2)
    }
    skippedTools = await runFromManifest(manifestPath, outDir)
  } else {
    // 本地模式（P1）：从本地路径拷贝
    if (!args.node || !args.git || !args.uv || !args.python) {
      console.error('用法（本地）：bun run build:runtimes -- --node <path> --git <path> --uv <path> --python <path>')
      console.error('用法（manifest）：bun run build:runtimes -- --from-manifest <manifest.json>')
      process.exit(2)
    }
    runFromLocal(
      { node: args.node, git: args.git, uv: args.uv, python: args.python },
      outDir,
    )
  }

  // 两种模式共用烟测
  runSmokeTests(outDir, skippedTools)
}

main()
