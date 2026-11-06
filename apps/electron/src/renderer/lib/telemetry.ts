/**
 * renderer 遥测薄封装（ADR-011 主进程统一汇集）
 *
 * 所有 renderer 侧埋点的唯一出口：fire-and-forget 投递到主进程
 * telemetry-service（consent 闸门 / 脱敏 / 上报都在主进程，renderer 零判断）。
 * 事件名必须取 @asci/shared 注册表常量，禁止裸字符串。
 */
import type { ImplicitFeedbackAction, TelemetryTrackRequest } from '@asci/shared'

/** 行为事件埋点（PostHog 路） */
export function trackEvent(request: TelemetryTrackRequest): void {
  void window.electronAPI.telemetryTrack(request).catch(() => {
    /* 遥测失败静默——绝不影响 UI 主流程 */
  })
}

/**
 * 隐式反馈信号（自进化路，issue #427）
 *
 * @param action 反馈动作（copy / save / cite / discard / retry；thumbs 为 0.3 占位无 UI）
 * @param target 反馈对象类型（受控枚举：message / review / paper / note）
 * @param sessionId 关联的 agent 会话（可选）
 */
export function captureFeedback(
  action: ImplicitFeedbackAction,
  target?: string,
  sessionId?: string,
): void {
  void window.electronAPI
    .telemetryCaptureSignal({ kind: 'implicit_feedback', action, target, sessionId })
    .catch(() => {
      /* 遥测失败静默 */
    })
}
