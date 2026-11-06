/**
 * Plan 模式允许工具集
 *
 * 与 agent-orchestrator.ts 解耦，单独放置以支持测试导入（orchestrator 依赖 electron，无法在 Bun 测试中直接 import）。
 *
 * A0b 双名兼容：SDK v2.1.63 之前 tool_use.name = "Task"，v2.1.63 之后 = "Agent"。
 * 派发语义位点必须同时包含两个名字，确保跨版本兼容。
 */

// Plan 模式下允许的只读工具（不包含 Write/Edit/Bash 等写操作）
// 'Task' 与 'Agent' 双名（A0b）：SDK v2.1.63 前后 tool_use.name 不同，派发语义位点必须 OR 双名
export const PLAN_MODE_ALLOWED_TOOLS = new Set<string>([
  'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
  'Task', 'Agent', 'TodoRead', 'TodoWrite', 'TaskOutput',
  'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
  'ListMcpResourcesTool', 'ReadMcpResourceTool',
])
