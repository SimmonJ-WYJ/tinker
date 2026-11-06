/**
 * paper-meta-cap-hook 行为单测（spec §5.6）
 *
 * 覆盖：
 *   - cap=3 硬上限：第 4 次调用被 deny
 *   - fail≥2 早停：第 2 次失败后即使尚未达 cap，剩余调用被 deny
 *   - 非目标工具名跳过（不干扰其他 MCP 调用）
 *   - PostToolUse 正确累计 attempts / failures
 *   - isPaperMetaToolResponseError 各边界情况
 */

import { describe, expect, mock, test } from 'bun:test'

import {
  GET_PAPER_META_TOOL,
  GET_PAPER_META_CAP,
  GET_PAPER_META_FAIL_EARLY_STOP,
  createPaperMetaCapHook,
  isPaperMetaToolResponseError,
} from './paper-meta-cap-hook.ts'

interface PreInput {
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input?: unknown
}
interface PostInput {
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_response: unknown
}

function runPre(hook: ReturnType<typeof createPaperMetaCapHook>, tool: string): unknown {
  const cb = hook.PreToolUse[0]!.hooks[0]!
  return cb({ hook_event_name: 'PreToolUse', tool_name: tool } as PreInput)
}
function runPost(
  hook: ReturnType<typeof createPaperMetaCapHook>,
  tool: string,
  response: unknown,
): void {
  const cb = hook.PostToolUse[0]!.hooks[0]!
  cb({ hook_event_name: 'PostToolUse', tool_name: tool, tool_response: response } as PostInput)
}

function isDeny(out: unknown): boolean {
  if (!out || typeof out !== 'object') return false
  const o = out as { hookSpecificOutput?: { permissionDecision?: string } }
  return o.hookSpecificOutput?.permissionDecision === 'deny'
}

describe('createPaperMetaCapHook', () => {
  test('spec 常量：cap=3 / fail-early-stop=2', () => {
    expect(GET_PAPER_META_CAP).toBe(3)
    expect(GET_PAPER_META_FAIL_EARLY_STOP).toBe(2)
  })

  test('第 1-3 次允许（PostToolUse 计入 attempts），第 4 次被 cap deny', () => {
    const hook = createPaperMetaCapHook('s-1', () => {})
    // 第 1 次
    expect(isDeny(runPre(hook, GET_PAPER_META_TOOL))).toBe(false)
    runPost(hook, GET_PAPER_META_TOOL, { content: [{ type: 'text', text: 'ok' }] })
    // 第 2 次
    expect(isDeny(runPre(hook, GET_PAPER_META_TOOL))).toBe(false)
    runPost(hook, GET_PAPER_META_TOOL, { content: [{ type: 'text', text: 'ok' }] })
    // 第 3 次
    expect(isDeny(runPre(hook, GET_PAPER_META_TOOL))).toBe(false)
    runPost(hook, GET_PAPER_META_TOOL, { content: [{ type: 'text', text: 'ok' }] })
    // 第 4 次：触 cap
    const out = runPre(hook, GET_PAPER_META_TOOL)
    expect(isDeny(out)).toBe(true)
    expect(hook.readState().attempts).toBe(3)
  })

  test('累计 fail≥2 时早停（即使总 attempts 未达 cap）', () => {
    const hook = createPaperMetaCapHook('s-2', () => {})
    // 第 1 次：成功
    runPre(hook, GET_PAPER_META_TOOL)
    runPost(hook, GET_PAPER_META_TOOL, { content: [], isError: false })
    // 第 2 次：失败
    runPre(hook, GET_PAPER_META_TOOL)
    runPost(hook, GET_PAPER_META_TOOL, { content: [], isError: true })
    // 第 3 次 PreToolUse 时 failures=1，未触发早停
    expect(isDeny(runPre(hook, GET_PAPER_META_TOOL))).toBe(false)
    runPost(hook, GET_PAPER_META_TOOL, { content: [], isError: true })
    // 第 4 次 PreToolUse 时 failures=2 → 早停（同时 attempts=3 也会触 cap，但 fail 早停优先级与 cap 同；任一触发即 deny）
    const out = runPre(hook, GET_PAPER_META_TOOL)
    expect(isDeny(out)).toBe(true)
    expect(hook.readState().failures).toBe(2)
  })

  test('fail 累计在 cap 前就先达到早停阈值（attempts=2 / failures=2 → 早停）', () => {
    const hook = createPaperMetaCapHook('s-3', () => {})
    // 第 1 次失败
    runPre(hook, GET_PAPER_META_TOOL)
    runPost(hook, GET_PAPER_META_TOOL, { content: [], isError: true })
    // 第 2 次失败
    runPre(hook, GET_PAPER_META_TOOL)
    runPost(hook, GET_PAPER_META_TOOL, { content: [], isError: true })
    // 第 3 次 PreToolUse 时 failures=2 / attempts=2 → 早停拒绝
    const out = runPre(hook, GET_PAPER_META_TOOL)
    expect(isDeny(out)).toBe(true)
    expect(hook.readState()).toEqual({ attempts: 2, failures: 2 })
  })

  test('非目标工具名跳过：其他 MCP 工具不受影响', () => {
    const hook = createPaperMetaCapHook('s-4', () => {})
    // 把无关工具 4 次 PreToolUse + PostToolUse，counter 应纹丝不动
    for (let i = 0; i < 4; i++) {
      expect(runPre(hook, 'mcp__paper-search__search_papers')).toEqual({})
      runPost(hook, 'mcp__paper-search__search_papers', { content: [] })
    }
    expect(hook.readState()).toEqual({ attempts: 0, failures: 0 })
  })

  test('触发 deny 时调用 logger（含 session id + 计数）', () => {
    const logs: string[] = []
    const hook = createPaperMetaCapHook('s-5', (m) => {
      logs.push(m)
    })
    // 跑满 cap
    for (let i = 0; i < 3; i++) {
      runPre(hook, GET_PAPER_META_TOOL)
      runPost(hook, GET_PAPER_META_TOOL, { content: [] })
    }
    runPre(hook, GET_PAPER_META_TOOL)
    expect(logs.length).toBeGreaterThanOrEqual(1)
    expect(logs[0]).toContain('s-5')
  })

  test('matcher 字段限定到 get_paper_meta', () => {
    const hook = createPaperMetaCapHook('s-6', () => {})
    expect(hook.PreToolUse[0]!.matcher).toBe(GET_PAPER_META_TOOL)
    expect(hook.PostToolUse[0]!.matcher).toBe(GET_PAPER_META_TOOL)
  })
})

describe('isPaperMetaToolResponseError', () => {
  test('null / undefined → 失败', () => {
    expect(isPaperMetaToolResponseError(null)).toBe(true)
    expect(isPaperMetaToolResponseError(undefined)).toBe(true)
  })
  test('isError: true → 失败', () => {
    expect(isPaperMetaToolResponseError({ isError: true })).toBe(true)
    expect(isPaperMetaToolResponseError({ content: [], isError: true })).toBe(true)
  })
  test('isError: false / 缺失 → 成功', () => {
    expect(isPaperMetaToolResponseError({ content: [], isError: false })).toBe(false)
    expect(isPaperMetaToolResponseError({ content: [] })).toBe(false)
  })
  test('非 object 形态保守视为成功（避免误伤）', () => {
    expect(isPaperMetaToolResponseError('text response')).toBe(false)
    expect(isPaperMetaToolResponseError(42)).toBe(false)
  })
})
