/**
 * RuntimeProvisioner — 4 个内置工具的校验器与路径暴露
 *
 * 替代 PythonRuntimeService 的"copying 阶段"。本类仅做：
 *   1. 校验 runtimes/.version 存在 + 与 app.getVersion() 一致
 *   2. 校验 4 个 binary 存在 + 可执行 + spawn --version 通过
 *   3. 暴露绝对路径 getter
 *
 * 任一校验失败 → phase='error'，UI 引导用户重装。
 *
 * 见 docs/superpowers/specs/2026-05-06-bundled-runtimes-installer-design.md
 */

import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, accessSync, constants as fsConstants } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import type {
  RuntimeProvisionerStatus,
  RuntimeProvisionerErrorCode,
} from '@asci/shared'
import { errMsg } from '@asci/shared'
import {
  getRuntimeStampPath,
  getNodeBinPath,
  getGitBinPath,
  getUvBinPath,
  getPythonInterpreterPath,
  getRuntimesRoot,
  listRuntimeBinaries,
} from './paths.ts'

interface RuntimeProvisionerOptions {
  /** 当前 ASCI 版本，与 .version 文件做精确字符串匹配 */
  asciVersion: string
}

export class RuntimeProvisioner extends EventEmitter {
  private status: RuntimeProvisionerStatus = { phase: 'idle' }

  constructor(private readonly opts: RuntimeProvisionerOptions) {
    super()
  }

  getStatus(): RuntimeProvisionerStatus {
    return this.status
  }

  /** 校验 runtimes 子树。同步路径快（仅 stat + 一次 spawn 每个 binary） */
  async verify(): Promise<RuntimeProvisionerStatus> {
    this.setStatus({ phase: 'verifying' })

    const stampPath = getRuntimeStampPath()
    if (!existsSync(stampPath)) {
      return this.setError('STAMP_MISSING', `runtime stamp 不存在: ${stampPath}`)
    }

    let stamp: string
    try {
      stamp = readFileSync(stampPath, 'utf-8').trim()
    } catch (err) {
      return this.setError('STAMP_MISSING', `runtime stamp 读取失败: ${errMsg(err)}`)
    }

    if (stamp !== this.opts.asciVersion) {
      return this.setError(
        'STAMP_MISMATCH',
        `runtime stamp ${stamp} 与 ASCI 版本 ${this.opts.asciVersion} 不匹配`,
      )
    }

    const missing: string[] = []
    const notExecutable: string[] = []
    const spawnFailed: string[] = []

    const optionalPython = existsSync(`${getRuntimesRoot()}/.optional-python`)
    for (const bin of listRuntimeBinaries()) {
      // Do not execute the lazy launchers at startup: --version would download them.
      if (optionalPython && (bin.name === 'uv' || bin.name === 'python')) continue
      // git 在 macOS / Windows 不强制 bundle（Mac 用户走 Xcode CLT 系统 git；
      // Win 用户走 Git for Windows 系统 git，Bootstrapper 不 stage 时由
      // getGitBin() 退化）。缺失时跳过严格校验，避免 Provisioner 仅因 git
      // 而卡在 BINARY_MISSING、orchestrator 拿不到 Node 而陷入 chat 无回复。
      if (
        bin.name === 'git' &&
        (process.platform === 'darwin' || process.platform === 'win32') &&
        !existsSync(bin.path)
      ) {
        continue
      }
      if (!existsSync(bin.path)) {
        missing.push(bin.name)
        continue
      }
      // 可执行权限（Windows 跳过，靠 spawn 探测）
      if (process.platform !== 'win32') {
        try {
          accessSync(bin.path, fsConstants.X_OK)
        } catch {
          notExecutable.push(bin.name)
          continue
        }
      }
      // spawn --version 探测
      const result = spawnSync(bin.path, [...bin.versionArgs], { timeout: 5000, stdio: 'ignore' })
      if (result.status !== 0) {
        spawnFailed.push(bin.name)
      }
    }

    if (missing.length > 0) {
      return this.setError('BINARY_MISSING', `缺失: ${missing.join(', ')}`, missing)
    }
    if (notExecutable.length > 0) {
      return this.setError(
        'BINARY_NOT_EXECUTABLE',
        `无执行权限: ${notExecutable.join(', ')}`,
        notExecutable,
      )
    }
    if (spawnFailed.length > 0) {
      return this.setError(
        'BINARY_SPAWN_FAILED',
        `--version 调用失败: ${spawnFailed.join(', ')}`,
        spawnFailed,
      )
    }

    return this.setStatus({ phase: 'ready' })
  }

  getNodeBin(): string {
    return getNodeBinPath()
  }

  getGitBin(): string {
    const bundled = getGitBinPath()
    if (existsSync(bundled)) return bundled
    // 无 bundled git 时退化到系统 git
    if (process.platform === 'darwin') return '/usr/bin/git'
    if (process.platform === 'win32') {
      // Win 沿用 Git for Windows 安装位置；用户未装时由调用方 spawn 失败
      return 'C:\\Program Files\\Git\\cmd\\git.exe'
    }
    return bundled
  }

  getUvBin(): string {
    return getUvBinPath()
  }

  getPythonInterpreter(): string {
    return getPythonInterpreterPath()
  }

  getRuntimesRoot(): string {
    return getRuntimesRoot()
  }

  /**
   * bundled runtimes 应注入到 PATH 前缀的目录列表（按优先级降序）。
   *
   * 把"runtimes 子树具体布局"封装在这里：调用方（agent-orchestrator buildSdkEnv /
   * buildPathWithBundledPrefix）只需 join 即可，不必自己 dirname(getNodeBin) /
   * dirname(getPythonInterpreter)，避免布局知识泄漏。
   */
  getPathPrefixDirs(): string[] {
    return [
      getRuntimesRoot(),
      dirname(getPythonInterpreterPath()),
      dirname(getNodeBinPath()),
    ]
  }

  private setStatus(next: RuntimeProvisionerStatus): RuntimeProvisionerStatus {
    this.status = next
    this.emit('status', next)
    return next
  }

  private setError(
    code: RuntimeProvisionerErrorCode,
    detail: string,
    missing?: string[],
  ): RuntimeProvisionerStatus {
    return this.setStatus({ phase: 'error', code, detail, missing })
  }
}

let instance: RuntimeProvisioner | null = null

/** 应用启动时调用一次（runtime-init.ts） */
export function setRuntimeProvisioner(svc: RuntimeProvisioner): void {
  instance = svc
}

export function getRuntimeProvisioner(): RuntimeProvisioner {
  if (!instance) {
    throw new Error(
      'RuntimeProvisioner 未初始化；先在 runtime-init 中调 setRuntimeProvisioner',
    )
  }
  return instance
}

/** 测试用 */
export function _resetRuntimeProvisionerForTest(): void {
  instance = null
}
