/**
 * 内置工具版本检测公共逻辑
 *
 * node-detector / git-detector 模板代码完全相同：
 *   1. 从 RuntimeProvisioner 单例拿 binary 路径（未初始化 → not-available）
 *   2. RP 未 ready → not-available（带 phase 信息）
 *   3. spawnSync `--version` 解析输出 → 版本号
 *
 * 抽到此处，detector 只需提供 name / getBin / parseVersion 三个参数。
 */
import { spawnSync } from 'node:child_process'
import { getRuntimeProvisioner, type RuntimeProvisioner } from './runtime-provisioner.ts'

export interface BundledToolStatus {
  available: boolean
  path: string | null
  version: string | null
  error: string | null
}

export interface DetectBundledToolOptions {
  /** 工具显示名（用于错误提示），如 'node' / 'git' */
  toolName: string
  /** 从 RuntimeProvisioner 拿 binary 路径 */
  getBin: (rp: RuntimeProvisioner) => string
  /** 解析 spawnSync 的 stdout，返回版本号或 null */
  parseVersion: (stdout: string) => string | null
}

export function detectBundledTool(opts: DetectBundledToolOptions): BundledToolStatus {
  let rp: RuntimeProvisioner | null = null
  try {
    rp = getRuntimeProvisioner()
  } catch {
    return {
      available: false,
      path: null,
      version: null,
      error: 'RuntimeProvisioner 未初始化',
    }
  }

  const rpStatus = rp.getStatus()
  if (rpStatus.phase !== 'ready') {
    return {
      available: false,
      path: null,
      version: null,
      error: `RuntimeProvisioner 状态：${rpStatus.phase}${rpStatus.code ? ` (${rpStatus.code})` : ''}`,
    }
  }

  const binPath = opts.getBin(rp)
  const versionResult = spawnSync(binPath, ['--version'], {
    encoding: 'utf-8',
    timeout: 5000,
  })
  const version = opts.parseVersion(versionResult.stdout ?? '')
  return {
    available: true,
    path: binPath,
    version,
    error: version ? null : `无法读取 ${opts.toolName} --version 输出`,
  }
}
