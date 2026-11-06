/**
 * OutputFeedback IPC 通道与类型 —— 助手输出的 👍/👎 直观反馈采集（issue #477）
 *
 * 渲染端通过 `window.electronAPI.outputFeedback.*` 调用，主进程 ipcMain.handle 注册
 * 同名通道；业务逻辑落到 apps/electron/src/main/lib/output-feedback-service.ts，
 * 把每次表态以 append-only 事件追加写到 ~/.asci/feedback/<sessionId>.jsonl。
 *
 * 设计规格见 docs/specs/output-feedback-spec.md
 */

/** 反馈值；'none' 表示取消表态（折叠回显时从 map 删除） */
export type OutputFeedbackValue = 'up' | 'down' | 'none'

/** 落盘的单条反馈事件（append-only JSONL，一行一条；含切换 / 取消） */
export interface OutputFeedbackEvent {
  /** 助手消息 uuid（折叠键；同一 uuid 取最后一条为当前态） */
  messageUuid: string
  /** 对应用户提问消息 uuid（可空：极端历史消息无配对提问） */
  userMessageUuid?: string
  /** Agent session id */
  sessionId: string
  /** workspace id（按 workspace 切分分析用，可空） */
  workspaceId?: string
  /** 反馈值；'none' 表示取消表态 */
  value: OutputFeedbackValue
  /** 事件写入时间，ISO 8601（由主进程生成，避免渲染端时钟不一致） */
  createdAt: string
  /** 可选维度：产出该消息的模型 id */
  model?: string
  /** 可选维度：能力包 scenario 标识 */
  scenario?: string
}

/** 单条消息折叠后的选中态：'up' / 'down' / null（未表态或已取消） */
export type FeedbackSelection = Exclude<OutputFeedbackValue, 'none'> | null

/** 回显：messageUuid → 当前态（'up' / 'down'）；'none'（取消）不出现在 map 中 */
export type SessionFeedbackMap = Record<string, Exclude<OutputFeedbackValue, 'none'>>

export const OUTPUT_FEEDBACK_IPC_CHANNELS = {
  /** 写入/切换/取消一条反馈，返回折叠后的当前态 */
  SET: 'outputFeedback:set',
  /** 拉取某 session 的回显 map */
  GET_FOR_SESSION: 'outputFeedback:getForSession',
} as const

export interface OutputFeedbackSetInput {
  sessionId: string
  messageUuid: string
  userMessageUuid?: string
  workspaceId?: string
  value: OutputFeedbackValue
  model?: string
  scenario?: string
}

/** 返回折叠后的当前态（'none' → null，便于渲染端判断高亮） */
export interface OutputFeedbackSetResult {
  value: FeedbackSelection
}

export interface OutputFeedbackGetForSessionInput {
  sessionId: string
}

export type OutputFeedbackGetForSessionResult = SessionFeedbackMap
