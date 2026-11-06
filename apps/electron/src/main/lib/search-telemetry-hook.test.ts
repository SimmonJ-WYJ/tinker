/**
 * search-telemetry-hook 行为单测（issue #717 Issue 1）
 *
 * 覆盖：
 *   - retrieve 返回 display_count → 上报 search_executed（source + resultCount + success）
 *   - process_search_results（逃生路径）返回 display_count → 同样上报，source 为该工具
 *   - 无 display_count（errored retrieve）→ 不上报（由逃生路径补，天然不双计）
 *   - 非检索工具 → 跳过
 *   - 非 PostToolUse 事件 → 跳过
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { TelemetryTrackRequest } from '@asci/shared'
import { telemetryService } from './telemetry/telemetry-service.ts'
import { createSearchTelemetryHook } from './search-telemetry-hook.ts'
import { RETRIEVE_TOOL, PROCESS_SEARCH_RESULTS_TOOL } from './plan-terminal-skill-guard.ts'

// 替换单例方法而非 mock.module，避免跨文件泄漏
const originalTrack = telemetryService.track.bind(telemetryService)
let tracked: TelemetryTrackRequest[]

beforeEach(() => {
  tracked = []
  telemetryService.track = ((req: TelemetryTrackRequest) => {
    tracked.push(req)
  }) as typeof telemetryService.track
})
afterEach(() => {
  telemetryService.track = originalTrack
})

/**
 * tool_response 用**实测真实形态**：裸的 content blocks 数组 `[{ type:'text', text }]`
 * （SDK CLI 对 MCP 工具如此返回，非 `{content:[...]}` 包裹）。
 */
function resp(displayCount: number | null): unknown {
  const body = displayCount == null ? { error: 'boom' } : { display_count: displayCount }
  return [{ type: 'text', text: JSON.stringify(body) }]
}

function fire(tool: string, response: unknown): void {
  const hook = createSearchTelemetryHook('sess-1')
  const cb = hook.PostToolUse[0]!.hooks[0]!
  cb({ hook_event_name: 'PostToolUse', tool_name: tool, tool_response: response })
}

describe('search-telemetry-hook', () => {
  test('retrieve 主路径返回 display_count → 上报 search_executed', () => {
    fire(RETRIEVE_TOOL, resp(75))
    expect(tracked).toHaveLength(1)
    expect(tracked[0]!.event).toBe('search_executed')
    expect(tracked[0]!.props).toEqual({ source: RETRIEVE_TOOL, resultCount: 75, success: true })
  })

  test('process_search_results 逃生路径返回 display_count → 上报，source 为该工具', () => {
    fire(PROCESS_SEARCH_RESULTS_TOOL, resp(31))
    expect(tracked).toHaveLength(1)
    expect(tracked[0]!.props).toEqual({
      source: PROCESS_SEARCH_RESULTS_TOOL,
      resultCount: 31,
      success: true,
    })
  })

  test('tool_response 为已解析对象（顶层 display_count）也上报', () => {
    fire(RETRIEVE_TOOL, { total_from_sources: 77, display_count: 69, duplicates_removed: 8 })
    expect(tracked).toHaveLength(1)
    expect(tracked[0]!.props).toMatchObject({ source: RETRIEVE_TOOL, resultCount: 69, success: true })
  })

  test('tool_response 为 {content:[{text}]} 包裹形态也上报', () => {
    fire(RETRIEVE_TOOL, { content: [{ type: 'text', text: JSON.stringify({ display_count: 12 }) }] })
    expect(tracked).toHaveLength(1)
    expect(tracked[0]!.props).toMatchObject({ source: RETRIEVE_TOOL, resultCount: 12, success: true })
  })

  test('display_count 为 0 也上报（检索完成但 0 命中）', () => {
    fire(RETRIEVE_TOOL, resp(0))
    expect(tracked).toHaveLength(1)
    expect(tracked[0]!.props).toMatchObject({ resultCount: 0 })
  })

  test('无 display_count（errored retrieve）→ 不上报', () => {
    fire(RETRIEVE_TOOL, resp(null))
    expect(tracked).toHaveLength(0)
  })

  test('非检索工具 → 跳过', () => {
    fire('mcp__paper-search__get_paper_meta', resp(10))
    expect(tracked).toHaveLength(0)
  })

  test('非 PostToolUse 事件 → 跳过', () => {
    const hook = createSearchTelemetryHook('sess-1')
    const cb = hook.PostToolUse[0]!.hooks[0]!
    cb({ hook_event_name: 'PreToolUse' as 'PostToolUse', tool_name: RETRIEVE_TOOL, tool_response: resp(9) })
    expect(tracked).toHaveLength(0)
  })
})
