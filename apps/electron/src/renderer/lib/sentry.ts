/**
 * renderer Sentry 初始化（issue #416 / ADR-011）
 *
 * 捕获 renderer 未捕获 JS 异常 / unhandled rejection，经 preload 桥
 * （@sentry/electron/preload）转发主进程统一上报。配置随主进程合并：
 * 主进程未初始化（dev / DSN 缺省）时 renderer 事件无处可去，等效关闭——
 * 因此这里只做 Vite dev 门控 + 双保险脱敏，不需要自带 DSN。
 *
 * 脱敏双保险：主进程 beforeSend 只覆盖 main 自身事件，renderer 转发的
 * envelope 不再过主进程 beforeSend，故 renderer 侧必须有自己的 beforeSend。
 */
import { init } from '@sentry/electron/renderer'
import { redactDeepWithMatches, scrubSentryEvent } from '@asci/shared'
import { getIsDevMode } from '@/lib/dev-mode'

/** beforeSend 只读到的最小 event 形状（避免耦合 Sentry 导出类型 / 不用 any）。 */
interface SentryEventLike {
  exception?: { values?: Array<{ type?: string; value?: string }> }
}

/**
 * 是否为 Vite HMR Fast-Refresh 失同步噪音：模块热更新（尤其某些模块「Could not
 * Fast Refresh」回退整页 invalidate）后，React reconciler 持有的真实 DOM 节点已被
 * 移动/替换，卸载或重排时对其 removeChild / insertBefore 抛 NotFoundError
 * （"…is not a child of this node"）。这是开发期产物、非产品 bug，仅在 dev 联调下丢弃。
 */
export function isHmrReconcilerNoise(event: SentryEventLike): boolean {
  return (
    event.exception?.values?.some(
      (v) =>
        v.type === 'NotFoundError' &&
        typeof v.value === 'string' &&
        v.value.includes('not a child of this node'),
    ) ?? false
  )
}

export function initSentryRenderer(): void {
  // vite dev 默认不上报；ASCI_TELEMETRY_FORCE_SEND=1（经 preload 透出）可在 dev 下强制初始化以联调。
  // 打包产物 telemetryForceSend 恒 false；getIsDevMode() 仅启动时读取一次，运行期切 Debug 不影响本次会话（需重启）。
  const forceSend = window.electronAPI?.telemetryForceSend === true
  if (getIsDevMode() && !forceSend) return
  // 打包产物 forceSend 恒 false → 'production'；dev 联调（forceSend）→ 'development'。
  // 打 environment 标签后 Sentry 看板可按 production 过滤，dev 联调噪音不再混入生产信号。
  const environment = forceSend ? 'development' : 'production'
  try {
    init({
      environment,
      sendDefaultPii: false,
      beforeSend(event) {
        // dev 联调下丢弃 HMR Fast-Refresh 失同步噪音；生产环境保留以防真实 React 异常。
        if (environment === 'development' && isHmrReconcilerNoise(event)) return null
        return scrubSentryEvent(event)
      },
      beforeBreadcrumb(breadcrumb) {
        return redactDeepWithMatches(breadcrumb).value
      },
    })
  } catch (err) {
    console.warn('[遥测] renderer Sentry 初始化失败（忽略）:', err)
  }
}
