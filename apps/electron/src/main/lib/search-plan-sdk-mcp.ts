/**
 * lit-search in-process SDK MCP server（检索方案确认 · issue #435）
 *
 * 用 SDK 提供的 createSdkMcpServer + tool() API，在主进程内实现 `present_search_plan`
 * 工具。Agent SDK 把它当成普通 MCP server 暴露给 scenarioAgent.def.mcpServers，
 * 但执行时不走 stdio 子进程，handler 直接在主进程闭包内执行。
 *
 * 闭包模式与 litreview-sdk-mcp.ts 对称：每个 agent session 在 orchestrator 启动
 * SDK query 前调 createSearchPlanSdkMcpServer(sessionId, sendToRenderer) 拿到一个
 * session-bound server，注入到 SDK options.mcpServers。
 *
 * 工具名暴露给 LLM：`mcp__searchplan__present_search_plan`
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { SearchPlanProposal, SearchPlanConfirmRequest } from '@asci/shared'
import { searchPlanService, type SearchPlanConfirmResult } from './agent-search-plan-service.ts'

/** SDK tool 输入 schema —— LLM 调用 present_search_plan 时按此结构传参 */
const presentSearchPlanInputSchema = {
  researchQuestion: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1),
  sources: z.array(z.string().min(1)).min(1),
  methodTerms: z.array(z.string().min(1)).optional(),
  objectTerms: z.array(z.string().min(1)).optional(),
  timeRange: z
    .object({
      from: z.number().int().optional(),
      to: z.number().int().optional(),
    })
    .optional(),
  targetCount: z.number().int().positive().optional(),
}

/**
 * 把 SearchPlanConfirmResult 序列化为 tool_result content。
 * SDK content 字段是 `Array<{ type: 'text'; text: string }>`，LLM 看到的就是 JSON 字符串。
 */
function resultToContent(result: SearchPlanConfirmResult): { content: { type: 'text'; text: string }[] } {
  switch (result.kind) {
    case 'confirm':
      return { content: [{ type: 'text' as const, text: JSON.stringify({ choice: 'confirm' }) }] }
    case 'adjust':
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ choice: 'adjust', adjustment: result.adjustment }) }],
      }
    case 'cancel':
      return { content: [{ type: 'text' as const, text: JSON.stringify({ choice: 'cancel' }) }] }
  }
}

/**
 * 为指定 agent session 创建一个 lit-search SDK MCP server 实例。
 *
 * @param sessionId 当前 agent session 的 ID（用于关联 pending tool call）
 * @param sendToRenderer 发请求到 renderer 的回调（一般是 eventBus.emit 包装）
 */
export function createSearchPlanSdkMcpServer(
  sessionId: string,
  sendToRenderer: (request: SearchPlanConfirmRequest) => void,
): ReturnType<typeof createSdkMcpServer> {
  const presentSearchPlanTool = tool(
    'present_search_plan',
    'Present the proposed literature search plan (keywords / sources / time range / target count) to the user for confirmation before executing the search. The tool blocks until the user confirms, requests an adjustment (free-text), or cancels.',
    presentSearchPlanInputSchema,
    async (args, _extra) => {
      // signal 当前没有从 extra 暴露；先用一个 never-aborts signal（pending 清理由 service.clearSessionPending 处理）
      const controller = new AbortController()
      const plan: SearchPlanProposal = {
        researchQuestion: args.researchQuestion,
        keywords: args.keywords,
        sources: args.sources,
        ...(args.methodTerms && { methodTerms: args.methodTerms }),
        ...(args.objectTerms && { objectTerms: args.objectTerms }),
        ...(args.timeRange && { timeRange: args.timeRange }),
        ...(args.targetCount && { targetCount: args.targetCount }),
      }
      const result = await searchPlanService.handlePresentSearchPlan(sessionId, plan, controller.signal, sendToRenderer)
      return resultToContent(result)
    },
  )

  return createSdkMcpServer({
    name: 'searchplan',
    version: '0.1.0',
    tools: [presentSearchPlanTool],
  })
}
