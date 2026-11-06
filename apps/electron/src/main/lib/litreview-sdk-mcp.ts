/**
 * lit-review in-process SDK MCP server（spec §5.4 Turn 1 ChoiceCard tool 入口）
 *
 * 用 SDK 提供的 createSdkMcpServer + tool() API，在主进程内实现 `present_directions`
 * 工具。Agent SDK 会把它当成普通 MCP server 暴露给 scenarioAgent.def.mcpServers，
 * 但执行时不走 stdio 子进程，handler 直接在主进程闭包内执行。
 *
 * 闭包模式：每个 agent session 在 orchestrator 启动 SDK query 前调
 * `createLitReviewSdkMcpServer(sessionId, sendToRenderer)` 拿到一个 session-bound
 * server，注入到 SDK options.mcpServers。tool handler 关联当前 session 的
 * eventBus emit 函数，与 AgentExitPlanService 流程对称。
 *
 * 工具名暴露给 LLM：`mcp__litreview__present_directions`
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type {
  LitReviewDirection,
  LitReviewPresentDirectionsRequest,
} from '@asci/shared'
import { litReviewDirectionsService, type LitReviewDirectionsResult } from './agent-litreview-directions-service.ts'

/** SDK tool 输入 schema —— LLM 调用 present_directions 时按此结构传参 */
const presentDirectionsInputSchema = {
  directions: z
    .array(
      z.object({
        key: z.enum(['1', '2', '3']),
        title: z.string().min(1),
        thesis: z.string().min(1),
        outlinePreview: z.array(z.string().min(1)).length(6, 'outlinePreview must have exactly 6 chapter titles'),
        papersInScope: z.array(z.string().min(1)).min(1),
        paperCount: z.number().int().nonnegative(),
        paperWithFulltextCount: z.number().int().nonnegative(),
      }),
    )
    .length(3, 'Must provide exactly 3 candidate directions'),
  rerollLabel: z.string().optional(),
  customLabel: z.string().optional(),
  comprehensiveLabel: z.string().optional(),
  comprehensiveDescription: z.string().optional(),
}

/**
 * 把 LitReviewDirectionsResult 序列化为 tool_result content。
 * SDK content 字段是 `Array<{ type: 'text'; text: string }>`，LLM 看到的就是 JSON 字符串。
 */
function resultToContent(result: LitReviewDirectionsResult): { content: { type: 'text'; text: string }[] } {
  switch (result.kind) {
    case 'pick':
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              choice: result.choice,
              direction: result.direction,
            }),
          },
        ],
      }
    case 'comprehensive':
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ choice: 'comprehensive' }) }],
      }
    case 'reroll':
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ choice: 'reroll' }) }],
      }
    case 'custom':
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              choice: 'custom',
              customDirection: result.customDirection,
            }),
          },
        ],
      }
    case 'cancel':
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ choice: 'cancel' }) }],
      }
  }
}

/**
 * 为指定 agent session 创建一个 lit-review SDK MCP server 实例。
 *
 * @param sessionId 当前 agent session 的 ID（用于关联 pending tool call）
 * @param sendToRenderer 发请求到 renderer 的回调（一般是 eventBus.emit 包装；与 ExitPlanMode 模式对称）
 */
export function createLitReviewSdkMcpServer(
  sessionId: string,
  sendToRenderer: (request: LitReviewPresentDirectionsRequest) => void,
): ReturnType<typeof createSdkMcpServer> {
  const presentDirectionsTool = tool(
    'present_directions',
    'Present 3 review direction candidates to the user for selection (lit-review Turn 1). The tool blocks until the user picks 1/2/3, chooses "comprehensive" (a full-coverage review over the entire EvidenceSet instead of narrowing to one direction), requests a reroll, supplies a custom direction, or cancels.',
    presentDirectionsInputSchema,
    async (args, _extra) => {
      // SDK tool handler 在闭包里捕获 sessionId / sendToRenderer
      // signal 当前没有从 extra 暴露；先用一个 never-aborts signal（pending 清理由 service.clearSessionPending 处理）
      const controller = new AbortController()
      const result = await litReviewDirectionsService.handlePresentDirections(
        sessionId,
        args.directions as LitReviewDirection[],
        controller.signal,
        sendToRenderer,
        {
          ...(args.rerollLabel && { rerollLabel: args.rerollLabel }),
          ...(args.customLabel && { customLabel: args.customLabel }),
          ...(args.comprehensiveLabel && { comprehensiveLabel: args.comprehensiveLabel }),
          ...(args.comprehensiveDescription && { comprehensiveDescription: args.comprehensiveDescription }),
        },
      )
      return resultToContent(result)
    },
  )

  return createSdkMcpServer({
    name: 'litreview',
    version: '0.1.0',
    tools: [presentDirectionsTool],
  })
}
