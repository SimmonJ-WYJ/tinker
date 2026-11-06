/**
 * Git 运行时检测模块
 *
 * 通过 RuntimeProvisioner 获取捆绑 Git 的绝对路径，
 * 然后执行 --version 获取版本号供 UI 展示。
 * 不再搜索系统 PATH。
 */

import { execSync, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import type { GitRuntimeStatus, GitRepoStatus } from '@asci/shared'
import { getRuntimeProvisioner } from './runtime/runtime-provisioner.ts'
import { detectBundledTool } from './runtime/detect-bundled-tool.ts'

/**
 * 检测 Git 运行时状态
 *
 * 向 RuntimeProvisioner 查询捆绑 Git 路径；
 * 若 RuntimeProvisioner 未初始化或尚未就绪，返回 available: false。
 */
export async function detectGitRuntime(): Promise<GitRuntimeStatus> {
  return detectBundledTool({
    toolName: 'git',
    getBin: (rp) => rp.getGitBin(),
    parseVersion: (stdout) => stdout.match(/git version (\S+)/)?.[1] ?? null,
  })
}

/**
 * 执行 Git 命令
 *
 * @param gitBin - Git 可执行路径
 * @param args - Git 命令参数
 * @param cwd - 工作目录
 * @returns 命令输出，如果失败返回 null
 */
function runGitCommand(gitBin: string, args: string[], cwd: string): string | null {
  try {
    const result = spawnSync(gitBin, args, {
      cwd,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // 禁止 Git 提示输入
        GIT_TERMINAL_PROMPT: '0',
      },
    })

    if (result.status === 0) {
      return result.stdout.trim()
    }
  } catch {
    // 命令执行失败
  }

  return null
}

/**
 * 获取指定目录的 Git 仓库状态
 *
 * @param dirPath - 目录路径
 * @returns Git 仓库状态，如果不是 Git 仓库或出错返回 null
 */
export async function getGitRepoStatus(dirPath: string): Promise<GitRepoStatus | null> {
  // 检查目录是否存在
  if (!existsSync(dirPath)) {
    return null
  }

  // 从 RuntimeProvisioner 获取 Git 路径；未初始化时回退到 null
  let gitBin: string
  try {
    gitBin = getRuntimeProvisioner().getGitBin()
  } catch {
    return null
  }

  // 检查是否为 Git 仓库
  const isRepo = runGitCommand(gitBin, ['rev-parse', '--is-inside-work-tree'], dirPath)

  if (isRepo !== 'true') {
    return {
      isRepo: false,
      branch: null,
      hasChanges: false,
      remoteUrl: null,
    }
  }

  // 获取当前分支
  const branch = runGitCommand(gitBin, ['rev-parse', '--abbrev-ref', 'HEAD'], dirPath)

  // 检查是否有未提交的更改
  const status = runGitCommand(gitBin, ['status', '--porcelain'], dirPath)
  const hasChanges = status !== null && status.length > 0

  // 获取远程仓库 URL
  const remoteUrl = runGitCommand(gitBin, ['config', '--get', 'remote.origin.url'], dirPath)

  return {
    isRepo: true,
    branch: branch || null,
    hasChanges,
    remoteUrl: remoteUrl || null,
  }
}

/**
 * Windows 上检测 Git Bash 路径
 *
 * @returns Git Bash 路径，如果未找到返回 null
 */
export function detectGitBashWindows(): string | null {
  if (process.platform !== 'win32') {
    return null
  }

  const commonPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ]

  for (const path of commonPaths) {
    if (existsSync(path)) {
      return path
    }
  }

  // 尝试使用 where 命令
  try {
    const result = execSync('where bash', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    })

    const bashPath = result.trim().split('\n')[0]

    if (bashPath && existsSync(bashPath)) {
      return bashPath
    }
  } catch {
    // 未找到
  }

  return null
}
