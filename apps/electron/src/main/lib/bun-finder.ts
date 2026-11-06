/**
 * Bun 运行时检测 —— 简化为始终 unavailable
 *
 * Bun 不在 ASCI 的 4 个内置工具内（Node / Git / uv / Python），
 * 只在开发期由开发者本地系统提供。本模块保留是为了让 runtime-init
 * 的运行时状态摘要里仍能列出 Bun 一项（标记为"已跳过"）。
 *
 * 历史上的 vendor / 系统 PATH / 打包内嵌等多源查找已在 P2 删除。
 */

import type { BunRuntimeStatus } from '@asci/shared'
export { getCurrentPlatformArch } from '@asci/shared'

/** 始终返回 unavailable —— Bun 不再 prod scope */
export async function detectBunRuntime(): Promise<BunRuntimeStatus> {
  return {
    available: false,
    path: null,
    version: null,
    source: null,
    error: 'Bun 不在 ASCI 内置工具内（仅开发期使用）',
  }
}
