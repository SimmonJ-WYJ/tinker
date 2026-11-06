/**
 * 遥测统一汇集服务（ADR-011 主进程统一汇集架构）
 *
 * 所有行为事件（renderer IPC 投递 + 主进程直接调用）与自进化信号的
 * 唯一闸口，按序执行：
 *   1. consent 闸门 —— 采集入口全停语义：对应 toggle 关闭则不写盘不上报
 *   2. 白名单 —— 行为事件属性来自注册表类型约束；信号过 Zod validateSignal
 *   3. 脱敏 —— redactDeep 兜底（属性本应无自由文本，防御性再过一遍）
 *   4. deviceId / ts 注入
 *   5. 出口 —— dev 门控（未打包 / ASCI_DEV=1）只落本地 JSONL 不发网络；
 *      prod 走 PosthogSender / SignalSender
 *
 * Sentry 不经过本服务（恒开、有独立的 beforeSend 脱敏，见 sentry-init.ts）。
 */
import {
  redactDeepWithMatches,
  resolveConsentState,
  validateSignal,
  TELEMETRY_PROP_ALLOWLIST,
  type TelemetryConsentState,
  type TelemetryTrackRequest,
} from '@asci/shared'
import { getSettings } from '../settings-service.ts'
import { getPosthogKey } from '../build-config.ts'
import { isRealSendAllowed } from '../dev-runtime.ts'
import { getDeviceId } from './device-id.ts'
import { JsonlBuffer } from './jsonl-buffer.ts'
import { PosthogSender } from './posthog-sender.ts'
import { SignalSender } from './signal-sender.ts'
import { fetchFeatureFlagEnabled } from './posthog-flags.ts'

/** 远程 kill switch flag key（PostHog Feature Flag）：false → 强制停 PostHog 上报 */
const REMOTE_KILL_FLAG = 'enabledDevPosthog'
/** 远程 flag 刷新间隔（让管理员翻转后无需重启即可在下个周期生效） */
const FLAG_REFRESH_MS = 10 * 60 * 1000

export interface TelemetryInitOptions {
  /** 测试注入：覆盖系统时区（T-3 地域分支验证用） */
  timeZone?: string
}

class TelemetryService {
  private consent: TelemetryConsentState | undefined
  private eventsBuffer: JsonlBuffer | undefined
  private posthogSender: PosthogSender | undefined
  private signalSender: SignalSender | undefined
  private timeZoneOverride: string | undefined
  /**
   * dev 上报门控（实时）：dev 默认 false（只写本地）；设置页开关或 env 打开后即时放行，
   * 无需重启。打包产物恒 true。每次 refreshConsent 重算（设置变更时 ipc 会触发）。
   */
  private realSendAllowed = false
  /** 远程 kill switch：仅当 flag 明确为 false 时为 true（拉取失败/未知保持 false=放行） */
  private remoteKillActive = false
  private flagTimer: ReturnType<typeof setInterval> | undefined
  /**
   * 当前登录账户标识（OPENSCI uid，#420）。登录后作 distinct_id；
   * 未登录 / 登出 → undefined → 回落匿名 deviceId。非 PII。
   */
  private userId: string | undefined

  /** 当前 distinct_id：登录态用账户 uid，否则匿名 deviceId */
  private currentDistinctId(): string {
    return this.userId ?? getDeviceId()
  }

  /** 应用启动时调用（settings 可读后）；重复调用幂等 */
  init(options?: TelemetryInitOptions): void {
    this.timeZoneOverride = options?.timeZone ?? this.timeZoneOverride
    this.refreshConsent() // 内含 realSendAllowed 重算 + flag 轮询启动
    if (!this.eventsBuffer) {
      this.eventsBuffer = new JsonlBuffer('events.jsonl')
      // sender 恒带真实 key/endpoint；是否真发由 track() 处的 realSendAllowed 实时门控
      // 决定（dev 切开关即时生效，不必重启）。dev signal 无 endpoint，天然不外发。
      this.posthogSender = new PosthogSender(getPosthogKey(), this.eventsBuffer)
      this.signalSender = new SignalSender(
        process.env.ASCI_EVOLUTION_ENDPOINT || undefined,
        new JsonlBuffer('signals.jsonl'),
        getDeviceId(),
      )
    }
  }

  /** 客户端允许上报且有 key 时，启动远程 kill switch 轮询（幂等，仅启一次） */
  private ensureFlagPolling(): void {
    if (this.realSendAllowed && getPosthogKey() && !this.flagTimer) {
      void this.refreshRemoteKillSwitch()
      this.flagTimer = setInterval(() => void this.refreshRemoteKillSwitch(), FLAG_REFRESH_MS)
      this.flagTimer.unref?.()
    }
  }

  /**
   * 拉取远程 kill switch（PostHog Feature Flag enabledDevPosthog）。
   * flag===false → 停发；===true → 放行；拉取失败/未知 → 以客户端为准（放行）。
   */
  private async refreshRemoteKillSwitch(): Promise<void> {
    const key = getPosthogKey()
    if (!key) return
    const enabled = await fetchFeatureFlagEnabled(key, getDeviceId(), REMOTE_KILL_FLAG)
    const wasKilled = this.remoteKillActive
    this.remoteKillActive = enabled === false // 仅显式 false 拦截；undefined（拉取失败）→ 放行
    if (this.remoteKillActive !== wasKilled) {
      console.log(
        `[遥测] 远程 kill switch ${REMOTE_KILL_FLAG}=${enabled === false ? 'false → 停止 PostHog 上报' : '放行'}`,
      )
    }
  }

  /** settings 变更后重算生效状态（ipc settings:update 处调用）：consent + dev 上报门控 */
  refreshConsent(): void {
    const timeZone =
      this.timeZoneOverride ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    this.consent = resolveConsentState(timeZone, getSettings().telemetryConsent)
    // dev 上报开关切换 → 实时反映；首次允许时顺带起远程 flag 轮询
    this.realSendAllowed = isRealSendAllowed()
    this.ensureFlagPolling()
  }

  /** 懒初始化兜底：未显式 init（如单测 / 启动早期）时按需初始化 */
  private ensureInitialized(): void {
    if (!this.consent) this.init()
  }

  /** 当前生效 consent 状态（renderer 设置页查询用） */
  getConsentState(): TelemetryConsentState {
    this.ensureInitialized()
    // init 后 consent 必有值；冗余兜底保持类型干净
    return this.consent ?? resolveConsentState(undefined, undefined)
  }

  /**
   * 第三方出口净化（#710 P0-5）：按事件白名单过滤属性键 + 凭证/路径感知脱敏（防御性）。
   * 本地 events.jsonl 与 PostHog 上报共用本结果，故本地诊断面同样只含白名单 + 脱敏值。
   */
  private sanitizeProps(event: TelemetryTrackRequest['event'], props: Record<string, unknown>): Record<string, unknown> {
    const allow = TELEMETRY_PROP_ALLOWLIST[event] ?? []
    const filtered: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(props)) {
      if (allow.includes(k)) filtered[k] = v
    }
    return redactDeepWithMatches(filtered).value
  }

  /** 行为事件埋点（PostHog 路）—— consent 关闭时完全不落地 */
  track(request: TelemetryTrackRequest): void {
    this.ensureInitialized()
    if (!this.consent?.posthogEnabled) return
    const item = {
      event: request.event,
      distinct_id: this.currentDistinctId(),
      properties: this.sanitizeProps(request.event, { ...request.props }),
      timestamp: new Date().toISOString(),
    }
    // 本地 JSONL 恒写（不算"上报"）；网络上报受 dev 门控（realSendAllowed，dev 默认关、
    // 设置页/ env 手动开）+ 服务端远程 kill switch 双重拦截。
    this.eventsBuffer?.append(item)
    if (this.realSendAllowed && !this.remoteKillActive) this.posthogSender?.enqueue(item)
  }

  /**
   * 登录成功：把后续事件归属到账户 uid，并合并此前匿名 deviceId 的历史（#420）。
   *
   * 发一条 PostHog `$identify`：`$anon_distinct_id` 触发设备匿名事件 → uid 的
   * 身份合并（等价 alias，无需 posthog-js）；`$set` 写 person 属性。
   * 红线：只接受 uid + institution/discipline/signupMethod，**绝不传 email/姓名/头像**。
   * consent 关 / dev 未放行 / 远程 kill 时只记 userId、不发网络（与 track 同门控）。
   */
  identifyUser(
    uid: string,
    props?: { institution?: string | null; discipline?: string | null; signupMethod?: string | null },
  ): void {
    this.ensureInitialized()
    if (!uid) return
    this.userId = uid
    if (!this.consent?.posthogEnabled || !this.realSendAllowed || this.remoteKillActive) return
    const set: Record<string, unknown> = {}
    if (props?.institution) set.institution = props.institution
    if (props?.discipline) set.discipline = props.discipline
    if (props?.signupMethod) set.signup_method = props.signupMethod
    const item = {
      event: '$identify',
      distinct_id: uid,
      properties: redactDeepWithMatches({ $anon_distinct_id: getDeviceId(), $set: set }).value as Record<string, unknown>,
      timestamp: new Date().toISOString(),
    }
    this.eventsBuffer?.append(item)
    this.posthogSender?.enqueue(item)
  }

  /** 登出：后续事件回落匿名 deviceId（不回写 person 属性、不反向 alias） */
  clearUser(): void {
    this.userId = undefined
  }

  /** 自进化信号采集（独立通道）—— consent 关闭时完全不落地 */
  captureSignal(raw: Record<string, unknown>): void {
    this.ensureInitialized()
    if (!this.consent?.agentEvolutionEnabled) return
    const signal = validateSignal(redactDeepWithMatches({ ...raw, ts: Date.now() }).value)
    if (!signal) {
      console.warn('[遥测] 信号未过 schema 白名单，已丢弃:', raw['kind'])
      return
    }
    // signal-sender 恒写本地 signals.jsonl；仅在 dev 允许且配了 endpoint 时才外发
    if (this.realSendAllowed) this.signalSender?.capture(signal)
    else this.signalSender?.bufferOnly(signal)
  }

  /** app 退出前清空发送队列 */
  async shutdown(): Promise<void> {
    if (this.flagTimer) {
      clearInterval(this.flagTimer)
      this.flagTimer = undefined
    }
    await Promise.allSettled([this.posthogSender?.flush(), this.signalSender?.flush()])
  }

  /** 仅测试用：重置全部内部状态（配合 ASCI_CONFIG_HOME 隔离） */
  resetForTest(): void {
    this.consent = undefined
    this.eventsBuffer = undefined
    this.posthogSender = undefined
    this.signalSender = undefined
    this.timeZoneOverride = undefined
    this.realSendAllowed = false
    this.remoteKillActive = false
    this.userId = undefined
    if (this.flagTimer) {
      clearInterval(this.flagTimer)
      this.flagTimer = undefined
    }
  }
}

/** 主进程单例 */
export const telemetryService = new TelemetryService()
