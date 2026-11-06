/**
 * SDK v2.1.63 之后 tool_use.name 从 "Task" 改名为 "Agent"，
 * 但 system:init.tools[] 与 permission_denials[].tool_name 仍写 "Task"。
 *
 * 双名匹配的位点（所有"判断子 Agent 派发 / 调用 / 事件归属"语义）：
 *   - convertSDKMessage / 事件转换层
 *   - 子 Agent 调用次数 / 时长统计
 *   - UI 区分派发气泡
 *   - Hook matcher
 *   - tool name → display name 查表
 *
 * 例外位点（只匹配 "Task"，绝不 OR "Agent"）：
 *   - system:init.tools[] 数组（SDK 不会出 "Agent"）
 *   - permission_denials[].tool_name（SDK 写 "Task"）
 *
 * 输入侧（options.allowedTools）只写 "Task"，双写会被 SDK 解析为两个独立工具。
 */
export const SUBAGENT_TOOL_NAMES = ['Task', 'Agent'] as const

export type SubagentToolName = (typeof SUBAGENT_TOOL_NAMES)[number]

export const SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT = 'Task' as const

export function isSubagentToolUse(block: { name?: string | undefined }): boolean {
  return (SUBAGENT_TOOL_NAMES as readonly string[]).includes(block.name ?? '')
}
