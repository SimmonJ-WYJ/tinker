/**
 * PostHog 行为事件注册表（issue #426 / ADR-011）
 *
 * 唯一事实源：所有行为埋点的事件名 + 属性白名单都集中声明在这里，
 * 调用点必须引用 TELEMETRY_EVENTS 常量，禁止裸字符串——保证：
 *   1. 可审计：外部 review 此文件即可还原全部可采集字段范围
 *   2. 防漂移：事件名拼写错误在编译期暴露
 *
 * 红线（0.3.0 PRD Epic 3）：属性白名单中绝不允许出现
 * 检索词原文 / 文献标题 / 笔记原文 / 对话原文 / 邮箱 / 用户名 / 含用户名路径。
 * 新增事件或属性必须 review 是否触线。
 */

import type { ConversationType } from './conversation-type.ts'

export const TELEMETRY_EVENTS = {
  /** 应用启动（主进程 app ready 后发） */
  APP_LAUNCHED: 'app_launched',
  /** 本地用户档案首次创建（#420 登录落地前的占位归属事件） */
  PROFILE_CREATED: 'profile_created',
  /** OPENSCI 登录完成 —— 占位，等 #420 登录端到端落地后接入 */
  LOGIN_COMPLETED: 'login_completed',
  /** 论文检索执行（只采计数与耗时，绝不采检索词原文） */
  SEARCH_EXECUTED: 'search_executed',
  /** 综述生成完成 */
  REVIEW_GENERATED: 'review_generated',
  /** Agent 任务（一次 runAgent 会话轮）结束 */
  AGENT_TASK_COMPLETED: 'agent_task_completed',
} as const

export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[keyof typeof TELEMETRY_EVENTS]

/**
 * 每个事件的属性白名单 —— 只允许计数 / 耗时 / 布尔 / 受控枚举，
 * 不允许任何自由文本字段（模型 ID / 渠道类型是受控枚举值，非用户内容）。
 */
export interface TelemetryEventPropsMap {
  app_launched: {
    appVersion: string
    platform: NodeJS.Platform | string
    /** UI 语言（'zh' / 'en'） */
    uiLocale?: string
  }
  profile_created: Record<string, never>
  login_completed: {
    /** 注册/登录源（受控枚举：opensci / email / google / orcid），非 PII */
    signupMethod?: string
  }
  search_executed: {
    /** 检索来源（受控枚举：openalex / zotero 等） */
    source?: string
    resultCount?: number
    durationMs?: number
    success: boolean
  }
  review_generated: {
    paperCount?: number
    durationMs?: number
    success: boolean
  }
  agent_task_completed: {
    numTurns?: number
    durationMs?: number
    success: boolean
    /** 受控枚举：SDK result subtype（success / error_max_turns / ...） */
    resultSubtype?: string
    modelId?: string
    /** 渠道类型（受控枚举：anthropic / bedrock / ...），不含渠道名等用户自定义文本 */
    channelType?: string
    /**
     * 本轮任务消耗的 token 总数（input + output + cache_read + cache_creation）。
     * 取自 SDK result.modelUsage 按模型聚合后求和，含主 Agent 与所有子 Agent；纯计数无 PII。
     */
    totalTokens?: number
    /** 受控枚举：对话类型（search 检索 / review 综述 / other 其他），由粘滞能力包映射，不含原始包 id */
    conversationType?: ConversationType
  }
}

/** 带编译期属性白名单约束的 track 请求（renderer → main IPC 载荷） */
export type TelemetryTrackRequest = {
  [K in TelemetryEventName]: { event: K; props: TelemetryEventPropsMap[K] }
}[TelemetryEventName]

/** 披露分级（spec §3）：第三方 payload 字段治理标注用。 */
export type DisclosureLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4'

/**
 * 第三方（PostHog）出口字段白名单（#710 P0-5）：每事件允许外发的属性键，与上方 PropsMap 同口径。
 * telemetry-service.track 发送前按此**运行期过滤**——丢弃任何不在白名单的键（防 renderer / 上游误塞
 * 自由文本）。红线：所有属性均为计数 / 耗时 / 布尔 / 受控枚举（L0-L2），绝无 prompt body / raw tool I/O /
 * 完整 query / 路径 / secret。新增事件属性时务必同步此处，由 event-registry 测试守门。
 */
export const TELEMETRY_PROP_ALLOWLIST: Record<TelemetryEventName, readonly string[]> = {
  app_launched: ['appVersion', 'platform', 'uiLocale'],
  profile_created: [],
  login_completed: ['signupMethod'],
  search_executed: ['source', 'resultCount', 'durationMs', 'success'],
  review_generated: ['paperCount', 'durationMs', 'success'],
  agent_task_completed: [
    'numTurns',
    'durationMs',
    'success',
    'resultSubtype',
    'modelId',
    'channelType',
    'totalTokens',
    'conversationType',
  ],
}
