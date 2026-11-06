/**
 * 遥测 IPC 契约（ADR-011 主进程统一汇集架构）
 *
 * 流程：
 *  1. renderer 显式埋点（事件名取 event-registry 常量，禁裸字符串）
 *  2. ipcRenderer.invoke → 主进程 telemetry-service
 *  3. 主进程统一执行：consent 闸门 → 脱敏 → deviceId 注入 → 上报/本地缓冲
 *
 * consent 开关本身走现有 settings:get/update 通道（AppSettings.telemetryConsent），
 * 此处只承载事件与信号的单向投递。
 */
import type { TelemetryTrackRequest } from './event-registry.ts'
import type { SelfEvolutionSignal } from '../schemas/telemetry-signals.ts'

export const TELEMETRY_IPC_CHANNELS = {
  /** renderer → main：行为事件投递（fire-and-forget，ipcRenderer.invoke） */
  TRACK: 'telemetry:track',
  /** renderer → main：自进化隐式反馈信号投递 */
  CAPTURE_SIGNAL: 'telemetry:capture-signal',
  /** renderer → main：查询运行时 consent 状态（地域默认 + 用户选择合成结果） */
  GET_CONSENT_STATE: 'telemetry:get-consent-state',
  /** renderer → main（sendSync）：dev 是否允许真实上报（env || dev 开关），renderer Sentry 启动期门控用 */
  REAL_SEND_ALLOWED: 'telemetry:real-send-allowed',
} as const

export type TelemetryIpcChannel = (typeof TELEMETRY_IPC_CHANNELS)[keyof typeof TELEMETRY_IPC_CHANNELS]

/** 对 union 逐成员 Omit（普通 Omit 会把 discriminated union 塌缩成公共字段交集） */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** telemetry:capture-signal 载荷（ts/deviceId 由主进程注入，renderer 只给信号体） */
export type TelemetryCaptureSignalRequest = DistributiveOmit<SelfEvolutionSignal, 'ts'>

export type { TelemetryTrackRequest }
