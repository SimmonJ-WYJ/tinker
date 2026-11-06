import { isTinkerCandidate } from '../candidate-profile'
/**
 * Runtime 子树路径常量
 *
 * 4 个内置工具（Node / Git / uv / Python）的根目录是
 * macOS:   ~/Library/Application Support/ASCI/runtimes/
 * Windows: %APPDATA%/ASCI/runtimes/
 *
 * 该路径由 installer 写入；ASCI 主进程只读。dev 模式下由
 * bun run setup:runtimes 脚本写入。
 *
 * 测试隔离：ASCI_RUNTIMES_HOME 环境变量覆盖 base 目录（仅测试用，
 * 真生产不应设置；与 config-paths.ts 的 ASCI_CONFIG_HOME 同模式）。
 */

import { join } from 'node:path'
import { homedir, platform as osPlatform } from 'node:os'

/**
 * 已锁定的 Python 主版本（与 build-runtimes / python/paths.ts 同源）
 *
 * 单源真相点：其它模块需要时统一从这里 import，禁止再写字面量 '3.12'。
 */
export const PYTHON_MAJOR_MINOR = '3.12' as const

/** Windows 下给可执行文件名补 .exe；其它平台原样返回 */
function exeName(bin: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? `${bin}.exe` : bin
}

/** runtimes 根目录的父目录（macOS: ~/Library/Application Support/ASCI/，Windows: %APPDATA%/ASCI/） */
export function getRuntimesParent(): string {
  if (process.env.ASCI_RUNTIMES_HOME) return process.env.ASCI_RUNTIMES_HOME
  const platform = osPlatform()
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', isTinkerCandidate() ? 'Tinker Candidate' : 'ASCI')
  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    return join(appData, 'ASCI')
  }
  // Linux：spec 标注 out of scope，但保留路径以便 typecheck 全平台通过
  return join(homedir(), '.local', 'share', 'asci')
}

export function getRuntimesRoot(): string {
  return join(getRuntimesParent(), 'runtimes')
}

/** runtime stamp 文件名（与 RuntimeBootstrapper 写入的版本号匹配文件） */
export const RUNTIME_STAMP_FILENAME = '.version'

export function getRuntimeStampPath(): string {
  return join(getRuntimesRoot(), RUNTIME_STAMP_FILENAME)
}

/**
 * paper-search Python 包目录（与 runtimes/ 同辈，不在 runtimes/ 内）。
 *
 * 之所以不在 runtimes/ 子树：runtimes/ 由 RuntimeBootstrapper 完全管理，整体 rm + 重拷；
 * paper-search 包目录会创建 .venv（uv run --extra mcp），混在一起会破坏幂等。
 */
export function getPaperSearchPackageDir(): string {
  return join(getRuntimesParent(), 'paper-search-mcp')
}

export function getNodeBinPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return join(getRuntimesRoot(), 'node', exeName('node', platform))
  return join(getRuntimesRoot(), 'node', 'bin', exeName('node', platform))
}

export function getGitBinPath(platform: NodeJS.Platform = process.platform): string {
  return join(getRuntimesRoot(), 'git', 'bin', exeName('git', platform))
}

export function getUvBinPath(platform: NodeJS.Platform = process.platform): string {
  return join(getRuntimesRoot(), exeName('uv', platform))
}

export function getPythonInterpreterPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return join(getRuntimesRoot(), 'python', 'runtime', exeName('python', platform))
  }
  return join(getRuntimesRoot(), 'python', 'runtime', 'bin', `python${PYTHON_MAJOR_MINOR}`)
}

/** 4 个工具 binary 的清单（用于校验时遍历） */
export interface RuntimeBinaryDescriptor {
  name: 'node' | 'git' | 'uv' | 'python'
  path: string
  versionArgs: readonly string[]
}

export function listRuntimeBinaries(
  platform: NodeJS.Platform = process.platform,
): RuntimeBinaryDescriptor[] {
  return [
    { name: 'node', path: getNodeBinPath(platform), versionArgs: ['--version'] },
    { name: 'git', path: getGitBinPath(platform), versionArgs: ['--version'] },
    { name: 'uv', path: getUvBinPath(platform), versionArgs: ['--version'] },
    { name: 'python', path: getPythonInterpreterPath(platform), versionArgs: ['--version'] },
  ]
}
