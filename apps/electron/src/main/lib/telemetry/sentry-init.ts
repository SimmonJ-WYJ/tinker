/**
 * Sentry 崩溃上报初始化（issue #416 / ADR-011）
 *
 * - 恒开无 toggle（PRD：数据采集 tab 仅 PostHog + 自进化两开关），
 *   但 dev 门控（未打包 / ASCI_DEV=1）与 DSN 缺省（账号未开通）时不初始化
 * - 覆盖 main + renderer 双进程（@sentry/electron 原生双进程架构；
 *   renderer 侧初始化见 renderer/lib/sentry.ts，preload 桥见 preload/index.ts）
 * - 脱敏（T-1/T4/T4a）：sendDefaultPii=false（不采 IP）+ beforeSend 对整个
 *   event 深度 redact（邮箱 / IP / 堆栈路径用户名段 → <USER>）+
 *   beforeBreadcrumb 同样脱敏
 * - 已知边界：native minidump（Crashpad 二进制转储）无法客户端脱敏，
 *   其上传不含 ASCI 注入的用户字段；JS 层事件全部走 beforeSend（ADR-011 记录）
 *
 * 打包注意（CLAUDE.md §7.1 例外）：@sentry/electron 依赖 OTel 动态
 * instrumentation（require-in-the-middle），不可被 esbuild bundle，
 * 必须 --external + electron-builder files 带上完整传递闭包。
 */
import { redactDeepWithMatches, scrubSentryEvent } from '@asci/shared'
import { getSentryDsn } from '../build-config.ts'
import { isDevRuntime, isRealSendAllowed } from '../dev-runtime.ts'

/**
 * Sentry 是否「应当处于活跃」状态的单一判定：DSN 已配置 + dev 放行。
 * initSentryMain 与崩溃诊断（crash-diagnostics）共用此门控，避免两处独立推导漂移。
 */
export function isSentryActive(): boolean {
  return Boolean(getSentryDsn()) && isRealSendAllowed()
}

/**
 * 取已初始化的 main 进程 Sentry 实例；门控同 initSentryMain。
 * 未配置 / dev 不放行 / 模块加载失败时返回 null（调用方据此 noop）。
 * 动态 require 保留：避免 dev / 单测加载 OTel 依赖树（§7.1 不可 bundle）。
 */
export function getActiveSentryMain(): typeof import('@sentry/electron/main') | null {
  if (!isSentryActive()) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@sentry/electron/main') as typeof import('@sentry/electron/main')
  } catch {
    return null
  }
}

/**
 * 主进程 Sentry 初始化；app ready 前尽早调用。
 * DSN 缺省 / dev 模式下 noop（开发与测试不被账号阻塞）。
 * dev 下可用 ASCI_TELEMETRY_FORCE_SEND=1 强制初始化以验证上报与脱敏。
 */
export function initSentryMain(appVersion: string): void {
  const dsn = getSentryDsn()
  if (!dsn) {
    console.log('[遥测] Sentry DSN 未配置，跳过初始化')
    return
  }
  if (!isRealSendAllowed()) {
    console.log('[遥测] dev 模式，Sentry 不初始化（如需联调置 ASCI_TELEMETRY_FORCE_SEND=1）')
    return
  }

  // 动态 require：dev / 单测下完全不加载 OTel 依赖树
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require('@sentry/electron/main') as typeof import('@sentry/electron/main')
  Sentry.init({
    dsn,
    release: `asci@${appVersion}`,
    // dev 联调（force-send）标 development、打包产物标 production；与 renderer 端一致，
    // 使 Sentry 看板可按 environment 区分联调噪音与真实生产崩溃。
    environment: isDevRuntime() ? 'development' : 'production',
    // 不采集 PII：无 IP、无 cookies、无用户标识
    sendDefaultPii: false,
    // 性能追踪不在 #416 范围，只收崩溃/异常
    tracesSampleRate: 0,
    // 深度脱敏：堆栈 frame 路径、异常 message、上下文字符串 + 清 user/request
    beforeSend(event) {
      return scrubSentryEvent(event)
    },
    beforeBreadcrumb(breadcrumb) {
      return redactDeepWithMatches(breadcrumb).value
    },
  })
  console.log('[遥测] Sentry 已初始化（main + renderer）')
}
