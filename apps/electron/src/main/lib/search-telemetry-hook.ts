/**
 * createSearchTelemetryHook —— search_executed 行为埋点（issue #717 Issue 1）。
 *
 * 背景：paper-search 的检索由 **searcher 子 Agent** 调用；原先唯一的 `track(SEARCH_EXECUTED)`
 * 挂在 paper-result-recorder 的 `handleToolResult()` 上，而该函数**生产侧零调用**（JSONL 落盘
 * 职责早已迁到 Python MCP），埋点随之成为死代码 → 检索完成永不上报。
 *
 * 本 hook 用 **PostToolUse** 监听"检索完成"工具——SDK 文档明确 PostToolUse 对**子 Agent 内部
 * 工具调用同样触发**（fires from within a subagent），且 run-orchestrator-query 装配不受能力包
 * 门控，故任何包里的检索都能上报：
 *   - `retrieve`：现行主路径
 *   - `process_search_results`：逃生路径（retrieve 报错降级）
 * 只在解析出 display_count（检索确实完成并返回计数）时上报；errored retrieve 无 display_count
 * → 不计，由逆路径补上，天然不双计。
 *
 * tool_response 形态（实测 SDK CLI）：MCP 工具的 tool_response 是**裸的 content blocks 数组**
 * `[{ type:'text', text:'<json串>' }]`（不是 `{content:[...]}` 包裹）。display_count 在该 text
 * 的 JSON 里。readDisplayCount 兼容裸数组 / `{content:[...]}` / 已解析对象三种形态。
 *
 * 红线：只采来源工具名（受控枚举：mcp__paper-search__*）与结果计数，**绝不采检索词原文**。
 */
import { TELEMETRY_EVENTS } from '@asci/shared'
import { telemetryService } from './telemetry/telemetry-service.ts'
import { DISPLAY_COUNT_TOOLS } from './plan-terminal-skill-guard.ts'

/** 把 tool_response 归一为文本：string / `[{type:text,text}]` 裸数组 / `{content:[{type:text,text}]}`。 */
function toResponseText(resp: unknown): string | null {
  if (typeof resp === 'string') return resp
  if (!resp || typeof resp !== 'object') return null
  // 顶层裸数组（实测 retrieve/process_search_results 形态），或 { content: [...] } 包裹
  const blocks = Array.isArray(resp) ? resp : (resp as { content?: unknown }).content
  if (!Array.isArray(blocks)) return null
  const parts: string[] = []
  for (const b of blocks) {
    if (
      b &&
      typeof b === 'object' &&
      (b as { type?: unknown }).type === 'text' &&
      typeof (b as { text?: unknown }).text === 'string'
    ) {
      parts.push((b as { text: string }).text)
    }
  }
  return parts.length > 0 ? parts.join('') : null
}

/**
 * 从 PostToolUse 的 `tool_response`（类型 `unknown`，形态因 SDK 版本而异）稳健解析 display_count：
 *   1. 已是解析好的对象、顶层直接带数字 display_count → 直接取
 *   2. 否则归一为文本（裸数组 / content 包裹 / string）再 JSON.parse 取 display_count
 * 两条都拿不到返回 null。
 */
function readDisplayCount(resp: unknown): number | null {
  if (resp && typeof resp === 'object' && !Array.isArray(resp)) {
    const dc = (resp as { display_count?: unknown }).display_count
    if (typeof dc === 'number') return dc
  }
  const text = toResponseText(resp)
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object') {
      const dc = (parsed as { display_count?: unknown }).display_count
      if (typeof dc === 'number') return dc
    }
  } catch {
    /* 非 JSON → 无计数 */
  }
  return null
}

interface HookCallbackInput {
  hook_event_name: 'PostToolUse'
  tool_name?: string
  tool_response?: unknown
}

interface HookEntry {
  matcher: string
  hooks: ((input: HookCallbackInput) => unknown)[]
}

export interface SearchTelemetryHooks {
  PostToolUse: HookEntry[]
}

/**
 * 创建 search_executed 埋点 hook。
 * @param sessionId 仅用于日志可定位性（埋点本身不带 sessionId，由 telemetry 层统一处理）
 */
export function createSearchTelemetryHook(sessionId: string): SearchTelemetryHooks {
  const onSearchPost = (input: HookCallbackInput): unknown => {
    if (input.hook_event_name !== 'PostToolUse') return {}
    const toolName = input.tool_name ?? ''
    if (!DISPLAY_COUNT_TOOLS.has(toolName)) return {}

    // 只在检索真正完成并返回计数时上报：errored retrieve 无 display_count → 跳过（逆路径会补上）
    const count = readDisplayCount(input.tool_response)
    if (count == null) return {}

    telemetryService.track({
      event: TELEMETRY_EVENTS.SEARCH_EXECUTED,
      props: { source: toolName, resultCount: count, success: true },
    })
    console.log(
      `[search-telemetry session=${sessionId}] search_executed 上报: source=${toolName} resultCount=${count}`,
    )
    return {}
  }

  // 用 '*' matcher 兜全部 PostToolUse，规避 MCP 工具名 matcher 正则匹配不上的风险
  // （内部仍只对 DISPLAY_COUNT_TOOLS 上报）。
  return {
    PostToolUse: [{ matcher: '*', hooks: [onSearchPost] }],
  }
}
