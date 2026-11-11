/** 正式Rust服务wire v1；秘密配置只供可信宿主初始化，不能传给renderer。 */
export const DESKTOP_RUNTIME_VERSION = 1 as const
export const DESKTOP_RUNTIME_MAX_FRAME_BYTES = 4 * 1024 * 1024
export const DESKTOP_RUNTIME_MAX_PAGE_BYTES = 2 * 1024 * 1024
export const DESKTOP_RUNTIME_MAX_PENDING = 32
export const DESKTOP_RUNTIME_MAX_AGGREGATE_BYTES = 16 * 1024 * 1024
export type DesktopMethod = keyof DesktopParams
export interface DesktopRequest<M extends DesktopMethod = DesktopMethod> {
  version: 1
  id: string
  method: M
  params: DesktopParams[M]
}
export type DesktopReply<T = unknown> =
  | { version: 1; id: string; result: T; error?: never }
  | { version: 1; id: string; result?: never; error: { code: string } }
export type DesktopProtocol = 'openai-chat' | 'anthropic-messages'
export interface DesktopModel { modelId: string; label: string; supportedEfforts: DesktopEffort[] }
export interface DesktopProfile {
  profileId: string
  label: string
  configRevision: string
  models: DesktopModel[]
  protocol: DesktopProtocol
}
/** 仅可信主进程/启动器拥有；不发送至renderer，不写进会话journal。 */
export interface DesktopTrustedProfile {
  profileId: string
  label: string
  configRevision: string
  models: { modelId: string; label: string; supportedEfforts?: DesktopEffort[] }[]
  /** 旧可信配置缺省openai-chat；不接受renderer提供的能力声明。 */
  protocol?: DesktopProtocol
  endpoint: string
  key: string
}
export type DesktopEffort = 'low' | 'medium' | 'high' | 'max'
export interface DesktopSend {
  requestId: string
  sessionId: string
  profileId: string
  modelId: string
  userMessage: string
  startedAt: number
  effort: DesktopEffort | null
}
export interface DesktopParams {
  'runtime.describe': Record<string, never>
  'profiles.list': Record<string, never>
  'sessions.list': Record<string, never>
  'sessions.create': { title: string; profileId: string; workspaceId: string | null; reuseDraft: boolean }
  'sessions.update': { sessionId: string; title?: string; pinned?: boolean; archived?: boolean }
  'sessions.delete': { sessionId: string }
  'sessions.history': { sessionId: string; after: number; limit: number }
  'chat.send': DesktopSend
  'chat.cancel': { sessionId: string; requestId: string }
  'chat.events': { sessionId: string; requestId: string; afterSequence: number; limit: number }
}
export interface DesktopSession {
  sessionId: string
  title: string
  profileId: string
  workspaceId: string | null
  pinned: boolean
  archived: boolean
  createdAt: number
  /** 最后用户变更的宿主提交时间；模型流式和终态不改变排序。 */
  updatedAt: number
  deleted: boolean
}
export type DesktopRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export interface DesktopTurn extends DesktopSend {
  runId: string
  userMessageId: string
  assistantMessageId: string
  configRevision: string
  assistantMessage: string
  status: DesktopRunStatus
  sequence: number
  errorCode: string | null
}
export interface DesktopEvent {
  sessionId: string
  requestId: string
  runId: string
  startedAt: number
  sequence: number
  kind: 'started' | 'delta' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  text: string | null
  errorCode: string | null
}
export interface DesktopResults {
  'runtime.describe': { version: 1; maxFrameBytes: number; maxPageBytes: number; maxPending: number; capabilities: string[]; efforts: DesktopEffort[] }
  'profiles.list': { profiles: DesktopProfile[] }
  'sessions.list': { sessions: DesktopSession[] }
  'sessions.create': DesktopSession
  'sessions.update': DesktopSession
  'sessions.delete': { deleted: true }
  'sessions.history': { turns: DesktopTurn[]; nextAfter: number; hasMore: boolean }
  'chat.send': DesktopTurn
  'chat.cancel': DesktopTurn
  'chat.events': { turn: DesktopTurn; events: DesktopEvent[]; nextAfterSequence: number; hasMore: boolean }
}

/** 主进程确认的隔离预览状态；只读，不接收路径或执行参数。 */
export const DESKTOP_PREVIEW_STATUS_CHANNEL = 'desktop-runtime:preview-status'
