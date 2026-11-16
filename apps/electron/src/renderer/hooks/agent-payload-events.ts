/** SDK 与内部事件到原流式状态的兼容投影。 */
import { toast } from 'sonner'
import { i18n } from '../lib/i18n.ts'
import { inferModelContextWindow } from '@asci/shared'
import type { AgentStreamPayload, AgentEvent, SDKAssistantMessage, SDKUserMessage, SDKSystemMessage, SDKContentBlock, SDKUserContentBlock } from '@asci/shared'
export function payloadToLegacyEvents(payload: AgentStreamPayload): AgentEvent[] {
  if (payload.kind === 'asci_event') {
    const evt = payload.event
    switch (evt.type) {
      case 'text_snapshot':
        return [{ type: 'text_complete', text: evt.text, isIntermediate: false }, { type: 'model_resolved', model: evt.model }]
      case 'text_delta':
        return [{ type: 'text_delta', text: evt.text, turnId: evt.turnId }]
      case 'permission_request':
        return [{ type: 'permission_request', request: evt.request }]
      case 'permission_resolved':
        return [{ type: 'permission_resolved', requestId: evt.requestId, behavior: evt.behavior }]
      case 'ask_user_request':
        return [{ type: 'ask_user_request', request: evt.request }]
      case 'ask_user_resolved':
        return [{ type: 'ask_user_resolved', requestId: evt.requestId }]
      case 'exit_plan_mode_request':
        return [{ type: 'exit_plan_mode_request', request: evt.request }]
      case 'exit_plan_mode_resolved':
        return [{ type: 'exit_plan_mode_resolved', requestId: evt.requestId }]
      case 'litreview_present_directions_request':
        return [{ type: 'litreview_present_directions_request', request: evt.request }]
      case 'litreview_present_directions_resolved':
        return [{ type: 'litreview_present_directions_resolved', requestId: evt.requestId }]
      case 'search_plan_request':
        return [{ type: 'search_plan_request', request: evt.request }]
      case 'search_plan_resolved':
        return [{ type: 'search_plan_resolved', requestId: evt.requestId }]
      case 'research_gap_table':
        return [{ type: 'research_gap_table', table: evt.table }]
      case 'enter_plan_mode':
        return [{ type: 'enter_plan_mode', sessionId: evt.sessionId }]
      case 'model_resolved':
        return [{ type: 'model_resolved', model: evt.model }]
      case 'model_fallback_notice': {
        // 子 Agent model 别名家族未激活的提示（纯 toast，无内部 AgentEvent 承载）
        const msg = evt.noClaudeActivated
          ? i18n.t('modelFallback.noClaudeActivated', { ns: 'common' })
          : i18n.t(evt.agentCount ? 'modelFallback.summary' : 'modelFallback.aliasInactive', {
              ns: 'common',
              agentName: evt.agentName,
              count: evt.agentCount,
              family: evt.requestedFamily,
              model: evt.fallbackModelId,
            })
        toast.warning(msg)
        return []
      }
      case 'permission_mode_changed':
        return [{ type: 'permission_mode_changed', mode: evt.mode }]
      case 'resolved_language':
        return [{ type: 'resolved_language', language: evt.language }]
      case 'waiting_resume':
        return [{ type: 'waiting_resume', message: evt.message }]
      case 'resume_start':
        return [{ type: 'resume_start', messageId: evt.messageId }]
      case 'retry': {
        const events: AgentEvent[] = []
        if (evt.status === 'starting' && evt.attempt != null && evt.maxAttempts != null) {
          events.push({ type: 'retrying', attempt: evt.attempt, maxAttempts: evt.maxAttempts, delaySeconds: evt.delaySeconds ?? 0, reason: evt.reason ?? '' })
        }
        if (evt.status === 'attempt' && evt.attemptData) {
          events.push({ type: 'retry_attempt', attemptData: evt.attemptData })
        }
        if (evt.status === 'cleared') {
          events.push({ type: 'retry_cleared' })
        }
        if (evt.status === 'failed' && evt.attemptData) {
          events.push({ type: 'retry_failed', finalAttempt: evt.attemptData })
        }
        return events
      }
      default:
        return []
    }
  }

  // sdk_message → 转换为对应的 AgentEvent
  const msg = payload.message

  switch (msg.type) {
    case 'assistant': {
      const aMsg = msg as SDKAssistantMessage
      if (aMsg.isReplay) return []
      if (aMsg.error) {
        // 错误已在主进程处理，这里仅作为 typed_error 透传
        return [{ type: 'error', message: aMsg.error.message }]
      }
      const events: AgentEvent[] = []
      for (const block of aMsg.message.content) {
        if (block.type === 'text' && 'text' in block) {
          events.push({ type: 'text_complete', text: (block as { text: string }).text, isIntermediate: false, parentToolUseId: aMsg.parent_tool_use_id ?? undefined })
        } else if (block.type === 'tool_use') {
          const tb = block as SDKContentBlock & { id: string; name: string; input: Record<string, unknown> }
          const intent = (tb.input._intent as string | undefined)
            ?? (tb.name === 'Bash' ? (tb.input.description as string | undefined) : undefined)
          events.push({
            type: 'tool_start',
            toolName: tb.name,
            toolUseId: tb.id,
            input: tb.input,
            intent,
            displayName: tb.input._displayName as string | undefined,
            parentToolUseId: aMsg.parent_tool_use_id ?? undefined,
          })
        }
      }
      // Usage（保留完整字段用于详细展示）
      if (!aMsg.parent_tool_use_id && aMsg.message.usage) {
        const u = aMsg.message.usage
        const inputTokens = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        // 流式过程中 SDK 不返回 contextWindow，按模型名推断一个默认值作为 fallback
        const modelName = aMsg.message.model ?? aMsg._channelModelId
        const fallbackWindow = modelName ? inferModelContextWindow(modelName) : undefined
        events.push({
          type: 'usage_update',
          usage: {
            inputTokens,
            outputTokens: u.output_tokens,
            cacheReadTokens: u.cache_read_input_tokens,
            cacheCreationTokens: u.cache_creation_input_tokens,
            ...(fallbackWindow ? { contextWindow: fallbackWindow } : {}),
          },
        })
      }
      return events
    }

    case 'user': {
      const uMsg = msg as SDKUserMessage
      if (uMsg.isReplay) return []
      const events: AgentEvent[] = []
      const contentBlocks = uMsg.message?.content ?? []
      for (const block of contentBlocks) {
        if (block.type === 'tool_result') {
          const tb = block as SDKUserContentBlock & { tool_use_id: string; content?: unknown; is_error?: boolean }
          const resultStr = typeof tb.content === 'string' ? tb.content : (tb.content != null ? JSON.stringify(tb.content) : '')
          events.push({
            type: 'tool_result',
            toolUseId: tb.tool_use_id,
            result: resultStr,
            isError: tb.is_error ?? false,
            parentToolUseId: uMsg.parent_tool_use_id ?? undefined,
          })
        }
      }
      return events
    }

    case 'result': {
      const rMsg = msg as { subtype: string; usage?: { input_tokens: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }; total_cost_usd?: number; modelUsage?: Record<string, { contextWindow?: number }> }
      const usage = rMsg.usage
      // 优先用 SDK 返回的真实 contextWindow；非 Anthropic 渠道常常不带 modelUsage，
      // 此时按 modelUsage 的 model 键（或缺省时回退）推断窗口大小
      const modelUsageEntries = rMsg.modelUsage ? Object.entries(rMsg.modelUsage) : []
      const sdkContextWindow = modelUsageEntries[0]?.[1]?.contextWindow
      const sdkModelId = modelUsageEntries[0]?.[0]
      const contextWindow = sdkContextWindow ?? (sdkModelId ? inferModelContextWindow(sdkModelId) : undefined)
      return [{
        type: 'complete',
        stopReason: rMsg.subtype === 'success' ? 'end_turn' : 'error',
        usage: usage ? {
          inputTokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens,
          cacheCreationTokens: usage.cache_creation_input_tokens,
          costUsd: rMsg.total_cost_usd,
          contextWindow,
        } : undefined,
      }]
    }

    case 'system': {
      const sMsg = msg as SDKSystemMessage
      if (sMsg.subtype === 'compact_boundary') return [{ type: 'compact_complete' }]
      if (sMsg.subtype === 'compacting') return [{ type: 'compacting' }]
      if (sMsg.subtype === 'task_started' && sMsg.task_id) {
        return [{ type: 'task_started', taskId: sMsg.task_id, description: sMsg.description ?? '', taskType: sMsg.task_type, toolUseId: sMsg.tool_use_id }]
      }
      if (sMsg.subtype === 'task_notification' && sMsg.task_id) {
        return [{
          type: 'task_notification',
          taskId: sMsg.task_id,
          status: (sMsg.status as 'completed' | 'failed' | 'stopped') ?? 'completed',
          summary: sMsg.summary ?? '',
          outputFile: sMsg.output_file,
          toolUseId: sMsg.tool_use_id,
          usage: sMsg.usage ? {
            totalTokens: sMsg.usage.total_tokens ?? 0,
            toolUses: sMsg.usage.tool_uses ?? 0,
            durationMs: sMsg.usage.duration_ms ?? 0,
          } : undefined,
        }]
      }
      if (sMsg.subtype === 'task_progress' && sMsg.task_id) {
        return [{
          type: 'task_progress',
          taskId: sMsg.task_id,
          toolUseId: sMsg.tool_use_id ?? sMsg.task_id,
          description: sMsg.description,
          lastToolName: sMsg.last_tool_name,
          usage: sMsg.usage ? {
            totalTokens: sMsg.usage.total_tokens ?? 0,
            toolUses: sMsg.usage.tool_uses ?? 0,
            durationMs: sMsg.usage.duration_ms ?? 0,
          } : undefined,
        }]
      }
      return []
    }

    case 'tool_progress': {
      const tpMsg = msg as { tool_use_id: string; elapsed_time_seconds?: number; task_id?: string }
      return [{
        type: 'task_progress',
        toolUseId: tpMsg.tool_use_id,
        elapsedSeconds: tpMsg.elapsed_time_seconds,
        taskId: tpMsg.task_id,
      }]
    }

    case 'prompt_suggestion': {
      const psMsg = msg as { suggestion?: string }
      if (psMsg.suggestion) return [{ type: 'prompt_suggestion', suggestion: psMsg.suggestion }]
      return []
    }

    case 'tool_use_summary': {
      const tusMsg = msg as { summary?: string; preceding_tool_use_ids?: string[] }
      if (tusMsg.summary) return [{ type: 'tool_use_summary', summary: tusMsg.summary, precedingToolUseIds: tusMsg.preceding_tool_use_ids ?? [] }]
      return []
    }

    default:
      return []
  }
}
