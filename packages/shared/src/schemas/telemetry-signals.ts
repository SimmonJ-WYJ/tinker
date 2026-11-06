/**
 * 自进化埋点 5 类结构化信号 + 隐式反馈 Zod schema（issue #427 T-5 / ADR-011）
 *
 * 双重角色：
 *   1. 运行时白名单：信号出口前必须过 validateSignal()——zod object 默认 strip
 *      未声明字段，超出 schema 的字段直接丢弃，schema 即可采集字段的上界。
 *   2. 审计事实源：scripts/gen-telemetry-schema.ts 由本文件生成
 *      schema/telemetry/*.schema.json（tracked），外部审计员不读源码即可
 *      还原可采集字段范围；drift 测试守门生成物与本文件同步。
 *
 * 红线：所有字段只允许计数 / 耗时 / 布尔 / 受控枚举 / 受控标识符（工具名、
 * 模型 ID、workspace slug 的 hash）。绝不允许文献全文 / PDF / 笔记原文 /
 * 对话原文 / 检索词 / 凭据 / 含用户名路径。error 类的 message 字段必须
 * 先经主进程 redact 脱敏再进 schema 校验，且有长度上限兜底。
 *
 * 注：原 PRD 6 类中的「Proposal 五档决策信号」已随 Proposal 移出 0.3 删除；
 * 隐式反馈保留 thumbs_up / thumbs_down 枚举位，但 0.3 无赞踩 UI（另开 issue）。
 */
import { z } from 'zod'

/** 所有信号共有的封皮字段 */
const SignalBase = z.object({
  /** 信号产生时间（epoch ms） */
  ts: z.number().int().nonnegative(),
  /** 归属的 agent session（UUID，本地会话标识，不含用户信息） */
  sessionId: z.string().max(64).optional(),
})

/** ① 任务结构：一次 Agent 任务的形态画像（不含任何 prompt 原文） */
export const TaskStructureSignal = SignalBase.extend({
  kind: z.literal('task_structure'),
  /** 用户消息字符数（只采长度，不采内容） */
  promptChars: z.number().int().nonnegative().optional(),
  attachmentCount: z.number().int().nonnegative().optional(),
  mentionedSkillCount: z.number().int().nonnegative().optional(),
  /** SDK result 的回合数 */
  numTurns: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  success: z.boolean().optional(),
})

/** ② 工具使用：单次工具调用的名称与结果（不含 input/output 内容） */
export const ToolUsageSignal = SignalBase.extend({
  kind: z.literal('tool_usage'),
  /** 工具名（受控标识符：Read / Bash / mcp__zotero__search 等） */
  toolName: z.string().max(128),
  success: z.boolean().optional(),
  durationMs: z.number().int().nonnegative().optional(),
})

/** ③ 模型选型：本次任务实际生效的模型与渠道类型 */
export const ModelChoiceSignal = SignalBase.extend({
  kind: z.literal('model_choice'),
  /** 模型 ID（受控枚举值，如 claude-sonnet-4-6） */
  modelId: z.string().max(128),
  /** 渠道类型（受控枚举：anthropic / bedrock / ...），不含用户自定义渠道名 */
  channelType: z.string().max(64).optional(),
})

/** ④ 错误异常：错误形态（message 必须先经 redact 脱敏，长度兜底截断） */
export const ErrorEventSignal = SignalBase.extend({
  kind: z.literal('error_event'),
  /** 错误发生阶段（受控枚举：agent_run / tool_call / provider / ipc 等） */
  stage: z.string().max(64),
  /** 已脱敏的错误摘要（无邮箱 / IP / 用户名路径），上限 512 字符 */
  message: z.string().max(512).optional(),
  retryable: z.boolean().optional(),
})

/** ⑤ 工作区结构：工作区规模画像（只采计数，不含名称与内容） */
export const WorkspaceStructureSignal = SignalBase.extend({
  kind: z.literal('workspace_structure'),
  /** workspace 的非可逆 hash（不采 slug 原文，slug 可能含研究主题） */
  workspaceHash: z.string().max(64).optional(),
  sessionCount: z.number().int().nonnegative().optional(),
  paperCount: z.number().int().nonnegative().optional(),
  noteCount: z.number().int().nonnegative().optional(),
})

/** 隐式反馈动作枚举（thumbs_* 为 0.3 占位，无 UI） */
export const IMPLICIT_FEEDBACK_ACTIONS = [
  'copy',
  'save',
  'cite',
  'discard',
  'thumbs_up',
  'thumbs_down',
  'retry',
] as const

/** ⑥ 用户隐式反馈：对 Agent 产出的隐式质量信号 */
export const ImplicitFeedbackSignal = SignalBase.extend({
  kind: z.literal('implicit_feedback'),
  action: z.enum(IMPLICIT_FEEDBACK_ACTIONS),
  /** 反馈对象类型（受控枚举：message / review / paper / note） */
  target: z.string().max(64).optional(),
})

export const SelfEvolutionSignal = z.discriminatedUnion('kind', [
  TaskStructureSignal,
  ToolUsageSignal,
  ModelChoiceSignal,
  ErrorEventSignal,
  WorkspaceStructureSignal,
  ImplicitFeedbackSignal,
])

export type SelfEvolutionSignal = z.infer<typeof SelfEvolutionSignal>
export type ImplicitFeedbackAction = (typeof IMPLICIT_FEEDBACK_ACTIONS)[number]

/** 上报封皮：deviceId 由主进程注入，信号体过白名单 */
export const SignalEnvelope = z.object({
  /** 匿名设备标识（UUID，#420 登录落地后通过 alias 关联账户） */
  deviceId: z.string().max(64),
  signals: z.array(SelfEvolutionSignal),
})

export type SignalEnvelope = z.infer<typeof SignalEnvelope>

/**
 * 信号出口白名单校验：合法 → 返回 strip 后的信号（未声明字段已丢弃）；
 * 非法 → 返回 null（调用方丢弃，不上报不落盘）。
 */
export function validateSignal(raw: unknown): SelfEvolutionSignal | null {
  const result = SelfEvolutionSignal.safeParse(raw)
  return result.success ? result.data : null
}

/** 供 JSON Schema 生成脚本与 drift 测试共用的「类名 → schema」映射 */
export const SELF_EVOLUTION_SIGNAL_SCHEMAS = {
  'task-structure': TaskStructureSignal,
  'tool-usage': ToolUsageSignal,
  'model-choice': ModelChoiceSignal,
  'error-event': ErrorEventSignal,
  'workspace-structure': WorkspaceStructureSignal,
  'implicit-feedback': ImplicitFeedbackSignal,
} as const
