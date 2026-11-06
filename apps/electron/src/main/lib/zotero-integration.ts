/**
 * Zotero 集成管理器（主进程）
 *
 * 职责：
 * 1. 探测 Zotero 是否安装（各平台常见路径）
 * 2. 启动 Zotero 桌面版
 * 3. （Task 12 后续扩展）管理工作区 mcp.json 中的 zotero server 条目
 */

import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, basename, dirname } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import type { ZoteroInstallStatus, ZoteroLaunchResult, ZoteroValidatePathResult } from '@asci/shared'
import { getSettings } from './settings-service.ts'

// macOS 上 Zotero 桌面版的 Bundle Identifier。
// 通过 LaunchServices（`open -b`）寻址，无需依赖具体安装路径。
const ZOTERO_MACOS_BUNDLE_ID = 'org.zotero.zotero'

// macOS 常见安装路径（系统级 + 用户级 + Setapp）
const MACOS_CANDIDATES = [
  '/Applications/Zotero.app',
  `${homedir()}/Applications/Zotero.app`,
  `${homedir()}/Applications/Setapp/Zotero.app`,
  '/Applications/Setapp/Zotero.app',
]

// Windows 常见安装路径
const WINDOWS_CANDIDATES = [
  `${process.env.ProgramFiles ?? 'C:\\Program Files'}\\Zotero\\zotero.exe`,
  `${process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'}\\Zotero\\zotero.exe`,
  `${process.env.LOCALAPPDATA ?? ''}\\Zotero\\zotero.exe`,
]

/**
 * 在 PATH 中查找 zotero.exe（Windows 自定义 prefix 安装兜底）。
 * macOS 走 LaunchServices Bundle ID 寻址；Linux 不在支持范围内。
 */
function findInPath(): string | null {
  if (process.platform !== 'win32') return null
  const PATH = process.env.PATH
  if (!PATH) return null
  for (const dir of PATH.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, 'zotero.exe')
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate
      }
    } catch {
      // 忽略权限错误，继续扫
    }
  }
  return null
}

/**
 * 探测当前平台上 Zotero 是否已安装
 *
 * 优先级：
 * 1. settings.zoteroInstallPath（用户手动配置，存在性校验后命中）
 * 2. 平台常见目录（仅支持 macOS / Windows）
 * 3. PATH 环境变量（仅 Windows）
 *
 * macOS 即使本函数返回 installed=false，`launchZotero` 仍可能通过
 * LaunchServices Bundle ID 启动成功 —— UI 仅用于提示是否需要手动配置。
 * Linux 不在支持范围；返回 installed=false，需用户手动指定 zoteroInstallPath。
 */
export function detectZoteroInstalled(): ZoteroInstallStatus {
  const customPath = getSettings().zoteroInstallPath?.trim()
  if (customPath && existsSync(customPath)) {
    return { installed: true, installedPath: customPath, source: 'custom' }
  }

  const candidates =
    process.platform === 'darwin' ? MACOS_CANDIDATES
    : process.platform === 'win32' ? WINDOWS_CANDIDATES
    : []

  for (const path of candidates) {
    if (path && existsSync(path)) {
      return { installed: true, installedPath: path, source: 'default' }
    }
  }

  // Windows 上扫 PATH 兜底；macOS 走 Bundle ID 无需 PATH；Linux 不支持
  if (process.platform === 'win32') {
    const fromPath = findInPath()
    if (fromPath) {
      return { installed: true, installedPath: fromPath, source: 'path' }
    }
  }

  return { installed: false }
}

/**
 * 校验用户在 UI 里选择的路径是否是有效的 Zotero 可执行文件 / Bundle。
 *
 * 归一化规则：
 * - macOS：传入 .app 目录或 .app/Contents/MacOS/zotero 都收敛到 .app
 * - Windows：传入 zotero.exe 文件路径
 *
 * 仅做存在性 + 文件名 + 父目录匹配，不做签名校验 —— 用户主动指定路径即代表认可。
 * Linux 不在支持范围：直接返回 platform-mismatch。
 */
export function validateZoteroPath(input: string): ZoteroValidatePathResult {
  const path = input?.trim()
  if (!path) return { valid: false, reason: 'not-exists' }
  if (!existsSync(path)) return { valid: false, reason: 'not-exists' }

  if (process.platform === 'darwin') {
    let normalized = path
    if (/\/Contents\/MacOS\/[Zz]otero$/.test(path)) {
      normalized = path.replace(/\/Contents\/MacOS\/[Zz]otero$/, '')
    }
    if (!normalized.endsWith('.app')) {
      return { valid: false, reason: 'not-a-zotero-binary' }
    }
    if (!/zotero/i.test(basename(normalized))) {
      return { valid: false, reason: 'not-a-zotero-binary' }
    }
    const macBin = join(normalized, 'Contents', 'MacOS', 'zotero')
    const macBinCap = join(normalized, 'Contents', 'MacOS', 'Zotero')
    if (!existsSync(macBin) && !existsSync(macBinCap)) {
      return { valid: false, reason: 'not-a-zotero-binary' }
    }
    return { valid: true, normalizedPath: normalized }
  }

  if (process.platform !== 'win32') {
    return { valid: false, reason: 'platform-mismatch' }
  }

  try {
    if (!statSync(path).isFile()) {
      return { valid: false, reason: 'not-a-zotero-binary' }
    }
  } catch {
    return { valid: false, reason: 'not-exists' }
  }

  const name = basename(path).toLowerCase()
  if (name !== 'zotero.exe') {
    if (!name.endsWith('.exe')) {
      return { valid: false, reason: 'platform-mismatch' }
    }
    return { valid: false, reason: 'not-a-zotero-binary' }
  }
  const parent = basename(dirname(path)).toLowerCase()
  if (!parent.includes('zotero') && !path.toLowerCase().includes('zotero')) {
    return { valid: false, reason: 'not-a-zotero-binary' }
  }
  return { valid: true, normalizedPath: path }
}

/**
 * 等待子进程结束并返回 exit code；spawn 阶段就抛错则 resolve null。
 * 用于需要确认启动器（如 macOS `open`）实际成败的场景。
 */
function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (code: number | null): void => {
      if (settled) return
      settled = true
      child.removeAllListeners('error')
      child.removeAllListeners('exit')
      resolve(code)
    }
    child.once('error', () => done(null))
    child.once('exit', (code) => done(code))
  })
}

/**
 * 等到 spawn 事件触发后立即返回；error 事件返回错误信息。
 * 用于 detached + unref 启动：我们无法等到目标进程结束，但能确认 spawn 自身没失败。
 */
function waitForSpawn(child: ChildProcess): Promise<{ ok: true } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    let settled = false
    const done = (r: { ok: true } | { ok: false; message: string }): void => {
      if (settled) return
      settled = true
      child.removeAllListeners('error')
      child.removeAllListeners('spawn')
      resolve(r)
    }
    child.once('error', (err) => done({ ok: false, message: err.message }))
    child.once('spawn', () => done({ ok: true }))
  })
}

/**
 * 启动 Zotero 桌面版
 *
 * 优先级：
 * 1. macOS：先用 LaunchServices（`open -b <bundleId>`）寻址 —— 不依赖具体安装路径，
 *    Zotero 装在 /Applications、~/Applications、Setapp、自定义子目录都能命中。
 *    `open` 是同步等到 LaunchServices 收到请求才退出，能用 exit code 判断成败。
 * 2. 任意平台：回退到 `detectZoteroInstalled` + 路径 spawn；spawn 用 'spawn'/'error'
 *    事件捕获真实成败，避免 `unref()` 静默吞错。
 */
export async function launchZotero(installedPath?: string): Promise<ZoteroLaunchResult> {
  // macOS 优先走 LaunchServices（即使 detect 找不到路径也能成功）
  if (process.platform === 'darwin' && !installedPath) {
    try {
      const child = spawn('open', ['-b', ZOTERO_MACOS_BUNDLE_ID], { stdio: 'ignore' })
      const code = await waitForExit(child)
      if (code === 0) return { success: true }
      // 非 0：LaunchServices 没找到 Bundle ID，落到路径回退
    } catch {
      // 落到路径回退
    }
  }

  const status = installedPath
    ? { installed: true, installedPath }
    : detectZoteroInstalled()

  if (!status.installed || !status.installedPath) {
    return { success: false, message: '未检测到 Zotero 桌面版，请先安装' }
  }

  try {
    const child = process.platform === 'darwin'
      ? spawn('open', ['-a', status.installedPath], { detached: true, stdio: 'ignore' })
      : spawn(status.installedPath, [], { detached: true, stdio: 'ignore' })
    const result = await waitForSpawn(child)
    if (!result.ok) {
      return { success: false, message: `启动失败: ${result.message}` }
    }
    child.unref()
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误'
    return { success: false, message: `启动失败: ${message}` }
  }
}

// ===== 资源路径工具 =====

/**
 * 返回 resources 根目录。
 *
 * 新版 build:resources 将 MCP bundle 和运行时资产写入 dist/resources。
 * 开发期保留旧 resources/ 回退，方便迁移期未运行 build:resources 的本地环境。
 */
function getResourceCandidates(): string[] {
  // 延迟导入避免在测试环境（非 Electron 进程）中崩溃
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron')
  const appPath = app.getAppPath()
  return app.isPackaged
    ? [
        join(appPath, 'dist', 'resources'),
        process.resourcesPath,
        join(appPath, 'resources'),
      ]
    : [
        join(appPath, 'dist', 'resources'),
        join(appPath, 'resources'),
      ]
}

function getResourcePath(...parts: string[]): string {
  const candidates = getResourceCandidates()
  for (const base of candidates) {
    const path = join(base, ...parts)
    if (existsSync(path)) return path
  }
  return join(candidates[candidates.length - 1]!, ...parts)
}

export function getZoteroServerCjsPath(): string {
  return getResourcePath('zotero-mcp', 'server.cjs')
}

export function getOcrServerCjsPath(): string {
  return getResourcePath('ocr-mcp', 'server.cjs')
}

export function getAsrServerCjsPath(): string {
  return getResourcePath('asr-mcp', 'server.cjs')
}

