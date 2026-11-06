import { describe, expect, it } from 'bun:test'
import {
  SUBAGENT_TOOL_NAMES,
  SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT,
  isSubagentToolUse,
} from './subagent-tool-name.ts'

describe('isSubagentToolUse - 派发语义位点双名匹配', () => {
  it('对 name === "Task" 返回 true（SDK v2.1.63 之前）', () => {
    expect(isSubagentToolUse({ name: 'Task' })).toBe(true)
  })
  it('对 name === "Agent" 返回 true（SDK v2.1.63 之后）', () => {
    expect(isSubagentToolUse({ name: 'Agent' })).toBe(true)
  })
  it('对 name === "Bash" 等其他工具返回 false', () => {
    expect(isSubagentToolUse({ name: 'Bash' })).toBe(false)
    expect(isSubagentToolUse({ name: 'Read' })).toBe(false)
  })
  it('对缺失 name 字段返回 false', () => {
    expect(isSubagentToolUse({})).toBe(false)
    expect(isSubagentToolUse({ name: undefined })).toBe(false)
  })
})

describe('SUBAGENT_TOOL_NAMES 常量集（用于 grep / matcher 双向）', () => {
  // 这是一道刻意写死的"canary"断言：阻止意外向数组里增加新名字
  // （新增需求出现时应同步更新 dispatch / exception / input 三类位点）
  it('恰好包含 "Task" 与 "Agent" 两项', () => {
    expect(SUBAGENT_TOOL_NAMES).toEqual(['Task', 'Agent'])
  })
})

describe('SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT - SDK options.allowedTools 输入侧约束', () => {
  it('恰好为 "Task" 单值（SDK 输入侧只写 Task，双写会被解析为两个工具）', () => {
    expect(SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT).toBe('Task')
  })
})
