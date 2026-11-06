import { describe, expect, it } from 'bun:test'
import { SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT } from '@asci/shared'
import { resolveMasterAllowedTools } from './agent-orchestrator.master-tools.ts'

describe('Master allowedTools (A0 ② Phase 1)', () => {
  it('default 模式返回 undefined（SDK 默认全开，保留 Phase 1 之前行为）', () => {
    expect(resolveMasterAllowedTools({ permissionMode: 'default' })).toBeUndefined()
  })

  it('bypassPermissions 模式返回 undefined（SDK 默认全开）', () => {
    expect(resolveMasterAllowedTools({ permissionMode: 'bypassPermissions' })).toBeUndefined()
  })

  it('plan 模式返回 PLAN_MODE_ALLOWED_TOOLS 全集（含 Task / Agent / Read）', () => {
    const tools = resolveMasterAllowedTools({ permissionMode: 'plan' })
    expect(tools).toBeDefined()
    expect(tools).toContain('Task')
    expect(tools).toContain('Agent') // A0b 双名兼容：plan 模式过滤器需含 Agent
    expect(tools).toContain('Read')
  })

  it('acceptEdits 模式包含 Task + 完整 SAFE_TOOLS（保留 Phase 1 之前 SAFE_TOOLS 不被删）', () => {
    const tools = resolveMasterAllowedTools({ permissionMode: 'acceptEdits' })
    expect(tools).toBeDefined()
    expect(tools![0]).toBe(SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT) // Task 在首位（A0b 输入侧约定）
    expect(tools).toContain(SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT)
    expect(tools).toContain('Read') // SAFE_TOOLS 成员
    // 不双写 Agent
    expect(tools).not.toContain('Agent')
  })
})
