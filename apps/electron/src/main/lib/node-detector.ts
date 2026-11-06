/**
 * Node.js 运行时检测模块
 *
 * 通过 RuntimeProvisioner 获取捆绑 Node.js 的绝对路径，
 * 然后执行 --version 获取版本号供 UI 展示。
 * 不再搜索系统 PATH。
 */

import type { NodeRuntimeStatus } from '@asci/shared'
import { detectBundledTool } from './runtime/detect-bundled-tool.ts'

/**
 * 检测 Node.js 运行时状态
 *
 * 向 RuntimeProvisioner 查询捆绑 Node.js 路径；
 * 若 RuntimeProvisioner 未初始化或尚未就绪，返回 available: false。
 */
export async function detectNodeRuntime(): Promise<NodeRuntimeStatus> {
  return detectBundledTool({
    toolName: 'node',
    getBin: (rp) => rp.getNodeBin(),
    parseVersion: (stdout) => stdout.trim().replace(/^v/, '') || null,
  })
}

/**
 * 解析版本号为数字数组
 *
 * @param version - 版本号字符串（如 "22.13.1"）
 * @returns 数字数组 [22, 13, 1]
 */
function parseVersion(version: string): number[] {
  return version.split('.').map((n) => parseInt(n, 10))
}

/**
 * 比较版本号
 *
 * @param version - 当前版本
 * @param target - 目标版本
 * @returns 是否满足目标版本（>= target）
 */
function meetsVersion(version: string, target: string): boolean {
  const v = parseVersion(version)
  const t = parseVersion(target)

  for (let i = 0; i < Math.max(v.length, t.length); i++) {
    const vPart = v[i] || 0
    const tPart = t[i] || 0

    if (vPart > tPart) return true
    if (vPart < tPart) return false
  }

  return true // 版本相等
}

/**
 * 检查 Node.js 版本是否满足要求
 *
 * @param version - Node.js 版本号
 * @param minimum - 最低版本（默认 18）
 * @param recommended - 推荐版本（默认 22）
 * @returns { meetsMinimum, meetsRecommended }
 */
export function checkNodeVersion(
  version: string,
  minimum = '18.0.0',
  recommended = '22.0.0'
): { meetsMinimum: boolean; meetsRecommended: boolean } {
  return {
    meetsMinimum: meetsVersion(version, minimum),
    meetsRecommended: meetsVersion(version, recommended),
  }
}
