/**
 * Master Orchestrator allowedTools 决议（A0 ②）
 *
 * 独立模块原因：agent-orchestrator.ts 依赖 electron，无法在 Bun 测试中直接 import；
 * 将纯逻辑提取到此文件，使测试可独立校验工具白名单决议逻辑。
 */

import { SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT, SAFE_TOOLS } from '@asci/shared'
import { PLAN_MODE_ALLOWED_TOOLS } from './agent-allowed-tools.ts'

/**
 * Master Orchestrator allowedTools 决议函数。
 *
 * Phase 1 形态：完全保留 Phase 1 之前的"哪些模式设置 allowedTools"语义。
 * - 'default' / 'bypassPermissions'：返回 undefined → SDK 默认允许所有工具
 * - 'plan'：PLAN_MODE_ALLOWED_TOOLS 全集（已含 Task / Agent）
 * - 'acceptEdits'：[Task, ...SAFE_TOOLS] 去重 — 仅"在原有 SAFE_TOOLS 之前注入 Task"，
 *   不删除任何 SAFE_TOOLS 既有项
 *
 * Phase 4 形态（未来）：收紧到 ['Task', 'Read'] 一类，让 master 仅承担路由 + 澄清。
 *
 * 注意：'Agent' 不注入 allowedTools 顶层 —— SDK options.allowedTools 输入侧
 * 约束（A0b）只接受 'Task'；'Agent' 仅在 PLAN_MODE_ALLOWED_TOOLS（PreToolUse 过滤）
 * 中出现以保持跨版本兼容。
 */
export function resolveMasterAllowedTools(opts: {
  permissionMode: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'
}): string[] | undefined {
  if (opts.permissionMode === 'default' || opts.permissionMode === 'bypassPermissions') {
    // 保留 Phase 1 之前行为：不显式设置 allowedTools，让 SDK 默认允许所有工具
    return undefined
  }

  if (opts.permissionMode === 'plan') {
    // plan 模式：返回 PLAN_MODE_ALLOWED_TOOLS 全集（含 Task）
    // 注意：此处含 'Agent' 是 PreToolUse 过滤所需（A0b 双名），不违反顶层输入侧约束
    return Array.from(PLAN_MODE_ALLOWED_TOOLS)
  }

  if (opts.permissionMode === 'acceptEdits') {
    // acceptEdits — Task 排首位 + SAFE_TOOLS；去重以防止 SAFE_TOOLS 将来意外含 Task
    return Array.from(new Set([SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT, ...SAFE_TOOLS]))
  }

  // exhaustive 守卫：联合类型扩展时编译期失败，提示开发者更新本函数
  const _exhaustiveCheck: never = opts.permissionMode
  throw new Error(`Unreachable: unknown permissionMode ${_exhaustiveCheck}`)
}
