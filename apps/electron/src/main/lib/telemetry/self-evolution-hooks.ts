/**
 * 自进化信号采集器（issue #427 / ADR-011）
 *
 * 每次 runAgent 创建一个 collector，从 orchestrator 已有的消息扫描点
 * 旁路采集 5 类结构化信号，经 telemetryService.captureSignal 投递
 * （consent 闸门 / Zod 白名单 / 脱敏都在 service 内，本模块零判断）。
 *
 * 设计取向：与 subagent spans sink 完全独立、零侵入现有 callback 链——
 * 不注册新的 SDK hook，只在 orchestrator 既有的 tool_use / tool_result /
 * result 扫描分支调用本 collector 的轻量方法。
 *
 * 红线：promptChars 只采长度；toolName / modelId / channelType 是受控
 * 标识符；workspaceHash 是 slug 的非可逆 hash（slug 可能含研究主题词，
 * 不采原文）；error message 由 service 层 redact。
 */
import { createHash } from 'node:crypto'
import { telemetryService } from './telemetry-service.ts'

export interface SelfEvolutionRunContext {
  sessionId: string
  promptChars: number
  attachmentCount: number
  mentionedSkillCount: number
  modelId?: string
  channelType?: string
  workspaceSlug?: string
  paperCount?: number
}

/** workspace slug → 非可逆短 hash（前 16 hex），避免采集研究主题词 */
export function hashWorkspaceSlug(slug: string): string {
  return createHash('sha256').update(slug).digest('hex').slice(0, 16)
}

export class SelfEvolutionCollector {
  /** 同名工具多次调用计数去抖：本轮每个工具只发首条 tool_usage（控制信号量） */
  private readonly reportedTools = new Set<string>()

  constructor(private readonly ctx: SelfEvolutionRunContext) {}

  /** 任务开始：发 model_choice + workspace_structure（各一条） */
  emitRunStart(): void {
    if (this.ctx.modelId) {
      telemetryService.captureSignal({
        kind: 'model_choice',
        sessionId: this.ctx.sessionId,
        modelId: this.ctx.modelId,
        channelType: this.ctx.channelType,
      })
    }
    if (this.ctx.workspaceSlug) {
      telemetryService.captureSignal({
        kind: 'workspace_structure',
        sessionId: this.ctx.sessionId,
        workspaceHash: hashWorkspaceSlug(this.ctx.workspaceSlug),
        paperCount: this.ctx.paperCount,
      })
    }
  }

  /** tool_result 到达：发 tool_usage（每工具每轮仅首条） */
  emitToolResult(toolName: string, success: boolean): void {
    if (this.reportedTools.has(toolName)) return
    this.reportedTools.add(toolName)
    telemetryService.captureSignal({
      kind: 'tool_usage',
      sessionId: this.ctx.sessionId,
      toolName,
      success,
    })
  }

  /** result 消息到达：发 task_structure（含本轮形态画像） */
  emitTaskResult(opts: { numTurns?: number; durationMs: number; success: boolean }): void {
    telemetryService.captureSignal({
      kind: 'task_structure',
      sessionId: this.ctx.sessionId,
      promptChars: this.ctx.promptChars,
      attachmentCount: this.ctx.attachmentCount,
      mentionedSkillCount: this.ctx.mentionedSkillCount,
      numTurns: opts.numTurns,
      durationMs: opts.durationMs,
      success: opts.success,
    })
  }

  /** 错误 / 重试耗尽：发 error_event（message 由 service 层脱敏 + 截断） */
  emitError(stage: string, message: string, retryable?: boolean): void {
    telemetryService.captureSignal({
      kind: 'error_event',
      sessionId: this.ctx.sessionId,
      stage,
      message,
      retryable,
    })
  }
}
